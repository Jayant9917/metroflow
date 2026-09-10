# MetroFlow — Phase 0 Domain Discovery

> **Document:** `domain/00-phase0-domain-discovery.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 0 — Discovery & Domain Understanding
> **Status:** COMPLETE / APPROVED
> **Document Type:** Domain Discovery

---

## 1. Phase Objective

Phase 0 establishes a thorough understanding of the MetroFlow domain **before any technology, architecture, or implementation decisions are made**.

The objective is to answer:

```
What does this system do?
Who interacts with it?
What are its boundaries?
What are its core domain concepts?
What are the rules that govern those concepts?
What can go wrong?
What is explicitly not the system's responsibility?
```

Phase 0 produces a shared understanding of the problem domain that drives all subsequent phases. Business requirements — not technology choices — define what needs to be built.

**Phase 0 does NOT produce:**

```
Database schemas
API endpoints
Framework selection
Programming language selection
Cloud architecture
```

Those decisions belong to later phases, driven by the requirements that emerge here.

---

## 2. System Boundary

### 2.1 In Scope

MetroFlow is exclusively a **fare collection and ticket management platform**. The following domain concepts are inside the system boundary:

```
Stations
Gates (entry and exit)
Fare rules
Fare calculation
Fare quotes
Purchases / Orders
Payments
Ticket issuance
Digital tickets and QR identifiers
Ticket lifecycle management
Entry gate validation
Exit gate validation
Journey lifecycle
Gate events and audit trail
Ticket expiry
Active journey duration enforcement
Payment/ticket consistency management
Failure recovery concepts
Administrative visibility
Transaction and payment history
```

### 2.2 Out of Scope

MetroFlow does **not** manage:

```
Train movement or location
Train scheduling or tracking
Train signalling (ATP, ATO, CBTC)
Platform safety systems
Power distribution or SCADA
Train maintenance
Physical metro infrastructure
Track management or switching
Train drivers

UPI infrastructure
NPCI infrastructure
Banking networks
Card network infrastructure
Real Delhi Metro internal APIs
```

MetroFlow models the software boundary. It does not attempt to replicate the full transport operating system.

### 2.3 Hardware Boundary

MetroFlow is a **software engineering project**. Physical fare collection hardware is explicitly outside scope:

```
Outside:                        Inside:
─────────────────────           ─────────────────────
Physical token / card           Digital ticket / identifier
Physical RFID/NFC reader        Gate simulator (software)
Physical turnstile              AFC validation engine
Physical gate hardware          ALLOW / REJECT decision
```

Conceptually, a real metro system processes:

```
Physical Ticket / Card
        ↓
Physical Reader
        ↓
Fare Media Identifier
        ↓
AFC Software
```

MetroFlow begins at the software boundary:

```
Digital Ticket / Identifier
        ↓
Gate Simulator (software)
        ↓
AFC Validation Engine
        ↓
