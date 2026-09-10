# MetroFlow — Sprint C: Production Readiness Checklist

> **Document:** `architecture/sprint-c-production-readiness.md`
> **Status:** Approved — Locked
> **Covers:** Resilience, concurrency, observability, security, Docker, testing, V1 freeze

---

## 1. What Must Be Atomic (Transaction Boundaries)

| Operation | Tables in one transaction |
|---|---|
| Gate entry ALLOW | tickets + journeys + gate_events |
| Gate exit ALLOW | tickets + journeys + gate_events |
| Gate REJECT | gate_events only |
| Payment webhook success | payment_attempts + payments + outbox_events |
| Core: payment.succeeded Transaction A | purchases only: `PAYMENT_PENDING → PAID` — **COMMIT** |
| Core: payment.succeeded Transaction B | tickets + purchases `PAID → TICKET_ISSUED` + `ticket.issued` outbox_events — **COMMIT**; PAID remains recoverable if this fails |
| Password reset | users + password_reset_tokens + sessions |
| Token rotation | sessions (REVOKE old) → sessions (INSERT new) |

Rule: if partial state would cause a business invariant violation, it must be in one transaction.

---

## 2. Concurrency Protection Summary

| Race condition | Protection |
|---|---|
| Two gates scan same ticket simultaneously | `UPDATE tickets WHERE status='ISSUED'` returns 0 rows → second loses |
| Duplicate ticket issuance (Kafka replay) | `uq_tickets_payment_id` unique constraint |
| Duplicate purchase for same fare quote | `uq_purchases_fare_quote_id` unique constraint |
| Duplicate payment for same purchase | `uq_payments_purchase_id` unique constraint |
| Duplicate webhook | `uq_provider_events_id` → ON CONFLICT DO NOTHING |
| Concurrent token refresh | `UPDATE sessions WHERE status='ACTIVE' RETURNING id` → 0 rows = already rotated |

No application-level mutexes. Database constraints are the concurrency mechanism.

---

## 3. What Happens When Services Crash

| Service crashes | Impact | Recovery |
|---|---|---|
| Core API mid-request | HTTP 5xx to client | Client retries; DB transaction rolled back |
| Worker crash during outbox publish | Kafka may have accepted the event while the outbox row remains PENDING | Worker retries the PENDING outbox row after restart. Duplicate Kafka delivery is possible; consumer idempotency makes the replay safe. |
| Payment initiation before reservation commit | No durable initiation | Client may retry the same Idempotency-Key |
| Payment initiation after IN_PROGRESS reservation commit but before definitive provider result | IN_PROGRESS remains; provider outcome may be ambiguous | Do not blindly create another Razorpay Order; reconciliation/manual recovery required |
| Webhook before required durable commit | Transaction rolls back | Return 5xx; Razorpay retries |
| Webhook after durable commit | Provider/payment/outbox state exists | Duplicate webhook is idempotent |
| Payment Service after DB commit | Outbox PENDING | Publisher retries on restart |
| Gate Service | Gateway returns 503 | Gate Simulator shows error; passenger retries |
| Worker crash mid-consume | Kafka offset not committed | Event redelivered; consumer idempotency handles |
| Worker crash after email sent | Email delivered; offset not committed | Possible duplicate email — acceptable |

---

## 4. What Happens When Infrastructure Is Unavailable

| Infrastructure | Service affected | Behavior |
|---|---|---|
| PostgreSQL (Core DB) | Core API, Worker | HTTP 503 to clients; operations fail fast |
| PostgreSQL (Payment DB) | Payment Service | Webhook returns 5xx; Razorpay retries |
| Redis | Gate Service | Rate limit and idempotency degrade; DB constraints still protect |
| Redis | Core Auth | OTP verification returns 503; login fails safely |
| Kafka | Outbox publisher | Outbox events accumulate as PENDING; published when Kafka recovers |
| Kafka | Worker consumers | No emails sent; lag accumulates; workers catch up on recovery |
| Razorpay | Payment Service | Definitive no-Order result → reservation may become RETRYABLE and retry is safe; timeout/ambiguous result → IN_PROGRESS remains, no blind second Order, reconciliation required |

---

## 5. Internal Error → Safe Public Error Mapping

```
UniqueConstraintViolation:
  uq_tickets_payment_id    → TICKET_ALREADY_ISSUED (409)
  uq_tickets_purchase_id   → TICKET_ALREADY_ISSUED (409)
  uq_journeys_ticket_id    → TICKET_ALREADY_IN_JOURNEY (422)
  uq_users_email           → EMAIL_ALREADY_REGISTERED (409)
  uq_purchases_fare_quote  → FARE_QUOTE_ALREADY_USED (409)

DB connection error          → SERVICE_TEMPORARILY_UNAVAILABLE (503)
Redis connection error       → SERVICE_TEMPORARILY_UNAVAILABLE (503)
Kafka producer error         → SERVICE_TEMPORARILY_UNAVAILABLE (503)
Razorpay API error           → PAYMENT_PROVIDER_ERROR (502)
Unhandled exception          → INTERNAL_ERROR (500)

Rule: stack traces, SQL errors, constraint names, service names,
      Redis errors, Kafka errors NEVER reach the client response.
      They are logged with requestId only.
```

