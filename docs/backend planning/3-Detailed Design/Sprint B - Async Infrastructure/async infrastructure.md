# MetroFlow — Sprint B: Async Infrastructure

> **Document:** `architecture/sprint-b-async-infrastructure.md`
> **Status:** Approved — Locked
> **Covers:** Kafka event contracts, Redis key register, Worker outbox, email jobs

---

## 1. Kafka — Topics and Ownership

| Topic | Producer | Consumer | Kafka Key | Via Outbox? |
|---|---|---|---|---|
| `payment.succeeded` | Payment Service | Core | `purchaseId` | Yes |
| `ticket.issued` | Core | Worker | `userId` | Yes |
| `otp.requested` | Core | Worker | `userId` | No — direct |
| `password.reset.requested` | Core | Worker | `userId` | No — direct |

`otp.requested` and `password.reset.requested` are direct delivery jobs in V1. Their delivery consumers retry failures with bounded attempts; they do not bypass offset handling merely because email is secondary.

---

### 1.1 Operational DLQ

`metroflow.dlq` is an operational Kafka topic, not a domain-event topic.

```text
Producer:
  Core or a Worker consumer after the defined bounded retry/handling policy

Automatic consumer:
  None in V1

Purpose:
  Preserve failed events for operational inspection and manual replay

Kafka key:
  originalEventId
```

DLQ envelope:

```json
{
  "failedEventId": "uuid-v7",
  "originalTopic": "payment.succeeded",
  "originalEventId": "uuid-v7",
  "consumer": "core-api",
  "failureType": "PROCESSING_FAILURE",
  "failedAt": "ISO8601",
  "attempts": 5,
  "payload": {},
  "sensitivePayloadOmitted": false
}
```

For `payment.succeeded` and `ticket.issued`, the original payload may be
preserved according to normal security and redaction rules. For `otp.requested`
and `password.reset.requested`, plaintext OTPs and reset tokens must never be
copied into the DLQ. Store metadata only and set
`sensitivePayloadOmitted: true`.

Expired authentication-delivery jobs are not automatically replayed; the user
must request a fresh OTP or password-reset flow.

## 2. Kafka Event Envelopes

### `payment.succeeded`
```json
{
  "eventId":    "uuid-v7",
  "eventType":  "PAYMENT_SUCCEEDED",
  "version":    "1.0",
  "occurredAt": "ISO8601",
  "paymentId":  "uuid",
  "purchaseId": "uuid",
  "userId":     "uuid",
  "amount":     "40.00",
  "currency":   "INR"
}
```

### `ticket.issued`
```json
{
  "eventId":    "uuid-v7",
  "eventType":  "TICKET_ISSUED",
  "version":    "1.0",
  "occurredAt": "ISO8601",
  "ticketId":   "uuid",
  "purchaseId": "uuid",
  "userId":     "uuid",
  "userEmail":  "passenger@example.com",
  "originStation":      { "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
  "destinationStation": { "code": "HAUZ_KHAS",   "name": "Hauz Khas"   },
  "paidAmount": "40.00",
  "currency":   "INR",
  "expiresAt":  "ISO8601"
}
```

### `otp.requested`
```json
{
  "eventId":   "uuid-v7",
  "eventType": "OTP_REQUESTED",
  "version":   "1.0",
  "occurredAt":"ISO8601",
  "userId":    "uuid",
  "email":     "passenger@example.com",
  "otpCode":   "847291",
  "expiresAt": "ISO8601",
  "purpose":   "LOGIN"
}
```

`otpCode` is plaintext. This topic is internal only — not accessible externally.

This is an accepted V1 security trade-off. The topic requires strict ACLs, TLS,
short retention, and payload redaction from logs. OTP verification state remains
hashed in Redis/PostgreSQL as already designed. A stronger encrypted delivery-job
mechanism is deferred to a future version.

### `password.reset.requested`
```json
{
  "eventId":   "uuid-v7",
  "eventType": "PASSWORD_RESET_REQUESTED",
  "version":   "1.0",
  "occurredAt":"ISO8601",
  "userId":    "uuid",
  "email":     "passenger@example.com",
  "resetLink": "https://app.metroflow.dev/reset-password?token=<plaintext>",
  "expiresAt": "ISO8601"
}
```

The reset token in this internal event follows the same accepted V1 trade-off:
strict ACLs, TLS, short retention, and no token or complete payload logging.

---

## 3. Kafka Consumer Rules

```
Delivery:    at-least-once
Consumers:   must be idempotent

Consumer groups:
  core-api   → consumes: payment.succeeded
  worker     → consumes: ticket.issued, otp.requested, password.reset.requested

Version check:
  Supported version → process normally
  Unknown/unsupported version → do not run the business handler
    → log structured error
    → route to DLQ / failed-event handling
    → commit the original offset only after failed-event handling succeeds

Idempotency per consumer:
  payment.succeeded → resumable Core flow:
    Purchase PAYMENT_PENDING → Transaction A: Purchase → PAID
    Purchase PAID → Transaction B: idempotently create Ticket,
      Purchase → TICKET_ISSUED, and ticket.issued outbox
    Purchase TICKET_ISSUED + Ticket exists → duplicate; safely complete/skip
    Unique ticket purchase_id/payment_id constraints protect retries
  ticket.issued     → email retries are bounded; duplicate delivery is safe
  otp.requested     → email retries are bounded; verification state remains authoritative
```

---

## 4. Redis Key Register

