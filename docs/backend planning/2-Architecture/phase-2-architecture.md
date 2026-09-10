# MetroFlow — Phase 2: Architecture & Technology Decisions

> **Document:** `3-architecture/phase-2-architecture.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 2 — Architecture & Technology Decisions
> **Status:** Approved — Architecture Baseline
> **Depends on:** `domain/00-phase0-domain-discovery.md`, `v1 requirement/Requirements & Scope.md`

---

## 1. Phase Objective

Phase 2 translates MetroFlow's domain understanding and V1 requirements into explicit architectural decisions.

This phase answers:

```
How is MetroFlow structured?
What parts stay inside the Core application?
What parts are separate services?
How do applications communicate?
What data does each service own?
Which technologies are used and why?
How does the architecture handle correctness, concurrency,
idempotency, failures, scalability, deployment, and observability?
How can the system evolve from a small showcase deployment
to a much larger production-scale system?
```

Phase 2 does **not** define:

```
Exact database columns or indexes
Exact API request/response bodies
Exact Kafka message schemas
Exact JWT payload structure
Exact Redis TTL values
Implementation code
```

Those belong to **Phase 3 — Detailed Design**.

---

## 2. Architecture Goals

MetroFlow architecture must prioritize:

```
Correctness before unnecessary complexity
Strong transactional consistency for Ticket and Journey operations
Safe handling of concurrent gate requests
Idempotent handling of payment events and gate retries
Clear ownership of data per service
Independent scaling where workloads differ significantly
Backend-authoritative business rules
Failure isolation between major components
Horizontal scalability
Clear deployment boundaries
Good observability and debuggability
A realistic architecture that one developer can implement and maintain
```

**Guiding principle:**

> Scalable by design, simple by default.

MetroFlow should not start with unnecessary infrastructure simply because a larger production system could eventually use it. Every architectural decision has a documented reason.

---

## 3. Architectural Style

### Decision

MetroFlow V1 uses a **hybrid architecture**:

```
1 Core Modular Monolith
2 Focused Microservices (Payment, Gate)
1 Background Worker
1 Frontend Application
```

### Deployable Units

```
1. Next.js Web Application
2. MetroFlow Core API       (Modular Monolith)
3. Payment Service          (Microservice)
4. Gate Service             (Microservice)
5. Background Worker        (Async consumer)
```

---

## 4. Why a Hybrid Architecture?

A **pure monolith** would be simpler initially, but Payment and Gate have sufficiently different integration, security, and scaling profiles to justify independent deployables.

A **full microservice architecture** would introduce excessive distributed-system coordination overhead for a V1 solo project.

The hybrid approach keeps tightly related business operations together while extracting the domains with distinct external integrations and operational requirements.

### 4.2 Execution Environments

The system architecture above is unchanged. For local development, Web, API Gateway, Core API, Payment Service, Gate Service, and Worker run directly on the developer PC using pnpm/Turborepo watch mode. PostgreSQL, Redis, and Kafka run in Docker through host ports such as `localhost`.

Full containerized execution keeps all MetroFlow applications and infrastructure in Docker Compose for E2E testing, CI, production-style validation, VPS deployment, and deployment demonstrations. This separation reduces local disk usage and avoids rebuilding application images for normal source changes. Service boundaries, Kafka's role, and event contracts are unchanged.

---

### 4.1 Why Core Is a Modular Monolith

Core contains tightly related metro business state:

```
Auth / Users / Stations / Gates / Fare Rules / Fare Quotes
Purchases / Tickets / Journeys / Gate Events / Admin / Notification publishing
```

Ticket and Journey operations require **strong consistency**. Successful Entry conceptually performs three operations:

```
Ticket:     ISSUED → IN_JOURNEY
Journey:    CREATE ACTIVE
GateEvent:  ENTRY_ACCEPTED
```

These must succeed or fail together. Keeping them inside one Core application and one Core PostgreSQL database allows them to execute within a single database transaction.

**Important principle:**

> A modular monolith is not a tightly coupled monolith. Each module should own its business logic and avoid uncontrolled cross-module writes. The structure must allow modules to be extracted later if scaling justifies it.

---

### 4.2 Why Payment Is a Microservice

Payment has a clear external integration boundary and a separate financial audit concern.

**Payment Service owns:**

```
Razorpay integration / Razorpay Orders
Payment Attempts / Payment status
Webhook processing and verification
Provider event records (immutable log)
Payment idempotency / Financial audit records
```

**Reasons for separation:**

```
Independent security surface (Razorpay webhook endpoint)
Independent financial audit boundary
Independent database ownership
External Razorpay integration
Independent scaling from passenger browsing traffic
Payment failures isolated from Core domain state
```

---

### 4.3 Why Gate Is a Microservice

Gate Service represents the software-facing interface for metro gate interactions. The Gate domain has different operational characteristics from normal passenger API traffic:

```
High request volume potential
Low-latency validation requirements
Gate/device authentication (separate from passenger auth)
Request idempotency at the edge
Rate limiting per gate device
Independent horizontal scaling
```

**Gate Service does not own Ticket or Journey state.** It forwards validation requests to Core, where all business rules remain authoritative.

V1 supports: `QR_TICKET`. The architecture may later support `PAPER_QR`, `SMART_CARD`, `NCMC` without redesigning the passenger purchase system.

---

## 5. Core Modules

MetroFlow Core is one NestJS application organized into clear domain modules:

```
Core API
├── Auth
├── Users
├── Stations
├── Gates
├── Fares
├── FareQuotes
├── Purchases
├── Tickets
├── Journeys
├── GateEvents
├── Admin
└── Notifications  (Kafka publisher only — does not send email)
```

---

## 6. Technology Stack

| Area | Technology | Rationale |
|---|---|---|
| Frontend | Next.js + TypeScript | SSR, routing, layouts, production React tooling |
| Frontend server-state | TanStack Query | Fetching, caching, polling, invalidation — avoids manual useEffect state |
| Core Backend | NestJS + TypeScript | Structured module system maps to domain; TypeScript throughout |
| Payment Service | NestJS + TypeScript | Consistent stack; focused on Razorpay integration |
| Gate Service | NestJS + TypeScript | Consistent stack; focused REST-in / REST-out validation proxy |
| Background Worker | NestJS + TypeScript | Kafka consumer + email dispatch |
| Public API | REST / HTTPS | Browser-friendly, easy to document, Swagger-compatible |
| Internal sync communication | REST / HTTP | Simple, debuggable; gRPC deferred to V2 |
| Internal async events | Apache Kafka | Durable, ordered, decoupled event delivery |
| Primary database | PostgreSQL | ACID transactional source of truth |
| Temporary / fast state | Redis | OTP TTL, rate limiting, idempotency cache |
| Payment provider | Razorpay Test Mode | Real webhook lifecycle without real money; production upgrade is config-only |
| Email provider | TBD (Resend / SendGrid / SES) | Interface-first; provider swappable without code changes |
| API documentation | OpenAPI / Swagger | Auto-generated from NestJS decorators |
| Containers | Docker | Reproducible builds and deployment |
| Local orchestration | Docker Compose | Single-command local multi-service startup |
| CI/CD | GitHub Actions | Automated lint, test, build, deploy pipeline |
| Observability | Structured logs + Prometheus + OpenTelemetry | Debugging, metrics, and tracing |

---

## 7. Why Next.js?

Next.js provides React, TypeScript, routing, layouts, and SSR where useful. MetroFlow domain APIs remain in NestJS. Next.js does not duplicate Fare, Ticket, Payment, Journey, or Gate business logic in API routes.

Next.js responsibilities: UI rendering, routing, client interaction, calling backend APIs, frontend auth/session UX.

---

## 8. Why TanStack Query?

Most MetroFlow frontend data is **server-owned state**: Stations, Fare Quotes, Purchases, Payments, Tickets, Journeys, Gate statuses, Admin tables.

TanStack Query handles fetching, caching, loading/error states, refetching, invalidation, polling (payment pending → outcome), and background refresh. This avoids manually recreating async state management with `useEffect` chains and local state.

---

## 9. Communication Strategy

MetroFlow uses **two communication styles** in V1:

```
REST / HTTP  — synchronous request-response (external and internal)
Kafka        — asynchronous durable events between services
```

### 9.1 External Communication — REST / HTTPS

All browser traffic uses REST over HTTPS through the API Gateway:

```
Next.js (Passenger/Admin flows)  →  API Gateway  →  Core API
Next.js (Gate Simulator)         →  API Gateway  →  Gate Service
```

### 9.2 Internal Synchronous Communication — REST / HTTP

V1 uses internal REST when one service requires an immediate response from another:

```
Core API      →  REST  →  Payment Service   (initiate payment, query status)
Gate Service  →  REST  →  Core API          (entry/exit validation)
```

**gRPC is explicitly deferred to V2.** At V1 scale, the latency difference between gRPC and internal REST is unmeasurable. gRPC adds Proto Buffer management, code generation, and debugging overhead not justified until a measured bottleneck exists. The documented upgrade path is Gate Service → Core when latency measurements justify it.

### 9.3 Internal Asynchronous Communication — Kafka

Kafka is used when a service publishes a confirmed fact and does not require an immediate consumer response:

```
Payment Service  →  Kafka: PAYMENT_SUCCEEDED
Core             ←  Kafka: consumes PAYMENT_SUCCEEDED → issues Ticket
Core             →  Kafka: TICKET_ISSUED
Background Worker←  Kafka: consumes TICKET_ISSUED → sends Ticket email
Core             →  Kafka: OTP_REQUESTED, PASSWORD_RESET_REQUESTED
Background Worker←  Kafka: consumes and dispatches relevant email
```

**Why Kafka is retained:**

```
Payment-to-ticket delivery must be durable:
  If Core is temporarily down when Razorpay confirms payment,
  the PAYMENT_SUCCEEDED event must not be lost.
  Kafka retains the event until Core recovers.