---

## 6. Structured Logging — Required Fields

Every log line:
```
timestamp, level, service, requestId
```

Add when available:
```
userId, purchaseId, paymentId, ticketId, journeyId,
gateId, stationId, outboxEventId, providerEventId
```

Never log:
```
JWT tokens, refresh tokens, passwords, OTP plaintext,
RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
full raw webhook payload, card data
```

---

## 7. Prometheus Metrics — Minimum Required

```
All services:
  http_requests_total{method, route, status_code}
  http_request_duration_ms{method, route}

Core:
  tickets_issued_total
  gate_entry_total{decision}
  gate_exit_total{decision}
  gate_rejection_total{reason}
  outbox_pending_count (gauge)
  outbox_dead_count (gauge)

Payment Service:
  payment_initiation_total
  payment_success_total
  webhook_received_total
  webhook_signature_invalid_total
  webhook_duplicate_total
  outbox_pending_count (gauge)

Worker:
  emails_sent_total{template}
  email_failures_total{template}
  journey_timeouts_processed_total
```

---

## 8. Health Endpoint

All services: `GET /health`

```json
{ "status": "ok", "service": "core-api", "timestamp": "ISO8601" }
```

`/metrics` — internal/monitoring access only. Not publicly exposed.

---

## 9. Secrets — Ownership and Rules

| Secret | Lives in | Never in |
|---|---|---|
| `JWT_PRIVATE_KEY` | Core API env | Browser, logs, other services |
| `JWT_PUBLIC_KEY` | Core API env | Logs, other services |
| `RAZORPAY_KEY_SECRET` | Payment Service env | Browser, Core, logs |
| `RAZORPAY_WEBHOOK_SECRET` | Payment Service env | Browser, Core, logs |
| `GATE_API_KEY_SECRET` | Gate Service + Next.js BFF env | Browser JS, NEXT_PUBLIC_* vars |
| `CORE_DATABASE_URL` | Core API + Worker env | Logs, responses |
| `PAYMENT_DATABASE_URL` | Payment Service + Worker env | Logs, responses |
| `REDIS_URL` | Core + Gate Service env | Logs |

Worker needs both database URLs only for its owned outbox publishing and
background jobs.

Never commit secrets to source control. Use `.env` files locally (gitignored). Use environment variables in deployment.

---

## 10. Docker Compose — Service Topology

### 10.1 Local Development Topology

To reduce local disk usage and avoid rebuilding application images during normal development:

```text
Local host: Web, API Gateway, Core API, Payment Service, Gate Service, Worker
Docker:     PostgreSQL, Redis, Kafka
```

The infrastructure-only Compose configuration exposes host ports. Host applications use `localhost`, including `localhost:9092` for Kafka. Kafka advertised listeners must support host-to-container development and container-to-container full-stack execution.

Preferred workflow:

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm dev
```

Normal application source changes do not require Docker image rebuilds.

### 10.2 Full Containerized / Production-Style Topology

```
Startup order:
  postgres → redis → kafka → core-api → payment-service
  → gate-service → worker → gateway → web

Ports:
  3000  Next.js web
  3001  Core API
  3002  Payment Service
  3003  Gate Service
  3004  Worker (health/metrics only)
  5432  PostgreSQL
  6379  Redis
  8080  API Gateway (nginx)
  9092  Kafka

PostgreSQL: one container, two databases
  metroflow_core
  metroflow_payment
  created by docker/init-databases.sql on first start

