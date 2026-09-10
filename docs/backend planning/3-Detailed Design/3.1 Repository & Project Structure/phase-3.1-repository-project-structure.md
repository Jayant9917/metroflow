# MetroFlow — Phase 3.1: Repository & Project Structure

> **Document:** `3-Detailed Design/3.1 Repository & Project Structure/phase-3.1-repository-project-structure.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 3 — Detailed Design
> **Section:** 3.1 — Repository & Project Structure
> **Status:** Approved
> **Depends on:** `2-Architecture/phase-2-architecture.md`

---

## 1. Purpose

This document defines the complete repository layout, monorepo tooling strategy, internal package design, per-application structure, configuration conventions, and Docker/CI setup for MetroFlow V1.

## 1.1 Environment Execution Strategy

For local development, Web, API Gateway, Core API, Payment Service, Gate Service, and Worker run directly from the monorepo with pnpm/Turborepo watch mode. Only PostgreSQL, Redis, and Kafka run in Docker and are accessed through host-reachable `localhost` ports. Normal application source changes must not require Docker image rebuilds.

The existing application Dockerfiles and full Compose configuration remain required for E2E, CI, production-style testing, VPS deployment, and future hosting. Do not remove them to optimize local development.

The structure must support:

```
5 independently deployable applications
3 shared internal packages
TypeScript throughout
Independent per-app builds and deployments
Shared type safety across service boundaries (without entity sharing)
Docker containerisation per application
GitHub Actions CI/CD pipeline
Turborepo build caching
```

---

## 2. Monorepo Tooling

### Decision: Turborepo + pnpm

| Concern | Approach |
|---|---|
| Build orchestration | Turborepo — task pipeline, local + remote caching |
| Package manager | pnpm workspaces — strict dependency isolation, fast installs |
| Per-app builds | Each app builds independently via `turbo run build` |
| TypeScript | Each app has its own `tsconfig.json` extending a root base |
| Overhead | Minimal — `turbo.json` + `pnpm-workspace.yaml` |

### Why pnpm

```
Strict dependency isolation (no phantom dependencies)
Faster installs via content-addressable store
Native workspace support
Smaller node_modules footprint
```

---

## 3. Top-Level Repository Structure

```
metroflow/
│
├── apps/
│   ├── web/                        Next.js — Passenger UI, Admin UI, Gate Simulator
│   ├── core-api/                   NestJS — Core Modular Monolith
│   ├── payment-service/            NestJS — Payment Microservice
│   ├── gate-service/               NestJS — Gate Microservice
│   └── worker/                     NestJS — Background Worker (Kafka consumer, Core context)
│
├── packages/
│   ├── shared-types/               Universal enums and value types only
│   ├── contracts/                  HTTP and Kafka transport contracts
│   └── tsconfig/                   Shared TypeScript configuration bases
│
├── docs/
│   ├── domain/
│   │   └── 00-phase0-domain-discovery.md
│   ├── requirements/
│   │   └── v1-requirements.md
│   ├── architecture/
│   │   ├── phase-2-architecture.md
│   │   └── phase-3-repository-structure.md
│   └── features/                   Feature-level specs (one per V1 feature)
│
├── docker/
│   ├── core-api.Dockerfile
│   ├── payment-service.Dockerfile
│   ├── gate-service.Dockerfile
│   ├── worker.Dockerfile
│   ├── web.Dockerfile
│   ├── init-databases.sql          Creates metroflow_core + metroflow_payment
│   └── nginx.conf                  API Gateway / reverse proxy config
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  Lint + type-check + test on every PR
│       ├── build-core.yml
│       ├── build-payment.yml
│       ├── build-gate.yml
│       ├── build-worker.yml
│       └── build-web.yml
│
├── docker-compose.yml              Full containerized / production-style environment
├── docker-compose.dev.yml          Optional local infrastructure-only environment
│                                   (PostgreSQL + Redis + Kafka)
├── docker-compose.test.yml         CI test environment (infra only, no app containers)
├── turbo.json                      Turborepo task pipeline
├── pnpm-workspace.yaml
├── package.json                    Root — dev tooling only, no app code
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── .gitignore
└── README.md
```

---

## 4. Shared Packages

### Package Boundary Rules

```
shared-types   → universal enums and primitive value types only
               → no runtime logic
               → no dependencies beyond TypeScript

contracts      → HTTP request/response shapes
               → Kafka event message shapes
               → common transport metadata
               → no database entities
               → no business service interfaces
               → no repository models

Service-internal entities, repository models, and business
domain objects stay inside their owning service.

