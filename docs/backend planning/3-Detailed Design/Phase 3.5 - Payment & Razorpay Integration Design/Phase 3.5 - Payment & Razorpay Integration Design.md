# MetroFlow — Phase 3.5: Payment & Razorpay Integration Design

> **Document:** `architecture/phase-3-payment-design.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 3 — Detailed Design
> **Section:** 3.5 — Payment & Razorpay Integration Design
> **Status:** Approved — V1 Locked
> **Depends on:** `phase-2-architecture.md`, `phase-3-database-schema.md`, `phase-3-api-contracts.md`, `phase-3-auth-design.md`

---

## 1. Purpose

This document defines the complete V1 payment architecture and Razorpay integration for MetroFlow. It removes ambiguity from every step of the payment workflow — from purchase creation through ticket issuance — and explicitly addresses every significant failure scenario.

This is a **design document**. No production NestJS code is written here.

---

## 2. Ownership and Responsibility Matrix

Before any flow is described, ownership must be unambiguous.

| Responsibility | Owner |
|---|---|
| Purchase lifecycle status (`CREATED → PAYMENT_PENDING → PAID → TICKET_ISSUED`) | Core API |
| Payment entity (`payments.id`, payment lifecycle) | Payment Service |
| Payment attempt records (`payment_attempts`) | Payment Service |
| Razorpay Order creation | Payment Service |
| Razorpay webhook receipt and verification | Payment Service |
| Raw provider event storage (`provider_events`) | Payment Service |
| Authoritative payment success determination | Payment Service (via verified Razorpay webhook) |
| Outbox event publication for `payment.succeeded` | Payment Service |
| Kafka `payment.succeeded` consumption | Core API |
| Ticket issuance | Core API |
| Outbox event publication for `ticket.issued` | Core API |
| Email delivery | Background Worker |
| Frontend Razorpay checkout session display | Next.js (browser) |

### 2.1 What Is Never Trusted as Payment Authority

```
Frontend Razorpay success callback   → informational only; never authoritative
Browser-supplied amount              → never used; server-side amount is authoritative
Browser-supplied payment status      → never trusted
Core's own assumption                → Core learns success only via verified Kafka event
```

### 2.2 What Constitutes Authoritative Payment Success

```
Razorpay sends webhook to Payment Service
          ↓
Payment Service verifies HMAC signature using webhook secret
          ↓
Payment Service stores the parsed webhook payload in provider_events.raw_payload as JSONB
          ↓
Payment Service updates PaymentAttempt → SUCCESS
          ↓
Payment Service updates Payment → SUCCESS
          ↓
Payment Service inserts outbox_events record

This is authoritative. Nothing else is.
```

---

## 3. Payment State Machine

### 3.1 `payments.status` — Allowed Transitions

```
CREATED → PENDING    (first PaymentAttempt created, Razorpay Order initiated)
PENDING → SUCCESS    (verified webhook confirms successful payment)

No other transitions are permitted on the parent Payment.
```

**Forbidden transitions:**

```
SUCCESS → PENDING    ❌ (payment cannot be un-succeeded)
SUCCESS → CREATED    ❌
SUCCESS → FAILED     ❌ (FAILED is not a parent Payment status)
CREATED → SUCCESS    ❌ (must pass through PENDING / PaymentAttempt)
```

Note: `FAILED` is not a valid `payments.status` in V1. A failed attempt leaves the parent Payment as `PENDING`. The parent Payment only becomes `SUCCESS` when a PaymentAttempt succeeds.

### 3.2 `payment_attempts.status` — Allowed Transitions

```
PENDING → SUCCESS    (Razorpay webhook: payment.captured)
PENDING → FAILED     (verified Razorpay webhook: payment.failed)
```

**Forbidden transitions:**

```
SUCCESS → FAILED     ❌
SUCCESS → PENDING    ❌
FAILED  → SUCCESS    ❌ (a failed attempt cannot be retroactively succeeded)
FAILED  → PENDING    ❌ (a new attempt requires a new PaymentAttempt row)
```

### 3.3 Relationship

```
Purchase P1
   └── Payment PAY-1 (status: PENDING)
         ├── PaymentAttempt A1 (status: FAILED)
         ├── PaymentAttempt A2 (status: FAILED)
         └── PaymentAttempt A3 (status: SUCCESS)
                 ↑
     Payment PAY-1.status → SUCCESS
     Payment PAY-1.razorpay_payment_id set
```

---

## 4. Payment Initiation — Complete Sequence

### 4.1 Locked Decisions

```
Payment Service generates `payments.id` and owns the Payment entity and all Payment state.
Core sends purchaseId, userId, amount, currency + Idempotency-Key header
Payment Service owns all Razorpay interaction
Amount and currency always derived server-side from Purchase record
```

### 4.2 Idempotency Key Semantics

The `Idempotency-Key` header sent from Core to Payment Service identifies one logical payment initiation request. PostgreSQL is authoritative for this idempotency record; Redis may optionally cache the response but must never determine correctness.

```
Network retry (same logical request):
  Core → Payment Service  Idempotency-Key: K1
  Timeout / response lost
  Core retries → same Idempotency-Key: K1
  Payment Service: PostgreSQL idempotency record for K1 already exists → return the existing Payment/Attempt/Order result
  No new PaymentAttempt created

New user-initiated attempt (passenger clicks Try Again after confirmed failure):
  Core → Payment Service  Idempotency-Key: K2  (new key)
  Payment Service: K2 not seen → create new PaymentAttempt A2
  New Razorpay Order R2 created
  Same parent Payment PAY-1
```

The `Idempotency-Key` is generated by Core for each distinct initiation event. Core stores it alongside the initiation context so network retries can reuse it. A genuine user-intentional retry generates a new key but reuses the same parent Payment and creates a new PaymentAttempt and Razorpay Order. Payment Service serializes concurrent requests for the same key using the durable state record; it does not hold a database transaction open while calling Razorpay.

### 4.3 Full Initiation Sequence

```
1. Passenger clicks "Pay"

2. Frontend: POST /api/v1/payments/initiate { purchaseId }
   Authorization: Bearer <access_token>

3. Core validates:
   a. Purchase exists and belongs to authenticated user
   b. Purchase.status = CREATED or PAYMENT_PENDING
      (PAID or TICKET_ISSUED → PURCHASE_ALREADY_PAID)
   c. Amount and currency loaded from purchases table (never from request)

4. Core generates idempotencyKey (UUID v7) for this initiation event

5. Core: POST /internal/v1/payments
   Idempotency-Key: <idempotencyKey>
   {
     purchaseId,
     userId,
     amount,      ← from purchases.amount
     currency     ← from purchases.currency
   }

