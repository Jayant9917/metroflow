# MetroFlow — Phase 3.2: Database Schema Design

> **Document:** `architecture/phase-3-database-schema.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 3 — Detailed Design
> **Section:** 3.2 — Database Schema Design
> **Status:** Final — V1 Schema Locked
> **Amendment:** Auth sessions added during Phase 3.4 design; Phase 3.5 payment-idempotency additions included
> **Depends on:** `architecture/phase-2-architecture.md`, `architecture/phase-3-repository-structure.md`

---

## 1. Purpose

This document defines the complete relational database schema for MetroFlow V1.

It covers:

```
Core PostgreSQL database     — all metro domain tables
Payment PostgreSQL database  — all payment and provider tables
Outbox tables                — one per database, for durable Kafka event delivery
Design decisions and rationale for every non-obvious choice
Intentional denormalization with explicit documentation
Index strategy per table
Constraint strategy (PK, FK, UNIQUE, CHECK)
Concurrency and idempotency mechanisms
Future scalability notes
Drizzle ORM schema file structure
```

---

## 2. Schema Design Principles

### 2.1 Normalization

The schema targets **Third Normal Form (3NF)** as the baseline.

Exceptions are permitted only where:

```
Historical accuracy requires capturing a value at a point in time
  (e.g. fare amount on a ticket — the fare rule may change later)

Audit integrity requires an immutable snapshot
  (e.g. origin/destination on a ticket)

Query performance requires avoiding a join on a hot read path
  (must be documented with the specific query it serves)
```

All intentional denormalization is documented in Section 12.

### 2.2 Primary Keys

All public-facing entities use **UUID v7** as their primary key.

```
UUID v7 properties:
  Time-ordered           → better B-tree index performance than UUID v4
  Globally unique        → safe for distributed generation
  Opaque to clients      → no sequential ID enumeration
  Chronologically sortable → natural ordering without extra sort column
```

**Generation strategy:** MetroFlow generates UUID v7 identifiers at the application layer so that IDs are available before persistence and can be consistently used across entities, logs, REST responses, and outbox/event construction. IDs are generated in TypeScript via the `uuidv7` npm package and passed to Drizzle for storage as PostgreSQL `UUID` columns.

PostgreSQL 18's native `gen_uuidv7()` exists but is intentionally unused. Application-layer generation keeps ID creation testable, consistent across all services, and available before any database round-trip.

Internal reference tables with no external exposure (e.g. `fare_rules`) use `BIGSERIAL` where simplicity is preferred.

### 2.3 Timestamps

All tables include:

```sql
created_at  TIMESTAMPTZ  NOT NULL  DEFAULT NOW()
```

Tables with mutable records additionally include:

```sql
updated_at  TIMESTAMPTZ  NOT NULL  DEFAULT NOW()
```

`updated_at` is maintained at the application layer on every write.

**All timestamps are `TIMESTAMPTZ`.** Naive `TIMESTAMP` is never used. All values are stored in UTC.

### 2.4 Soft Deletes

MetroFlow does **not** use soft deletes in V1.

```
Gate events      — immutable, INSERT-only
Provider events  — immutable, INSERT-only
Outbox events    — status-tracked, never deleted
All others       — not expected to be deleted in normal operation
```

Explicit `status` transitions are preferred over soft delete patterns.

### 2.5 Service Data Ownership

```
Core PostgreSQL    → owned exclusively by Core API and Background Worker
Payment PostgreSQL → owned exclusively by Payment Service

No cross-database foreign keys.
No shared tables.
Cross-service references are stored as plain UUID columns with no FK constraint.
Every such column is documented with a comment.
```

### 2.6 Naming Conventions

```
Tables          snake_case, plural             gate_events, fare_quotes
Columns         snake_case                     created_at, ticket_id
Primary keys    id
Foreign keys    {referenced_singular}_id       ticket_id, station_id
Indexes         idx_{table}_{column(s)}        idx_tickets_status
Unique          uq_{table}_{column(s)}         uq_journeys_ticket_id
Check           chk_{table}_{rule}             chk_tickets_valid_status
FK constraint   fk_{table}_{ref}               fk_journeys_tickets
Enum types      {domain}_{field}_type          ticket_status_type
```

---

## 3. PostgreSQL Enum Types

### 3.1 Core Database Enums

```sql
CREATE TYPE user_role_type AS ENUM (
  'PASSENGER',
  'ADMIN'
);

CREATE TYPE gate_type AS ENUM (
  'ENTRY',
  'EXIT'
);

CREATE TYPE gate_status_type AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE purchase_status_type AS ENUM (
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'TICKET_ISSUED'
);

CREATE TYPE ticket_status_type AS ENUM (
  'ISSUED',
  'IN_JOURNEY',
  'COMPLETED',
  'EXPIRED'
);

CREATE TYPE journey_status_type AS ENUM (
  'ACTIVE',
  'COMPLETED',
  'TIMED_OUT'
);

CREATE TYPE gate_event_type AS ENUM (
  'ENTRY_ACCEPTED',
  'ENTRY_REJECTED',
  'EXIT_ACCEPTED',
  'EXIT_REJECTED'
);

CREATE TYPE gate_rejection_reason_type AS ENUM (
  'TICKET_NOT_FOUND',
  'TICKET_EXPIRED',
  'TICKET_COMPLETED',
  'TICKET_ALREADY_IN_JOURNEY',
  'WRONG_ORIGIN',
  'WRONG_DESTINATION',
  'NO_ACTIVE_JOURNEY',
  'JOURNEY_TIMED_OUT',
  'GATE_INACTIVE'
);

CREATE TYPE outbox_status_type AS ENUM (
  'PENDING',
  'PUBLISHED',
  'DEAD'
);
```

### 3.2 Payment Database Enums

```sql
CREATE TYPE payment_status_type AS ENUM (
  'CREATED',
  'PENDING',
  'SUCCESS'
);

CREATE TYPE payment_attempt_status_type AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED'
);