Do not share business entities through packages.
Sharing a TypeScript type is not the same as keeping services decoupled.
Shared types create implicit coupling if they represent internal models.
```

---

### 4.1 `packages/shared-types`

Contains only TypeScript enums and primitive value types that are genuinely universal across service boundaries.

```
packages/shared-types/
├── src/
│   ├── index.ts
│   │
│   ├── enums/
│   │   ├── ticket-status.enum.ts
│   │   ├── journey-status.enum.ts
│   │   ├── payment-status.enum.ts       PaymentStatus enum values only — not a Payment entity
│   │   ├── gate-type.enum.ts
│   │   ├── gate-status.enum.ts
│   │   ├── gate-event-type.enum.ts
│   │   ├── gate-rejection-reason.enum.ts
│   │   └── user-role.enum.ts
│   │
│   └── common/
│       ├── pagination.types.ts          PaginatedResponse<T>
│       └── api-response.types.ts        ApiResponse<T>, ApiError envelope
│
├── package.json
└── tsconfig.json
```

**Example — `gate-rejection-reason.enum.ts`:**

```typescript
export enum GateRejectionReason {
  TICKET_NOT_FOUND          = 'TICKET_NOT_FOUND',
  TICKET_EXPIRED            = 'TICKET_EXPIRED',
  TICKET_COMPLETED          = 'TICKET_COMPLETED',
  TICKET_ALREADY_IN_JOURNEY = 'TICKET_ALREADY_IN_JOURNEY',
  WRONG_ORIGIN              = 'WRONG_ORIGIN',
  WRONG_DESTINATION         = 'WRONG_DESTINATION',
  NO_ACTIVE_JOURNEY         = 'NO_ACTIVE_JOURNEY',
  JOURNEY_TIMED_OUT         = 'JOURNEY_TIMED_OUT',
  GATE_INACTIVE             = 'GATE_INACTIVE',
}
```

**What must NOT go in shared-types:**

```
Payment entity (internal to Payment Service)
Ticket entity (internal to Core)
Journey entity (internal to Core)
Any database-mapped interface
Any type representing a repository or service return value
```

---

### 4.2 `packages/contracts`

Contains HTTP request/response contracts and Kafka event message schemas shared between producers and consumers.

**Rule:** Contracts define transport interfaces between services. They contain types only — no business logic, no database logic, no entity models.

```
packages/contracts/
├── src/
│   ├── index.ts
│   │
│   ├── http/
│   │   ├── gate/
│   │   │   ├── validate-entry.contract.ts
│   │   │   └── validate-exit.contract.ts
│   │   ├── payment/
│   │   │   ├── initiate-payment.contract.ts   Core → Payment Service internal call
│   │   │   └── payment-status.contract.ts
│   │   └── core/
│   │       ├── fare-quote.contract.ts
│   │       ├── purchase.contract.ts
│   │       └── ticket.contract.ts
│   │
│   └── kafka/
│       ├── payment-succeeded.event.ts
│       ├── ticket-issued.event.ts
│       ├── otp-requested.event.ts
│       └── password-reset-requested.event.ts
│
├── package.json
└── tsconfig.json
```

**Kafka topics in V1 — authoritative list:**

```
payment.succeeded         Payment Service → Core
ticket.issued             Core → Background Worker
otp.requested             Core → Background Worker
password.reset.requested  Core → Background Worker
```

`payment.failed` is **not** a Kafka topic. Failed payment outcomes are owned entirely by Payment Service and are not published to Core or the Worker. Core is only informed of a confirmed success.

**Example — `payment-succeeded.event.ts`:**

```typescript
export const PAYMENT_SUCCEEDED_TOPIC = 'payment.succeeded';