ALLOW / REJECT
```

### 2.4 External Systems

MetroFlow interfaces with the following external systems conceptually:

| External System | Role | V1 Approach |
|---|---|---|
| Payment Provider | Processes passenger payments and confirms success/failure | Simulated mock provider |
| Gate Hardware | Presents tickets at entry/exit points | Software gate simulator |

MetroFlow does not build the payment network itself. It sends payment initiation requests and receives payment outcome notifications through a defined interface.

---

## 3. Actors

### 3.1 Passenger

The primary end user of the MetroFlow platform.

**Responsibilities:**
- Select origin and destination stations
- Request a fare quote
- Initiate and complete purchase and payment
- Present digital ticket at entry gate
- Travel within the metro network
- Present digital ticket at exit gate

**Does NOT:**
- Determine the authoritative fare
- Control ticket state
- Control journey state
- Directly modify any system record

---

### 3.2 Entry Gate

Represents the software boundary at a station's entry point.

**Responsibilities:**
- Receive a ticket identifier presented by a passenger
- Submit an entry validation request to the AFC system
- Receive an ALLOW or REJECT decision
- Record that a gate interaction occurred (via gate event)

**Does NOT:**
- Evaluate business rules itself
- Modify ticket or journey state directly
- Operate without connectivity to the AFC backend (offline operation is out of V1 scope)

---

### 3.3 Exit Gate

Represents the software boundary at a station's exit point.

**Responsibilities:**
- Receive a ticket identifier presented by a passenger
- Submit an exit validation request to the AFC system
- Receive an ALLOW or REJECT decision
- Record that a gate interaction occurred (via gate event)

**Does NOT:**
- Evaluate business rules itself
- Modify ticket or journey state directly

---

### 3.4 Payment Provider

The external financial system that processes fare payments.

**Responsibilities:**
- Receive payment initiation requests from MetroFlow
- Process the financial transaction
- Notify MetroFlow of payment success or failure
- Provide a provider-side transaction reference

**Does NOT:**
- Issue tickets
- Manage journey state
- Know anything about metro domain concepts

In V1, the Payment Provider is replaced by a **simulated mock** that can trigger success and failure outcomes on demand.

---

### 3.5 Admin

Admin is an authorized internal actor with visibility into operational AFC information.

**Responsibilities:**
- View stations, gates, gate status, tickets, journeys, payments, and gate events
- View rejected interactions and problem transactions
- Identify system inconsistencies, such as payment success without ticket issuance

Exact Admin mutation permissions are not defined in Phase 0. Whether Admin can change fares, refund payments, invalidate tickets, close journeys, or activate/deactivate gates is deferred to Phase 1: V1 Requirements & Scope Definition.

---

### 3.6 Background Process

Some MetroFlow business rules are time-dependent and may require system-driven processing or validation without direct human interaction.

Examples include:
- Fare Quote expiry
- Ticket validity
- Maximum Journey duration
- Payment recovery and consistency checks

The exact enforcement mechanism — such as a scheduler, queue, background worker, validation-on-read, or database job — is deferred to later design. Phase 0 does not require a particular implementation.

---

## 4. Ticket Lifecycle

### Definition

A **Ticket** represents:

> A digital travel entitlement issued after successful payment that permits one passenger to travel from a specified origin station to a specified destination station, subject to defined validity rules.

A Ticket represents **permission to travel**. It is distinct from the Journey, which represents **actual travel**.

---

### States

```
ISSUED
  │
  ├──→ IN_JOURNEY
  │         │
  │         └──→ COMPLETED
  │
  └──→ EXPIRED
```

| State | Meaning |
|---|---|
| `ISSUED` | Ticket has been created after confirmed payment. Passenger has not yet entered. |
| `IN_JOURNEY` | Passenger has successfully passed entry gate. Journey is active. |
| `COMPLETED` | Passenger has successfully exited. Journey is complete. Ticket is consumed. |
| `EXPIRED` | Ticket validity window elapsed before first entry. Ticket is unusable. |

---

### Transitions

| From | Event | To |
|---|---|---|
| *(none)* | Payment confirmed | `ISSUED` |
| `ISSUED` | Successful entry gate validation | `IN_JOURNEY` |
| `ISSUED` | Validity window expires before entry | `EXPIRED` |
| `IN_JOURNEY` | Successful exit gate validation | `COMPLETED` |

---

### Business Rules

- A ticket is only issued after **confirmed payment success**.
- A ticket has a **validity window** before first entry (exact duration to be specified in design).
- An `EXPIRED` ticket cannot transition to `IN_JOURNEY`.
- A `COMPLETED` ticket cannot be reused — it is permanently consumed.
- A single ticket represents a **single journey** — at most one Journey is created per Ticket.
- Ticket state is **separate from payment state**. Payment states must not appear in the Ticket lifecycle.

---

### Invalid Transitions

| Attempt | Reason Rejected |
|---|---|
| `EXPIRED` → `IN_JOURNEY` | Ticket validity has lapsed |
| `COMPLETED` → `IN_JOURNEY` | Ticket already consumed |
| `IN_JOURNEY` → `IN_JOURNEY` | Active journey already exists |
| `ISSUED` → `COMPLETED` | Cannot complete without active journey |

---

## 5. Fare System

### Fare Authority

The backend is the **sole authority** for fare calculation. Clients must never supply or influence the fare amount. The system derives fare from stored fare rules.

Example of what must be rejected:

```json
{
  "origin": "RAJIV_CHOWK",
  "destination": "HAUZ_KHAS",
  "fare": 1
}
```

The `fare` field from a client request is ignored. The system looks up the authoritative fare rule.

---

### Fare Calculation

```
Origin Station
      +