6. Payment Service receives internal call:
   a. Check `payment_idempotency_keys` in PostgreSQL:
      → COMPLETED: return the durable Payment/Attempt/Order response
      → IN_PROGRESS: do not call Razorpay again; return/propagate
        PAYMENT_INITIATION_IN_PROGRESS or perform bounded reconciliation/re-read
      → RETRYABLE: safely retry the provider call using the reserved attempt identity
      → New key: proceed; Redis is only an optional response cache

   b. Check uq_payments_purchase_id:
      → Payment for this purchase already exists: load it
      → Does not exist: INSERT payments {
           id = uuidv7(),         ← Payment Service generates this
           purchase_id,
           user_id,
           amount,
           currency,
           status = CREATED
        }

      Lock/load the parent Payment for initiation serialization.
      → If an IN_PROGRESS reservation already exists for this Payment, do not
        create another reservation or call Razorpay; return
        PAYMENT_INITIATION_IN_PROGRESS or perform bounded reconciliation.
      → If the latest PaymentAttempt is PENDING, do not create another attempt
        or Order; return the existing active checkout or
        PAYMENT_ATTEMPT_IN_PROGRESS.
      → If the latest attempt is FAILED, a new intentional attempt is allowed.
      → If Payment is SUCCESS, reject the new attempt.
      → If no attempt exists, the first attempt is allowed.

   c. Transaction A — reserve before the external call:
      → create/load the parent Payment
      → persist idempotency key = IN_PROGRESS
      → generate and reserve a stable paymentAttemptId
      → associate the reservation with the Payment
      → COMMIT

      No database transaction remains open while calling Razorpay.

   d. Create Razorpay Order:
      razorpay.orders.create({
        amount: amount_in_paise,   ← exact decimal conversion to paise
        currency: 'INR',
        receipt: paymentAttemptId  ← stable provider-operation identity
      })

   e. If Razorpay definitively confirms that no Order was created:
      → set idempotency state = RETRYABLE
      → no payable PaymentAttempt is finalized
      → Payment remains CREATED/PENDING as appropriate
      → Return error to Core: PAYMENT_PROVIDER_ERROR
      (Provider initiation failure is not a passenger payment failure.)

      If the request timed out or the outcome is ambiguous:
      → keep status = IN_PROGRESS
      → mark/log the initiation as requiring reconciliation
      → do not create another Order
      → reconcile using the stable paymentAttemptId/receipt first

   f. Transaction B — after successful Order creation:
      INSERT payment_attempts {
        id = paymentAttemptId,
        payment_id,
        razorpay_order_id = <order.id>,
        status = PENDING
      }
      → persist razorpay_order_id and response_payload
      → set idempotency state = COMPLETED
      → commit the PaymentAttempt and idempotency result

   g. A RETRYABLE reservation may reuse the same logical key safely. An
      IN_PROGRESS reservation marked as requiring reconciliation must be reconciled
      before any new provider Order is created.

   h. Cache the durable idempotency result in Redis (optional, TTL = 24 hours)

   i. Return to Core:
      {
        paymentId,
        paymentAttemptId,
        razorpayOrderId,
        amount,
        currency
      }

   If a retry finds K1 = IN_PROGRESS after a crash, Payment Service MUST NOT blindly
   create another Razorpay Order. It first reconciles the reserved provider operation
   using the stable paymentAttemptId/receipt. The exact Razorpay reconciliation API
   remains an implementation decision. Only after reconciliation establishes that no
   prior Order exists may the initiation be safely retried.

   A failed payment attempt is created only after a Razorpay payment/order has
   actually entered the payment flow and Razorpay authoritatively reports failure.

7. Core:
   a. UPDATE purchases SET status = PAYMENT_PENDING
   b. Return to frontend:
      {
        payment: {
          id: paymentId,
          purchaseId,
          amount,
          currency,
          razorpayOrderId,
          razorpayKeyId   ← PUBLIC key only
        }
      }

8. Frontend initializes Razorpay Checkout widget with:
   key: razorpayKeyId     ← public key
   order_id: razorpayOrderId
   amount, currency, name, description
   handler: onRazorpayCallback   ← fires on frontend completion (informational only)
```

### 4.4 Razorpay Currency Units

Razorpay requires amounts in the **smallest currency unit** (paise for INR):

```
MetroFlow stores: NUMERIC(10,2) → e.g. 40.00 (INR)
Razorpay requires: integer paise → 4000
Conversion: exact decimal arithmetic → integer paise
```

This conversion happens in Payment Service. The browser never sees or sends paise. Conversion from PostgreSQL `NUMERIC(10,2)` / decimal-string representation to integer paise MUST use exact decimal arithmetic. Standard JavaScript floating-point arithmetic must not be used for monetary conversion. The exact decimal library remains an implementation decision.

---

## 5. Razorpay Checkout Flow (Browser)

```
Frontend receives:
  razorpayKeyId     ← Razorpay public key (rzp_test_xxx)
  razorpayOrderId   ← Razorpay order ID
  amount            ← display amount (MetroFlow decimal string)
  currency          ← 'INR'

Frontend opens Razorpay Checkout widget

Passenger completes or abandons payment in Razorpay UI

Case A: Passenger completes payment
  Razorpay calls frontend handler (onRazorpayCallback) with:
    razorpay_order_id
    razorpay_payment_id
    razorpay_signature
  → Frontend IGNORES these values for authoritative confirmation
  → Frontend shows: "Confirming your payment..."
  → Frontend begins polling: GET /api/v1/payments/{paymentId}

Case B: Passenger abandons / closes widget
  → No frontend callback
  → If Razorpay had already captured payment:
      Webhook arrives at Payment Service regardless
      Payment SUCCESS processed server-side
      Ticket issued
      Passenger retrieves ticket from their account later
  → If Razorpay had not captured:
      PaymentAttempt remains PENDING until a supported payment.failed webhook
      or reconciliation resolves it

Case C: Browser closes entirely after payment completes
  → Same as Case B success path
  → Webhook still arrives
  → Ticket still issued
  → Passenger logs back in and finds their ticket
```

### 5.1 Frontend Callback Is Never Authoritative

The Razorpay frontend callback provides `razorpay_signature`. Even though this signature could technically be verified, **MetroFlow does not use the frontend callback as confirmation of payment success**. Reasons:

```
1. The webhook is the Razorpay-recommended authoritative confirmation
2. Frontend JavaScript can be manipulated
3. The callback signature uses a different signing mechanism than webhooks
4. The webhook arrives server-to-server without browser involvement
5. Treating both as authoritative creates race conditions
```

The frontend callback serves one purpose: trigger the "Confirming payment..." UX state.

### 5.2 Frontend Polling Strategy

After the Razorpay frontend callback:

```
Frontend polls: GET /api/v1/payments/{paymentId}
  every 2 seconds
  for a maximum of 30 seconds