export interface PaymentSucceededEvent {
  eventId:    string;   // idempotency key
  paymentId:  string;
  purchaseId: string;
  userId:     string;
  amount:     number;
  currency:   string;
  occurredAt: string;   // ISO 8601
}
```

---

### 4.3 `packages/tsconfig`

```
packages/tsconfig/
├── base.json        Strict TypeScript base
├── nestjs.json      Extends base; NestJS decorator settings
└── nextjs.json      Extends base; Next.js specific settings
```

---

## 5. Application Structures

---

### 5.1 `apps/core-api` — NestJS Modular Monolith

```
apps/core-api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── modules/
│   │   │
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── local.strategy.ts
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   └── roles.guard.ts
│   │   │   ├── decorators/
│   │   │   │   ├── current-user.decorator.ts
│   │   │   │   └── roles.decorator.ts
│   │   │   └── dto/
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts
│   │   │   └── entities/
│   │   │       └── user.entity.ts
│   │   │
│   │   ├── stations/
│   │   │   ├── stations.module.ts
│   │   │   ├── stations.controller.ts
│   │   │   ├── stations.service.ts
│   │   │   ├── stations.repository.ts
│   │   │   └── entities/
│   │   │       └── station.entity.ts
│   │   │
│   │   ├── gates/                          Separate module — not nested in stations
│   │   │   ├── gates.module.ts
│   │   │   ├── gates.service.ts            Gate ACTIVE/INACTIVE management
│   │   │   ├── gates.repository.ts
│   │   │   └── entities/
│   │   │       └── gate.entity.ts
│   │   │
│   │   ├── fares/
│   │   │   ├── fares.module.ts
│   │   │   ├── fares.service.ts            Fare engine — calculates authoritative fare
│   │   │   ├── fares.repository.ts
│   │   │   └── entities/
│   │   │       └── fare-rule.entity.ts
│   │   │
│   │   ├── fare-quotes/
│   │   │   ├── fare-quotes.module.ts
│   │   │   ├── fare-quotes.controller.ts
│   │   │   ├── fare-quotes.service.ts
│   │   │   ├── fare-quotes.repository.ts
│   │   │   └── entities/
│   │   │       └── fare-quote.entity.ts
│   │   │
│   │   ├── purchases/
│   │   │   ├── purchases.module.ts
│   │   │   ├── purchases.controller.ts
│   │   │   ├── purchases.service.ts
│   │   │   ├── purchases.repository.ts
│   │   │   └── entities/
│   │   │       └── purchase.entity.ts
│   │   │
│   │   ├── tickets/
│   │   │   ├── tickets.module.ts
│   │   │   ├── tickets.controller.ts
│   │   │   ├── tickets.service.ts          Issue, expire, retrieve
│   │   │   ├── tickets.repository.ts
│   │   │   └── entities/
│   │   │       └── ticket.entity.ts
│   │   │
│   │   ├── journeys/
│   │   │   ├── journeys.module.ts
│   │   │   ├── journeys.controller.ts
│   │   │   ├── journeys.service.ts         Create, complete; timeout check on read
│   │   │   ├── journeys.repository.ts
│   │   │   └── entities/
│   │   │       └── journey.entity.ts
│   │   │
│   │   ├── gate-events/
│   │   │   ├── gate-events.module.ts
│   │   │   ├── gate-events.service.ts      Records gate events — no controller
│   │   │   ├── gate-events.repository.ts
│   │   │   └── entities/
│   │   │       └── gate-event.entity.ts
│   │   │
│   │   ├── gate-validation/
│   │   │   ├── gate-validation.module.ts
│   │   │   ├── gate-validation.controller.ts   Internal endpoint — Gate Service calls this
│   │   │   ├── gate-validation.service.ts      All entry/exit business rules
│   │   │   └── dto/
│   │   │
│   │   ├── payment-events/
│   │   │   ├── payment-events.module.ts
│   │   │   └── payment-events.consumer.ts  Consumes payment.succeeded → calls Tickets service
│   │   │                                   Does NOT publish Kafka events directly
│   │   │
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts         Read-only views + Gate status management
│   │   │   ├── admin.service.ts
│   │   │   └── dto/
│   │   │
│   │   ├── outbox/                          Transactional Outbox (see Section 6)
│   │   │   ├── outbox.module.ts
│   │   │   ├── outbox.service.ts            Writes outbox record inside same DB transaction
│   │   │   ├── outbox.repository.ts
│   │   │   ├── outbox.publisher.ts          Polls unprocessed records → publishes to Kafka
│   │   │   └── entities/
│   │   │       └── outbox-event.entity.ts
│   │
│   ├── database/
│   │   ├── database.module.ts
│   │   ├── migrations/
│   │   └── seeds/                          Station, gate, fare rule seed data
│   │
│   ├── kafka/
│   │   └── kafka.module.ts
│   │
│   ├── redis/
│   │   └── redis.module.ts
│   │
│   ├── common/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── correlation-id.interceptor.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   └── health/
│   │       └── health.controller.ts
│   │
│   └── config/
│       ├── app.config.ts
│       ├── database.config.ts
│       ├── jwt.config.ts
│       ├── kafka.config.ts
│       └── redis.config.ts
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

---

### 5.2 `apps/payment-service` — NestJS Microservice