Destination Station
      ↓
Fare Engine
      ↓
Applicable Fare Rule
      ↓
Authoritative Fare Amount
```

- Fare rules are stored in the system — not hardcoded in application logic.
- The same origin and destination is an invalid journey request and must be rejected before fare calculation.

---

### Fare Quote

A **Fare Quote** is the system's response to a fare calculation request, before any purchase is made.

```
Passenger selects Origin + Destination
            ↓
Fare Engine runs
            ↓
Fare Quote issued:
  - Origin
  - Destination
  - Authoritative fare amount
  - Quote validity timestamp
            ↓
Passenger proceeds to purchase
```

A Fare Quote has a **10-minute validity window**.

Conceptually:

```
Fare Quote CREATED
      ↓
10-minute validity window
      ↓
If Purchase/Payment not initiated
      ↓
EXPIRED
```

After expiry, the passenger selects the origin and destination again and receives a new quote. An expired Fare Quote cannot start a new Purchase.

Fare Quote expiry does **not** invalidate a Purchase for which Payment has already been initiated. For example:

```
10:00  Fare Quote created
10:08  Payment initiated
10:09  Money deducted
10:10  Fare Quote validity ends / page refreshes
10:11  Payment SUCCESS confirmed

        Purchase remains valid
        Ticket can still be issued
```

---

### Historical Fare

Once a passenger pays a fare, that payment record preserves the **historical fare at time of purchase**. If fare rules are later updated, historical payment and ticket records must not change.

```
Passenger paid: ₹40 on Jan 1
Fare updated to: ₹50 on Feb 1

Historical ticket/payment still shows: ₹40  ✓
```

---

### Rules

- Clients cannot determine authoritative fare.
- Fare Quotes are valid for 10 minutes.
- Purchases must reference a valid, unexpired fare quote.
- Fare Quote expiry does not invalidate a Payment already initiated for a valid Purchase.
- The purchase amount is derived from the fare quote — never from the client request.
- Historical paid fares are immutable.

---

## 6. Gate Lifecycle

### Gate Operational State

Gates have two operational states:

```
ACTIVE
INACTIVE
```

Only an `ACTIVE` Gate can participate in normal ticket validation. An `INACTIVE` Gate cannot process normal ticket validation and must return `GATE_INACTIVE`.

Who may change a Gate between `ACTIVE` and `INACTIVE`, and whether this is managed through the Admin experience, is deferred to Phase 1.

### Entry Gate

```
Passenger presents ticket identifier
            ↓
Entry Gate submits validation request
            ↓
AFC system evaluates business rules
            ↓
ALLOW or REJECT
```

**On ALLOW:**

```
Ticket:      ISSUED → IN_JOURNEY
Journey:     (none) → ACTIVE
Gate Event:  ENTRY_ACCEPTED recorded
```

**On REJECT:**

```
Ticket:      UNCHANGED
Journey:     UNCHANGED
Gate Event:  ENTRY_REJECTED recorded (with machine-readable reason)
```

---

### Exit Gate

```
Passenger presents ticket identifier
            ↓
Exit Gate submits validation request
            ↓
AFC system evaluates business rules
            ↓
