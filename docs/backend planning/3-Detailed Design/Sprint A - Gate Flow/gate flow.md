# MetroFlow — Sprint A: Gate Service & Gate Flow Design

> **Document:** `architecture/sprint-a-gate-flow.md`
> **Status:** Approved — V1 Locked
> **Covers:** Gate Service design, entry/exit validation, concurrency, idempotency, timeout, audit

---

## Locked Decisions

Everything in this document is final for MetroFlow V1.

Implementation may choose normal code-level details, but it must not invent or change:

- gate business rules,
- ticket/journey state transitions,
- idempotency semantics,
- concurrency behavior,
- timeout behavior,
- Gate Service/Core ownership boundaries,
- or gate authentication boundaries.

Any future behavior outside this document belongs in the V2 backlog unless a genuine V1 correctness issue is discovered.

---

# 1. Physical Flow

```text
Passenger scans Ticket QR
        ↓
Gate Simulator UI
(Next.js browser)
        ↓
Next.js BFF server route
        ↓
Adds Gate API key server-side
        ↓
API Gateway (:8080)
        ↓
Gate Service (:3003)
  → authenticate Gate API key
  → check Redis idempotency fast path
  → rate limit new requests
  → forward request to Core
        ↓
Core API (:3001)
internal gate endpoint
  → durable idempotency check
  → resolve Gate
  → evaluate business rules
  → execute atomic PostgreSQL transaction
  → write GateEvent
  → return ALLOW or REJECT
        ↓
Gate Service
  → cache successful business result in Redis
  → return result to BFF
        ↓
Gate Simulator UI
  → ALLOW  → green/open simulation
  → REJECT → red/reason

The browser never receives or stores the Gate API key.

The Next.js BFF injects:

X-Gate-Api-Key: <secret>

before forwarding the request.

The Gate Service never trusts the browser to supply MetroFlow's infrastructure credential.

2. Gate Service Authentication

Gate requests use a dedicated machine credential.

This authentication mechanism is separate from passenger/admin JWT authentication.

X-Gate-Api-Key: <key>

Gate Service validates the supplied key against its configured secret.

Conceptually:

received key
      ↓
constant-time comparison
      ↓
valid   → continue
invalid → HTTP 401 UNAUTHORIZED

Implementation may use Node.js:

crypto.timingSafeEqual(...)

The implementation must safely handle unequal buffer lengths before calling timingSafeEqual.

V1 Secret Placement

V1 uses one shared Gate API key for the Gate Simulator infrastructure.

The secret is configured server-side in both:

Next.js BFF
→ needs the key to send authenticated Gate requests

Gate Service
→ needs the key to validate authenticated Gate requests

The secret must never be included in:

browser JavaScript,
browser environment variables,
API responses,
frontend logs,
Git,
or public configuration.

Exact production secret-management infrastructure is deferred to:

Phase 3.11 — Observability, Security & Deployment
3. Request Idempotency

Every gate scan request must contain:

Idempotency-Key: <uuid>

One scan operation generates one key.

A retry of the same scan must reuse the same key.

A new physical scan must generate a new key.

Missing key:

HTTP 400
VALIDATION_ERROR
3.1 Gate Service Fast Path

Gate Service first checks Redis:

Key:
gate_idempotency:{idempotencyKey}

TTL:
300 seconds

Flow:

GET gate_idempotency:{key}

HIT
  ↓
Return cached business response
Do not call Core

MISS
  ↓
Continue as a new/unresolved request

The cache value contains the gate business response.

Example:

{
  "decision": "ALLOW",
  "ticket": {},
  "journey": {}
}

or:

{
  "decision": "REJECT",
  "rejectionCode": "WRONG_ORIGIN",
  "message": "This ticket is not valid for entry at this station."
}

Redis is only a performance optimization.

Redis is not the authoritative idempotency store.

3.2 Durable Idempotency Authority

Core provides durable idempotency through:

gate_events.request_id

The database must enforce:

CREATE UNIQUE INDEX uq_gate_events_request_id
  ON gate_events (request_id)
  WHERE request_id IS NOT NULL;

This replaces the previous non-unique request ID index.

Phase 3.2 Amendment
DB-044

gate_events.request_id is uniquely constrained so that one
Idempotency-Key can produce at most one committed GateEvent.

This provides durable gate-request idempotency, including protection
against concurrent requests using the same Idempotency-Key.

Redis expiry, restart, data loss, or cache miss must never cause an already committed gate operation to execute again.

Authoritative flow:

Request
   ↓
Redis
   │
   ├── HIT → return cached result
   │
   └── MISS
          ↓
         Core
          ↓
gate_events.request_id
          │
          ├── exists
          │      ↓
          │   reconstruct previous result
          │
          └── absent
                 ↓
              process request

Byte-for-byte JSON equality after Redis expiry is not required.

What is required is:

same request
→ same business decision
→ no duplicate business transition
4. Rate Limiting

Rate limiting protects the Gate Service from excessive new scan requests.

Redis key:

rate_limit:gate:{gateId}:{windowMinute}

where:

windowMinute = Math.floor(Date.now() / 60000);

Conceptual algorithm:

INCR key

first increment
→ set expiration

value <= configured limit
→ continue

value > configured limit
→ HTTP 429

Configuration:

GATE_RATE_LIMIT_PER_MINUTE

The exact numeric limit is operational configuration and is not architecturally locked.

Ordering

The Gate Service processing order is:

1. Authenticate Gate API key
2. Check Redis idempotency cache
3. Rate-limit unresolved/new requests
4. Call Core

Therefore, a retry whose result is already cached may return immediately without consuming another new-operation allowance.

Detailed Redis implementation and outage behavior are finalized in Sprint B.

5. Core Internal Endpoint Contract

Gate Service calls Core directly through internal service endpoints.

POST /internal/v1/gate/validate-entry
POST /internal/v1/gate/validate-exit

These endpoints are not public passenger endpoints.

They are not exposed through the public API Gateway routing surface.

Request
{
  "gateId": "01932b4c-...",
  "ticketIdentifier": "01932b4c-...",
  "requestId": "01932b4c-..."
}

Where:

requestId = Idempotency-Key received by Gate Service
ALLOW — Entry
{
  "decision": "ALLOW",
  "ticket": {
    "id": "01932b4c-...",
    "originStation": {},
    "destinationStation": {}
  },
  "journey": {
    "id": "01932b4c-...",
    "enteredAt": "2026-09-04T10:00:00.000Z",
    "expiresAt": "2026-09-04T12:30:00.000Z"
  }
}
ALLOW — Exit
{
  "decision": "ALLOW",
  "ticket": {
    "id": "01932b4c-...",
    "originStation": {},
    "destinationStation": {}
  },
  "journey": {
    "id": "01932b4c-...",
    "enteredAt": "2026-09-04T10:00:00.000Z",
    "exitedAt": "2026-09-04T11:00:00.000Z"
  }
}
REJECT
{
  "decision": "REJECT",
  "rejectionCode": "WRONG_ORIGIN",
  "message": "This ticket is not valid for entry at this station."
}

Business ALLOW and REJECT outcomes use HTTP 200.

HTTP error statuses are reserved for request/authentication/infrastructure failures.

6. Gate Resolution

Before ticket business validation, Core resolves the supplied Gate.

gateId
   ↓
Gate exists?

If the Gate cannot be resolved:

HTTP 400
VALIDATION_ERROR

Example:

Unknown or invalid gateId.

This is not an ALLOW/REJECT ticket business decision.

No gate_events row is created because:

gate_events.gate_id
gate_events.station_id

require valid resolved database entities.

Therefore:

Every gate business interaction associated with a valid resolved Gate produces a GateEvent.

Requests rejected before Gate resolution are request/system failures rather than gate business events.

gate_id and station_id remain NOT NULL.

7. Entry Validation

After resolving the Gate, Core evaluates entry rules in this exact order.

First failure wins.

1. Gate.type = ENTRY
   → else VALIDATION_ERROR

2. Gate.status = ACTIVE
   → else GATE_INACTIVE

3. Ticket exists
   → else TICKET_NOT_FOUND

4. Ticket.status

   EXPIRED
   → TICKET_EXPIRED

   IN_JOURNEY
   → TICKET_ALREADY_IN_JOURNEY

   COMPLETED
   → TICKET_COMPLETED

   ISSUED
   → continue

5. Ticket first-entry validity

   NOW() >= ticket.expires_at
   → TICKET_EXPIRED

   NOW() < ticket.expires_at
   → continue

6. Origin validation

   gate.station_id == ticket.origin_station_id
   → continue

   otherwise
   → WRONG_ORIGIN

All rules pass:

ALLOW
8. Entry ALLOW Transaction

Entry state transition must be atomic.

BEGIN;

UPDATE tickets
SET
  status = 'IN_JOURNEY',
  updated_at = NOW()
WHERE id = $ticketId
  AND status = 'ISSUED'
  AND expires_at > NOW()
RETURNING id;

If zero rows are returned:

The state changed after validation.

Most likely:
→ another concurrent entry won.

Rollback current operation and determine current durable state.

For the normal concurrent-entry case:

REJECT
TICKET_ALREADY_IN_JOURNEY

Continue only if the Ticket update succeeded.

INSERT INTO journeys (
  id,
  ticket_id,
  user_id,
  entry_station_id,
  entry_gate_id,
  status,
  entered_at,
  expires_at
)
VALUES (
  $journeyId,
  $ticketId,
  $userId,
  $entryStationId,
  $entryGateId,
  'ACTIVE',
  NOW(),
  NOW() + INTERVAL '150 minutes'
);

Existing database invariant:

uq_journeys_ticket_id

ensures one Journey per Ticket.

Then:

INSERT INTO gate_events (
  id,
  gate_id,
  station_id,
  ticket_id,
  event_type,
  rejection_reason,
  request_id,
  occurred_at,
  created_at
)
VALUES (
  $eventId,
  $gateId,
  $stationId,
  $ticketId,
  'ENTRY_ACCEPTED',
  NULL,
  $requestId,
  NOW(),
  NOW()
);

COMMIT;

Final state:

Ticket
ISSUED → IN_JOURNEY

Journey
none → ACTIVE

GateEvent
ENTRY_ACCEPTED

These three effects commit together.

9. Entry REJECT

A normal business rejection does not mutate Ticket or Journey state.

Example:

WRONG_ORIGIN
TICKET_EXPIRED
TICKET_ALREADY_IN_JOURNEY

Core records:

INSERT INTO gate_events (
  id,
  gate_id,
  station_id,
  ticket_id,
  event_type,
  rejection_reason,
  request_id,
  occurred_at,
  created_at
)
VALUES (
  $eventId,
  $gateId,
  $stationId,
  $ticketId,
  'ENTRY_REJECTED',
  $reason,
  $requestId,
  NOW(),
  NOW()
);

For:

TICKET_NOT_FOUND

ticket_id may be NULL.

The Gate itself has already been resolved, so:

gate_id    NOT NULL
station_id NOT NULL

remain available.

10. V1 Exit Scope Decision

Earlier MetroFlow requirements allowed:

early exit before destination
→ ALLOW
→ no refund

Sprint A deliberately simplifies this behavior for V1.

V1 Rule

A passenger may exit only at the station purchased as the Ticket destination.

gate.station_id == ticket.destination_station_id
→ ALLOW

gate.station_id != ticket.destination_station_id
→ WRONG_DESTINATION

Example:

Purchased journey:

A → D

V1:

Exit A → REJECT WRONG_DESTINATION
Exit B → REJECT WRONG_DESTINATION
Exit C → REJECT WRONG_DESTINATION
Exit D → ALLOW
Exit E → REJECT WRONG_DESTINATION

MetroFlow V1 therefore does not need to distinguish:

early station
vs
beyond-destination station

because both are invalid V1 exits.

Route-order/topology-aware exit behavior is deferred to V2.

Cross-Document Rule

This Sprint A decision supersedes the earlier V1 requirement that permitted early exit.

The earlier requirement/business-rule documentation must therefore be amended so it no longer states that early exit is supported in V1.

V2 backlog:

Route topology
Station ordering
Early exit support
Beyond-destination detection
Potential future fare adjustment rules

No V1 refund behavior is introduced.

11. Exit Validation

After resolving the Gate, Core evaluates exit rules in this exact order.

First failure wins.

1. Gate.type = EXIT
   → else VALIDATION_ERROR

2. Gate.status = ACTIVE
   → else GATE_INACTIVE

3. Ticket exists
   → else TICKET_NOT_FOUND

4. Active Journey exists for Ticket
   → else NO_ACTIVE_JOURNEY

5. Journey timeout

   NOW() >= journey.expires_at
   → JOURNEY_TIMED_OUT

   NOW() < journey.expires_at
   → continue

6. Destination validation

   gate.station_id == ticket.destination_station_id
   → ALLOW

   otherwise
   → WRONG_DESTINATION

Journey timeout correctness never depends on whether the background worker has already changed its stored status.

The timestamp itself is authoritative.

12. Exit ALLOW Transaction

Successful exit requires Ticket and Journey completion to happen atomically.

BEGIN;

First transition the Ticket:

UPDATE tickets
SET
  status = 'COMPLETED',
  updated_at = NOW()
WHERE id = $ticketId
  AND status = 'IN_JOURNEY'
RETURNING id;

Zero rows:

Ticket is no longer in the expected state.

Rollback.
Do not continue Journey mutation.

Then transition the active Journey:

UPDATE journeys
SET
  status = 'COMPLETED',
  exit_station_id = $exitStationId,
  exit_gate_id = $exitGateId,
  exited_at = NOW(),
  updated_at = NOW()
WHERE ticket_id = $ticketId
  AND status = 'ACTIVE'
  AND expires_at > NOW()
RETURNING id;

Zero rows:

No active, unexpired Journey exists.

ROLLBACK the entire transaction.

Never commit:

Ticket  = COMPLETED
Journey = ACTIVE

Then insert the accepted GateEvent:

INSERT INTO gate_events (
  id,
  gate_id,
  station_id,
  ticket_id,
  event_type,
  rejection_reason,
  request_id,
  occurred_at,
  created_at
)
VALUES (
  $eventId,
  $gateId,
  $stationId,
  $ticketId,
  'EXIT_ACCEPTED',
  NULL,
  $requestId,
  NOW(),
  NOW()
);

Commit:

COMMIT;

Final state:

Ticket
IN_JOURNEY → COMPLETED

Journey
ACTIVE → COMPLETED

GateEvent
EXIT_ACCEPTED

All three durable effects commit together.

13. Exit REJECT

Exit rejection leaves Ticket and Journey unchanged.

Core records:

INSERT INTO gate_events (
  id,
  gate_id,
  station_id,
  ticket_id,
  event_type,
  rejection_reason,
  request_id,
  occurred_at,
  created_at
)
VALUES (
  $eventId,
  $gateId,
  $stationId,
  $ticketId,
  'EXIT_REJECTED',
  $reason,
  $requestId,
  NOW(),
  NOW()
);

Possible V1 business rejection reasons include:

TICKET_NOT_FOUND
NO_ACTIVE_JOURNEY
JOURNEY_TIMED_OUT
WRONG_DESTINATION
GATE_INACTIVE
14. Journey Timeout

Maximum active Journey duration:

2.5 hours
150 minutes

journeys.expires_at is calculated when entry succeeds:

expires_at = entered_at + 150 minutes

Authoritative validation rule:

NOW() >= journey.expires_at
→ JOURNEY_TIMED_OUT

NOW() < journey.expires_at
→ Journey is still valid

The equality boundary is therefore explicitly timed out.

Background Cleanup

The Background Worker eventually synchronizes stale ACTIVE rows:

UPDATE journeys
SET
  status = 'TIMED_OUT',
  timed_out_at = NOW(),
  updated_at = NOW()
WHERE status = 'ACTIVE'
  AND expires_at <= NOW();

This is a cleanup/reconciliation job.

It is not the source of correctness.

Example:

Journey expires at 12:30:00

Worker has not run yet
Database still says ACTIVE

Passenger scans exit at 12:31:00
        ↓
Core checks expires_at directly
        ↓
JOURNEY_TIMED_OUT

Correctness therefore does not depend on worker scheduling.

15. Concurrent Entry Scans

Example:

Ticket X = ISSUED

Gate A scan → 10:35:00.001
Gate B scan → 10:35:00.002

Both may initially read:

Ticket = ISSUED

Both eventually execute:

UPDATE tickets
SET status = 'IN_JOURNEY'
WHERE id = $ticketId
  AND status = 'ISSUED'
RETURNING id;

PostgreSQL serialization at the row prevents both transitions.

Result:

Gate A
→ 1 row updated
→ creates Journey
→ ENTRY_ACCEPTED

Gate B
→ after Gate A commits, condition status='ISSUED' no longer matches
→ 0 rows updated
→ REJECT TICKET_ALREADY_IN_JOURNEY

Final invariant:

1 Ticket
1 Journey
1 successful entry

No application-level distributed lock is required.

The database is the concurrency authority.

16. Concurrent Exit Scans

The same principle applies at exit.

Two gates may attempt to complete the same Journey.

Both execute:

UPDATE tickets
SET status = 'COMPLETED'
WHERE id = $ticketId
  AND status = 'IN_JOURNEY'
RETURNING id;

Only one request can transition the Ticket successfully.

The other request observes zero rows after the winning transaction commits.

Therefore:

At most one fresh exit operation completes a Ticket.

Ticket and Journey completion remain inside the same transaction.

17. Concurrent Requests With the Same Idempotency-Key

Separate from ticket concurrency, two identical retries may arrive at Core simultaneously:

Request K1
Request K1

Both may initially observe:

gate_events.request_id = K1
→ not found

The unique database constraint is the final authority:

CREATE UNIQUE INDEX uq_gate_events_request_id
ON gate_events (request_id)
WHERE request_id IS NOT NULL;

If one transaction commits first:

Request A
→ commits GateEvent K1

the second transaction cannot commit another GateEvent using K1.

If the second transaction encounters the unique conflict:

ROLLBACK its transaction
        ↓
reload gate_events.request_id = K1
        ↓
reconstruct committed result
        ↓
return same business outcome

It must not return an arbitrary new business result caused by the losing concurrent attempt.

18. Network Timeout / Ambiguous Result

Example:

Gate Simulator
    ↓
send request K1
    ↓
Core commits ALLOW
    ↓
response is lost
    ↓
Gate Simulator sees timeout

The client does not know whether the operation committed.

It retries:

same Idempotency-Key: K1
Case A — Redis Still Has Result
Gate Service
→ Redis HIT
→ return cached result
→ no Core call
Case B — Redis Does Not Have Result

Possible reasons:

Gate Service crashed before caching
Redis restarted
TTL expired
cache was evicted

Gate Service calls Core again using:

requestId = K1

Core checks:

SELECT *
FROM gate_events
WHERE request_id = $requestId
LIMIT 1;
Existing ACCEPTED event

Core:

load GateEvent
load referenced Ticket
load referenced Journey
reconstruct ALLOW response

Core does not execute the transition again.

Existing REJECTED event

Core:

load GateEvent
read rejection_reason
reconstruct REJECT response

Core does not re-evaluate the business operation as a new scan.

No GateEvent
No durable commit exists for K1
→ process request normally

This gives MetroFlow a simple rule:

GateEvent exists
→ operation committed

GateEvent absent
→ no committed gate operation exists for that requestId
19. GateEvent Audit Model

GateEvents are immutable audit records.

For every business gate interaction associated with a valid resolved Gate:

ALLOW  → GateEvent
REJECT → GateEvent

Fields:

id
  UUID v7

gate_id
  valid Gate FK

station_id
  station snapshot derived from Gate

ticket_id
  Ticket UUID when known
  NULL when Ticket lookup fails

event_type
  ENTRY_ACCEPTED
  ENTRY_REJECTED
  EXIT_ACCEPTED
  EXIT_REJECTED

rejection_reason
  NULL for ACCEPTED
  machine-readable reason for REJECTED

request_id
  Idempotency-Key

occurred_at
  business event time

created_at
  persistence timestamp

GateEvents are:

INSERT only
Never UPDATE
Never DELETE

The database uniquely constrains:

request_id

for durable request idempotency.

20. Canonical V1 Gate Rejection Reasons

Use the existing canonical values.

TICKET_NOT_FOUND
TICKET_EXPIRED
TICKET_COMPLETED
TICKET_ALREADY_IN_JOURNEY
WRONG_ORIGIN
WRONG_DESTINATION
NO_ACTIVE_JOURNEY
JOURNEY_TIMED_OUT
GATE_INACTIVE

Do not introduce aliases such as:

WRONG_ENTRY_STATION
WRONG_EXIT_STATION
TICKET_ALREADY_USED

Use:

WRONG_ORIGIN
WRONG_DESTINATION
TICKET_COMPLETED

consistently across:

database enums,
shared contracts,
APIs,
GateEvents,
tests,
logs.
21. Business Outcome vs System Error

Gate business decisions:

ALLOW
REJECT

both return:

HTTP 200

Example REJECT:

{
  "decision": "REJECT",
  "rejectionCode": "WRONG_DESTINATION",
  "message": "This ticket is not valid for exit at this station."
}

System/request failures use HTTP errors.

Examples:

Missing Gate API key
→ 401 UNAUTHORIZED

Invalid Gate API key
→ 401 UNAUTHORIZED

Missing/invalid request fields
→ 400 VALIDATION_ERROR

Unknown gateId
→ 400 VALIDATION_ERROR

Missing Idempotency-Key
→ 400 VALIDATION_ERROR

Rate limit exceeded
→ 429

Core unavailable
→ 503 SERVICE_TEMPORARILY_UNAVAILABLE

These are not GateEvent ALLOW/REJECT business outcomes unless a valid Gate has already been resolved and business validation has started.

22. Gate Service Responsibilities

Gate Service owns the gate-facing infrastructure boundary.

It performs:

Gate API-key authentication
Redis idempotency fast-path lookup
Rate limiting
Request validation
Forwarding to Core
Timeout/error translation
Redis result caching

It does not own metro business decisions.

23. What Gate Service Does NOT Do

Gate Service:

does not read Core PostgreSQL

does not write Core PostgreSQL

does not change Ticket status

does not create Journey records

does not complete Journey records

does not create GateEvents

does not evaluate origin station

does not evaluate destination station

does not evaluate Journey timeout

does not decide whether Ticket is usable

does not understand detailed
ISSUED / IN_JOURNEY / COMPLETED transitions

These belong to Core.

Responsibility boundary:

Gate Service
      ↓
transport/security/fast-path infrastructure

Core API
      ↓
authoritative metro business logic

PostgreSQL
      ↓
authoritative durable state/concurrency
24. Failure Principles

Sprint A locks the following principles.

Redis unavailable

Redis is not the authoritative gate state store.

Detailed Redis outage behavior is finalized in Sprint B, but Gate correctness must not depend on cached state.

Gate Service crashes after Core commits

Retry with the same Idempotency-Key.

Core finds the existing GateEvent and reconstructs the committed result.

Core crashes before transaction commit

No Ticket/Journey/GateEvent transition is committed.

Retry may safely process the request.

Core crashes after transaction commit but before response

GateEvent exists.

Retry reconstructs the committed result.

Two gates scan the same Ticket

Conditional PostgreSQL updates determine the winner.

Two requests use the same Idempotency-Key

uq_gate_events_request_id determines the single committed request result.

25. V1 Gate Invariants

Implementation must preserve:

1. A Ticket may enter at most once.

2. A Ticket may have at most one Journey.

3. Entry is allowed only at ticket.origin_station_id.

4. V1 exit is allowed only at ticket.destination_station_id.

5. One successful entry:
   Ticket ISSUED → IN_JOURNEY
   Journey none → ACTIVE

6. One successful exit:
   Ticket IN_JOURNEY → COMPLETED
   Journey ACTIVE → COMPLETED

7. Ticket/Journey successful transitions and their GateEvent
   are committed atomically.

8. Journey timeout is authoritative from journeys.expires_at.

9. Redis is never the durable idempotency authority.

10. One Idempotency-Key produces at most one committed GateEvent.

11. Gate Service owns no metro business data.

12. The browser never receives the Gate API key.
26. Required Cross-Document Amendments

Sprint A introduces two small consistency amendments to earlier locked documentation.

Amendment A — Gate Idempotency

Phase 3.2:

Replace:

CREATE INDEX idx_gate_events_request_id
  ON gate_events (request_id)
  WHERE request_id IS NOT NULL;

with:

CREATE UNIQUE INDEX uq_gate_events_request_id
  ON gate_events (request_id)
  WHERE request_id IS NOT NULL;

Add:

DB-044:
gate_events.request_id is uniquely constrained to guarantee
durable gate-request idempotency, including concurrent requests
using the same Idempotency-Key.
Amendment B — Early Exit

Earlier requirements stated:

Early exit before purchased destination is allowed in V1.

That rule is superseded.

MetroFlow V1 now uses:

Exit only at purchased destination.
Any other station → WRONG_DESTINATION.

Early-exit and topology-aware destination handling move to V2.

Update earlier requirement/business-rule documents accordingly so there is no contradiction.

Sprint A — Definition of Done

A developer can now answer:

 How does the Gate Simulator communicate with the backend?
→ Browser → BFF → Gateway → Gate Service → Core.
 Where is the Gate API key stored?
→ Server-side BFF and Gate Service only.
 Does the browser know the Gate API key?
→ No.
 Who evaluates Ticket/Journey business rules?
→ Core.
 Does Gate Service access Core PostgreSQL?
→ No.
 What is Redis used for?
→ Fast-path idempotency and rate limiting.
 Is Redis the idempotency authority?
→ No.
 What provides durable idempotency?
→ Unique gate_events.request_id.
 What happens when Redis loses a cached response?
→ Core reconstructs the committed result from durable state.
 What happens if the same request reaches Core concurrently?
→ Unique request_id constraint allows only one committed GateEvent.
 Where may a Ticket enter?
→ Only ticket.origin_station_id.
 Where may a Ticket exit in V1?
→ Only ticket.destination_station_id.
 Is early exit supported in V1?
→ No; deferred to V2.
 What happens on successful entry?
→ Ticket becomes IN_JOURNEY, Journey becomes ACTIVE, ENTRY_ACCEPTED is recorded atomically.
 What happens on successful exit?
→ Ticket becomes COMPLETED, Journey becomes COMPLETED, EXIT_ACCEPTED is recorded atomically.
 How are simultaneous scans handled?
→ Conditional PostgreSQL updates and constraints.
 How is the 2.5-hour rule enforced?
→ NOW() >= journey.expires_at is timed out.
 Does Worker timing determine timeout correctness?
→ No.
 What happens after an ambiguous network timeout?
→ Retry with the same Idempotency-Key.
 Does an unresolved/unknown Gate produce a GateEvent?
→ No.
 Are GateEvents mutable?
→ No.
Sprint A Status
Gate Service & Gate Flow Design
✅ APPROVED — V1 LOCKED

Do not reopen Sprint A during normal implementation.

Implementation discoveries that do not affect:

security
database correctness
business invariants
public/internal contracts
distributed consistency

should be handled as normal implementation decisions rather than new architecture work.