```
apps/payment-service/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── modules/
│   │   │
│   │   ├── payments/
│   │   │   ├── payments.module.ts
│   │   │   ├── payments.controller.ts      Internal endpoint — Core calls this, not browser
│   │   │   ├── payments.service.ts
│   │   │   ├── payments.repository.ts
│   │   │   └── entities/
│   │   │       ├── payment.entity.ts       Internal to Payment Service — not in shared-types
│   │   │       └── payment-attempt.entity.ts
│   │   │
│   │   ├── razorpay/
│   │   │   ├── razorpay.module.ts
│   │   │   ├── razorpay.service.ts         Razorpay SDK wrapper
│   │   │   └── razorpay-webhook.controller.ts
│   │   │
│   │   ├── provider-events/
│   │   │   ├── provider-events.module.ts
│   │   │   ├── provider-events.service.ts  Persists raw webhook payloads (immutable)
│   │   │   ├── provider-events.repository.ts
│   │   │   └── entities/
│   │   │       └── provider-event.entity.ts
│   │   │
│   │   └── admin/
│   │       ├── admin.module.ts
│   │       └── admin.controller.ts         Read-only payment admin endpoints
│   │
│   ├── outbox/                             Transactional Outbox (see Section 6)
│   │   ├── outbox.module.ts
│   │   ├── outbox.service.ts
│   │   ├── outbox.repository.ts
│   │   ├── outbox.publisher.ts             Polls → publishes payment.succeeded to Kafka
│   │   └── entities/
│   │       └── outbox-event.entity.ts
│   │
│   ├── database/
│   │   ├── database.module.ts
│   │   └── migrations/
│   │
│   ├── common/
│   │   ├── filters/
│   │   ├── interceptors/
│   │   └── health/
│   │       └── health.controller.ts
│   │
│   └── config/
│       ├── app.config.ts
│       ├── database.config.ts
│       ├── kafka.config.ts
│       └── razorpay.config.ts
│
├── test/
│   ├── unit/
│   └── integration/
│
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

---

### 5.3 `apps/gate-service` — NestJS Microservice

```
apps/gate-service/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── modules/
│   │   │
│   │   ├── gate-validation/
│   │   │   ├── gate-validation.module.ts
│   │   │   ├── gate-validation.controller.ts
│   │   │   ├── gate-validation.service.ts  auth → rate-limit → idempotency → Core call
│   │   │   └── dto/
│   │   │
│   │   ├── core-client/
│   │   │   ├── core-client.module.ts
│   │   │   └── core-client.service.ts      REST client → Core gate-validation endpoint
│   │   │
│   │   ├── idempotency/
│   │   │   ├── idempotency.module.ts
│   │   │   └── idempotency.service.ts      Redis-backed request deduplication
│   │   │
│   │   ├── rate-limiting/
│   │   │   ├── rate-limiting.module.ts
│   │   │   └── rate-limiting.guard.ts      Redis-backed rate limiter per gate device
│   │   │
│   │   └── auth/
│   │       ├── gate-auth.module.ts
│   │       └── gate-api-key.guard.ts
│   │
│   ├── common/
│   │   ├── filters/
│   │   ├── interceptors/
│   │   └── health/
│   │       └── health.controller.ts
│   │
│   └── config/
│       ├── app.config.ts
│       ├── redis.config.ts
│       └── core-client.config.ts
│
├── test/
│   ├── unit/
│   └── integration/
│
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

---

### 5.4 `apps/worker` — Background Worker

**Important boundary statement:**

> The Background Worker is a separate deployable process inside the Core bounded context. It is not an independent microservice and does not own a separate database. Approved Core background jobs may access Core persistence through Core database connections.

The Worker runs a **minimal HTTP listener** for operational endpoints (`/health`, `/metrics`) only. It exposes no business REST API.

```
apps/worker/
├── src/
│   ├── main.ts                             Bootstraps Kafka consumer + minimal HTTP listener
│   ├── app.module.ts
│   │
│   ├── consumers/
│   │   ├── ticket-issued.consumer.ts       ticket.issued → send Ticket email
│   │   ├── otp-requested.consumer.ts       otp.requested → send OTP email
│   │   └── password-reset.consumer.ts      password.reset.requested → send reset email
│   │
│   ├── jobs/
│   │   └── journey-timeout.job.ts          Periodic sweep: ACTIVE journeys > 2.5h → TIMED_OUT
│   │                                       Uses CORE_DATABASE_URL — Worker is in Core context
│   │
│   ├── email/
│   │   ├── email.module.ts
│   │   ├── email.service.ts                Interface-based dispatch
│   │   ├── providers/
│   │   │   ├── resend.provider.ts
│   │   │   └── console.provider.ts         Local dev: logs to console, no real sends
│   │   └── templates/
│   │       ├── ticket-issued.template.ts
│   │       ├── otp.template.ts
│   │       └── password-reset.template.ts
│   │
│   ├── common/
│   │   └── health/
│   │       └── health.controller.ts        GET /health, GET /metrics — operational only
│   │
│   └── config/
│       ├── kafka.config.ts
│       ├── database.config.ts              Connects to Core DB for journey-timeout job
│       └── email.config.ts
│
├── test/
│   └── unit/
│
├── package.json
├── tsconfig.json
└── nest-cli.json
```