ALLOW or REJECT
```

**On ALLOW:**

```
Ticket:      IN_JOURNEY → COMPLETED
Journey:     ACTIVE → COMPLETED
Gate Event:  EXIT_ACCEPTED recorded
```

**On REJECT:**

```
Ticket:      UNCHANGED
Journey:     UNCHANGED
Gate Event:  EXIT_REJECTED recorded (with machine-readable reason)
```

---

### Validation

The gate submits a validation interaction. MetroFlow evaluates the business rules and makes the ALLOW/REJECT decision. MetroFlow records the resulting Gate Event; the Gate client does not own the audit record.

---

### Rejections

All rejections must carry a **machine-readable reason code**. The reason is recorded in the gate event and returned in the API response.

Identified rejection reasons:

```
TICKET_NOT_FOUND          — No ticket found for the presented identifier
TICKET_EXPIRED            — Ticket validity window has elapsed
TICKET_COMPLETED          — Ticket has already been used for a completed journey
TICKET_ALREADY_IN_JOURNEY — Ticket is already associated with an active journey
WRONG_ORIGIN              — Entry gate station does not match ticket's origin station
WRONG_DESTINATION         — Exit gate station is beyond the ticket's purchased destination
NO_ACTIVE_JOURNEY         — No active journey found for this ticket at exit
JOURNEY_DURATION_EXCEEDED — Journey has exceeded the 2.5-hour maximum active duration
GATE_INACTIVE             — Gate is not in an operational state
```

---

### Gate Events

Every gate interaction — regardless of outcome — produces a **Gate Event** record.

Gate Event contains:

```
Gate ID
Station ID
Ticket identifier
Event type (ENTRY_ACCEPTED / ENTRY_REJECTED / EXIT_ACCEPTED / EXIT_REJECTED)
Timestamp
Outcome reason (rejection reason code or SUCCESS)
```

Gate Events are **immutable audit records**. They are never deleted. They provide the full interaction history for a ticket independent of the journey record.

Example audit trail:

```
10:30  ENTRY_REJECTED   WRONG_ORIGIN
10:35  ENTRY_ACCEPTED
10:36  ENTRY_REJECTED   TICKET_ALREADY_IN_JOURNEY
11:05  EXIT_ACCEPTED
```

---

## 7. Payment Lifecycle

### States

```
CREATED
   ↓
PENDING
   ↓
SUCCESS   or   FAILED
```

| State | Meaning |
|---|---|
| `CREATED` | Payment record initialised before provider interaction |
| `PENDING` | Payment request sent to provider; outcome not yet known |
| `SUCCESS` | Provider confirmed successful collection |
| `FAILED` | Authoritative payment failure has been established |

A communication or network timeout means that the payment outcome may be unknown; it does **not** automatically mean `FAILED`.

---

### Payment / Ticket Separation

Payment and Ticket are **separate domain concepts with separate lifecycles**.

```
Payment owns:    CREATED / PENDING / SUCCESS / FAILED
Ticket owns:     ISSUED / IN_JOURNEY / COMPLETED / EXPIRED
```

Payment states must **never appear** as Ticket states. A Ticket does not have a `PAYMENT_PENDING` or `PAYMENT_FAILED` status. These are entirely different domain objects.

```
Payment SUCCESS → Ticket ISSUED     ✓
Payment FAILED  → No usable Ticket  ✓
```

### Purchase and Payment Continuity

Browser state is not authoritative transaction state. Once the backend has created a Purchase, Payment, or Ticket, a browser refresh, browser close, frontend timeout, or temporary client disconnect must not delete or forget that record.

If a passenger returns while payment is still unresolved, the following is a valid domain state:

```
Purchase exists
Payment = PENDING
Ticket = NONE
```

The passenger must not be asked to pay again merely because the frontend did not receive the final result. The exact recovery and presentation experience is deferred to Phase 1.

Payment success after a refresh or browser close remains processable:

```
Payment initiated
      ↓
Browser refreshes or closes
      ↓
Provider later confirms SUCCESS
      ↓
MetroFlow processes SUCCESS
      ↓
Ticket issued and associated with Passenger/Purchase
      ↓