| Key | Type | TTL | Purpose | Owner |
|---|---|---|---|---|
| `otp:login:{userId}` | String | 600s | Hashed OTP for login | Core Auth |
| `otp:attempts:{userId}` | Integer | 600s | Failed attempt counter | Core Auth |
| `otp:cooldown:{email}` | String | 60s | Request rate limiting | Core Auth |
| `rate_limit:gate:{gateId}:{minute}` | Integer | 60s | Per-gate rate limit | Gate Service |
| `gate_idempotency:{idempotencyKey}` | JSON | 300s | Gate request cache | Gate Service |

### Rule: Redis Is Never the Sole Source of Truth

```
Sessions      → PostgreSQL sessions table is authoritative
Payment state → PostgreSQL payments table is authoritative
Ticket state  → PostgreSQL tickets table is authoritative
Journey state → PostgreSQL journeys table is authoritative

Redis is fast temporary storage. PostgreSQL decides correctness.
```

### Redis Failure Behavior

| Concern | Redis unavailable → |
|---|---|
| OTP verification | `SERVICE_TEMPORARILY_UNAVAILABLE` — do not bypass |
| Gate rate limiting | Fail open (allow request) — DB constraints still protect |
| Gate idempotency miss | Call Core — DB uniqueness constraints prevent duplicates |

---

## 5. Outbox Publisher

Core and Payment Service write outbox rows transactionally. They do not run their
own publishers. The Background Worker owns publishing for both outbox databases.

```
Core DB outbox      → Worker
Payment DB outbox   → Worker
Worker              → Kafka

Poll interval: configurable (not locked)
Batch size:    100 records per poll

BEGIN;

SELECT eligible PENDING outbox rows
ORDER BY created_at ASC
LIMIT configured batch size
FOR UPDATE SKIP LOCKED;

For each claimed record:
  Publish to Kafka(topic, key, payload) using a bounded Kafka publish timeout

  Success:
    UPDATE outbox_events
    SET status='PUBLISHED', published_at=NOW()
    WHERE id = $id

  Failure:
    UPDATE outbox_events
    SET attempts = attempts + 1,
        last_attempted_at = NOW(),
        error_message = $error
    WHERE id = $id

    IF attempts >= MAX_ATTEMPTS:
      UPDATE outbox_events SET status = 'DEAD'

MAX_ATTEMPTS: configurable (suggest 5 as starting point)
Backoff:      configurable — simple fixed interval is fine for V1
DEAD records: never deleted, surfaced in admin endpoint

COMMIT;

Multiple Worker instances must not intentionally select the same outbox rows at
the same time. V1 intentionally keeps this bounded transaction open while the
claimed batch is published. `FOR UPDATE SKIP LOCKED` prevents concurrent Workers
from selecting the same rows.

At-least-once delivery remains possible if Kafka accepts a message but the
database transaction later fails, therefore consumers must remain idempotent.
A lease/claim design that avoids holding the database transaction across Kafka
network calls is deferred to V2.
```

---

## 6. Worker — Email Consumers

Worker is a NestJS app. Kafka consumer only — no business REST API. Exposes `/health` and `/metrics` only.

### Email Provider Interface

```typescript
interface EmailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}

// ConsoleEmailProvider  → local dev (logs to stdout)
// ResendEmailProvider   → production (or SendGrid / SES)
// Switch via EMAIL_PROVIDER env: 'console' | 'resend'
```

### `ticket.issued` Consumer

```
1. Parse event, extract ticket + user details
2. Render ticket email HTML template
3. Call EmailProvider.send()
4. Log result without logging the complete event payload
5. On success, commit Kafka offset
6. On temporary failure, retry with bounded attempts/backoff
7. If attempts are exhausted, route to DLQ / failed-email handling,
   then commit the original offset
   Passenger can retrieve the ticket from their account regardless
```

### `otp.requested` Consumer

```
1. Parse event, extract email + otpCode + expiresAt
2. Render OTP email template
3. Call EmailProvider.send()
4. On success, commit Kafka offset
5. On temporary failure, retry with bounded attempts/backoff
6. If attempts are exhausted, route to DLQ / failed-email handling,
   then commit the original offset
```

### `password.reset.requested` Consumer

```
1. Parse event, extract email + resetLink
2. Render password reset email template
3. Call EmailProvider.send()
4. On success, commit Kafka offset
5. On temporary failure, retry with bounded attempts/backoff
6. If attempts are exhausted, route to DLQ / failed-email handling,
   then commit the original offset
```

---

## 7. Worker — Journey Timeout Sweep

```
Runs on schedule (cron-style, configurable interval)
Uses CORE_DATABASE_URL — Worker is in Core bounded context

SQL:
  UPDATE journeys
  SET
    status = 'TIMED_OUT',
    timed_out_at = NOW(),
    updated_at = NOW()
WHERE status = 'ACTIVE'
    AND expires_at <= NOW();

Logs: count of rows updated
Does NOT create gate events (no gate interaction occurred)
Does NOT affect gate validation — that uses:
  NOW() >= journey.expires_at → JOURNEY_TIMED_OUT
  NOW() < journey.expires_at  → valid
```

---

## Sprint B — Definition of Done

- [x] 4 V1 domain topics + 1 operational DLQ defined
- [x] Consumer groups and idempotency rules defined
- [x] Event versioning strategy defined
- [x] Redis key register complete
- [x] Redis-is-not-source-of-truth rule stated
- [x] Redis failure behavior defined per concern
- [x] Outbox publisher algorithm defined
- [x] DEAD outbox behavior defined
- [x] Worker email consumer logic defined per topic
- [x] Journey timeout sweep defined
- [x] Email provider interface and local dev strategy defined

---

## Next: Sprint C — Production Readiness Checklist