CREATE TYPE outbox_status_type AS ENUM (
  'PENDING',
  'PUBLISHED',
  'DEAD'
);
```

---

## 4. Core Database Schema

### 4.1 `users`

Stores registered passengers and admin accounts.

```sql
CREATE TABLE users (
  id                UUID           PRIMARY KEY,
  email             TEXT           NOT NULL,
  password_hash     TEXT,
  -- NULL when user registers via OTP-only flow
  -- NOT NULL when user has set a password

  role              user_role_type NOT NULL DEFAULT 'PASSENGER',
  is_email_verified BOOLEAN        NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE INDEX idx_users_role ON users (role);
```

**Notes:**
- `password_hash` is nullable to support passwordless accounts
- `is_email_verified` is present for future use; V1 does not gate access on email verification
- Email uniqueness enforced at the database level

### `sessions` — Phase 3.2 Amendment: Auth Sessions

A dedicated `sessions` table is added to Core PostgreSQL to support refresh-token rotation, logout revocation, session expiry, and refresh-token reuse detection.

PostgreSQL is the authoritative source for session validity. Redis is not the sole source of truth for refresh-token revocation.

```sql
CREATE TYPE session_status_type AS ENUM (
  'ACTIVE',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE sessions (
  id                 UUID                PRIMARY KEY,
  user_id            UUID                NOT NULL REFERENCES users (id),

  refresh_token_hash TEXT                NOT NULL,

  family_id          UUID                NOT NULL,
  -- Identifies the refresh-token rotation family for this session

  rotation_counter   INTEGER             NOT NULL DEFAULT 0,
  status             session_status_type NOT NULL DEFAULT 'ACTIVE',

  expires_at         TIMESTAMPTZ         NOT NULL,
  last_used_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,

  device_info        TEXT,
  -- Optional metadata only; no device fingerprinting requirement in V1

  created_at         TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_sessions_refresh_token_hash
    UNIQUE (refresh_token_hash),

  CONSTRAINT chk_sessions_rotation_counter
    CHECK (rotation_counter >= 0),

  CONSTRAINT chk_sessions_revoked_state
    CHECK (
      status <> 'REVOKED'
      OR revoked_at IS NOT NULL
    )
);

CREATE INDEX idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX idx_sessions_family_id
  ON sessions (family_id);

CREATE INDEX idx_sessions_active_expiry
  ON sessions (expires_at)
  WHERE status = 'ACTIVE';
```

**Session ownership:**

```
Core Auth module
    → owns sessions

PostgreSQL
    → authoritative source for session validity

Redis
    → OTPs
    → rate limiting
    → optional short-lived auth cache
```

**Refresh-token rotation:**

```
Login
    → Session created
    → Refresh Token V1 stored as hash

Refresh using V1
    → validate session
    → V1 invalidated/replaced
    → rotation_counter++
    → Refresh Token V2 issued

Old V1 used again
    → refresh-token reuse detected
    → session/family revoked
    → user must authenticate again
```

The schema supports multiple sessions per user. Admin session listing/revocation APIs are not part of MetroFlow V1 and remain a future capability.

---

### 4.2 `otp_codes`

Audit record of OTP requests and consumption. Redis is the authoritative store for OTP validation — this table records that an OTP was requested and whether it was consumed.

**No OTP hash is stored here.** Redis holds the hashed OTP value with TTL. If the Redis key expires, the OTP is expired — the user must request a new one.

```sql
CREATE TABLE otp_codes (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users (id),
  purpose      TEXT        NOT NULL,
  -- 'LOGIN' | 'EMAIL_VERIFICATION'

  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  -- Mirrors the TTL set in Redis at request time

  consumed_at  TIMESTAMPTZ,
  -- NULL = OTP not yet used or expired unused
  -- NOT NULL = OTP was successfully consumed

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_user_id ON otp_codes (user_id);

CREATE INDEX idx_otp_codes_expires_at
  ON otp_codes (expires_at)
  WHERE consumed_at IS NULL;
-- Partial index: only index pending OTPs for expiry queries
```

**Notes:**
- OTP validation happens entirely through Redis
- This table provides audit trail: how many OTPs were requested, when, and whether consumed
- Rate limiting is enforced by the Core Auth module using Redis; this table is not the enforcement mechanism

---

### 4.3 `password_reset_tokens`

Stores secure password reset tokens. Unlike OTPs, password reset tokens are security-sensitive and are hashed before storage. Redis is not used for password reset — the token is durable.

```sql
CREATE TABLE password_reset_tokens (
  id           UUID        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users (id),
  token_hash   TEXT        NOT NULL,
  -- Token is hashed before storage; plaintext is never persisted

  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  -- NULL = unused; NOT NULL = consumed

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_password_reset_tokens_hash UNIQUE (token_hash)
);

CREATE INDEX idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
```

**Notes:**
- Password reset tokens are durable (not TTL-based) because the user may not act immediately
- Only one unused token per user should be active at a time — enforced at application layer by invalidating previous tokens on new request

---

### 4.4 `stations`

Metro stations participating in fare collection. Seeded data in V1.

```sql
CREATE TABLE stations (
  id         UUID        PRIMARY KEY,
  code       TEXT        NOT NULL,
  -- Short unique identifier used in business logic e.g. 'RAJIV_CHOWK'

  name       TEXT        NOT NULL,
  -- Human-readable display name e.g. 'Rajiv Chowk'

  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_stations_code UNIQUE (code)
);
```

---

### 4.5 `gates`

Entry and exit validation points belonging to a station.

```sql
CREATE TABLE gates (
  id         UUID             PRIMARY KEY,
  station_id UUID             NOT NULL REFERENCES stations (id),
  code       TEXT             NOT NULL,
  -- Gate identifier unique within its station e.g. 'GATE-A1'

  type       gate_type        NOT NULL,
  -- 'ENTRY' | 'EXIT'

  status     gate_status_type NOT NULL DEFAULT 'ACTIVE',
  -- 'ACTIVE' | 'INACTIVE'

  created_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_gates_station_code UNIQUE (station_id, code)
);

CREATE INDEX idx_gates_station_id ON gates (station_id);
CREATE INDEX idx_gates_status     ON gates (status);
```

---

### 4.6 `fare_rules`

Authoritative fare lookup table. Maps origin-destination pairs to a fare amount.

```sql
CREATE TABLE fare_rules (
  id                     BIGSERIAL      PRIMARY KEY,
  -- Internal ID only; not exposed publicly

  origin_station_id      UUID           NOT NULL REFERENCES stations (id),
  destination_station_id UUID           NOT NULL REFERENCES stations (id),
  amount                 NUMERIC(10, 2) NOT NULL,
  -- NUMERIC avoids floating-point errors for currency

  currency               TEXT           NOT NULL DEFAULT 'INR',
  is_active              BOOLEAN        NOT NULL DEFAULT TRUE,
  valid_from             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  valid_until            TIMESTAMPTZ,
  -- NULL = currently active with no expiry

  created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fare_rules_different_stations
    CHECK (origin_station_id <> destination_station_id),

  CONSTRAINT chk_fare_rules_positive_amount
    CHECK (amount > 0),

  CONSTRAINT chk_fare_rules_valid_period
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX uq_fare_rules_route_active
  ON fare_rules (origin_station_id, destination_station_id)
  WHERE is_active = TRUE AND valid_until IS NULL;
-- Only one active unbounded rule per route at any time

CREATE INDEX idx_fare_rules_origin      ON fare_rules (origin_station_id);
CREATE INDEX idx_fare_rules_destination ON fare_rules (destination_station_id);
```

**Notes:**
- `NUMERIC(10, 2)` is used for all monetary amounts throughout the schema — never `FLOAT`
- Fare rules are versioned via `valid_from` / `valid_until` to support future fare changes
- The partial unique index prevents conflicting active rules for the same route

---

### 4.7 `fare_quotes`

Time-limited fare calculation results issued before purchase.

```sql
CREATE TABLE fare_quotes (
  id                     UUID           PRIMARY KEY,
  user_id                UUID           NOT NULL REFERENCES users (id),
  origin_station_id      UUID           NOT NULL REFERENCES stations (id),
  destination_station_id UUID           NOT NULL REFERENCES stations (id),
  fare_rule_id           BIGINT         NOT NULL REFERENCES fare_rules (id),
  amount                 NUMERIC(10, 2) NOT NULL,
  -- Denormalized from fare_rule — see Section 12.1

  currency               TEXT           NOT NULL DEFAULT 'INR',
  expires_at             TIMESTAMPTZ    NOT NULL,
  -- Set to created_at + 10 minutes at application layer

  used_at                TIMESTAMPTZ,
  -- NULL = not yet consumed; NOT NULL = consumed by a purchase

  created_at             TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_fare_quotes_different_stations
    CHECK (origin_station_id <> destination_station_id),

  CONSTRAINT chk_fare_quotes_positive_amount
    CHECK (amount > 0)
);

CREATE INDEX idx_fare_quotes_user_id    ON fare_quotes (user_id);
CREATE INDEX idx_fare_quotes_expires_at
  ON fare_quotes (expires_at)
  WHERE used_at IS NULL;
-- Partial index: only unexpired, unconsumed quotes
```

---

### 4.8 `purchases`

Records a passenger's intent to acquire a specific journey at a quoted fare. Core maintains its own purchase lifecycle status so it can answer purchase state queries without calling Payment Service.

```sql
CREATE TABLE purchases (
  id                     UUID                  PRIMARY KEY,
  user_id                UUID                  NOT NULL REFERENCES users (id),
  fare_quote_id          UUID                  NOT NULL REFERENCES fare_quotes (id),
  origin_station_id      UUID                  NOT NULL REFERENCES stations (id),
  destination_station_id UUID                  NOT NULL REFERENCES stations (id),
  -- Denormalized from fare_quote — see Section 12.2

  amount                 NUMERIC(10, 2)        NOT NULL,
  -- Denormalized from fare_quote — see Section 12.2

  currency               TEXT                  NOT NULL DEFAULT 'INR',
  status                 purchase_status_type  NOT NULL DEFAULT 'CREATED',
  -- CREATED         → purchase record created, no payment initiated
  -- PAYMENT_PENDING → Core has initiated payment with Payment Service
  -- PAID            → payment.succeeded Kafka event consumed and payment success persisted in Core
  -- TICKET_ISSUED   → ticket successfully created after PAID state has been persisted

  created_at             TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_purchases_positive_amount
    CHECK (amount > 0),

  CONSTRAINT chk_purchases_different_stations
    CHECK (origin_station_id <> destination_station_id)
);

CREATE INDEX idx_purchases_user_id      ON purchases (user_id);
CREATE INDEX idx_purchases_status       ON purchases (status);
CREATE UNIQUE INDEX uq_purchases_fare_quote_id
  ON purchases (fare_quote_id);
-- One FareQuote can create at most one Purchase
```

**Purchase status ownership:**
- `CREATED → PAYMENT_PENDING` — set by Core when payment is initiated with Payment Service
- `PAYMENT_PENDING → PAID` — Core first persists confirmed payment success
- `PAID → TICKET_ISSUED` — ticket issuance happens after PAID has been persisted
- If ticket issuance fails after PAID is stored, the purchase remains PAID and can be safely retried or recovered without losing the confirmed payment state
- Payment Service remains authoritative for detailed payment state (attempt history, failure reasons)
- Core does not mirror `FAILED` payment state — detailed failure belongs to Payment Service

---

### 4.9 `tickets`

Digital travel entitlements issued after confirmed payment.

```sql
CREATE TABLE tickets (
  id                     UUID               PRIMARY KEY,
  purchase_id            UUID               NOT NULL REFERENCES purchases (id),
  user_id                UUID               NOT NULL REFERENCES users (id),

  payment_id             UUID               NOT NULL,
  -- Cross-service reference: payments.id from Payment Service database
  -- No FK constraint — separate database

  origin_station_id      UUID               NOT NULL REFERENCES stations (id),
  destination_station_id UUID               NOT NULL REFERENCES stations (id),
  -- Denormalized from purchase — see Section 12.3

  paid_amount            NUMERIC(10, 2)     NOT NULL,
  -- Denormalized from purchase — see Section 12.3

  currency               TEXT               NOT NULL DEFAULT 'INR',
  status                 ticket_status_type NOT NULL DEFAULT 'ISSUED',
  issued_at              TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  expires_at             TIMESTAMPTZ        NOT NULL,
  -- End of metro service day — set at application layer

  created_at             TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_tickets_positive_amount
    CHECK (paid_amount > 0),

  CONSTRAINT chk_tickets_expiry_after_issue
    CHECK (expires_at > issued_at)
);

-- Primary idempotency constraint: prevents duplicate ticket on Kafka replay
CREATE UNIQUE INDEX uq_tickets_payment_id  ON tickets (payment_id);

CREATE INDEX idx_tickets_user_id           ON tickets (user_id);
CREATE INDEX idx_tickets_status            ON tickets (status);
CREATE UNIQUE INDEX uq_tickets_purchase_id
  ON tickets (purchase_id);
-- One Purchase can produce at most one Ticket
CREATE INDEX idx_tickets_expires_at
  ON tickets (expires_at)
  WHERE status = 'ISSUED';
-- Partial index: only ISSUED tickets awaiting expiry
```

**Notes:**
- `uq_tickets_payment_id` and `uq_tickets_purchase_id` protect duplicate Ticket creation from both payment and purchase directions
- If `payment.succeeded` is consumed twice, the second ticket INSERT fails with a unique constraint violation
- `paid_amount`, `origin_station_id`, `destination_station_id` are intentionally denormalized — see Section 12.3
- `payment_id` is a cross-service reference with no FK constraint — documented above

---

### 4.10 `journeys`

Records of actual passenger travel between entry and exit.

```sql
CREATE TABLE journeys (
  id               UUID                PRIMARY KEY,
  ticket_id        UUID                NOT NULL REFERENCES tickets (id),
  user_id          UUID                NOT NULL REFERENCES users (id),

  entry_station_id UUID                NOT NULL REFERENCES stations (id),
  exit_station_id  UUID                REFERENCES stations (id),
  -- NULL until exit is recorded

  entry_gate_id    UUID                NOT NULL REFERENCES gates (id),
  exit_gate_id     UUID                REFERENCES gates (id),
  -- NULL until exit is recorded

  status           journey_status_type NOT NULL DEFAULT 'ACTIVE',

  entered_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ         NOT NULL,
  -- entered_at + 2.5 hours, computed at application layer on entry
  -- Gate validation checks NOW() > expires_at to enforce 2.5-hour limit
  -- The background worker is cleanup, not the authority for this rule

  exited_at        TIMESTAMPTZ,
  -- NULL until successful exit

  timed_out_at     TIMESTAMPTZ,
  -- NULL unless background worker persisted TIMED_OUT state
  -- Represents when state was written, not when the rule was violated

  created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_journeys_exit_after_entry
    CHECK (exited_at IS NULL OR exited_at > entered_at),

  CONSTRAINT chk_journeys_expires_after_entry
    CHECK (expires_at > entered_at),

  CONSTRAINT chk_journeys_timeout_after_entry
    CHECK (timed_out_at IS NULL OR timed_out_at > entered_at),

  CONSTRAINT chk_journeys_completed_has_exit
    CHECK (
      status <> 'COMPLETED'
      OR (
        exit_station_id IS NOT NULL
        AND exited_at IS NOT NULL
        AND exit_gate_id IS NOT NULL
      )
    ),

  CONSTRAINT chk_journeys_timed_out_state
    CHECK (
      status <> 'TIMED_OUT'
      OR (
        exit_station_id IS NULL
        AND exit_gate_id IS NULL
        AND exited_at IS NULL
        AND timed_out_at IS NOT NULL
      )
    ),

  CONSTRAINT chk_journeys_active_state
    CHECK (
      status <> 'ACTIVE'
      OR (
        exit_station_id IS NULL
        AND exit_gate_id IS NULL
        AND exited_at IS NULL
        AND timed_out_at IS NULL
      )
    )
);

-- Primary concurrency constraint: one journey per ticket
CREATE UNIQUE INDEX uq_journeys_ticket_id ON journeys (ticket_id);

CREATE INDEX idx_journeys_user_id         ON journeys (user_id);
CREATE INDEX idx_journeys_status          ON journeys (status);
CREATE INDEX idx_journeys_entry_station   ON journeys (entry_station_id);

CREATE INDEX idx_journeys_active_expires
  ON journeys (expires_at ASC)
  WHERE status = 'ACTIVE';
-- Partial index: used by background timeout sweep to find expired active journeys
```

**Three distinct timestamps — three different facts:**

```
entered_at    When the passenger physically passed the entry gate
expires_at    When the journey becomes invalid by the 2.5-hour business rule
              Gate validation: NOW() > expires_at → reject
timed_out_at  When the background worker persisted TIMED_OUT to the database
              Always >= expires_at due to scheduler lag
```

**Notes:**
- `uq_journeys_ticket_id` combined with the conditional `UPDATE` on `tickets.status = 'ISSUED'` forms the two-layer concurrency protection for entry
- `expires_at` is the authoritative timeout signal for gate validation — not `timed_out_at` and not a computed expression
- Check constraints encode key business invariants at the database level independently of application logic

---

### 4.11 `gate_events`

Immutable audit records of every gate interaction, regardless of outcome.

```sql
CREATE TABLE gate_events (
  id               UUID                       PRIMARY KEY,
  gate_id          UUID                       NOT NULL REFERENCES gates (id),
  station_id       UUID                       NOT NULL REFERENCES stations (id),
  -- Denormalized from gate — see Section 12.4

  ticket_id        UUID,
  -- NULL if ticket was not found (TICKET_NOT_FOUND rejection)
  -- No FK constraint: ticket may not exist in database

  event_type       gate_event_type            NOT NULL,
  rejection_reason gate_rejection_reason_type,
  -- NULL for ACCEPTED events; NOT NULL for REJECTED events

  request_id       TEXT,
  -- Client-supplied idempotency key from Gate Service

  occurred_at      TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  -- occurred_at = business event time
  -- created_at  = record insertion time (may differ under retry)

  CONSTRAINT chk_gate_events_rejection_consistency
    CHECK (
      (event_type IN ('ENTRY_ACCEPTED', 'EXIT_ACCEPTED')
        AND rejection_reason IS NULL)
      OR
      (event_type IN ('ENTRY_REJECTED', 'EXIT_REJECTED')
        AND rejection_reason IS NOT NULL)
    )
);

-- gate_events is INSERT-only. No UPDATE. No DELETE.

CREATE INDEX idx_gate_events_gate_id      ON gate_events (gate_id);
CREATE INDEX idx_gate_events_occurred_at  ON gate_events (occurred_at DESC);

CREATE INDEX idx_gate_events_ticket_id
  ON gate_events (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX idx_gate_events_station_occurred
  ON gate_events (station_id, occurred_at DESC);
-- Station-level audit queries

CREATE UNIQUE INDEX uq_gate_events_request_id
  ON gate_events (request_id)
  WHERE request_id IS NOT NULL;
-- Database-backed idempotency guard for Gate Service requests
```

**Notes:**
- `ticket_id` has no FK constraint because `TICKET_NOT_FOUND` events must be recorded even when no ticket row exists
- `station_id` is denormalized — see Section 12.4
- `occurred_at` and `created_at` are separate to handle retry/replay scenarios accurately

---

### 4.12 `outbox_events` (Core)

Transactional outbox table for durable Kafka publishing from Core. Inserted in the same database transaction as the business record it announces.

```sql
CREATE TABLE outbox_events (
  id                UUID               PRIMARY KEY,
  event_type        TEXT               NOT NULL,
  -- e.g. 'TICKET_ISSUED'

  topic             TEXT               NOT NULL,
  -- Kafka topic e.g. 'ticket.issued'

  payload           JSONB              NOT NULL,
  -- Full event payload

  status            outbox_status_type NOT NULL DEFAULT 'PENDING',
  -- PENDING   → awaiting Kafka publication
  -- PUBLISHED → successfully delivered to Kafka
  -- DEAD      → exceeded max retry attempts; requires investigation

  attempts          INTEGER            NOT NULL DEFAULT 0,
  -- Incremented on each publish attempt
  -- Status remains PENDING while retrying

  last_attempted_at TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  -- NULL until successfully published

  error_message     TEXT,
  -- Most recent error message; updated on each failed attempt

  created_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_outbox_attempts_non_negative
    CHECK (attempts >= 0)
);

CREATE INDEX idx_outbox_pending
  ON outbox_events (created_at ASC)
  WHERE status = 'PENDING';
-- Partial index: publisher polls PENDING records oldest-first

CREATE INDEX idx_outbox_dead
  ON outbox_events (attempts DESC)
  WHERE status = 'DEAD';
-- Supports dead-event monitoring and admin visibility
```

**Retry semantics:**

```
Poll PENDING records (oldest first, batch of N)
For each record:
  Attempt Kafka publish
  If SUCCESS:
    UPDATE status = 'PUBLISHED', published_at = NOW()
  If FAILURE:
    UPDATE attempts = attempts + 1, last_attempted_at = NOW(), error_message = '...'
    If attempts >= max_attempts:
      UPDATE status = 'DEAD'
    Else:
      status remains 'PENDING' — will be retried on next poll

DEAD records:
  Require operational investigation
  Should be surfaced in admin visibility
  Never automatically deleted
```

`max_attempts` and polling interval are configuration values — not frozen in this schema document.

---

## 5. Payment Database Schema

### 5.1 `payments`

One payment record per purchase. Owns the overall payment lifecycle for a purchase. Multiple `payment_attempts` may be linked underneath.

```sql
CREATE TABLE payments (
  id                   UUID                PRIMARY KEY,

  purchase_id          UUID                NOT NULL,
  -- Cross-service reference: purchases.id from Core database
  -- No FK constraint — separate database

  user_id              UUID                NOT NULL,
  -- Cross-service reference: users.id from Core database

  amount               NUMERIC(10, 2)      NOT NULL,
  currency             TEXT                NOT NULL DEFAULT 'INR',

  status               payment_status_type NOT NULL DEFAULT 'CREATED',
  -- CREATED → payment lifecycle record initialized
  -- PENDING → payment is awaiting successful completion; attempts may be created/retried
  -- SUCCESS → exactly one PaymentAttempt has succeeded

  razorpay_payment_id  TEXT,
  -- Set when a PaymentAttempt succeeds (from webhook)

  razorpay_signature   TEXT,
  -- HMAC signature from successful webhook for audit

  created_at           TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_payments_positive_amount
    CHECK (amount > 0)
);

CREATE UNIQUE INDEX uq_payments_purchase_id
  ON payments (purchase_id);
-- One Payment record per Purchase

CREATE UNIQUE INDEX uq_payments_razorpay_payment_id
  ON payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
-- Idempotency: prevents duplicate processing of same Razorpay payment

CREATE INDEX idx_payments_status ON payments (status);
```

**Relationship to `payment_attempts`:**

```
Purchase
   └── Payment (one — owns lifecycle)
         ├── PaymentAttempt (attempt 1 → FAILED)
         ├── PaymentAttempt (attempt 2 → FAILED)
         └── PaymentAttempt (attempt 3 → SUCCESS)
                               ↑
                 payments.razorpay_payment_id set from this attempt
```

---

### 5.2 `payment_attempts`

Records each individual Razorpay payment attempt. Provides the full audit trail of how the payment lifecycle reached its final state.

```sql
CREATE TABLE payment_attempts (
  id                    UUID                          PRIMARY KEY,
  payment_id            UUID                          NOT NULL REFERENCES payments (id),

  razorpay_order_id     TEXT                          NOT NULL,
  -- The Razorpay Order this attempt was made against

  razorpay_payment_id   TEXT,
  -- Set when Razorpay confirms the outcome of this attempt

  status                payment_attempt_status_type   NOT NULL DEFAULT 'PENDING',
  -- PENDING → attempt in progress
  -- SUCCESS → Razorpay confirmed payment captured
  -- FAILED  → Razorpay confirmed payment failed or was rejected

  failure_reason        TEXT,
  -- NULL for successful attempts; populated from Razorpay response on failure

  attempted_at          TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  -- NULL until terminal state (SUCCESS or FAILED)

  created_at            TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_attempts_payment_id
  ON payment_attempts (payment_id);

CREATE UNIQUE INDEX uq_payment_attempts_one_success
  ON payment_attempts (payment_id)
  WHERE status = 'SUCCESS';
-- A Payment can have at most one successful attempt

CREATE UNIQUE INDEX uq_payment_attempts_one_pending
  ON payment_attempts (payment_id)
  WHERE status = 'PENDING';
-- A Payment can have at most one active pending attempt

CREATE UNIQUE INDEX uq_payment_attempts_razorpay_order_id
  ON payment_attempts (razorpay_order_id);
-- One Razorpay Order belongs to exactly one PaymentAttempt

CREATE UNIQUE INDEX uq_payment_attempts_razorpay_payment_id
  ON payment_attempts (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
-- A Razorpay payment ID can belong to only one attempt
```

**Notes:**
- Each row represents one Razorpay order attempt from `PENDING` to `SUCCESS` or `FAILED`
- A failed attempt does not make the parent Payment failed. `payments.status` remains `PENDING` while attempts fail.
- When one attempt succeeds, `payments.status` transitions to `SUCCESS`.
- On `SUCCESS`, `payments.razorpay_payment_id` and `payments.razorpay_signature` are set from the successful attempt

---

### 5.3 `provider_events`

Immutable log of every raw event received from Razorpay. INSERT-only. Never modified after creation.

```sql
CREATE TABLE provider_events (
  id                UUID        PRIMARY KEY,
  provider          TEXT        NOT NULL DEFAULT 'RAZORPAY',
  event_type        TEXT        NOT NULL,
  -- Razorpay event type e.g. 'payment.captured', 'payment.failed'

  provider_event_id TEXT        NOT NULL,
  -- Razorpay's own event identifier

  payment_id        UUID,
  -- NULL if event cannot be linked to a known Payment record yet
  -- No FK constraint — may arrive before payment record is fully processed

  raw_payload       JSONB       NOT NULL,
  -- Parsed webhook payload stored for audit and reconciliation

  inconsistency_code TEXT,
  -- Nullable reconciliation flag, e.g. UNKNOWN_RAZORPAY_ORDER,
  -- PAYMENT_STATE_INCONSISTENCY, or PAYMENT_AMOUNT_MISMATCH

  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_provider_events_id
    UNIQUE (provider, provider_event_id)
  -- Idempotency: prevents processing the same Razorpay event twice
);

CREATE INDEX idx_provider_events_payment_id
  ON provider_events (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX idx_provider_events_received_at
  ON provider_events (received_at DESC);
```

**Notes:**
- `provider_events` is INSERT-only — application must never UPDATE or DELETE rows
- `raw_payload` stores the parsed webhook payload as JSONB for audit, reconciliation, and debugging; exact raw HTTP bytes are retained only transiently for HMAC verification
- `uq_provider_events_id` deduplicates provider events transactionally with recognized-event processing

---

### 5.4 Phase 3.2 Schema Amendment — Durable Payment Initiation Idempotency

PostgreSQL is the authoritative source for payment-initiation idempotency. Redis
may optionally cache a response, but Redis loss, restart, or eviction must never
allow a retry to create a second PaymentAttempt or Razorpay Order.

```sql
CREATE TYPE payment_idempotency_status_type AS ENUM (
  'IN_PROGRESS',
  'COMPLETED',
  'RETRYABLE'
);

CREATE TABLE payment_idempotency_keys (
  id                  UUID         PRIMARY KEY,
  idempotency_key     TEXT         NOT NULL,
  purchase_id         UUID         NOT NULL,
  payment_id          UUID         NOT NULL REFERENCES payments (id),
  reserved_attempt_id UUID         NOT NULL,
  -- Stable attempt identity reserved before payment_attempts is finalized;
  -- intentionally has no FK because the attempt row may not exist yet
  payment_attempt_id  UUID,
  razorpay_order_id   TEXT,
  response_payload    JSONB,
  status              payment_idempotency_status_type NOT NULL DEFAULT 'IN_PROGRESS',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ  NOT NULL,

  CONSTRAINT uq_payment_idempotency_key
    UNIQUE (idempotency_key)
);

CREATE INDEX idx_payment_idempotency_purchase_id
  ON payment_idempotency_keys (purchase_id);

CREATE INDEX idx_payment_idempotency_expires_at
  ON payment_idempotency_keys (expires_at);

CREATE UNIQUE INDEX uq_payment_idempotency_one_in_progress_per_payment
  ON payment_idempotency_keys (payment_id)
  WHERE status = 'IN_PROGRESS';
-- A Payment can have at most one active initiation reservation
```

Before calling Razorpay, Payment Service durably reserves the key as
`IN_PROGRESS`, creates the Payment if needed, and reserves a stable
`reserved_attempt_id`. After Razorpay Order creation, it persists the Order ID,
creates/finalizes the PaymentAttempt, stores the response, and changes the key to
`COMPLETED`. Concurrent requests with the same key are resolved from this durable
state: `COMPLETED` returns the stored result, while `IN_PROGRESS` does not call
Razorpay again and instead returns an in-progress result or performs bounded
reconciliation. No database transaction is held open during the provider call.

If a key is found `IN_PROGRESS` after a crash, Payment Service must reconcile the
reserved provider operation before deciding whether it can retry; it must not
blindly create another Razorpay Order. A deliberate new payment attempt uses a
new key but the same parent Payment. `RETRYABLE` means the provider definitively
confirmed that no Order was created, so the same logical initiation may retry
safely.

### 5.5 `outbox_events` (Payment)

Transactional outbox for durable Kafka publishing from Payment Service. Identical structure to Core's outbox — same retry semantics, same `DEAD` terminal state.

```sql
CREATE TABLE outbox_events (
  id                UUID               PRIMARY KEY,
  event_type        TEXT               NOT NULL,
  topic             TEXT               NOT NULL,
  payload           JSONB              NOT NULL,
  status            outbox_status_type NOT NULL DEFAULT 'PENDING',
  attempts          INTEGER            NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_outbox_attempts_non_negative
    CHECK (attempts >= 0)
);

CREATE INDEX idx_outbox_pending
  ON outbox_events (created_at ASC)
  WHERE status = 'PENDING';

CREATE INDEX idx_outbox_dead
  ON outbox_events (attempts DESC)
  WHERE status = 'DEAD';
```

**Outbox transaction pattern — Payment Service:**

```sql
BEGIN;

  -- 1. Mark payment as SUCCESS and set Razorpay references
  UPDATE payments
  SET
    status               = 'SUCCESS',
    razorpay_payment_id  = $razorpay_payment_id,
    razorpay_signature   = $signature,
    updated_at           = NOW()
  WHERE id = $payment_id;

  -- 2. Mark the specific attempt as SUCCESS
  UPDATE payment_attempts
  SET
    status              = 'SUCCESS',
    razorpay_payment_id = $razorpay_payment_id,
    resolved_at         = NOW()
  WHERE id = $attempt_id;

  -- 3. Insert outbox record in the same transaction
  INSERT INTO outbox_events (id, event_type, topic, payload)
  VALUES (
    $outbox_id,
    'PAYMENT_SUCCEEDED',
    'payment.succeeded',
    $payload_json
  );

COMMIT;
-- All three succeed or all three roll back
-- Outbox publisher picks up PENDING record and publishes to Kafka
```

---

## 6. Entity Relationship Overview

```
CORE DATABASE

users
  ├── sessions
  ├── otp_codes
  ├── password_reset_tokens
  ├── fare_quotes
  ├── purchases
  ├── tickets
  └── journeys

stations
  ├── gates
  ├── fare_rules (as origin)
  ├── fare_rules (as destination)
  ├── fare_quotes (as origin)
  ├── fare_quotes (as destination)
  ├── purchases (as origin)
  ├── purchases (as destination)
  ├── tickets (as origin)
  ├── tickets (as destination)
  ├── journeys (as entry station)
  ├── journeys (as exit station)
  └── gate_events

fare_rules → fare_quotes (fare_rule_id)
fare_quotes → purchases (fare_quote_id)
purchases → tickets (purchase_id)
tickets → journeys (ticket_id) [UNIQUE]
gates → journeys (entry_gate_id, exit_gate_id)
gates → gate_events (gate_id)


PAYMENT DATABASE

payments
  ├── payment_attempts
  ├── payment_idempotency_keys
  └── provider_events


CROSS-SERVICE REFERENCES (plain UUID columns — no FK constraints)

tickets.payment_id          → payments.id           Core references Payment
payments.purchase_id        → purchases.id          Payment references Core
payments.user_id            → users.id              Payment references Core
payment_attempts.* (no direct Core ref)
```

---

## 7. Concurrency Design

### 7.1 Concurrent Entry — Two-Layer Protection

**Layer 1 — Conditional UPDATE on tickets:**

```sql
UPDATE tickets
SET status = 'IN_JOURNEY', updated_at = NOW()
WHERE id = $ticket_id
  AND status = 'ISSUED'
RETURNING id;
```

```
Returns 1 row → this transaction won; proceed to create Journey
Returns 0 rows → ticket is no longer ISSUED; reject
```

**Layer 2 — Unique constraint on journeys:**

```sql
INSERT INTO journeys (id, ticket_id, ...)
VALUES ($journey_id, $ticket_id, ...);
-- If ticket_id already has a journey: UNIQUE VIOLATION → transaction rolls back
```

Both layers execute inside a single PostgreSQL transaction. Together they make duplicate Journey creation impossible under any concurrency scenario.

### 7.2 Duplicate Ticket Issuance — Kafka At-Least-Once

Ticket issuance is protected by two database-level uniqueness constraints:

- `uq_tickets_payment_id` — one successful Payment can produce at most one Ticket
- `uq_tickets_purchase_id` — one Purchase can produce at most one Ticket

If `payment.succeeded` is delivered more than once, or ticket issuance is retried after a partial application failure, Core attempts to create the same logical Ticket again.

```sql
INSERT INTO tickets (id, purchase_id, payment_id, ...)
VALUES ($ticket_id, $purchase_id, $payment_id, ...);
-- Duplicate logical issuance:
-- UNIQUE VIOLATION on payment_id or purchase_id
```

Core treats the uniqueness violation as an idempotent outcome and loads the already-existing Ticket rather than creating another one.

### 7.3 Journey Timeout — Validate-on-Read

Gate validation does not rely on the background worker having run:

```sql
-- In Core gate-validation service, before allowing exit:
SELECT *
FROM journeys
WHERE ticket_id = $ticket_id
  AND status = 'ACTIVE';

-- Application layer then checks:
IF NOW() > journey.expires_at THEN
  -- Reject: JOURNEY_TIMED_OUT
  -- Record gate_event with rejection_reason
END IF;
```

The `expires_at` column is the authoritative timeout signal. The background worker that sets `status = 'TIMED_OUT'` is a cleanup sweep — it does not gate the business rule.

---

## 8. Index Strategy

### 8.1 Principles

```
Foreign-key and reference columns used frequently for joins,
filtering, or lookups receive indexes based on actual query patterns.

Indexes are not added automatically to every foreign key.
Each index should support a known access pattern.

Partial indexes filter on the most common query condition
  → idx_fare_quotes_expires_at WHERE used_at IS NULL
  → idx_tickets_expires_at WHERE status = 'ISSUED'
  → idx_journeys_active_expires WHERE status = 'ACTIVE'
  → idx_outbox_pending WHERE status = 'PENDING'
  → These reduce index size significantly for high-volume tables

Composite indexes order columns by selectivity (most selective first)
  → idx_gate_events_station_occurred (station_id, occurred_at DESC)

Descending indexes on timestamps used for recent-first queries
  → idx_gate_events_occurred_at (occurred_at DESC)
```

### 8.2 Columns Without Indexes (Intentional)

```
users.created_at          → Not queried by range in V1
purchases.created_at      → Accessed via user_id index
fare_rules.valid_from     → Low-cardinality table; full scan is acceptable
```

---

## 9. Scalability Notes

### 9.1 Table Volume Projections

| Table | Growth Rate | Notes |
|---|---|---|
| `users` | Low | One row per registered user |
| `stations` | Static | Seeded; rarely changes |
| `gates` | Static | Seeded; rarely changes |
| `fare_rules` | Very low | Updated occasionally |
| `fare_quotes` | Medium | One per journey request |
| `purchases` | Medium | One per ticket purchase |
| `tickets` | Medium | One per purchase |
| `journeys` | Medium | One per completed entry |
| `gate_events` | **High** | Every gate scan — all outcomes |
| `outbox_events` (Core) | **High** | One per Kafka event published |
| `payments` | Medium | One per purchase |
| `payment_attempts` | Medium | One per Razorpay attempt |
| `provider_events` | **High** | Every Razorpay webhook call |
| `outbox_events` (Payment) | Medium | One per payment.succeeded event |

### 9.2 `gate_events` Partitioning

`gate_events` is the highest-volume table. At production scale, a busy station generates thousands of gate events per hour.

**V1:** No partitioning. Append-only with partial indexes.

**V2 partition strategy (documented for future implementation):**

```sql
CREATE TABLE gate_events (...) PARTITION BY RANGE (occurred_at);

CREATE TABLE gate_events_2025_01
  PARTITION OF gate_events
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

Old partitions can be archived or dropped without touching active data.

### 9.3 Outbox Housekeeping

`PUBLISHED` outbox records accumulate over time. V1 has no automatic cleanup.

**V2:** Background job archives or deletes `PUBLISHED` outbox records older than a configured retention window.

---

## 10. Drizzle ORM Schema Structure

Drizzle defines schema in TypeScript. The SQL DDL in this document is the canonical design reference. Drizzle schema files implement it.

### 10.1 File Layout

```
apps/core-api/src/database/schema/
├── index.ts
├── users.schema.ts
├── otp-codes.schema.ts
├── password-reset-tokens.schema.ts
├── stations.schema.ts
├── gates.schema.ts
├── fare-rules.schema.ts
├── fare-quotes.schema.ts
├── purchases.schema.ts
├── tickets.schema.ts
├── journeys.schema.ts
├── gate-events.schema.ts
└── outbox-events.schema.ts

apps/payment-service/src/database/schema/
├── index.ts
├── payments.schema.ts
├── payment-attempts.schema.ts
├── provider-events.schema.ts
└── outbox-events.schema.ts
```

### 10.2 UUID v7 Generation

UUID v7 is generated at the application layer via the `uuidv7` npm package. IDs are available before any database operation — required for outbox record construction and Kafka event payloads.

```typescript
// apps/core-api/src/common/id/generate-id.ts
import { uuidv7 } from 'uuidv7';

export function generateId(): string {
  return uuidv7();
}
```

Each service owns its ID generation utility:

```typescript
// apps/payment-service/src/common/id/generate-id.ts
import { uuidv7 } from 'uuidv7';

export function generateId(): string {
  return uuidv7();
}
```

All entity insertions call `generateId()`. Database columns are `UUID` type with no `DEFAULT` expression.

### 10.3 Example Drizzle Schema File

```typescript
// apps/core-api/src/database/schema/tickets.schema.ts
import {
  pgTable, uuid, text, numeric, timestamp, pgEnum,
  uniqueIndex, index, check
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { purchases } from './purchases.schema';
import { users } from './users.schema';
import { stations } from './stations.schema';

export const ticketStatusEnum = pgEnum('ticket_status_type', [
  'ISSUED', 'IN_JOURNEY', 'COMPLETED', 'EXPIRED',
]);

export const tickets = pgTable(
  'tickets',
  {
    id:                   uuid('id').primaryKey(),
    purchaseId:           uuid('purchase_id').notNull().references(() => purchases.id),
    userId:               uuid('user_id').notNull().references(() => users.id),
    paymentId:            uuid('payment_id').notNull(),
    // Cross-service reference — no .references()

    originStationId:      uuid('origin_station_id').notNull().references(() => stations.id),
    destinationStationId: uuid('destination_station_id').notNull().references(() => stations.id),
    paidAmount:           numeric('paid_amount', { precision: 10, scale: 2 }).notNull(),
    currency:             text('currency').notNull().default('INR'),
    status:               ticketStatusEnum('status').notNull().default('ISSUED'),
    issuedAt:             timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt:            timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    paymentIdUnique: uniqueIndex('uq_tickets_payment_id').on(table.paymentId),
    userIdIdx:       index('idx_tickets_user_id').on(table.userId),
    statusIdx:       index('idx_tickets_status').on(table.status),
    purchaseIdUnique: uniqueIndex('uq_tickets_purchase_id').on(table.purchaseId),
    positiveAmount:  check('chk_tickets_positive_amount', sql`${table.paidAmount} > 0`),
    expiryAfterIssue: check(
      'chk_tickets_expiry_after_issue',
      sql`${table.expiresAt} > ${table.issuedAt}`
    ),
  })
);

export type Ticket    = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
```

### 10.4 Migration Strategy

```
drizzle-kit generate  → generates SQL migration file from schema diff
drizzle-kit migrate   → applies pending migrations
```

Migration files are committed to the repository and version-controlled. Migrations run during service startup in development and as a pre-deploy step in production.

---

## 11. Resolved Design Decisions

The following decisions were explicitly resolved during schema review. They are locked.

| # | Decision | Outcome |
|---|---|---|
| R-001 | Payment vs PaymentAttempt model | Model A: one `payments` record per purchase; multiple `payment_attempts` underneath. Each PaymentAttempt owns its own Razorpay Order. |
| R-002 | Purchase lifecycle ownership | `purchases.status` maintained by Core via Kafka events; Payment Service is authoritative for detailed payment state |
| R-003 | Journey timeout mechanism | `journeys.expires_at` set at entry time; gate validation checks `NOW() > expires_at`; background worker is cleanup only |
| R-004 | Outbox terminal state | `DEAD` (not `FAILED`); retryable failures remain `PENDING`; `DEAD` means max retries exceeded |
| R-005 | OTP storage | Redis is authoritative for OTP validation; PostgreSQL stores audit record only (no hash) |
| R-006 | `fare_rules` constraint syntax | All constraints inside `CREATE TABLE`; no orphaned constraint statements |
| R-007 | UUID v7 generation | Application layer via `uuidv7` npm package; IDs available before persistence for outbox construction |

---

## 12. Intentional Denormalization Register

All intentional departures from 3NF are documented here. Any departure not listed is a schema error.

### 12.1 `fare_quotes.amount`

| Field | Table | Source |
|---|---|---|
| `amount` | `fare_quotes` | `fare_rules.amount` |

**Reason:** A fare quote captures the authoritative fare at the moment of calculation. If the fare rule is later updated, the quoted amount must remain historically accurate. The quote is a point-in-time snapshot.

### 12.2 `purchases.amount`, `.origin_station_id`, `.destination_station_id`

| Field | Table | Source |
|---|---|---|
| `amount` | `purchases` | `fare_quotes.amount` |
| `origin_station_id` | `purchases` | `fare_quotes.origin_station_id` |
| `destination_station_id` | `purchases` | `fare_quotes.destination_station_id` |

**Reason:** A purchase is a financial commitment. Its amount and route must remain accurate even if the fare quote record is archived or the station configuration changes. Historical business record.

### 12.3 Ticket Snapshot and Read-Path Fields

| Field | Table | Source |
|---|---|---|
| `paid_amount` | `tickets` | `purchases.amount` |
| `origin_station_id` | `tickets` | `purchases.origin_station_id` |
| `destination_station_id` | `tickets` | `purchases.destination_station_id` |
| `user_id` | `tickets` | `purchases.user_id` |

**Reason:** Gate validation is a hot read path. Validating a ticket must not require joining through `purchases` and `fare_quotes`. Additionally, `paid_amount` is a historical financial fact required for audit and reconciliation independent of the purchase record. `user_id` is retained directly on tickets because passenger ticket listing and ownership validation are common read paths. This avoids joining through purchases for every passenger ticket query.

### 12.4 `gate_events.station_id`

| Field | Table | Source |
|---|---|---|
| `station_id` | `gate_events` | `gates.station_id` |

**Reason:** Gate events are immutable audit records. A gate could theoretically be reassigned to a different station. The event must record the station at the time of interaction. Station-level audit queries also avoid a join on this high-volume table.

### 12.5 `journeys.user_id`

| Field | Table | Source |
|---|---|---|
| `user_id` | `journeys` | `tickets.user_id` |

**Reason:** Passenger journey history is a common read path. Keeping `user_id` directly on `journeys` allows efficient passenger-scoped journey queries without joining through `tickets`. The value is copied from the owning ticket when the journey is created.

---

## 13. Schema Decision Register

| ID | Decision | Rationale |
|---|---|---|
| DB-001 | UUID v7 for all public-facing PKs | Time-ordered, better B-tree performance, opaque to clients, chronologically sortable |
| DB-002 | `BIGSERIAL` for `fare_rules.id` | Internal-only table; sequential ID is simpler and sufficient |
| DB-003 | `NUMERIC(10,2)` for all monetary amounts | Avoids floating-point precision errors for currency |
| DB-004 | `TIMESTAMPTZ` for all timestamps | UTC storage; no timezone ambiguity |
| DB-005 | PostgreSQL native ENUMs for status columns | Database-level value enforcement independent of application |
| DB-006 | `uq_tickets_payment_id` | Primary idempotency guard for Kafka at-least-once delivery of `payment.succeeded` |
| DB-007 | `uq_journeys_ticket_id` | Concurrency guard — prevents duplicate Journey on simultaneous entry requests |
| DB-008 | `uq_provider_events_id` | First-line Razorpay webhook deduplication |
| DB-009 | `uq_payments_purchase_id` | Enforces one Payment lifecycle record per Purchase |
| DB-010 | No FK constraint on cross-service UUID columns | Services have separate databases; referential integrity enforced by application and Kafka event ordering |
| DB-011 | Partial indexes on status/condition-filtered queries | Dramatically reduces index size for time-bound and status-filtered queries |
| DB-012 | `gate_events` INSERT-only | Immutable audit record; application must never UPDATE or DELETE |
| DB-013 | `provider_events` INSERT-only | Immutable raw webhook log for audit, reconciliation, and debugging |
| DB-014 | Outbox table in both Core and Payment databases | Durable Kafka delivery — business record and outbox event committed atomically |
| DB-015 | `gate_events.ticket_id` no FK constraint | `TICKET_NOT_FOUND` events reference non-existent tickets |
| DB-016 | `tickets.payment_id` cross-service reference | Payment Service owns payment records; Core stores reference UUID only |
| DB-017 | Denormalized route/amount on tickets | Gate validation hot path; historical financial fact — documented in Section 12.3 |
| DB-018 | UUID v7 generated at application layer | IDs available before persistence for outbox and Kafka payload construction |
| DB-019 | OTP hash not stored in PostgreSQL | Redis is authoritative for validation; PostgreSQL stores audit record only |
| DB-020 | `purchases.status` in Core | Core answers purchase state queries without calling Payment Service synchronously |
| DB-021 | `journeys.expires_at` | Encodes 2.5-hour rule at write time; gate validation uses column directly |
| DB-022 | Outbox terminal state is `DEAD` not `FAILED` | `FAILED` is ambiguous; `DEAD` unambiguously means max retries exceeded, requires intervention |
| DB-023 | `gate_events` partitioning deferred to V2 | V1 scale does not require it; strategy documented for future |
| DB-024 | Check constraints on journey state | Business invariants enforced at DB level independently of application |
| DB-025 | `uq_purchases_fare_quote_id` | One FareQuote can create at most one Purchase |
| DB-026 | `uq_tickets_purchase_id` | One Purchase can produce at most one Ticket |
| DB-027 | One successful PaymentAttempt per Payment | Partial unique index on `payment_id WHERE status = 'SUCCESS'` |
| DB-028 | Razorpay Order belongs to PaymentAttempt | Each retry/attempt owns its own Razorpay Order |
| DB-029 | Unique Razorpay payment ID per attempt | Prevents provider payment identity from appearing on multiple attempts |
| DB-030 | Gate request ID is database-unique | PostgreSQL provides durable Gate request idempotency |
| DB-031 | Payment remains PENDING after failed attempt | Attempt failure does not terminate the overall Payment lifecycle |
| DB-032 | PAID persisted before ticket issuance | Confirmed payment remains recoverable if ticket creation subsequently fails |
| DB-033 | `tickets.user_id` intentionally denormalized | Supports direct passenger ticket queries |
| DB-034 | `journeys.user_id` intentionally denormalized | Supports direct passenger journey-history queries |
| DB-035 | PaymentAttempt owns `razorpay_order_id` | Each provider order represents one payment attempt |
| DB-036 | Dedicated `sessions` table | Durable refresh-token rotation, revocation, expiry, and reuse detection |
| DB-037 | PostgreSQL authoritative for session validity | Session revocation must survive Redis restart/cache loss |
| DB-038 | Refresh-token family tracking | Reuse of a rotated refresh token can revoke the affected session family |
| DB-039 | Multiple sessions per user allowed | Supports separate authenticated devices/sessions without changing V1 APIs |
| DB-040 | Durable payment initiation idempotency in PostgreSQL | Redis may cache results, but correctness must survive cache loss and concurrent retries |
| DB-041 | Reconciliation flag on `provider_events` | Unknown orders, contradictory terminal events, and amount mismatches must be durably recorded without rewriting financial state |
| DB-042 | At most one PENDING PaymentAttempt per Payment | Prevents double-clicks, duplicate tabs, or concurrent requests from creating multiple active Razorpay Orders |
| DB-043 | At most one IN_PROGRESS initiation reservation per Payment | Serializes payment initiation across different idempotency keys before another provider Order can be created |

---

## 14. Next Phase 3 Document

```
phase-3-api-contracts.md
  → All REST endpoint paths, verbs, request/response shapes
  → Internal endpoint conventions (/internal/*)
  → Error response envelope structure
  → OpenAPI annotation strategy
```