Passenger can retrieve Ticket later
```

---

### Duplicate Notifications

If the payment provider sends the same success notification more than once (a common distributed-systems scenario), the system must process it **idempotently**.

```
Payment SUCCESS notification #1 → Ticket issued       ✓
Payment SUCCESS notification #2 → Duplicate detected, no second ticket issued  ✓
```

---

### Partial Failure

The most critical payment failure scenario:

```
Payment SUCCESS confirmed
        ↓
Ticket issuance fails
```

This leaves:

```
Money collected  ✓
Ticket issued    ✗
```

The system must be able to detect this inconsistency. Recovery should first attempt to restore consistency. If Ticket issuance ultimately cannot be completed, the transaction becomes refund eligible. The exact refund and recovery mechanism is deferred to Phase 1.

---

### Recovery Concept

```
Payment SUCCESS
      ↓
Ticket issuance fails
      ↓
System detects inconsistency
      ↓
Recovery attempts to restore consistency
      ↓
If recovery ultimately fails: transaction becomes refund eligible
```

Payment records are **never deleted**. They form part of the permanent financial audit trail.

---

## 8. Journey Lifecycle

### Journey Definition

A **Journey** represents the passenger's actual travel activity:

> The record of a passenger physically entering the metro network, travelling, and exiting.

A Ticket grants **permission** to travel. A Journey records that travel **actually occurred**.

```
Ticket  = "Passenger is authorised to travel"
Journey = "Passenger actually travelled"
```

---

### ACTIVE

A Journey enters `ACTIVE` state only after **successful entry gate validation**. Ticket purchase, payment, or ticket issuance alone do not create a Journey.

```
Ticket exists      ✓ (valid state — passenger hasn't entered yet)
Journey exists     ✗
```

---

### COMPLETED

A Journey transitions to `COMPLETED` after successful exit gate validation.

```
Journey records:
  - Entry station
  - Entry timestamp
  - Exit station
  - Exit timestamp
```

---

### Maximum Active Duration

The maximum active Journey duration is **2.5 hours** from successful entry.

```
Entry at:       1:00 PM
Maximum active: 3:30 PM
After 3:30 PM:  Normal exit is no longer valid
```

Once 2.5 hours have elapsed, the passenger's normal travel entitlement is no longer valid. Normal exit using that Journey must be rejected with a machine-readable duration-exceeded reason. The exact state representation and technical enforcement mechanism are deferred to Phase 1 and system design.

---

### Early Exit

A passenger may exit at any station before their purchased destination.

```
Purchased:   Rajiv Chowk → Hauz Khas
Actual exit: New Delhi (intermediate station)

Outcome:
  Exit:    ALLOWED  ✓
  Refund:  NONE     ✓
```

The original fare has already been paid. Unused journey distance does not generate a refund.

### Destination Exit Outcomes

The three destination outcomes are:

```
Before purchased destination → ALLOW, no refund
At purchased destination     → ALLOW
Beyond purchased destination → REJECT, WRONG_DESTINATION
```

For example:

```
Purchased: A → C
Exit at:   D
Result:    REJECT
Reason:    WRONG_DESTINATION
```

---

## 9. Failure & Edge Cases

### Business Validation Failures

```
Same origin and destination selected
Invalid or unknown station codes
Fare rule not found for station pair
Expired fare quote used for purchase
Ticket identifier not found at gate
Entry at wrong station (WRONG_ORIGIN)
Exit beyond purchased destination (WRONG_DESTINATION)
Expired ticket presented at entry
Completed ticket reused at entry
Ticket already in journey (duplicate entry attempt)
Exit attempted without active journey
```

---

### Payment Failures

```
Payment provider returns FAILED
Payment outcome remains unknown after a communication timeout
Payment success notification is received after browser refresh or closure
Payment remains pending when the passenger returns
Payment success received after passenger has abandoned flow
Payment success + ticket issuance failure (partial failure)
```

---

### Concurrency

```
Two gates process the same ticket at the same moment:
  Gate A — ENTRY request
  Gate B — ENTRY request (same ticket)

Business invariant:
  At most one Journey must be created per Ticket.

Technical requirement:
  Concurrency protection must prevent duplicate journey creation.
  Strategy (locking, constraints, atomic update) to be decided during design.
```

---

### Idempotency

```
Gate sends entry request
Backend processes successfully
Response lost in transit
Gate retries the same request

Expected outcome:
  Second request returns the same valid result.
  No second journey is created.

Similarly:
  Payment provider sends SUCCESS notification twice.
  No second ticket is issued.
```

---

### Consistency

A single business operation may affect multiple domain records. The system must not leave these in a contradictory state.

Successful entry must atomically produce:

```
Ticket: ISSUED → IN_JOURNEY       ✓
Journey: created as ACTIVE         ✓
Gate Event: ENTRY_ACCEPTED         ✓
```

Partial outcome (e.g. journey created but ticket not updated) is a **consistency failure** and must be avoided through appropriate transaction strategy (to be defined in design).

---

### Infrastructure

```
Backend unavailable when gate submits request
Database unavailable mid-transaction
Gate loses connectivity mid-operation
System-driven time-dependent processing or validation fails
```

MetroFlow must not silently produce incorrect state due to infrastructure failure. Failure handling strategies will be specified per feature in design.

---

## 10. Domain Model

### Entities

| Entity | Purpose |
|---|---|
| **Station** | A metro station participating in fare collection |
| **Gate** | An entry or exit validation point belonging to a Station |
| **FareRule** | The authoritative price for a given origin-destination pair |
| **FareQuote** | A time-limited fare calculation result presented to the passenger before purchase |
| **Purchase** | The passenger's intention to acquire a specific journey at a quoted fare |
| **Payment** | The financial transaction associated with a Purchase |
| **Ticket** | The digital travel entitlement issued after confirmed payment |
| **Journey** | The record of actual travel between entry and exit |
| **GateEvent** | An immutable audit record of every gate interaction |

---

### Relationships

```
Station ──< Gate

Station ──< FareRule (as origin)
Station ──< FareRule (as destination)

FareQuote >── Station (origin)
FareQuote >── Station (destination)
FareQuote >── FareRule

Purchase >── FareQuote

Payment >── Purchase

Ticket >── Payment
Ticket >── Station (origin)
Ticket >── Station (destination)

Journey >── Ticket
Journey >── Station (entry station)
Journey >── Station (exit station)

GateEvent >── Gate
GateEvent >── Ticket
```

---

### Ownership

Each entity owns its own lifecycle. No entity borrows another entity's state to represent its own condition.

| Entity | Owns |
|---|---|
| Payment | `CREATED / PENDING / SUCCESS / FAILED` |
| Ticket | `ISSUED / IN_JOURNEY / COMPLETED / EXPIRED` |
| Journey | `ACTIVE / COMPLETED` plus a Phase 1 decision for over-duration representation |
| GateEvent | Immutable record — no lifecycle transitions |
| FareQuote | Valid for 10 minutes from creation — no explicit state field required |

---

## 11. Business Rules Register

| Rule ID | Rule |
|---|---|
| BR-001 | Origin and destination stations must be different for a valid journey request. |
| BR-002 | Fare must be calculated by the authoritative system. The client cannot supply or influence the fare amount. |
| BR-003 | A Fare Quote is valid for 10 minutes. |
| BR-004 | The purchase amount must be derived from the Fare Quote. It cannot be supplied by the client. |
| BR-005 | An expired Fare Quote cannot start a new Purchase. |
| BR-006 | Fare Quote expiry does not invalidate a Payment already initiated for a valid Purchase. |
| BR-007 | Browser refresh or closure does not cancel an existing Purchase or Payment. |
| BR-008 | A communication timeout does not automatically mean Payment `FAILED`; the outcome may be unknown. |
| BR-009 | A Ticket has a validity window before first entry. An ISSUED Ticket that exceeds this window transitions to EXPIRED. |
| BR-010 | A usable Ticket can only be issued after confirmed Payment `SUCCESS`. |
| BR-011 | Payment state and Ticket state are separate. Payment lifecycle states must not appear as Ticket states. |
| BR-012 | Duplicate Payment-success processing must not create duplicate Tickets. |
| BR-013 | An EXPIRED Ticket cannot start a Journey. Entry must be rejected with reason `TICKET_EXPIRED`. |
| BR-014 | A COMPLETED Ticket cannot be reused. Entry must be rejected with reason `TICKET_COMPLETED`. |
| BR-015 | A single-journey Ticket can create at most one Journey. |
| BR-016 | A Ticket that is already IN_JOURNEY cannot start another Journey. Entry must be rejected with reason `TICKET_ALREADY_IN_JOURNEY`. |
| BR-017 | A Journey is created only upon successful Entry gate validation. Purchase or payment alone does not create a Journey. |
| BR-018 | Successful Entry must atomically transition the Ticket to IN_JOURNEY, create an ACTIVE Journey, and record an ENTRY_ACCEPTED Gate Event. |
| BR-019 | Rejected Gate validation must not incorrectly modify Ticket or Journey state and must record a machine-readable reason. |
| BR-020 | Entry gate station must match the Ticket's origin station. Mismatch must be rejected with reason `WRONG_ORIGIN`. |
| BR-021 | Only ACTIVE Gates may process normal Ticket validation. INACTIVE Gates must reject with reason `GATE_INACTIVE`. |
| BR-022 | Concurrent Entry requests for the same Ticket must result in at most one successful Entry and at most one Journey created. |
| BR-023 | Duplicate gate requests (retried calls) must be handled idempotently. The same valid result is returned without creating duplicate records. |
| BR-024 | Successful Exit must atomically transition the Ticket to COMPLETED, transition the Journey to COMPLETED, and record an EXIT_ACCEPTED Gate Event. |
| BR-025 | Exit without an active Journey must be rejected with reason `NO_ACTIVE_JOURNEY`. |
| BR-026 | Early exit before the purchased destination is permitted and produces no refund. |
| BR-027 | Exit at the purchased destination is permitted. |
| BR-028 | Exit beyond the purchased destination must be rejected with reason `WRONG_DESTINATION`. |
| BR-029 | Maximum active Journey duration is 2.5 hours from successful entry. |
| BR-030 | A Journey exceeding its allowed duration cannot perform a normal successful exit; exact state representation and enforcement are deferred to Phase 1/design. |
| BR-031 | MetroFlow records accepted and rejected Gate Events, and Gate Events are immutable audit records. |
| BR-032 | Historical payment and ticket fare amounts must remain accurate even if fare rules are later changed. |
| BR-033 | General ticket refunds are not supported; if successful Payment ultimately cannot result in Ticket issuance, the transaction becomes refund eligible. |
| BR-034 | Payment success followed by Ticket issuance failure must be detectable and subject to consistency recovery. |
| BR-035 | The backend is authoritative for all business decisions. The client must not be trusted to determine fare, ticket status, journey status, or gate permission. |

---

## 12. Open Questions

The following questions are intentionally deferred to Phase 1: V1 Requirements & Scope Definition. They do not change the business decisions already made in Phase 0.

| # | Question | Impact |
|---|---|---|
| OQ-001 | What is the exact ticket validity window before first entry? | Ticket lifecycle |
| OQ-002 | What exact state representation is used after a Journey exceeds 2.5 hours? | Journey lifecycle |
| OQ-003 | What exact Admin mutation capabilities are included in V1? | Admin scope |
| OQ-004 | Can Admin activate and deactivate Gates, and through which experience? | Gate/Admin scope |
| OQ-005 | Should multiple Payment attempts for the same Purchase be allowed? | Payment lifecycle |
| OQ-006 | What is the exact Payment recovery workflow for an unknown or pending outcome? | Payment lifecycle/recovery |
| OQ-007 | What is the exact Gate Simulator experience and interaction contract? | Gate Simulator scope |

These questions must be answered and recorded during Phase 1 before the relevant feature enters implementation.

---

## 13. Explicit Non-Goals

The following are valid real-world metro system concerns that MetroFlow **explicitly does not pursue**:

```
Train movement, location, scheduling, tracking
Train signalling (CBTC, ATP, ATO)
Platform safety systems
Physical gate hardware or embedded systems
Offline gate operation (gate functions without backend connectivity)
UPI, NPCI, or real banking infrastructure
Real card network integration (V1 uses a mock payment provider)
Season passes, stored-value cards, or multi-journey tickets
Concession fares (senior, student, disability)
Automated refund disbursement
Automated payment-to-ticket recovery (background reconciliation)
Push notifications to passengers
Revenue analytics dashboards
Multi-city or multi-network fare systems
Real Delhi Metro internal APIs or proprietary systems
```

These non-goals are not design failures — they represent a deliberate, disciplined scope boundary for a solo engineering project.

---

## 14. Phase 0 Definition of Done

Phase 0 is complete when all of the following are true:

- [x] System boundary is explicitly defined (in scope and out of scope)
- [x] All major actors are identified and their responsibilities are recorded
- [x] Ticket lifecycle is fully understood: states, transitions, and business rules
- [x] Fare authority is established: calculation, quotes, and historical integrity
- [x] Gate lifecycle is fully understood: entry, exit, validation, rejections, and events
- [x] Payment lifecycle is fully understood: states, payment/ticket separation, partial failure
- [x] Journey lifecycle is understood: creation, active travel, maximum duration, and early exit
- [x] Major failure categories are identified and catalogued
- [x] Concurrency and idempotency are recognised as system requirements
- [x] Core domain entities are identified and their relationships documented
- [x] Business rules are recorded in a numbered register
- [x] Unresolved domain questions are explicitly documented
- [x] Non-goals are explicitly documented
- [x] The entire domain can be explained without reference to any specific technology
- [x] The project is ready to move to Phase 1: V1 Requirements & Scope Definition

---

## 15. Phase 0 Final Decisions

The following decisions were made and closed during Phase 0. They are not open for re-evaluation during implementation without a documented change.

| Decision | Outcome |
|---|---|
| Gate offline operation | Out of scope. Gates require backend connectivity. |
| Physical hardware | Out of scope. MetroFlow begins at the digital/software boundary. |
| Real payment provider | Out of V1 scope. A simulated mock provider is used. |
| Refund policy | No general refunds. Only payment-success / ticket-failure case is refund-eligible. |
| Early exit | Permitted. No refund issued. Original fare stands. |
| Maximum journey duration | 2.5 hours from successful entry. After that, normal exit is rejected; state representation and enforcement are deferred to Phase 1/design. |
| Ticket/Payment separation | Firm. Payment lifecycle and Ticket lifecycle are always separate. |
| Gate event immutability | Firm. Gate events are never deleted or modified. |
| Historical fare integrity | Firm. Historical payment and ticket amounts are never modified by future fare rule changes. |
| Client fare authority | Firm. The backend is the sole authority for fare calculation. Client-supplied fare amounts are ignored. |
| Journey creation trigger | Journey is created only on successful entry gate validation — never at purchase or payment time. |
| Fare Quote validity | Fare Quotes are valid for 10 minutes. Expiry does not invalidate an already-initiated Payment for a valid Purchase. |
| Gate operational state | Gates are ACTIVE or INACTIVE. Only ACTIVE Gates process normal ticket validation. |
| Payment timeout semantics | A communication timeout leaves the outcome unknown; it does not automatically make Payment FAILED. |
| Transaction continuity | Browser refresh, closure, frontend timeout, or temporary disconnect does not cancel backend Purchase, Payment, or Ticket records. |
| Beyond-destination exit | Exit before or at the purchased destination is allowed; exit beyond it is rejected with WRONG_DESTINATION. |
| Gate Event ownership | MetroFlow evaluates gate interactions and records the immutable Gate Event. The Gate client does not own the audit record. |