---

### 5.5 `apps/web` — Next.js Frontend

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   │
│   │   ├── (passenger)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── journey/
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [purchaseId]/page.tsx
│   │   │   ├── tickets/
│   │   │   │   ├── page.tsx
│   │   │   │   └── [ticketId]/page.tsx
│   │   │   ├── journeys/page.tsx
│   │   │   └── payments/page.tsx
│   │   │
│   │   ├── (admin)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── stations/page.tsx
│   │   │   ├── tickets/page.tsx
│   │   │   ├── journeys/page.tsx
│   │   │   ├── payments/page.tsx
│   │   │   └── gates/page.tsx
│   │   │
│   │   ├── (gate-simulator)/
│   │   │   └── simulator/page.tsx
│   │   │
│   │   └── (auth)/
│   │       ├── login/page.tsx
│   │       ├── register/page.tsx
│   │       ├── otp/page.tsx
│   │       └── forgot-password/page.tsx
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── passenger/
│   │   │   ├── FareQuoteCard.tsx
│   │   │   ├── TicketCard.tsx
│   │   │   ├── QRDisplay.tsx
│   │   │   └── JourneyHistoryItem.tsx
│   │   ├── admin/
│   │   │   ├── GateStatusToggle.tsx
│   │   │   └── InconsistencyAlert.tsx
│   │   └── gate-simulator/
│   │       ├── GateSelector.tsx
│   │       ├── TicketInput.tsx
│   │       └── DecisionDisplay.tsx
│   │
│   ├── lib/
│   │   ├── api/
│   │   │   ├── auth.api.ts
│   │   │   ├── fares.api.ts
│   │   │   ├── purchases.api.ts
│   │   │   ├── tickets.api.ts
│   │   │   ├── journeys.api.ts
│   │   │   ├── gate.api.ts
│   │   │   └── admin.api.ts
│   │   ├── hooks/
│   │   │   ├── useTickets.ts
│   │   │   ├── useFareQuote.ts
│   │   │   ├── usePaymentStatus.ts
│   │   │   ├── useJourneys.ts
│   │   │   └── useAdminGates.ts
│   │   └── auth/
│   │       └── session.ts
│   │
│   └── providers/
│       ├── QueryProvider.tsx
│       └── AuthProvider.tsx
│
├── public/
├── next.config.ts
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

---

## 6. Transactional Outbox Pattern

### Why the Outbox Exists

Phase 2 Decision AD-007 states that Kafka is used for durable async event delivery. The Transactional Outbox Pattern is the implementation strategy that fulfils this requirement.

Without an Outbox:

```
BEGIN TRANSACTION
  Issue Ticket
COMMIT
  ↓
Publish to Kafka  ← if this fails, the event is lost forever
```

With an Outbox:

```
BEGIN TRANSACTION
  Issue Ticket
  INSERT outbox_event (TICKET_ISSUED, payload, status=PENDING)
COMMIT                    ← both records committed atomically

Outbox Publisher (separate process/timer)
  SELECT unprocessed outbox records
  Publish to Kafka
  Mark record as PUBLISHED
```

If the publisher crashes between commit and publish, the record remains `PENDING` and will be retried. The consumer's idempotency key prevents double-processing.

### Outbox in Core

```
Ticket issued
+
TICKET_ISSUED outbox record
→ same Core DB transaction

Outbox Publisher
→ Kafka: ticket.issued
```

The Core Outbox Publisher is responsible for publishing Core-owned Kafka events.

Domain modules do not publish Kafka events directly.

Example:

```
Ticket Service
    ↓
writes TICKET_ISSUED outbox record
    ↓
Outbox Publisher
    ↓
Kafka
```

### Outbox in Payment Service

```
Payment = SUCCESS confirmed
+
PAYMENT_SUCCEEDED outbox record
→ same Payment DB transaction

Outbox Publisher
→ Kafka: payment.succeeded
```

### What Does NOT Use the Outbox

```
otp.requested             — published directly; OTP is already persisted in Redis
password.reset.requested  — published directly; reset token already persisted in Core DB
```

These are not financial or journey-critical events. If delivery fails, the user can retry the action. The Outbox overhead is not justified for these flows.

### Outbox Entity Fields (conceptual — exact schema in Phase 3.2)

```
id
event_type        (e.g. TICKET_ISSUED, PAYMENT_SUCCEEDED)
payload           JSON
status            PENDING | PUBLISHED | FAILED
created_at
published_at
attempts
```