Decoupling:
  Payment outcome does not block email dispatch.
  Email failure does not affect Ticket issuance.

Meaningful distributed-systems practice:
  Idempotent consumers, event replay, consumer groups,
  and event-driven architecture are intentional learning outcomes.
```

**Important rule:**

> Kafka does not determine whether payment succeeded. Razorpay is the external payment authority. Payment Service verifies and persists the authoritative result. Kafka transports the confirmed fact to Core.

---

## 10. Kafka Topics — V1

| Topic | Producer | Consumer | Purpose |
|---|---|---|---|
| `payment.succeeded` | Payment Service | Core | Trigger Ticket issuance |
| `ticket.issued` | Core | Background Worker | Send Ticket confirmation email |
| `otp.requested` | Core | Background Worker | Send login OTP email |
| `password.reset.requested` | Core | Background Worker | Send password reset email |

**All Kafka consumers must be idempotent.** Kafka may deliver the same message more than once.

---

## 11. Payment Flow

```
Passenger selects journey
    ↓
Next.js  →  REST  →  Core
Core creates Fare Quote and Purchase
    ↓
Core  →  REST  →  Payment Service
Payment Service creates Razorpay Order
    ↓
Razorpay Test Mode (in browser) — passenger completes test payment
    ↓
Razorpay  →  Webhook  →  Payment Service
  1. Verifies HMAC signature
  2. Checks idempotency (has this payment event been processed?)
  3. Database transaction:
       Payment = SUCCESS
       Outbox event = PAYMENT_SUCCEEDED
       COMMIT
  4. Outbox Publisher → Kafka: payment.succeeded
    ↓