Response.status = PENDING → wait and retry
Response.status = SUCCESS → proceed to ticket display
Polling timeout (30s)    → show "Payment is taking longer than expected.
                            Your ticket will appear in your account
                            once confirmed."

After SUCCESS:
  GET /api/v1/purchases/{purchaseId}
  Wait for purchase.status = TICKET_ISSUED
  Then GET /api/v1/tickets → display QR
```

Exact polling interval and maximum duration are configuration values — not locked in this document.

---

## 6. Webhook Architecture

### 6.1 Endpoint

```
POST /webhooks/razorpay

Ownership:   Payment Service
Access:      Razorpay servers only
Auth:        HMAC signature verification (X-Razorpay-Signature header)
Not routed:  Through API Gateway
```

### 6.2 Raw Body Requirement

HMAC signature verification requires the **exact raw request body bytes** as received — before any JSON parsing. If the body is parsed first and re-serialized, the signature will not match.

```
Payment Service webhook controller:
  → Intercept raw body before NestJS JSON parsing
  → Hold raw bytes transiently for signature verification
  → Parse JSON separately after verification passes
```

In NestJS this requires a `rawBody` middleware or `RawBodyRequest` setup before the global JSON body parser.

### 6.3 Signature Verification

```
Razorpay sends:
  Header: X-Razorpay-Signature: <hmac_sha256_hex>
  Body: raw JSON payload

Payment Service verifies:
  expected = HMAC-SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)
  received = X-Razorpay-Signature header

  Compare using constant-time comparison (crypto.timingSafeEqual)
  to prevent timing attacks that could leak the secret.

If expected !== received:
  → Return HTTP 400
  → Log: "Invalid webhook signature" + requestId
  → Do NOT process event
  → Do NOT mutate any payment state

If expected === received:
  → Proceed to event processing
```

`RAZORPAY_WEBHOOK_SECRET` lives exclusively in Payment Service environment variables. It is never in Core, never in the browser, never logged.

### 6.4 Webhook Response Semantics (Phase 3.3 Amendment)

Per the Phase 3.3 review correction:

```
Invalid HMAC signature              → HTTP 400
Duplicate (already processed event) → HTTP 200
Successfully durably processed      → HTTP 200
Temporary internal failure          → HTTP 5xx (Razorpay will retry)
```

Returning 5xx on temporary failures allows Razorpay to retry. A webhook is
acknowledged with HTTP 200 only after all required durable effects for that event
category are committed:

```
payment.captured:
  provider event + Attempt SUCCESS + Payment SUCCESS + outbox

payment.failed:
  provider event + Attempt FAILED

unknown, mismatched, or contradictory event:
  provider event + inconsistency metadata only

temporary failure before the required commit:
  ROLLBACK + HTTP 5xx
```

### 6.5 Complete Webhook Processing Sequence

```
Razorpay → POST /webhooks/razorpay

1. Capture raw body before JSON parsing

2. Verify HMAC signature (constant-time)
   → Invalid: HTTP 400, stop

3. Parse JSON body
   Extract:
     event_type       (e.g. 'payment.captured', 'payment.failed')
     provider_event_id (e.g. razorpay event ID)
     razorpay_order_id
     razorpay_payment_id (for captured events)
     razorpay_signature