---

## 7. Payment Initiation — Internal Endpoint Only

Payment initiation is an **internal service call only**. The browser does not call Payment Service directly.

**Correct flow:**

```
Next.js
  ↓ REST (via API Gateway)
Core API
  ↓ REST (internal, not through API Gateway)
Payment Service: POST /internal/payments/initiate
  ↓
Razorpay
```

**Public Payment Service endpoints (Razorpay calls these, not the browser):**

```
POST /webhooks/razorpay
```

**API Gateway routing — Payment Service is not publicly exposed for payment initiation.**

The `/internal/*` prefix signals that an endpoint is not reachable through the API Gateway and is intended only for service-to-service calls. Exact endpoint paths are defined in Phase 3.3 — API Contracts.

---

## 8. Kafka Topic Ownership — Final V1 List

| Topic | Producer | Consumer | Note |
|---|---|---|---|
| `payment.succeeded` | Payment Service (via Outbox) | Core | Triggers Ticket issuance |
| `ticket.issued` | Core (via Outbox) | Background Worker | Triggers Ticket email |
| `otp.requested` | Core (direct) | Background Worker | Triggers OTP email |
| `password.reset.requested` | Core (direct) | Background Worker | Triggers reset email |

`payment.failed` is **not** a Kafka topic. Failed payments are recorded in Payment Service's own database. Core is not informed of payment failures via Kafka. If a passenger queries payment status, Core calls Payment Service's internal API.

---

## 9. Core Module Dependency Rules

```
Auth             → Users
Users            → (no domain dependencies)
Stations         → (no domain dependencies)
Gates            → Stations
Fares            → Stations
FareQuotes       → Fares, Stations
Purchases        → FareQuotes, Users
Tickets          → Purchases, Stations, Outbox
Journeys         → Tickets, Stations
GateEvents       → (no domain dependencies — records only)
GateValidation   → Tickets, Journeys, GateEvents, Gates
PaymentEvents    → Tickets
Admin            → Tickets, Journeys, Stations, Gates, GateEvents
Outbox           → Kafka infrastructure only
```

**Enforcement rules:**

```
GateEvents does not write Tickets or Journeys.
Tickets does not write Journeys.
Journeys does not write Tickets directly (GateValidation orchestrates both).
PaymentEvents calls Tickets service only.
No Core domain module publishes Kafka events directly.
Domain modules write an Outbox record as part of their database transaction.
The Outbox Publisher is the only Core component responsible for publishing those durable events to Kafka.
No module imports another module's Repository directly.
```

---

## 10. Turborepo Configuration

**Note:** The exact Turborepo configuration syntax must match the version installed when the repository is initialised. The structure below reflects current Turborepo syntax (`tasks` not `pipeline`). Verify against the installed version before committing.

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test:integration": {
      "dependsOn": ["^build"],
      "outputs": [],
      "env": ["DATABASE_URL", "REDIS_URL", "KAFKA_BROKER"]
    },
    "lint": {
      "outputs": []
    },
    "type-check": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

---

## 11. Docker Configuration

### `docker-compose.yml` — Full Local Environment

```yaml
services:

  # ── Infrastructure ──────────────────────────────────────

  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: metroflow
      POSTGRES_PASSWORD: metroflow
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/init-databases.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT
      CLUSTER_ID: metroflow-local-cluster
    ports:
      - "9092:9092"

  # ── Applications ─────────────────────────────────────────

  gateway:
    image: nginx:alpine
    volumes:
      - ./docker/nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "8080:80"          # API Gateway on 8080 — no conflict with Next.js
    depends_on:
      - core-api
      - gate-service
      - payment-service

  core-api:
    build:
      context: .
      dockerfile: docker/core-api.Dockerfile
    env_file: apps/core-api/.env
    depends_on:
      - postgres
      - redis
      - kafka
    ports:
      - "3001:3001"

  payment-service:
    build:
      context: .
      dockerfile: docker/payment-service.Dockerfile
    env_file: apps/payment-service/.env
    depends_on:
      - postgres
      - kafka
    ports:
      - "3002:3002"

  gate-service:
    build:
      context: .
      dockerfile: docker/gate-service.Dockerfile
    env_file: apps/gate-service/.env
    depends_on:
      - redis
      - core-api
    ports:
      - "3003:3003"

  worker:
    build:
      context: .
      dockerfile: docker/worker.Dockerfile
    env_file: apps/worker/.env
    depends_on:
      - kafka
      - postgres
    ports:
      - "3004:3004"        # Health + metrics only

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    env_file: apps/web/.env
    ports:
      - "3000:3000"        # Next.js on 3000
    depends_on:
      - core-api
      - gate-service

volumes:
  postgres_data:
```