Kafka  →  Core consumer
  1. Checks idempotency (has a Ticket already been issued for this paymentId?)
  2. Core transaction:
       Issue Ticket
       Outbox event = TICKET_ISSUED
       COMMIT
  3. Core Outbox Publisher → Kafka: ticket.issued
    ↓
Kafka  →  Background Worker
  Sends Ticket confirmation email to passenger
```

---

## 12. Payment Pending / Timeout Behavior

A frontend timeout, browser refresh, or browser close does **not** mean payment failed.

```
Payment initiated  →  Payment = PENDING

Browser refreshes or closes
    ↓
Payment remains PENDING in the database

Razorpay later confirms SUCCESS:
  Payment Service records SUCCESS + outbox event → Outbox Publisher → Kafka → Core → Ticket issued
  Passenger retrieves Ticket from their account

Razorpay later confirms FAILED:
  Payment Service records Payment = FAILED.
  No Ticket is issued.
  The passenger may query/view the failed Payment through the normal Payment Service flow
  and may retry payment according to Purchase rules.
  No payment.failed Kafka event is required in V1.
```

The passenger must not be asked to pay again simply because the frontend missed the outcome.

---

## 13. Gate Validation Flow

```
Gate Simulator (Next.js)
    ↓ REST
API Gateway  →  Gate Service
  1. Authenticates gate/simulator
  2. Checks rate limit (Redis)
  3. Checks request idempotency (Redis)
    ↓ REST
Core
  4. Loads Gate → verifies ACTIVE
  5. Loads Ticket → evaluates all business rules
  6. On ALLOW:
       BEGIN TRANSACTION
         Ticket   → IN_JOURNEY (entry) or COMPLETED (exit)
         Journey  → ACTIVE (entry) or COMPLETED (exit)
         GateEvent→ ENTRY_ACCEPTED or EXIT_ACCEPTED
       COMMIT
  7. On REJECT:
       INSERT GateEvent → ENTRY_REJECTED or EXIT_REJECTED (+ reason code)
  8. Returns { decision: ALLOW | REJECT, reason? }
Gate Service
  9. Stores idempotency result in Redis
 10. Returns decision to Gate Simulator
Gate Simulator
 11. Displays ALLOW (green) or REJECT (red + machine-readable reason)
```

---

## 14. Journey Timeout Enforcement

Maximum active Journey duration: **2.5 hours from successful entry.**

### Decision: Validate-on-Read Is Authoritative

The timeout rule is enforced **during gate validation by checking timestamps**, not by relying on a background job:

```
Exit request received
    ↓
Journey.status = ACTIVE

Core checks:
  currentTime > journey.entryTime + 2.5 hours?

YES → Treat as TIMED_OUT → EXIT_REJECTED with JOURNEY_TIMED_OUT
NO  → Continue normal exit validation
```

**Why validate-on-read:**

A background job runs on a schedule. Between the 2.5-hour threshold and the next job run, there is a gap where a Journey is logically timed out but the database still shows `ACTIVE`. Timestamp validation closes this gap entirely.

**Background job role:** A periodic cleanup sweep transitions stale `ACTIVE` records to `TIMED_OUT` for cleanliness, reporting, and admin visibility. It is cleanup, not enforcement.

---

## 15. Data Ownership

Each service owns its own data. No service directly queries or writes another service's database. Cross-service communication uses REST or Kafka events.

### 15.1 Core Database

Owned exclusively by Core API:

```
users / stations / gates / fare_rules / fare_quotes
purchases / tickets / journeys / gate_events
outbox_events
```

### 15.2 Payment Database

Owned exclusively by Payment Service:

```
payments / payment_attempts / provider_events (immutable webhook log) / outbox_events
```

Core learns payment outcomes only via Kafka events — never by querying Payment Service's database.

### 15.3 Local Development Database Strategy

One PostgreSQL container hosts both logical databases:

```
metroflow_core
metroflow_payment
```

with separate credentials and schema ownership. This preserves service boundaries while reducing local infrastructure complexity. Production can move each to a separate managed instance when needed.

---

## 16. Redis Responsibilities

Redis holds **temporary or fast-access state only**. It is never the durable source of truth for business records.

| Concern | Redis Usage |
|---|---|
| OTP storage | Value + TTL per user session |
| Rate limiting | Request counters per IP/user/gate |
| Gate request idempotency | RequestId → result cache with TTL |
| Short-lived read cache | Optional; Phase 3 decision |

```
PostgreSQL = durable truth
Redis      = temporary / high-speed infrastructure
```

---

## 17. Transactional Outbox for Reliable Event Publication

MetroFlow must not rely on:

1. Commit business data to PostgreSQL
2. Publish Kafka event separately

because a crash between those steps could permanently lose the event.

Example failure:

```
Payment = SUCCESS committed
        ↓