Kafka: KRaft mode (no Zookeeper)
```

---

---

## 10.3 Portfolio and Optional Public Demo

The portfolio/demo includes the GitHub source repository, Dockerfiles, Docker Compose configuration, architecture docs, tests, screenshots, an architecture diagram, and a demo video. Razorpay uses **Test Mode**; real-money processing is not required. Optional public hosting may use Vercel, Render, Railway, Fly.io, a VPS, or equivalent providers. Managed PostgreSQL, Redis, and a Kafka-compatible broker are deployment options, not locked vendor dependencies. If free Kafka hosting is impractical, the full Kafka architecture remains implemented and verified locally/E2E.

## 10.4 Future Real Production

A future real deployment may use a single VPS with Docker Compose or managed/cloud hosting. HTTPS, managed secrets, backups, monitoring, managed PostgreSQL, managed Redis, and managed Kafka-compatible infrastructure are required. Kubernetes and cloud-specific infrastructure are not implemented now. Razorpay Live Mode is used only when real-money payments are intentionally required.

## 11. Testing — What to Test and How

### Unit Tests (no DB, no Redis, no Kafka)
```
Fare calculation logic
Gate validation rule evaluation (each rejection reason)
Journey timeout check: `NOW() >= expires_at` → timed out; `NOW() < expires_at` → valid
Equality-boundary timeout test: timestamp exactly equal to `expires_at` → `JOURNEY_TIMED_OUT`
Ticket status transition guards
JWT claim validation
OTP rate limit logic
Payment state machine transitions
Outbox retry counter logic
```

### Integration Tests (real PostgreSQL + Redis, no Kafka)
```
Entry validation: concurrent requests → one journey created
Exit validation: ALLOW and REJECT paths
Duplicate ticket issuance: uq_tickets_payment_id caught
Token rotation: old REVOKED, new created
Reuse detection: REVOKED family revoked
OTP: request → verify → OTP_ALREADY_USED on second verify
Outbox: record created in same transaction, publisher marks PUBLISHED
```

### E2E Tests (all services running)
```
E2E infrastructure: PostgreSQL + Redis + Kafka + all MetroFlow services

Full happy path: register → fare quote → purchase → payment → ticket → entry → exit
Payment retry: attempt FAILED → retry → SUCCESS → ticket
Browser close: payment initiated → webhook arrives → ticket in account
Gate idempotency: same Idempotency-Key twice → one gate event
Journey timeout: enter → poll until expires_at passes → exit REJECTED
payment.succeeded Kafka replay → exactly one Ticket
Kafka unavailable → outbox remains PENDING → after Kafka recovery it is published
Worker email delivery repeatedly fails → bounded retries → operational DLQ after exhaustion
Admin: view gate events; toggle gate INACTIVE; validate rejected
```

### Test Infrastructure
```
Normal integration tests: PostgreSQL + Redis without Kafka
E2E infrastructure: PostgreSQL + Redis + Kafka + all MetroFlow services
docker-compose.test.yml: PostgreSQL + Redis only for normal integration tests
Each test suite: fresh migrations on setup
Each test: clean its own data or use DB transactions that roll back
Never share state between test suites
```

---

## 12. Implementation Order

```
Week 1: Foundation
  monorepo setup, Docker Compose, migrations, seed data
  Core: auth (register, login, JWT, sessions, OTP, password reset)
  Test: auth integration tests

Week 2: Purchase Flow
  Core: stations, fare quotes, purchases
  Test: fare calculation unit tests, purchase flow integration

Week 3: Payment
  Payment Service: Razorpay Test Mode, webhook, outbox
  Core: payment initiation, payment.succeeded consumer, ticket issuance
  Test: full payment flow E2E

Week 4: Gate
  Gate Service: auth, rate limit, idempotency
  Core: entry/exit validation, gate events, journeys
  Gate Simulator UI
  Test: concurrent entry integration test, gate idempotency

Week 5: Worker
  Worker: Kafka consumers, email templates (console provider)
  Journey timeout sweep
  Worker outbox publisher for Core and Payment databases

Week 6: Admin + Frontend
  Admin API + Admin UI
  Passenger UI (tickets, journeys, payment flow)
  Error handling audit

Week 7: Hardening + Deployment
  Prometheus metrics on all services
  E2E test suite
  Docker Compose verified end-to-end
  README: how to run locally
```

---

## 13. Decision Rule for Implementation

When a new question arises during coding:

```
Does it affect:
  database correctness?
  security?
  money/payments?
  distributed consistency?
  public API contract?

YES → stop, document the decision, continue
NO  → make a reasonable choice and keep coding
```

---

## 14. V1 Design Freeze

Everything needed to build V1 is now locked across:

```
Phase 3.1  Repository structure
Phase 3.2  Database schema
Phase 3.3  API contracts
Phase 3.4  Auth & authorization
Phase 3.5  Payment & Razorpay
Sprint A   Gate Service & gate flow
Sprint B   Kafka, Redis, Worker
Sprint C   Resilience, observability, testing
```

Do not design anything new before implementing. If a question arises during coding that is not answered by these documents and hits the decision rule above, write a two-paragraph decision note in `docs/decisions/` and move on.

V2 Backlog (do not implement in V1):
```
Automated payment reconciliation
Outbox dead-event automated replay
OAuth / social login
Admin session management UI
WRONG_EXIT_STATION (requires line topology)
Offline gate operation
Real payment provider swap (Razorpay Test → Live is config-only)
Revenue analytics
Multi-journey tickets
Concession fares
Push notifications
```

🔒 V1 DESIGN FREEZE — START CODING