**Port allocation summary:**

```
3000  Next.js Web App
3001  Core API
3002  Payment Service
3003  Gate Service
3004  Background Worker (health/metrics only)
8080  API Gateway (nginx) — browser sends API calls here
5432  PostgreSQL
6379  Redis
9092  Kafka
```

### `docker/init-databases.sql`

```sql
CREATE DATABASE metroflow_core;
CREATE DATABASE metroflow_payment;
```

---

## 12. Environment Variables

Exact values for secrets, expiry durations, and configuration are **not defined here**. They are defined in:

```
phase-3-auth-design.md       → JWT expiry values
phase-3-database-schema.md   → connection string structure
```

`.env.example` files use **empty placeholders** for values not yet specified. Example values for expiry or security settings must be marked as illustrative only.

### `apps/core-api/.env.example`

```env
# Server
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://metroflow:metroflow@localhost:5432/metroflow_core

# Redis
REDIS_URL=redis://localhost:6379

# Kafka
KAFKA_BROKER=localhost:9092
KAFKA_GROUP_ID=core-api

# JWT — values defined in auth design (phase-3-auth-design.md)
JWT_SECRET=
JWT_ACCESS_EXPIRES_IN=
JWT_REFRESH_EXPIRES_IN=

# Internal service URLs
PAYMENT_SERVICE_URL=http://payment-service:3002
```

### `apps/payment-service/.env.example`

```env
PORT=3002
NODE_ENV=development
DATABASE_URL=postgresql://metroflow:metroflow@localhost:5432/metroflow_payment
KAFKA_BROKER=localhost:9092
KAFKA_GROUP_ID=payment-service
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

### `apps/gate-service/.env.example`

```env
PORT=3003
NODE_ENV=development
REDIS_URL=redis://localhost:6379
CORE_API_URL=http://core-api:3001
GATE_API_KEY_SECRET=
```

### `apps/worker/.env.example`

```env
PORT=3004
NODE_ENV=development
KAFKA_BROKER=localhost:9092
KAFKA_GROUP_ID=worker
CORE_DATABASE_URL=postgresql://metroflow:metroflow@localhost:5432/metroflow_core
EMAIL_PROVIDER=console
EMAIL_FROM=
```

### `apps/web/.env.example`

```env
# Points to API Gateway — not directly to Core
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api
```

---

## 13. GitHub Actions CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: metroflow
          POSTGRES_PASSWORD: metroflow
        options: >-
          --health-cmd pg_isready
          --health-interval 10s

      redis:
        image: redis:7-alpine

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm turbo type-check

      - name: Lint
        run: pnpm turbo lint

      - name: Unit tests
        run: pnpm turbo test

      - name: Integration tests
        run: pnpm turbo test:integration
        env:
          DATABASE_URL: postgresql://metroflow:metroflow@localhost:5432/metroflow_core
          REDIS_URL: redis://localhost:6379
```

---

## 14. Naming Conventions

### Files and Directories

| Type | Convention | Example |
|---|---|---|
| NestJS module | `kebab-case.module.ts` | `fare-quotes.module.ts` |
| NestJS controller | `kebab-case.controller.ts` | `fare-quotes.controller.ts` |
| NestJS service | `kebab-case.service.ts` | `fare-quotes.service.ts` |
| NestJS repository | `kebab-case.repository.ts` | `fare-quotes.repository.ts` |
| Entity | `kebab-case.entity.ts` | `fare-quote.entity.ts` |
| DTO | `kebab-case.dto.ts` | `create-fare-quote.dto.ts` |
| Kafka consumer | `kebab-case.consumer.ts` | `payment-events.consumer.ts` |
| Kafka producer | `kebab-case.producer.ts` | `payment-events.producer.ts` |
| Outbox publisher | `outbox.publisher.ts` | `outbox.publisher.ts` |
| Next.js page | `page.tsx` (App Router) | `app/(passenger)/tickets/page.tsx` |
| React component | `PascalCase.tsx` | `TicketCard.tsx` |
| TanStack hook | `usePascalCase.ts` | `usePaymentStatus.ts` |
| API client file | `kebab-case.api.ts` | `tickets.api.ts` |

### TypeScript

| Type | Convention | Example |
|---|---|---|
| Interface | `PascalCase` | `PaymentSucceededEvent` |
| Enum | `PascalCase` | `TicketStatus` |
| Enum value | `SCREAMING_SNAKE_CASE` | `TicketStatus.IN_JOURNEY` |
| DTO class | `PascalCase + Dto` | `CreateFareQuoteDto` |
| Entity class | `PascalCase + Entity` | `FareQuoteEntity` |