Payment Service crashes
        ↓
payment.succeeded never reaches Kafka
        ↓
Core never issues Ticket
```

To prevent this, Payment Service uses the Transactional Outbox Pattern.

The Payment `SUCCESS` update and the corresponding outbox event record must be written inside the same PostgreSQL transaction.

Conceptually:

```
BEGIN

UPDATE payment → SUCCESS

INSERT outbox event:
PAYMENT_SUCCEEDED

COMMIT
```

An Outbox Publisher later publishes pending outbox events to Kafka.

Core uses the same pattern when issuing a Ticket and publishing `TICKET_ISSUED`.

Transactional Outbox prevents lost events. Kafka consumers must still be idempotent because duplicate publication is possible.

## 18. Idempotency Strategy

| Operation | Idempotency Key | Primary Protection | Secondary Protection |
|---|---|---|---|
| Razorpay webhook delivery | Razorpay `payment_id` / event ID | Payment DB unique record | — |
| Ticket issuance from Kafka event | `payment_id` | Core DB unique constraint on `payment_id` in tickets | Kafka consumer check |
| Gate entry validation retry | Client-supplied `requestId` | Redis TTL cache of result | DB state invariants |
| Gate exit validation retry | Client-supplied `requestId` | Redis TTL cache of result | DB state invariants |
| OTP generation | User + rate-limit window | Redis counter | — |

**Important principle:**

> Redis improves duplicate detection speed, but PostgreSQL protects the final business invariant. If Redis loses a gate idempotency record, Core database constraints must still prevent duplicate Journey creation.

```
Transactional Outbox
        ↓
prevents event loss

Idempotent Consumer
        ↓
prevents duplicate business effects
```

---

## 19. Concurrency Strategy

**Critical scenario:**

```
Gate A scans Ticket X at 10:35:00.001
Gate B scans Ticket X at 10:35:00.002

Business invariant: one Ticket creates at most one Journey.
```

**Strategy: Conditional database update + uniqueness constraint**

```sql
UPDATE tickets
SET status = 'IN_JOURNEY'
WHERE ticket_id = :id
AND status = 'ISSUED'
```

```
1 row updated → proceed: INSERT journey, INSERT gate_event
0 rows updated → Ticket is no longer ISSUED → REJECT
```

A **uniqueness constraint on `journeys.ticket_id`** ensures that even if two transactions both pass the UPDATE check simultaneously, only one INSERT succeeds. The second receives a constraint violation and rolls back.

**Why not application-level locks:** In-memory locks do not work across multiple Core instances. Database-level guarantees are safe under horizontal scaling.

---

## 20. Transaction Consistency

Core wraps multi-record operations in a single **PostgreSQL transaction**.

**Successful Entry:**

```
UPDATE tickets SET status = 'IN_JOURNEY' WHERE ...
INSERT INTO journeys (...)
INSERT INTO gate_events (type = 'ENTRY_ACCEPTED', ...)
COMMIT  — or ROLLBACK on any failure
```

**Successful Exit:**

```
UPDATE tickets SET status = 'COMPLETED' WHERE ...
UPDATE journeys SET status = 'COMPLETED', exit_station = ..., exit_time = ... WHERE ...
INSERT INTO gate_events (type = 'EXIT_ACCEPTED', ...)
COMMIT  — or ROLLBACK on any failure
```

The system must not leave partially updated business state. This is the technical implementation of BR-018 and BR-024.

---

## 21. Admin Cross-Service Data

Admin views may need data from both Core (tickets, journeys, purchases) and Payment Service (payments).

**V1 approach: UI-layer composition**

```
Admin frontend requests:
  Core Admin API      → tickets, journeys, purchases, gate events
  Payment Admin API   → payments, payment attempts