4. BEGIN one PostgreSQL transaction:

   a. Look up PaymentAttempt:
      SELECT * FROM payment_attempts
      WHERE razorpay_order_id = <order_id>

      → Not found: INSERT provider_events with payment_id = NULL and
        inconsistency_code = 'UNKNOWN_RAZORPAY_ORDER', commit, log warning,
        and return HTTP 200
        (Razorpay may send events for orders MetroFlow doesn't recognize)

   b. Validate the event and resolve the PaymentAttempt.
      → Compare provider amount with expected Payment.amount.
      → Determine inconsistency_code in memory: UNKNOWN_RAZORPAY_ORDER,
        PAYMENT_AMOUNT_MISMATCH, PAYMENT_STATE_INCONSISTENCY, or NULL.
      → The final code is supplied on the single provider_events INSERT below.

   c. INSERT provider_events {
        provider = 'RAZORPAY',
        event_type,
        provider_event_id,
        payment_id = <payment_attempt.payment_id>,
        raw_payload = <parsed JSONB payload>,
        inconsistency_code = <computed inconsistency_code>,
        received_at = NOW()
      }
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id

      → Conflict means a previous transaction committed the complete event
        processing; return HTTP 200 without repeating business effects.
      → No conflict: continue in this same transaction.

   d. Branch on event_type:

      payment.captured:
        → if attempt is PENDING, apply the success transition and outbox insert
        → if attempt is already SUCCESS, treat as same-outcome idempotency
        → if attempt is FAILED, use inconsistency_code =
          'PAYMENT_STATE_INCONSISTENCY'; do not mutate state or publish an outbox

      payment.failed:
        → if attempt is PENDING, apply the failure transition
        → if attempt is already FAILED, treat as same-outcome idempotency
        → if attempt is SUCCESS, use inconsistency_code =
          'PAYMENT_STATE_INCONSISTENCY'; do not mutate state

      other event types:
        → commit the stored, intentionally ignored event and return HTTP 200

   e. COMMIT.

5. Return HTTP 200 only after the transaction commits.

If any recognized-event operation fails before COMMIT, ROLLBACK and return HTTP 5xx.
The provider-event row is then absent, so Razorpay can retry and the retry can
process the event again. Contradictory terminal events are intentionally committed
with their inconsistency code and acknowledged with HTTP 200; financial history is
not rewritten.
```

### 6.6 Payment Success Transaction

This is the most critical atomic operation in the payment system.

```sql
BEGIN;

  -- provider_events INSERT occurs in this same transaction before these updates

  -- 1. Verify current state (prevent double-processing at DB level)
  UPDATE payment_attempts
  SET
    status              = 'SUCCESS',
    razorpay_payment_id = $razorpay_payment_id,
    resolved_at         = NOW()
  WHERE id = $attempt_id
    AND status = 'PENDING'
  RETURNING id;

  -- If 0 rows, inspect the current status:
  --   SUCCESS + captured: same-outcome idempotency; no new outbox event
  --   FAILED  + captured: persist PAYMENT_STATE_INCONSISTENCY; do not mutate
  --   SUCCESS + failed:   persist PAYMENT_STATE_INCONSISTENCY; do not mutate
  -- These outcomes COMMIT the provider_events row and return HTTP 200.

  -- 2. Update parent Payment
  UPDATE payments
  SET
    status              = 'SUCCESS',
    razorpay_payment_id = $razorpay_payment_id,
    razorpay_signature  = $signature,
    updated_at          = NOW()
  WHERE id = $payment_id
    AND status = 'PENDING';

  -- 3. Insert outbox record in same transaction
  INSERT INTO outbox_events (
    id, event_type, topic, payload, status
  ) VALUES (
    uuidv7(),
    'PAYMENT_SUCCEEDED',
    'payment.succeeded',
    $payload_json,
    'PENDING'
  );

COMMIT;
```

If the transaction rolls back for any reason (DB error, constraint violation), the provider event, PaymentAttempt update, Payment update, and outbox insert are all undone. Razorpay receives HTTP 5xx and retries. A duplicate is acknowledged with HTTP 200 only after the original recognized-event transaction committed completely.

---

## 7. Payment Failure Handling

### 7.1 When Razorpay Reports Failure

```
Webhook event_type: payment.failed

UPDATE payment_attempts
SET
  status         = 'FAILED',
  failure_reason = $razorpay_error_description,
  resolved_at    = NOW()
WHERE id = $attempt_id
  AND status = 'PENDING';

Parent Payment:
  remains PENDING
  (another attempt can be created)

No outbox event published for payment failure.
Core does not need to know about individual attempt failures.
```

If `payment.captured` arrives for an attempt already marked `FAILED`, do not
silently transition `FAILED → SUCCESS`. Persist the provider event, flag
`PAYMENT_STATE_INCONSISTENCY`, and require reconciliation/manual investigation.
Likewise, a failure event received after `SUCCESS` never regresses the attempt;
the event is stored and the inconsistent provider sequence is flagged.

### 7.2 Frontend-Visible Failure State

```
Frontend polls GET /api/v1/payments/{paymentId}
→ Core calls Payment Service for status
→ Payment.status = PENDING (parent is still PENDING after attempt failure)

But frontend needs to know the attempt failed so the passenger can retry.

Therefore Core also returns paymentAttemptStatus in the response:
{
  "payment": {
    "id": "...",
    "status": "PENDING",
    "latestAttemptStatus": "FAILED"   ← derived from most recent payment_attempt
  }
}

Frontend interprets:
  status=PENDING + latestAttemptStatus=FAILED
  → "Payment was unsuccessful. You can try again."

  status=PENDING + latestAttemptStatus=PENDING
  → "Confirming your payment..."

  status=SUCCESS
  → "Payment confirmed."
```

`latestAttemptStatus` is derived by Core when assembling the payment status response — it calls Payment Service's internal status endpoint which returns this detail.

### 7.3 Retry After Failure

```
Passenger clicks "Try Again"

Frontend: POST /api/v1/payments/initiate { purchaseId }
  (same endpoint as first attempt)

Core:
  Purchase.status = PAYMENT_PENDING (already set — no change needed)
  Core generates NEW idempotencyKey (K2)
    because this is a new user-intentional attempt, not a network retry

Core: POST /internal/v1/payments
  Idempotency-Key: K2
  { purchaseId, userId, amount, currency }

Payment Service:
  K2 not seen before → proceed
  Payment PAY-1 already exists (uq_payments_purchase_id) → load it
  Payment.status = PENDING → eligible for new attempt
  CREATE PaymentAttempt A2
  CREATE Razorpay Order R2
  Return { paymentId: PAY-1.id, paymentAttemptId: A2.id, razorpayOrderId: R2.id }
```

The parent `payments` record does not contain a Razorpay Order ID. Each `payment_attempt` owns exactly one `razorpay_order_id`; older order IDs remain on their attempts for audit.

---

## 8. Provider Events

### 8.1 Why Raw Events Are Stored

```
Audit:           Parsed Razorpay payload preserved for dispute resolution
Reconciliation:  Can replay or inspect events without calling Razorpay API
Debugging:       Full context available for any payment investigation
Compliance:      Financial audit trail
Idempotency:     (provider, provider_event_id) uniqueness prevents double-processing
```

### 8.2 Key Fields

| Field | Purpose |
|---|---|
| `provider` | Always `RAZORPAY` in V1 |
| `event_type` | Razorpay event name (`payment.captured`, `payment.failed`) |
| `provider_event_id` | Razorpay's own event ID — idempotency key |
| `payment_id` | Linked MetroFlow payment ID (set after lookup) |
| `raw_payload` | Parsed webhook payload stored as PostgreSQL JSONB; not byte-identical to the request body |
| `received_at` | When MetroFlow received the webhook |

### 8.3 Deduplication Behavior

```
Razorpay delivers webhook
  ↓
Verify signature using exact raw request bytes held transiently in memory
  ↓
BEGIN PostgreSQL transaction
  ↓
Deduplicate/store provider event
  ↓
Classify event and apply required effects:
  captured → Attempt SUCCESS + Payment SUCCESS + outbox
  failed → Attempt FAILED
  unknown/mismatch/contradictory → inconsistency evidence only
  ↓
COMMIT
  ↓
Return HTTP 200

If the provider-event uniqueness check finds a committed event:
  → Previous processing committed completely
  → Return HTTP 200 with no duplicate business effects

If any recognized-event step fails:
  → ROLLBACK, including provider_events
  → Return HTTP 5xx so Razorpay retries
```

`provider_events.raw_payload` stores the parsed webhook payload as PostgreSQL JSONB for audit, debugging, and reconciliation. It does not preserve the byte-identical HTTP request body. Exact raw bytes are retained only transiently for webhook signature verification.

---

## 9. Transactional Outbox and Kafka

### 9.1 Why the Outbox Is Required

Without the outbox:

```
BEGIN;
  UPDATE payments → SUCCESS
  UPDATE payment_attempts → SUCCESS
COMMIT;
  ↓
Publish to Kafka ← if this crashes, event is permanently lost
```

With the outbox:

```
BEGIN;
  UPDATE payments → SUCCESS
  UPDATE payment_attempts → SUCCESS
  INSERT outbox_events → PENDING
COMMIT;   ← all succeed or all roll back

Outbox Publisher (separate process):
  Poll PENDING outbox records
  Publish to Kafka
  Mark PUBLISHED
```

If the publisher crashes between commit and publish, the `PENDING` record remains and will be retried on next poll. Kafka's at-least-once delivery combined with consumer idempotency handles any duplicates.

### 9.2 `payment.succeeded` Event Contract

```json
{
  "eventId":    "01932b4c-...",
  "eventType":  "PAYMENT_SUCCEEDED",
  "version":    "1.0",
  "occurredAt": "2025-08-15T10:36:00.000Z",
  "paymentId":  "01932b4c-...",
  "purchaseId": "01932b4c-...",
  "userId":     "01932b4c-...",
  "amount":     "40.00",
  "currency":   "INR"
}
```

**Not included in event:**

```
razorpay_payment_id   ← Razorpay internal reference, stays in Payment DB
razorpay_signature    ← Never leaves Payment Service
raw_payload           ← Never leaves Payment Service
attempt_id            ← Internal to Payment Service
```

**Kafka key:** `purchaseId` — ensures all events for the same purchase go to the same partition, preserving ordering per purchase.

**Event versioning:** `version: "1.0"` field included. Consumers must check version. Breaking schema changes require a new version string.

### 9.3 Outbox Publisher Behavior

```
Poll outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 100

For each record:
  Attempt publish to Kafka topic = record.topic
  If success:
    UPDATE outbox_events SET status = 'PUBLISHED', published_at = NOW()
  If failure:
    UPDATE outbox_events SET
      attempts = attempts + 1,
      last_attempted_at = NOW(),
      error_message = <error>
    If attempts >= max_attempts:
      UPDATE outbox_events SET status = 'DEAD'
    Else:
      status remains PENDING → retried on next poll

DEAD records:
  Surfaced in admin /api/v1/admin/outbox/dead
  Require investigation
  Never automatically deleted
```

### 9.4 Core `payment.succeeded` Consumer

```
Core receives payment.succeeded from Kafka

1. Idempotency check:
   Has this eventId already been processed?
   → Check: does a ticket exist with payment_id = event.paymentId?
     (uq_tickets_payment_id — existence check is safe and fast)
   → Yes: log "duplicate event, skipping", commit offset, done
   → No: proceed

2. Load Purchase by event.purchaseId
   Verify Purchase.userId = event.userId (integrity check)
   Verify Purchase.amount = event.amount (integrity check)

3. Transaction A — acknowledge payment:
   BEGIN TRANSACTION;
   UPDATE purchases
   SET status = 'PAID', updated_at = NOW()
   WHERE id = event.purchaseId
     AND status = 'PAYMENT_PENDING'
   RETURNING id;
   COMMIT;

   → If the purchase is already PAID or TICKET_ISSUED, treat this as idempotent
     and continue to the ticket-existence check.
   → Payment success is now durably acknowledged independently of ticket creation.

4. Transaction B — issue the ticket:
   BEGIN TRANSACTION;
   → If a ticket already exists for event.paymentId or event.purchaseId, return it
     as the idempotent result.
   → Otherwise INSERT tickets {
        id             = uuidv7(),
        purchase_id    = event.purchaseId,
        user_id        = event.userId,
        payment_id     = event.paymentId,
        origin_station_id,         ← from purchase
        destination_station_id,    ← from purchase
        paid_amount    = event.amount,
        currency       = event.currency,
        status         = 'ISSUED',
        issued_at      = NOW(),
        expires_at     = <end of service day>
      }
   UPDATE purchases
   SET status = 'TICKET_ISSUED', updated_at = NOW()
   WHERE id = event.purchaseId
     AND status = 'PAID';
   INSERT outbox_events {
     event_type = 'TICKET_ISSUED',
     topic      = 'ticket.issued',
     payload    = { ticketId, userId, purchaseId, ... }
   }
   COMMIT;

4. Commit Kafka offset (mark event as processed)
```

### 9.5 Critical: PAID State Before Ticket Issuance

The `purchases.status = PAID` transition is committed **before ticket creation**. If Transaction B fails:

```
Kafka event received
  ↓
Transaction A:
  UPDATE purchases → PAID
  COMMIT ✓

Transaction B:
  INSERT tickets   → FAILS (e.g. DB error)
  ROLLBACK

Purchase remains PAID, with no Ticket
  ↓
Recoverable state detected by the inconsistencies endpoint
  ↓
Retry ticket issuance without re-acknowledging payment
```

If the transaction partially succeeds but the commit fails:

```
Transaction A commits PAID.
Transaction B either commits the Ticket, TICKET_ISSUED transition, and outbox
record together, or rolls back those ticket-side effects.
  ↓
The PAID purchase remains available for recovery.
```

The `uq_tickets_payment_id` and `uq_tickets_purchase_id` constraints ensure retried ticket insertions are caught as duplicates — returning the existing ticket, not creating a second one.

---

## 10. Core Purchases → PAID Recovery

If Purchase becomes `PAID` (successfully committed) but subsequent ticket issuance fails due to an unrelated error after commit:

```
Purchase.status = PAID ✓
Ticket = none ✗
```

This is the payment-success/ticket-missing inconsistency. Recovery:

```
Admin API: GET /api/v1/admin/inconsistencies
→ Returns purchases WHERE status = 'PAID' AND no ticket exists

Recovery action (V1: manual):
  Admin investigates
  Operator triggers the same idempotent Transaction B ticket-issuance path
  or replays/reprocesses the payment event
  Transaction B atomically creates the Ticket, sets Purchase → TICKET_ISSUED,
  and inserts the ticket.issued outbox event
  Or refund is initiated

Recovery action (V2: automated):
  Background job detects PAID purchases without tickets
  Attempts ticket issuance
  Uses uq_tickets_payment_id for idempotency
```

The `payment_id` on the ticket is obtained from the Kafka event that triggered the PAID transition. It is stored in the Kafka consumer context during processing.

---

## 11. Sequence Diagrams

### 11.1 Successful First-Attempt Payment

```
Passenger   Frontend    Core        PaymentSvc   Razorpay   Kafka
    │           │          │              │           │         │
    │──Pay──►  │          │              │           │         │
    │           │──POST────►             │           │         │
    │           │  /payments/initiate    │           │         │
    │           │          │──POST───────►           │         │
    │           │          │ /internal/  │           │         │
    │           │          │ payments    │──create──►│         │
    │           │          │             │  order    │         │
    │           │          │             │◄──orderId─│         │
    │           │◄─────────│             │           │         │
    │           │ {razorpay │            │           │         │
    │           │  OrderId} │            │           │         │
    │◄─checkout─│           │            │           │         │
    │  widget   │           │            │           │         │
    │──pays────►Razorpay    │            │           │         │
    │           │           │            │           │         │
    │◄─callback─│           │            │           │         │
    │           │           │            │◄─webhook──│         │
    │           │           │            │ (captured)│         │
    │           │           │            │──verify──►│         │
    │           │           │            │──update DB│         │
    │           │           │            │──outbox──►│         │
    │           │──poll─────►            │     payment.succeeded
    │           │           │            │           │────────►│
    │           │           │◄─consume───────────────────────  │
    │           │           │  purchase PAID                   │
    │           │           │  ticket issued                   │
    │           │◄──SUCCESS─│            │           │         │
    │◄─ticket───│           │            │           │         │
```

### 11.2 Failed Attempt → Retry → Success

```
Core        PaymentSvc     Razorpay    Kafka

Attempt 1:
POST /internal/payments
  → PAY-1 created
  → A1 created
  → Order R1 created
                    ←── webhook: payment.failed
  A1.status = FAILED
  PAY-1 remains PENDING
  No outbox event

Attempt 2 (passenger clicks Try Again):
POST /internal/payments
  Idempotency-Key: K2 (new)
  → PAY-1 found (purchase_id unique)
  → A2 created
  → Order R2 created
                    ←── webhook: payment.captured
  BEGIN:
    A2 → SUCCESS
    PAY-1 → SUCCESS
    INSERT outbox
  COMMIT
  Outbox publisher → Kafka → payment.succeeded
```

### 11.3 Duplicate Payment Initiation (Network Retry)

```
Core → POST /internal/payments  Idempotency-Key: K1
Payment Service durably reserves K1, creates PAY-1, and reserves A1 identity
Payment Service creates Order R1 and completes the durable K1 record
Response lost (timeout)

Core retries → POST /internal/payments  Idempotency-Key: K1
Payment Service: K1 found in PostgreSQL
→ Return durable { paymentId: PAY-1, razorpayOrderId: R1 }
→ No new Payment, no new Attempt, no new Order

If two requests with K1 arrive concurrently:
  → one request creates the durable IN_PROGRESS reservation
  → the other sees IN_PROGRESS and does not call Razorpay
  → it returns PAYMENT_INITIATION_IN_PROGRESS or performs bounded reconciliation
  → after completion, a later read of COMPLETED returns the stored result

If K1 is IN_PROGRESS after a crash:
  → reconcile the reserved provider operation first
  → never blindly create Order R2
```

### 11.4 Duplicate Webhook

```
Razorpay → webhook (payment.captured) event_id: EVT-1
  BEGIN: resolve attempt, INSERT provider_events,
         A1 → SUCCESS, PAY-1 → SUCCESS, outbox INSERT
  COMMIT all effects together
  → HTTP 200

Razorpay → same webhook again  event_id: EVT-1
  INSERT provider_events ON CONFLICT DO NOTHING → committed duplicate found
  → HTTP 200 immediately
  → No state mutation
  → No second outbox event
```

### 11.5 Payment Succeeds but Kafka Is Unavailable

```
Webhook received → verified
BEGIN: A1 → SUCCESS, PAY-1 → SUCCESS, outbox INSERT PENDING
COMMIT ✓
→ HTTP 200 to Razorpay

Kafka unavailable:
  Outbox publisher attempts publish → fails
  outbox_events.attempts++
  status remains PENDING

Kafka recovers:
  Outbox publisher retries
  Publishes payment.succeeded
  outbox_events → PUBLISHED

Core receives event → issues ticket
```

Payment Service returned 200 to Razorpay because the event was durably persisted (outbox). Kafka being temporarily unavailable is handled by the outbox retry loop.

### 11.6 Payment Succeeds but Ticket Issuance Initially Fails

```
Core receives payment.succeeded from Kafka

Transaction A:
  purchases PAYMENT_PENDING → PAID
  COMMIT ✓

Transaction B:
  INSERT tickets → DB error
  ROLLBACK

Purchase remains PAID with no Ticket.
The inconsistencies endpoint exposes the recoverable state.

On retry/recovery:
  Transaction B:
    INSERT tickets → success this time
    purchases PAID → TICKET_ISSUED
    INSERT outbox ticket.issued
  COMMIT

Kafka offset committed
```

If ticket creation fails repeatedly and offset is committed by accident, the `PAID` purchase without a ticket is detected by the admin inconsistencies endpoint.

---

## 12. Failure Scenarios

| Scenario | Expected State | Recovery | Automatic? | Passenger Sees |
|---|---|---|---|---|
| Razorpay unavailable during Order creation | No payable attempt finalized; Payment remains CREATED/PENDING | Passenger can retry initiation | No — user retries | "We were unable to start payment. Please try again." |
| Payment Service timeout (Core retries with same K) | Durable PostgreSQL idempotency record returns the same result | Idempotency returns same Payment/Attempt/Order | Yes | No change — same checkout session |
| User closes browser before paying | A1=PENDING, PAY-1=PENDING | Passenger can initiate another attempt after the current attempt is resolved | No — user may retry | Ticket absent; can retry |
| User pays, closes browser, webhook arrives | PAY-1=SUCCESS, ticket issued | Ticket in account | Yes (server-side) | Ticket in account on next login |
| Frontend callback before webhook | Purchase=PAYMENT_PENDING | Polling waits; webhook arrives; SUCCESS | Yes | "Confirming..." → "Confirmed" |
| Webhook arrives before frontend callback | PAY-1=SUCCESS while user still in checkout | Poll returns SUCCESS immediately | Yes | Fastest possible confirmation |
| Webhook delivered twice | Second event → committed provider_events conflict → acknowledged | Transactional provider-event deduplication | Yes | No impact |
| Webhook delivered many times | All subsequent committed duplicates → acknowledged | Transactional idempotency | Yes | No impact |
| Webhook events out of order (failed then captured) | Event stored; attempt remains FAILED; inconsistency flagged | Manual reconciliation required | No | Payment requires investigation |
| Failure event after SUCCESS | SUCCESS never regresses; event stored and inconsistency flagged | Manual reconciliation required | No | Payment remains confirmed pending review |
| Payment Service crashes before webhook DB commit | Transaction rolls back, including provider event; Razorpay returns 5xx → retries | Razorpay retries webhook | Yes | Delayed confirmation |
| DB commits SUCCESS, crashes before Kafka publication | Outbox record PENDING | Outbox publisher retries on recovery | Yes | Delayed ticket |
| Kafka permanently unavailable | Outbox records accumulate → DEAD after max retries | Manual investigation + replay | Partially | "Payment confirmed. Ticket pending." |
| payment.succeeded delivered to Core multiple times | Second delivery: ticket exists → idempotent skip | uq_tickets_payment_id | Yes | No impact |
| Core crashes while processing payment.succeeded | Kafka offset not committed → redelivery | Kafka at-least-once + idempotency | Yes | Delayed ticket |
| Purchase PAID but ticket creation fails | Purchase=PAID, no ticket | Admin inconsistencies endpoint; retry Transaction B; V2 automated recovery | No (V1 manual) | No ticket until resolved |
| Unknown Razorpay Order ID in webhook | Provider event persisted with `payment_id=NULL` and `UNKNOWN_RAZORPAY_ORDER` | Manual reconciliation | No | No impact |
| Invalid webhook signature | No state mutation | Log security warning; return 400 | Yes | No impact |
| Amount mismatch (webhook amount ≠ expected Payment.amount) | Provider event persisted with `PAYMENT_AMOUNT_MISMATCH`; Payment remains non-success for ticketing | Manual reconciliation; no `payment.succeeded` event | No | Payment requires investigation |
| Provider event cannot be mapped to attempt | Provider evidence retained with `payment_id=NULL` and reconciliation flag | Manual reconciliation | No | No impact |

---

## 13. User-Facing Payment States

The passenger must never see internal errors. Every state maps to a safe message.

| Internal State | User-Facing Message |
|---|---|
| Payment.status=PENDING, latest attempt=PENDING | "Confirming your payment. Please wait..." |
| Payment.status=PENDING, latest attempt=FAILED | "Payment was unsuccessful. You can try again." |
| Payment.status=SUCCESS, purchase=PAID | "Payment confirmed. Preparing your ticket..." |
| Purchase.status=TICKET_ISSUED | "Your ticket is ready." (show QR) |
| Polling timeout (still PENDING after 30s) | "Payment is taking longer than expected. Your ticket will appear in your account once confirmed." |
| PAYMENT_PROVIDER_ERROR from initiation | "We were unable to process your payment. Please try again." |
| SERVICE_TEMPORARILY_UNAVAILABLE | "We couldn't complete your request right now. Please try again shortly." |

**Never expose:**

```
Kafka errors
PostgreSQL errors
Razorpay internal error codes
Stack traces
Service names (Payment Service, Core API)
Webhook verification details
Database constraint names
outbox_events status
```

---

## 14. Reconciliation

### 14.1 V1 Reconciliation Strategy

V1 provides **admin visibility** into payment-related inconsistencies. Automated reconciliation is V2.

| Inconsistency | Detection | V1 Resolution |
|---|---|---|
| Purchase=PAID, no Ticket | `GET /admin/inconsistencies` | Manual admin action |
| Payment=SUCCESS in Payment DB but no payment.succeeded in Core | Compare Core purchase status vs Payment Service status | Admin calls both APIs, investigates |
| Outbox DEAD records | `GET /admin/outbox/dead` | Manual investigation + replay |
| provider_event with payment_id=NULL | Payment Service internal query | Manual mapping |

### 14.2 Cross-Service Reconciliation

Core knows: `purchases.status = PAYMENT_PENDING` for extended period.
Payment Service knows: `payments.status = SUCCESS`.

Discrepancy detected by:

```
Admin calls:
  GET /api/v1/admin/purchases?status=PAYMENT_PENDING (older than X hours)
  GET /internal/v1/payments?purchaseId={id}

If Payment says SUCCESS but Purchase says PAYMENT_PENDING:
  → Kafka event was lost or not processed
  → V1: manual ticket issuance or retry of consumer
  → V2: automated detection job
```

---

## 15. Security

### 15.1 Secret Ownership

| Secret | Owner | Never Reaches |
|---|---|---|
| `RAZORPAY_KEY_SECRET` | Payment Service env | Browser, Core, logs |
| `RAZORPAY_WEBHOOK_SECRET` | Payment Service env | Browser, Core, logs |
| `RAZORPAY_KEY_ID` (public) | Payment Service env | Never stored in browser — returned per-request |

### 15.2 What Browser Receives

```
razorpayKeyId      ← PUBLIC key (rzp_test_xxx) — safe to expose
razorpayOrderId    ← Razorpay Order ID — safe, scoped to one order
amount             ← display amount string
currency           ← 'INR'
```

```
NOT in the Razorpay Checkout widget:
razorpay_key_secret      ❌
razorpay_webhook_secret  ❌
paymentId may exist in MetroFlow frontend state for polling,
  but is not sent to or used by the Razorpay Checkout widget
purchase amount paise    ← Razorpay receives this via Order, not browser
```

### 15.3 Logging Rules

```
Must log (with requestId/paymentId):
  Payment initiation (purchaseId, amount, currency)
  Webhook received (provider_event_id, event_type)
  Signature verification result (valid/invalid — not the secret)
  Payment state transitions
  Outbox events and retries

Must NOT log:
  RAZORPAY_KEY_SECRET
  RAZORPAY_WEBHOOK_SECRET
  Full raw_payload if it contains card data
  Razorpay signature value
  Any PII beyond userId
```

### 15.4 Amount Integrity

The authoritative amount always originates from MetroFlow's server:

```
Purchase.amount (from FareQuote.amount from FareRule.amount)
  ↓
Core passes to Payment Service in internal call
  ↓
Payment Service uses this amount for Razorpay Order
  ↓
Razorpay Order amount is fixed at creation

Browser never supplies or influences amount.
```

If the Razorpay webhook amount differs from the expected `Payment.amount`:

```
→ persist the provider event with inconsistency_code = PAYMENT_AMOUNT_MISMATCH
→ do not transition Payment to SUCCESS for ticketing purposes
→ do not emit payment.succeeded
→ require reconciliation
```

---

## 16. Observability

### 16.1 Correlation IDs

Every payment-related log line must include available identifiers:

```
requestId         (all requests)
purchaseId        (all payment flows)
paymentId         (once Payment entity exists)
paymentAttemptId  (once Attempt entity exists)
providerEventId   (webhook flows)
razorpayOrderId   (once Order exists)
outboxEventId     (outbox flows)
```

### 16.2 Metrics

```
payment_initiation_total          (counter)
payment_initiation_errors_total   (counter, labeled by error_code)
payment_attempt_success_total     (counter)
payment_attempt_failure_total     (counter, labeled by failure_reason)
webhook_received_total            (counter)
webhook_signature_invalid_total   (counter)
webhook_duplicate_total           (counter)
webhook_processing_duration_ms    (histogram)
outbox_pending_count              (gauge)
outbox_dead_count                 (gauge)
outbox_publish_duration_ms        (histogram)
kafka_consumer_lag                (gauge, labeled by topic)
```

---

## 17. Payment Decision Register

| ID | Decision | Rationale |
|---|---|---|
| PAY-001 | Payment Service generates `payments.id` and owns Payment state | Payment Service owns the Payment lifecycle and returns the generated paymentId to Core |
| PAY-002 | Payment initiation idempotency is authoritative in PostgreSQL | Durable idempotency prevents Redis restart/eviction from creating duplicate Payments, Attempts, or Razorpay Orders |
| PAY-003 | Network retry: same Idempotency-Key returns the same Payment/Attempt/Order; user-intentional retry: new key uses the same parent Payment and creates a new PaymentAttempt and Razorpay Order | Prevents duplicate parent Payments while allowing deliberate retries after failed attempts |
| PAY-023 | Initiation reservation is durable before the Razorpay call | `IN_PROGRESS` plus a stable attempt identity closes the crash window between provider Order creation and PostgreSQL commit |
| PAY-024 | An `IN_PROGRESS` initiation is reconciled before retry | PostgreSQL cannot atomically commit with Razorpay; blind retry could create a second provider Order |
| PAY-025 | Contradictory provider terminal events are persisted and flagged | Financial history is never silently rewritten; reconciliation is required |
| PAY-026 | One active pending attempt and one in-progress reservation per Payment | Prevents concurrent requests with different idempotency keys from creating multiple active Razorpay Orders |
| PAY-027 | Provider events remain INSERT-only with final inconsistency metadata computed before insert | Preserves the immutable provider-event audit trail |
| PAY-004 | One Payment per Purchase (`uq_payments_purchase_id`) | Clean ownership model; all attempts belong to one Payment lifecycle |
| PAY-005 | Each PaymentAttempt owns one Razorpay Order | One-to-one mapping; clear audit trail; retry = new Order |
| PAY-006 | Frontend Razorpay callback is never authoritative | Prevents manipulation; webhook is the Razorpay-recommended authority |
| PAY-007 | Webhook is the only authoritative payment confirmation | Server-to-server, HMAC-verified, browser-independent |
| PAY-008 | Webhook returns 5xx on temporary internal failures | Allows Razorpay to retry; idempotency makes retries safe |
| PAY-009 | Raw webhook body captured before JSON parsing | HMAC verification requires exact bytes; parsing first invalidates signature |
| PAY-010 | Constant-time comparison for HMAC verification | Prevents timing attacks that could reveal webhook secret |
| PAY-011 | Parsed webhook payload stored in `provider_events.raw_payload` as JSONB | Supports audit, reconciliation, and debugging; exact raw HTTP bytes are retained only transiently for HMAC verification |
| PAY-012 | Provider-event uniqueness is enforced transactionally with category-specific processing | `captured` commits provider event + success mutations + outbox; `failed` commits provider event + failure mutation; inconsistencies commit evidence and metadata only |
| PAY-013 | Webhook durability is defined by event category | HTTP 200 follows the required commit: captured with success/outbox, failed with failure mutation, and inconsistent/unknown/mismatched events with provider evidence and inconsistency metadata |
| PAY-014 | Kafka key = `purchaseId` for `payment.succeeded` | Preserves ordering per purchase; all events for same purchase → same partition |
| PAY-015 | `payment.succeeded` event includes `version` field | Forward compatibility; consumers can reject unknown versions |
| PAY-016 | Core idempotency check = ticket existence by `payment_id` | Uses existing unique constraint; no separate idempotency table needed |
| PAY-017 | `purchases.status = PAID` is committed before ticket creation | Payment acknowledgement and ticket issuance are separate transactions, making PAID + no Ticket a genuine recoverable state |
| PAY-018 | `payments.status` does not include `FAILED` | Failed attempts leave parent PENDING; FAILED only on `payment_attempts` |
| PAY-019 | Amount converted to paise in Payment Service using exact decimal arithmetic | Payment Service owns Razorpay integration details; PostgreSQL NUMERIC/decimal strings must not pass through standard JavaScript floating-point arithmetic |
| PAY-020 | RAZORPAY_KEY_SECRET and WEBHOOK_SECRET live only in Payment Service env | Minimum secret surface; never in browser, Core, or logs |
| PAY-021 | Frontend polls MetroFlow status APIs after Razorpay callback | Decouples browser state from server state; works even if browser closes |
| PAY-022 | V1 reconciliation is admin-visible, not automated | Keeps V1 scope bounded; automated reconciliation is V2 |

---

## 18. Deferred Decisions

The following are intentionally not defined in this document:

```
Razorpay Order expiry TTL                    → Razorpay configuration
Outbox polling interval                      → Phase 3.9 Worker Design
Outbox max_attempts before DEAD              → Phase 3.9 Worker Design
Outbox backoff algorithm                     → Phase 3.9 Worker Design
Frontend polling interval and max duration   → implementation decision
Internal service auth mechanism (Core → Payment Service) → Phase 3.11 — Observability, Security & Deployment
Razorpay webhook event types beyond payment.captured / payment.failed → Future Payment extension / V2 Backlog
Automated payment reconciliation job         → V2 Backlog
Razorpay API timeout values                  → configuration
Payment retry limits (max attempts per purchase) → product decision, not locked in V1
Currency support beyond INR                  → V2 Backlog
Razorpay Key ID rotation strategy            → operational decision
```

---

## 19. Phase 3.5 Definition of Done

Phase 3.5 is complete when a developer can answer:

- [x] Who owns payment state? → Payment Service
- [x] Who creates Razorpay Orders? → Payment Service
- [x] What exactly is a PaymentAttempt? → One Razorpay Order attempt; PENDING → SUCCESS or FAILED
- [x] What happens when an attempt fails? → Parent Payment stays PENDING; new attempt can be created
- [x] How is payment initiation idempotent? → PostgreSQL `payment_idempotency_keys`; Payment Service generates one parent paymentId, retries reuse the same key, and Redis is optional cache only
- [x] What proves that a payment succeeded? → Verified Razorpay webhook; HMAC signature
- [x] Can frontend success be trusted? → No; frontend callback is informational only
- [x] How is a webhook authenticated? → HMAC-SHA256 with RAZORPAY_WEBHOOK_SECRET; constant-time compare
- [x] How are duplicate webhooks handled? → provider-event uniqueness is checked in the same transaction as recognized-event processing; committed duplicates return 200, failed transactions roll back and receive 5xx
- [x] How does Payment Service update SUCCESS atomically? → Recognized provider event, attempt, payment, and outbox commit together; contradictory terminal events commit only their evidence and flag
- [x] How does payment.succeeded reach Kafka reliably? → Transactional outbox; publisher with retry; DEAD on exhaustion
- [x] How does Core process that event idempotently? → Transaction A persists PAID, then Transaction B uses uq_tickets_payment_id and uq_tickets_purchase_id for ticket issuance
- [x] What happens if ticket issuance fails? → Purchase remains PAID with no Ticket; the inconsistencies endpoint exposes the recoverable state and Transaction B can be retried
- [x] What does passenger see while confirmation is pending? → "Confirming your payment..." via polling
- [x] How do we recover from major distributed failures? → Documented per scenario in Section 12
- [x] Which Razorpay values are public and which are secrets? → Section 15.1

---

## 20. Next Phase 3 Document

```
Phase 3.6 — Gate Service Detailed Design
  → Gate authentication (API key management)
  → Entry/exit validation business rule implementation
  → Idempotency at Gate Service layer
  → Rate limiting per gate device
  → Core internal gate validation endpoint design
  → Gate event recording
  → Concurrency at the entry point
```