### Database

| Type | Convention | Example |
|---|---|---|
| Table name | `snake_case` (plural) | `fare_quotes`, `gate_events` |
| Column name | `snake_case` | `created_at`, `ticket_id` |
| Index | `idx_{table}_{column}` | `idx_tickets_status` |
| Unique constraint | `uq_{table}_{column}` | `uq_journeys_ticket_id` |
| Foreign key | `fk_{table}_{ref}` | `fk_journeys_tickets` |

### Kafka

| Type | Convention | Example |
|---|---|---|
| Topic | `domain.event` | `payment.succeeded` |
| Consumer group | `{service-name}` | `core-api`, `worker` |
| Event type | `PascalCase + Event` | `PaymentSucceededEvent` |

---

## 15. Structure Decision Register

| ID | Decision | Rationale |
|---|---|---|
| SR-001 | Turborepo + pnpm workspaces | Low config overhead, fast caching, strict dependency isolation |
| SR-002 | `shared-types` is universal enums and value types only | Prevents entity model leaking across service boundaries via shared packages |
| SR-003 | `contracts` for HTTP and Kafka transport shapes only | Single source of truth for inter-service message contracts without coupling domain models |
| SR-004 | Payment entity stays internal to Payment Service | Sharing internal entity model creates implicit coupling even with TypeScript |
| SR-005 | `payment.failed` is not a Kafka topic | Failed payments are owned by Payment Service; Core does not need to consume failure events |
| SR-006 | Transactional Outbox in Core and Payment Service | Fulfils AD-007 (durable Kafka delivery); prevents event loss between DB commit and Kafka publish |
| SR-007 | Outbox not used for OTP/password-reset events | These are not journey/financial critical; user can retry; Outbox overhead not justified |
| SR-008 | `PaymentEvents` calls `Tickets` only | Ticket issuance writes Outbox; durable event publication is handled by the Outbox Publisher |
| SR-009 | `Gates` is a separate Core module from `Stations` | Gates have distinct lifecycle (ACTIVE/INACTIVE); Admin manages Gates independently |
| SR-010 | Worker is in Core bounded context with Core DB access | Journey timeout job needs Core persistence; Worker is not an independent microservice |
| SR-011 | Worker runs minimal HTTP listener for /health and /metrics | Kafka consumer apps still need operational endpoints; no business REST API is exposed |
| SR-012 | Payment initiation is internal endpoint only | Browser never calls Payment Service directly; Core orchestrates payment initiation |
| SR-013 | API Gateway on port 8080, Next.js on 3000 | Resolves Docker port 3000 conflict |
| SR-014 | JWT expiry and secret values left empty in .env.example | Auth design not yet complete; config examples must not silently make security decisions |
| SR-015 | API endpoint paths not specified in repository structure | Endpoint contracts belong to Phase 3.3; repository structure must not pre-empt that document |
| SR-016 | PostgreSQL 18, Node 24 | Current stable versions for a new project; no reason to start on older major versions |
| SR-017 | Turborepo `tasks` syntax (not `pipeline`) | Current Turborepo API; `pipeline` is deprecated |
| SR-018 | Next.js App Router with route groups | Clean separation of passenger, admin, gate-simulator, and auth flows |
| SR-019 | Console email provider for local development | No external email dependency during development |
| SR-020 | Single PostgreSQL container with two logical databases locally | Preserves service data boundaries without running two containers |
| SR-021 | Core domain modules do not publish Kafka events directly | Durable Core events are written to the Transactional Outbox and published by the Outbox Publisher, keeping domain logic separated from transport infrastructure |

---

## 16. Remaining Phase 3 Documents

This document covers repository and project structure. The remaining Phase 3 deliverables are:

```
phase-3-database-schema.md
  Core schema: tables, columns, indexes, constraints
  Payment schema: tables, columns, indexes, constraints
  Outbox table structure per service

phase-3-api-contracts.md
  All REST endpoint paths, HTTP verbs, request/response shapes
  Internal endpoint conventions (/internal/*)
  Error response envelope

phase-3-kafka-schemas.md
  Exact field definitions per Kafka topic
  Consumer group configuration
  Idempotency key strategy per topic

phase-3-auth-design.md
  JWT structure and expiry values
  OTP flow and TTL
  Password reset token design
  Session strategy

phase-3-feature-specs/
  One specification per V1 feature
  Each includes: goal, inputs, business rules, happy path,
  failure cases, Definition of Done
```

Implementation of any feature begins only after its Phase 3 specification is approved.