Admin UI composes the information in the browser.
```

A dedicated CQRS read model is not required in V1. Future systems may build unified read models from Kafka events.

The same authenticated `ADMIN` identity may access authorized Admin APIs in both Core and Payment Service.

Each service must independently validate the `ADMIN` role for its own endpoints.

Core authentication does not give Core permission to query Payment's database directly. Admin payment information is retrieved through Payment Service APIs.

---

## 22. Authentication and Authorization

### 22.1 Core Authentication

Core handles Passenger and Admin authentication. V1 supports:

```
Email + password registration and login
Email OTP / magic login
Forgot password flow
PASSENGER role / ADMIN role
```

Passengers can access only their own records. Admin role is required for admin-only endpoints.

### 22.2 Gate Authentication

Gate Service uses separate gate/device credentials — distinct from Passenger authentication:

```
Passenger Auth  ≠  Gate / Device Auth
```

V1 Gate Simulator uses an API key or device credential. Exact format is a Phase 3 decision.

### 22.3 API Gateway Authentication Responsibility

The API Gateway is **not** the primary authentication authority.

Gateway responsibilities:

```
Routing / TLS termination / Basic edge rate limiting
Request size limits / Access logging / Correlation ID injection
Service availability response handling
```

Each backend service validates the authentication relevant to its own operations. This keeps auth logic testable per service and avoids gateway coupling.

---

## 23. API Gateway / Reverse Proxy

All browser traffic enters backend infrastructure through one edge layer.

**Routing:**

```
/api/core/*      →  Core API
/api/gate/*      →  Gate Service
/api/payment/*   →  Core for passenger-facing payment initiation and status flows
/api/payment/webhook → Payment Service for Razorpay webhook delivery
```

Gateway manages traffic, not MetroFlow domain decisions.

Passenger-facing payment initiation must go through Core.

```
Next.js
    ↓
API Gateway
    ↓
Core
    ↓ internal REST
Payment Service
```

Payment Service is not directly exposed to the browser for normal payment operations.

The main public ingress to Payment Service is the Razorpay webhook endpoint, which is routed through the API Gateway / reverse proxy.

**Gate Simulator routing:** Gate Simulator (Next.js) connects to the API Gateway only — never directly to Gate Service. All browser traffic goes through the gateway.

---

## 24. Background Worker

The Background Worker is a **separate deployable** NestJS application. It is a Kafka consumer. It does not expose an HTTP API.

The Background Worker belongs to the Core bounded context. It is a separate deployable process, but it is not an independent microservice. It does not own a separate database. For approved Core background jobs, it may reuse Core application/persistence logic and access the Core database through the same bounded-context rules.

**Responsibilities:**

```
Consume otp.requested              → Send OTP email
Consume password.reset.requested   → Send password reset email
Consume ticket.issued              → Send Ticket confirmation email
Optional periodic sweep            → Transition stale ACTIVE journeys to TIMED_OUT
```

**Core Notifications Module** is a Kafka **publisher only**. It does not send email.

**Email failure rule:**

```
Ticket issued successfully → ticket.issued consumed → Worker email fails

Result:
  Ticket remains VALID
  Payment remains SUCCESS
  Email delivery failure is logged; its state is auditable
  Passenger retrieves Ticket from their account
```

---

## 25. Observability

V1 includes minimal but real observability from the start.

### 25.1 Structured Logging

All backend services emit structured JSON logs:

```
timestamp / service name / log level / correlation ID
domain identifiers: userId, purchaseId, paymentId, ticketId, journeyId, gateId
```

Correlation IDs are propagated across service calls so a single gate interaction is traceable across Gate Service, Core, and Kafka consumer logs.

### 25.2 Health Checks

Each deployable exposes `GET /health` — used by Docker, deployment platforms, and load balancers.

### 25.3 Metrics

Each service exposes **Prometheus-compatible metrics**:

```
Request count / error count / request latency (p50, p95, p99)
Kafka consumer lag and failures
Payment webhook processing count and failures
Gate validation count / gate rejection count by reason
```

### 25.4 Distributed Tracing

**OpenTelemetry** is used for distributed tracing. At minimum, one critical flow is traceable end-to-end:

```
Gate Simulator → API Gateway → Gate Service → Core → PostgreSQL
```

Full production observability dashboards (Grafana, Jaeger) are not required in V1. The instrumentation must be in place.

---

## 26. Monorepo Structure

MetroFlow uses a **monorepo**:

```
metroflow/
├── apps/
│   ├── web/               (Next.js)
│   ├── core-api/          (NestJS Core)
│   ├── payment-service/   (NestJS Payment)
│   ├── gate-service/      (NestJS Gate)
│   └── worker/            (NestJS Background Worker)
│
├── packages/
│   ├── shared-types/      (TypeScript types shared across apps)
│   ├── contracts/         (API contracts, Kafka message schemas)
│   └── config/            (Shared config utilities)
│
├── docs/
├── docker-compose.yml
└── .github/workflows/
```

All applications live in one Git repository while remaining independently deployable.

---

## 27. Local Development

Docker Compose provides reproducible local infrastructure, while application services run directly from the monorepo:

```
Local host: Next.js Web App, API Gateway, MetroFlow Core API, Payment Service, Gate Service, Background Worker
PostgreSQL  (one container: metroflow_core + metroflow_payment databases)
Redis
Kafka       (KRaft mode — no Zookeeper required)
```

Start local infrastructure with `docker compose -f docker-compose.dev.yml up -d`, then start application watch processes with `pnpm dev`. Host applications use host-reachable addresses. Kafka listeners must support both host-to-container development and container-to-container full-stack execution.

KRaft mode is preferred for Kafka locally to eliminate the Zookeeper dependency.

---

## 28. Deployment Architecture

### Initial Showcase Deployment

The portfolio/demo uses the GitHub repository, full source code, Dockerfiles, Docker Compose, architecture docs, tests, screenshots, an architecture diagram, and a demo video. Razorpay remains in **Test Mode**; real-money processing is not required. Optional public hosting may use Vercel, Render, Railway, Fly.io, a VPS, or equivalent providers, with managed PostgreSQL, Redis, and Kafka-compatible infrastructure as deployment-time options. These are not locked vendor dependencies. If free Kafka hosting is impractical, the full Kafka architecture remains implemented and verified locally/E2E.

```
                        INTERNET
                            │
                            ▼
                      NEXT.JS WEB APP
                            │ REST / HTTPS
                            ▼
                      API GATEWAY
                            │
             ┌──────────────┼──────────────┐
             │ REST         │ REST         │
             ▼              ▼
         CORE API      GATE SERVICE
             │              │ REST
             │              ▼
             │          CORE API
             ▼
      PAYMENT SERVICE
             │
             ▼
       RAZORPAY TEST MODE
             │ Webhook
             ▼
      PAYMENT SERVICE
             │ Payment DB transaction
             ├── Payment SUCCESS
             └── Outbox PAYMENT_SUCCEEDED
             │
             ▼
      OUTBOX PUBLISHER
             │
             ▼
           KAFKA
             │
             ▼
            CORE
             │
       ┌─────┴──────┐
       ▼             ▼
   CORE API    BACKGROUND WORKER
   (consumer)        │
                     ▼
               EMAIL PROVIDER

  DATA LAYER:
  ┌───────────────┐  ┌────────────────┐  ┌────────┐
  │ Core          │  │ Payment        │  │ Redis  │
  │ PostgreSQL    │  │ PostgreSQL     │  │        │
  └───────────────┘  └────────────────┘  └────────┘
```

### Independent Scaling

```
Core API:         3 instances  (passenger traffic)
Gate Service:    10 instances  (peak station validation)
Payment Service:  2 instances  (webhook processing)
Worker:           2 instances  (email dispatch)
```

---

## 29. Scale-Up Path

### 29.1 — 10 to 100 Users

```
Single instance per service / One PostgreSQL host (two logical databases)
Single Redis / Single Kafka broker (KRaft) / Docker Compose or single VPS
No architecture changes required.
```

### 29.2 — Hundreds to Thousands

```
Multiple Core API instances     (stateless JWT + Redis = horizontal scale from Day 1)
Multiple Gate Service instances (Redis-backed idempotency is shared-instance-safe)
Load balancer in front of Core and Gate
Managed PostgreSQL with connection pooling (PgBouncer)
Redis Sentinel or managed Redis for HA
Multi-broker Kafka cluster
Read replica for admin/reporting queries
```

**Key V1 decisions that enable this with zero architecture changes:**

```
Stateless Core API (JWT, no in-process session state)
Redis-backed shared idempotency (safe across multiple instances)
Database unique constraints for concurrency (not application-level locks)
```

### 29.3 — Tens of Thousands

```
PostgreSQL partitioning for gate_events and journeys (highest-volume append-only tables)
Kafka topic partitioning for parallel consumer throughput
Redis Cluster for distributed rate limiting and idempotency
CDN for Next.js static assets
Dedicated read replicas per domain
Autoscaling per service
```

### 29.4 — Millions of Users

When real bottlenecks are measured:

```
Core modules extracted into independent services:
  Journey Service   (high gate-event write volume)
  Ticket Service    (read-heavy for validation)
  Fare Service      (read-heavy, highly cacheable)
  Analytics Service (separate read pipeline from Kafka)

Database sharding for gate_events
Redis Cluster with consistent hashing
Multi-region Kafka clusters
Regional Gate infrastructure
Service mesh / mTLS for internal communication
gRPC for Gate Service → Core (latency-sensitive at this scale)
Advanced API Gateway with edge routing
Full observability dashboards (Grafana, Jaeger, Prometheus)
```

---

## 30. Why No gRPC in V1?

gRPC is a valid internal protocol for low-latency service communication. V1 already introduces microservices, Kafka, Redis, multiple databases, Razorpay, API Gateway, concurrency, idempotency, Docker, and observability. Adding gRPC would require Proto Buffer management, code generation steps, debugging tooling, and TLS config decisions — without solving a measured bottleneck.

**Decision:** V1 uses REST for all internal synchronous communication.

**Documented upgrade path:**

```
Gate Service → Core: REST (V1)
    ↓ when latency measurements justify it
Gate Service → Core: gRPC + Protocol Buffers (V2)
```

---

## 31. Why Kafka Is Retained

The payment-to-ticket flow **requires durable async delivery**:

```
Razorpay confirms payment
    ↓
Payment Service persists SUCCESS and publishes payment.succeeded
    ↓
If Core is temporarily down:
    Kafka retains the event
    ↓
When Core recovers:
    Core consumes payment.succeeded → Ticket is issued
```

With synchronous REST, a Core outage at the moment of webhook processing loses the payment confirmation event permanently.

Additionally, Kafka provides meaningful distributed-systems engineering practice: idempotent consumers, event replay, consumer groups, event-driven architecture, service decoupling, and eventual consistency.

---

## 32. Explicit V1 Non-Decisions (Deferred to Phase 3)

```
Exact API endpoints and HTTP verbs
Exact database table schemas, columns, and indexes
Exact Redis key naming and TTL values
Exact Kafka message field schemas
Exact Kafka consumer group configuration
Exact JWT structure and token expiry values
Exact password hashing parameters
Exact Gate device credential format
Exact API Gateway product selection (nginx / Traefik / Caddy)
Exact email provider selection
Exact service-day cutoff time for Ticket expiry
Exact background job scheduler interval
Exact outbox table schema
Exact outbox publisher implementation
Exact outbox polling/batching strategy
Exact Kafka producer retry strategy
Exact Kafka consumer retry strategy
Exact dead-letter handling strategy
Exact event versioning strategy
Exact deployment provider or cloud platform
Exact autoscaling thresholds
```

---

## 33. Architecture Decision Register

| ID | Decision | Rationale | Alternatives Rejected |
|---|---|---|---|
| AD-001 | Hybrid architecture: modular monolith + 2 microservices + 1 worker | Balances simplicity with isolation for payment/gate domains | Pure monolith (no isolation); full microservices (excessive solo-dev overhead) |
| AD-002 | Core is a NestJS modular monolith | Domain modules map directly to NestJS module system; single DB transaction for Ticket+Journey+GateEvent | Separate Core services per domain (premature extraction) |
| AD-003 | Payment is a separate microservice | Independent security surface, financial audit boundary, external Razorpay integration | Keeping payment in Core (no isolation for webhook endpoint or financial records) |
| AD-004 | Gate is a separate microservice | Different scaling profile, device auth, rate limiting; fare-media extensibility | Keeping gate in Core (couples high-volume gate traffic to passenger browsing) |
| AD-005 | Background Worker is a separate deployable | Single responsibility; Core Notifications module is publisher only | Email sent synchronously in Core (blocks Ticket issuance; couples delivery to business logic) |
| AD-006 | REST for internal synchronous communication in V1 | Debuggable, curl-friendly, no code generation; latency benefit of gRPC unmeasurable at V1 scale | gRPC (correct long-term upgrade; excessive V1 setup cost) |
| AD-007 | Kafka for async events | Durable delivery across service restarts; payment event must not be lost if Core is temporarily down | Direct REST callback from Payment to Core (tight coupling; event loss risk on Core outage) |
| AD-008 | gRPC deferred to V2 | No measured latency bottleneck; documented upgrade path for Gate → Core exists | Implementing gRPC immediately (adds Proto management and debugging overhead without benefit) |
| AD-009 | PostgreSQL for all durable state | ACID transactions; relational model fits domain; strong uniqueness constraints for concurrency | NoSQL (domain has relational shape; eventual consistency inappropriate for Ticket/Journey) |
| AD-010 | Separate logical databases per service | Data ownership boundary; independent backup and audit | Single shared database (violates service data ownership) |
| AD-011 | Single PostgreSQL container locally with two databases | Reduces local infrastructure while preserving ownership boundaries | Two separate local PostgreSQL containers (unnecessary local complexity) |
| AD-012 | Redis for OTP, rate limiting, and idempotency cache only | Fast TTL-native storage; shared across instances; not the durable source of truth | In-process cache (unsafe across multiple instances); Redis as primary database (wrong durability model) |
| AD-013 | Razorpay Test Mode | Real webhook lifecycle in test mode; production upgrade is config-only; stronger portfolio signal | Internal mock payment provider (no real webhook flow; weaker engineering demonstration) |
| AD-014 | Validate-on-read for Journey timeout | Closes the gap between background job schedule and actual 2.5-hour threshold | Background job as sole enforcement mechanism (allows exits in the gap window) |
| AD-015 | Conditional DB update + uniqueness constraint for concurrency | Safe under horizontal scaling; no application-level lock; DB guarantees correctness | Application-level mutex (not distributed-safe); pessimistic DB lock (performance risk at scale) |
| AD-016 | Single PostgreSQL transaction for Ticket + Journey + GateEvent | Atomicity required by BR-018 and BR-024; prevents partially updated business state | Separate operations (risk of inconsistent state on partial failure) |
| AD-017 | Each service validates its own auth | Simpler per-service testing; no coupling of all auth to gateway; clear auth boundary | Gateway-level JWT validation (couples all auth to gateway; harder to test services independently) |
| AD-018 | API Gateway handles edge concerns only | Gateway manages traffic, not business decisions | Business logic in gateway (wrong separation of concerns) |
| AD-019 | Monorepo with independent deployables | Shared types and contracts; single CI pipeline; still independently deployable | Multi-repo (more coordination overhead for a solo developer) |
| AD-020 | Structured logging + Prometheus + OpenTelemetry in V1 | Production-grade observability is part of the portfolio signal; correlation IDs enable end-to-end debugging | Logging only (insufficient for distributed tracing across services) |
| AD-021 | Kafka KRaft mode locally (no Zookeeper) | Reduces Docker Compose complexity; modern Kafka default | Kafka + Zookeeper (additional container and configuration) |
| AD-022 | Transactional Outbox is used for reliable Kafka publication from Payment and Core | Prevents loss of events between DB commit and Kafka publish | Publishing Kafka events separately after database commit |
| AD-023 | `payment.failed` is not published to Core in V1 | Failed payment state remains owned by Payment Service; Core only reacts to confirmed payment success | Publishing payment failure events to Core |

---

## 34. Phase 2 Definition of Done

Phase 2 is complete when all of the following are true:

- [x] Architectural style is defined and rationale is documented
- [x] Core vs microservice boundaries are defined
- [x] All five deployable units are identified
- [x] Technology stack is selected with rationale for every choice
- [x] External REST communication strategy is defined
- [x] Internal synchronous REST communication strategy is defined
- [x] gRPC deferral decision is documented with upgrade path
- [x] Kafka event usage and all V1 topics are defined
- [x] Core and Payment data ownership is defined
- [x] Local development database strategy is defined
- [x] Redis responsibilities are defined
- [x] Payment lifecycle architecture is defined
- [x] Payment pending / timeout behavior is defined
- [x] Gate validation architecture is defined
- [x] Journey timeout enforcement (validate-on-read) is defined
- [x] Idempotency approach is documented per operation
- [x] Concurrency strategy is documented
- [x] Transaction consistency boundaries are documented
- [x] Admin cross-service data strategy is defined
- [x] Authentication responsibility boundaries are defined
- [x] API Gateway responsibility is defined
- [x] Background Worker responsibility is defined
- [x] Monorepo structure is defined
- [x] Observability strategy is defined (logging, metrics, tracing)
- [x] Local development approach is defined
- [x] Independent deployment model is defined
- [x] Scale-up path from 10 users to millions is documented
- [x] Phase 3 non-decisions are explicitly listed
- [x] Architecture Decision Register is complete with rationale and rejected alternatives

---

## 35. Final Architecture Summary

```
METROFLOW V1 — ARCHITECTURE SUMMARY

Frontend
└── Next.js + TypeScript
    ├── Passenger UI
    ├── Admin UI
    └── Gate Simulator UI

Core
└── NestJS Modular Monolith
    ├── Auth / Users / Stations / Gates / Fares / FareQuotes
    ├── Purchases / Tickets / Journeys / GateEvents
    ├── Ticket issuance
    ├── Transactional Outbox / Kafka publisher
    ├── Admin
    └── Notifications (Kafka publisher only)

Microservices
├── Payment Service (NestJS)
│   ├── Razorpay Test Mode integration
│   ├── Payment lifecycle management
│   ├── Webhook receipt and HMAC verification
│   ├── Payment attempt records
│   ├── Payment idempotency
│   ├── Transactional Outbox
│   └── Kafka publisher
│
└── Gate Service (NestJS)
    ├── Gate-facing REST API
    ├── Gate / simulator authentication
    ├── Rate limiting (Redis)
    ├── Request idempotency (Redis)
    └── Delegates business logic to Core via REST

Worker
└── Background Worker (NestJS — Kafka consumer; separate deployable inside Core bounded context)
    ├── OTP email dispatch
    ├── Password reset email dispatch
    ├── Ticket confirmation email dispatch
    ├── Optional stale Journey cleanup sweep
    └── No independent database

Data
├── Core PostgreSQL
│   users / stations / gates / fare_rules / fare_quotes
│   purchases / tickets / journeys / gate_events / outbox_events
├── Payment PostgreSQL
│   payments / payment_attempts / provider_events / outbox_events
└── Redis
    OTP TTL / rate limiting / gate request idempotency cache

Event Infrastructure
└── Apache Kafka (KRaft mode)
    payment.succeeded
    ticket.issued
    otp.requested / password.reset.requested

Communication
├── Browser → Backend:        REST / HTTPS via API Gateway
├── Service → Service sync:   REST / HTTP (gRPC upgrade path documented for V2)
└── Service → Service async:  Apache Kafka

Observability
├── Structured JSON logging with correlation IDs
├── Prometheus-compatible metrics per service
└── OpenTelemetry distributed tracing

Infrastructure
├── Docker (all services containerised)
├── Docker Compose (local multi-service development)
├── API Gateway / Reverse Proxy (edge routing + TLS)
├── GitHub Actions (CI/CD)
└── Health check endpoint per deployable

Deployable Units (independently scalable)
├── Next.js Web App
├── MetroFlow Core API
├── Payment Service
├── Gate Service
└── Background Worker
```

---

## 36. Next Phase

```
PHASE 3
DETAILED DESIGN
```

Phase 3 produces:

```
Database schema per service (tables, columns, indexes, constraints)
API endpoint contracts (OpenAPI / Swagger)
Kafka message schemas per topic
Module dependency rules within Core
Authentication and session contract
Gate request/response contract
Payment request/response contract
Redis key naming strategy and TTL values
Error response envelope structure
Feature-level technical specifications
```

Implementation begins only after the relevant Phase 3 specification is approved.
