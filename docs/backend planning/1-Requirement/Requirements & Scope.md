# MetroFlow — V1 Requirements & Scope

> **Document:** `requirements/v1-requirements.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 1 — V1 Requirements & Scope Definition
> **Status:** Draft
> **Goal:** Portfolio/Showcase Project

---

## 1. V1 Objective

MetroFlow V1 must demonstrate a **production-inspired metro fare collection platform** that is:

- Architecturally clean and explicitly documented
- Covering all core lifecycle paths (happy path + critical failures)
- Backed by automated tests
- Accessible through a REST API and a minimal passenger/admin UI

V1 is not a minimal prototype. It is a showcase of disciplined engineering practice — domain-driven design, explicit business rules, failure handling, and controlled scope — delivered by a single developer.

---

## 2. V1 Scope Philosophy

V1 includes a feature **only if**:

1. It is essential to the correctness of the core metro journey lifecycle, OR
2. It demonstrates a meaningful engineering decision (concurrency, idempotency, failure recovery), OR
3. It is required to make the system explainable end-to-end

Everything else moves to the V2/Backlog.

---

## 3. V1 In-Scope Features

### 3.1 Station & Gate Management

| # | Requirement |
|---|---|
| S1 | The system must store metro stations with a unique code and display name |
| S2 | Each station must have one or more gates |
| S3 | Each gate must have a type: `ENTRY` or `EXIT` |
| S4 | Each gate must have an operational status: `ACTIVE` or `INACTIVE` |
| S5 | Only `ACTIVE` gates may process ticket validations |
| S6 | Station and gate data is seeded — no passenger-facing station management UI required in V1 |

---

### 3.2 Fare Engine

| # | Requirement |
|---|---|
| F1 | The system must calculate authoritative fares based on origin and destination |
| F2 | Fare rules must be stored in the system — not hardcoded in application logic |
| F3 | The client must never supply the fare amount; the backend derives it from stored rules |
| F4 | Same origin and destination must be rejected as an invalid journey request |
| F5 | A fare quote must be returned before purchase begins |
| F6 | A fare quote must include: origin, destination, and the calculated amount |
| F7 | A fare quote must be valid for 10 minutes |
| F8 | Historical paid fares must remain accurate even if fare rules are later updated |

---

### 3.3 Purchase & Order

| # | Requirement |
|---|---|
| P1 | A passenger must create a purchase by referencing a valid fare quote |
| P2 | The system must derive the purchase amount from the fare quote — not from the client request |
| P3 | A purchase record must be created before payment is initiated |
| P4 | A purchase must be associated with a specific origin and destination |
| P5 | A Purchase may have multiple Payment attempts if earlier attempts fail |
| P6 | Failed Payment attempts remain associated with the same Purchase for audit history |
| P7 | Only one Payment may successfully fulfill a Purchase |
| P8 | Once a Purchase has a successful Payment, no additional Payment attempt may be initiated for that Purchase |

A Purchase remains valid when Payment has already been initiated, even if the Fare Quote subsequently expires. Browser refresh, browser closure, frontend timeout, or temporary client disconnect must not cancel an existing Purchase or Payment. A communication timeout leaves Payment outcome unknown; it does not automatically make Payment `FAILED`. A later `SUCCESS` notification must still be processed and the issued Ticket must remain retrievable by the passenger.

---

### 3.4 Payment (Razorpay Test Mode)

| # | Requirement |
|---|---|
| PY1 | V1 must integrate Razorpay as the payment provider using Razorpay Test Mode |
| PY2 | V1 must not process real money or use Razorpay Live Mode |
| PY3 | Payment lifecycle states: `CREATED → PENDING → SUCCESS` or `CREATED → PENDING → FAILED` |
| PY4 | Ticket issuance must occur only after authoritative payment success has been verified by the backend |
| PY5 | The frontend must never be treated as the authoritative source of payment success |
| PY6 | Duplicate payment-success processing must not create duplicate Tickets |
| PY7 | Payment and Ticket must remain separate domain entities |
| PY8 | A Payment record must retain the external Razorpay payment/order reference required for reconciliation and debugging |
| PY9 | A communication timeout or missing frontend response must not automatically transition a Payment to `FAILED` |
| PY10 | A Payment may be marked `FAILED` only when an authoritative failure outcome has been established |
| PY11 | MetroFlow must continue tracking an initiated Payment even if the passenger refreshes, closes, or leaves the page |
| PY12 | If Payment `SUCCESS` is confirmed after the passenger leaves the purchase page, Ticket issuance must still occur |
| PY13 | Multiple failed Payment attempts may exist for the same Purchase |
| PY14 | At most one Payment associated with a Purchase may successfully fulfill that Purchase |
| PY15 | Once a Purchase has been successfully paid, further Payment attempts for that Purchase must be rejected |

V1 uses Razorpay Test Mode to build and verify the complete payment architecture without processing real money. Razorpay Live Mode, KYC, settlement, and controlled real payments are optional future operational evolution and must not require rewriting MetroFlow's core payment domain.

The Razorpay SDK package, webhook endpoint URL, webhook signature algorithm, API key storage, order-creation API structure, database columns, and retry implementation are deferred to Phase 2 architecture/design.

---

### 3.5 Ticket Issuance

| # | Requirement |
|---|---|
| T1 | A ticket may only be issued after confirmed payment success |
| T2 | Each ticket must be associated with exactly one purchase and one payment |
| T3 | Each ticket must record: origin station, destination station, paid fare amount, issue timestamp, and validity expiry |
| T4 | Each ticket must have a unique digital identifier suitable for QR representation |
| T5 | Ticket lifecycle states: `ISSUED → IN_JOURNEY → COMPLETED` and `ISSUED → EXPIRED` |
| T6 | An unused `ISSUED` ticket remains valid until the end of the metro service day in which it was issued |
| T7 | At the end of that service day, an unused `ISSUED` ticket becomes `EXPIRED` and must not permit entry |
| T8 | A `COMPLETED` ticket must not be reused |
| T9 | An `EXPIRED` ticket must not permit entry |
| T10 | If payment succeeds but ticket issuance fails, the system must detect and flag this inconsistency for recovery |
| T11 | V1 recovery behavior: flag inconsistent payment-without-ticket records; manual review is acceptable in V1 (automated recovery is V2) |

---

### 3.6 Entry Gate Validation

| # | Requirement |
|---|---|
| EG1 | Entry gate validation receives: gate ID and ticket identifier |
| EG2 | Entry must be rejected if the ticket is not found |
| EG3 | Entry must be rejected if the ticket is `EXPIRED` |
| EG4 | Entry must be rejected if the ticket is `IN_JOURNEY` (already active) |
| EG5 | Entry must be rejected if the ticket is `COMPLETED` |
| EG6 | Entry must be rejected if the presenting gate's station does not match the ticket's origin station |
| EG7 | Entry must be rejected if the gate is `INACTIVE` |
| EG8 | Successful entry must: transition ticket to `IN_JOURNEY`, create an `ACTIVE` journey, record an `ENTRY_ACCEPTED` gate event |
| EG9 | Rejected entry must: leave ticket and journey state unchanged, record an `ENTRY_REJECTED` gate event with a machine-readable reason |
| EG10 | Concurrent entry requests for the same ticket must result in at most one successful entry (concurrency protection required) |
| EG11 | Duplicate entry requests (retried gate call) must be handled idempotently — the same valid result is returned without creating a second journey |

---

### 3.7 Journey Lifecycle

| # | Requirement |
|---|---|
| J1 | A journey is created only upon successful entry validation — never at purchase or payment time |
| J2 | Journey lifecycle states: `ACTIVE → COMPLETED` or `ACTIVE → TIMED_OUT` |
| J3 | Each journey must record: ticket reference, entry station, entry timestamp |
| J4 | On successful exit, the journey must record: exit station and exit timestamp |
| J5 | A journey may remain `ACTIVE` for a maximum of 2.5 hours from successful entry |
| J6 | If 2.5 hours elapse before successful exit, the journey must transition to `TIMED_OUT` |
| J7 | A `TIMED_OUT` journey must not permit normal successful exit |
| J8 | Exit for a `TIMED_OUT` journey must be rejected with reason `JOURNEY_TIMED_OUT` |

---

### 3.8 Exit Gate Validation

| # | Requirement |
|---|---|
| XG1 | Exit gate validation receives: gate ID and ticket identifier |
| XG2 | Exit must be rejected if no active journey exists for the ticket |
| XG3 | Exit must be rejected if the journey is `TIMED_OUT` |
| XG4 | Exit must be rejected if the gate is `INACTIVE` |
| XG5 | Early exit (before purchased destination) is **permitted** — no refund is issued |
| XG6 | Exit beyond the purchased destination must be rejected with reason `WRONG_DESTINATION` |
| XG7 | Successful exit must: transition ticket to `COMPLETED`, transition journey to `COMPLETED`, record an `EXIT_ACCEPTED` gate event |
| XG8 | Rejected exit must: leave ticket and journey state unchanged, record an `EXIT_REJECTED` gate event with a machine-readable reason |
| XG9 | Duplicate exit requests must be handled idempotently |

---

### 3.9 Gate Events

| # | Requirement |
|---|---|
| GE1 | Every gate interaction must produce a gate event record regardless of outcome |
| GE2 | Gate event must record: gate ID, station ID, ticket identifier, event type, timestamp, and outcome reason |
| GE3 | Gate event types: `ENTRY_ACCEPTED`, `ENTRY_REJECTED`, `EXIT_ACCEPTED`, `EXIT_REJECTED` |
| GE4 | Gate events must never be deleted |
| GE5 | All machine-readable rejection reasons must be defined in a canonical list before implementation |

---

### 3.10 Machine-Readable Rejection Reasons (V1 Canonical List)

```
TICKET_NOT_FOUND
TICKET_EXPIRED
TICKET_COMPLETED
TICKET_ALREADY_IN_JOURNEY
WRONG_ORIGIN
WRONG_DESTINATION
NO_ACTIVE_JOURNEY
JOURNEY_TIMED_OUT
GATE_INACTIVE
```

This list may be extended during design if a gap is identified. No new reason should be added during implementation without approval.

---

### 3.11 Refund Policy

| # | Requirement |
|---|---|
| R1 | General ticket refunds are not supported in V1 |
| R2 | Voluntary non-use, early exit, and journey completion do not trigger refunds |
| R3 | The only refund-eligible case: payment success followed by unrecoverable ticket issuance failure |
| R4 | V1 does not need to automate the refund disbursement — flagging the record is sufficient |

---

### 3.12 Administrative Visibility

| # | Requirement |
|---|---|
| A1 | Admin can view all stations and gates |
| A2 | Admin can view tickets and filter by status |
| A3 | Admin can view journeys including `ACTIVE`, `COMPLETED`, and `TIMED_OUT` |
| A4 | Admin can view Gate Events associated with a Ticket |
| A5 | Admin can view Payments and their statuses |
| A6 | Admin can identify payment-success / ticket-missing inconsistencies |
| A7 | Admin authentication is required — admin endpoints must not be publicly accessible |
| A8 | Except for Gate operational-status management, Admin does not modify Tickets, Journeys, Payments, Fare Rules, or refunds in V1 |
| A9 | Admin may change a Gate operational status between `ACTIVE` and `INACTIVE` |
| A10 | Gate status changes must affect subsequent validation requests immediately |
| A11 | An `INACTIVE` Gate must not process normal ticket validation |
| A12 | Admin Gate-status changes must not modify Ticket, Journey, or Payment state |

---

### 3.13 Passenger-Facing UI

| # | Requirement |
|---|---|
| U1 | Passenger can register using email and password |
| U2 | Passenger can login using email and password |
| U3 | Passenger can request passwordless login using an email OTP |
| U4 | Passenger can request a password-reset email |
| U5 | Passenger can select origin and destination stations |
| U6 | Passenger can view the calculated fare before purchasing |
| U7 | Passenger can initiate a Purchase and complete a Razorpay Test Mode Payment |
| U8 | Passenger can view and retrieve issued Tickets associated with their account |
| U9 | Passenger can view their Ticket QR/digital identifier |
| U10 | Passenger can view their Purchase and Payment history |
| U11 | Passenger can view their Journey history |
| U12 | Passenger can retrieve a Ticket issued after the original payment page was refreshed or closed |

Authentication and email support MetroFlow's core flows; they are not independent product areas. V1 implements only the authentication and transactional-email capabilities required for account access, recovery, and Ticket delivery.

### 3.14 Authentication & Authorization

| # | Requirement |
|---|---|
| AUTH1 | V1 must support passenger registration using email and password |
| AUTH2 | V1 must support passenger login using email and password |
| AUTH3 | V1 must support passwordless login using a one-time code sent to the passenger's registered email |
| AUTH4 | Email OTPs must have a limited validity period |
| AUTH5 | An expired OTP must not be accepted |
| AUTH6 | A successfully used OTP must not be reusable |
| AUTH7 | The system must limit repeated invalid OTP attempts |
| AUTH8 | V1 must support a forgot-password flow through email |
| AUTH9 | Password reset must use a secure, time-limited, single-use reset token or link |
| AUTH10 | Passwords must never be stored in plaintext |
| AUTH11 | MetroFlow must support role-based authorization with at least `PASSENGER` and `ADMIN` roles |
| AUTH12 | Passengers may access only their own purchases, payments, tickets, and journeys |
| AUTH13 | Admin-only endpoints must require the `ADMIN` role |
| AUTH14 | Authentication/session expiry, logout, browser refresh, or browser closure must not delete or cancel Purchases, Payments, Tickets, or Journeys |
| AUTH15 | The exact token/session implementation is an architecture decision and must not be fixed in Phase 1 |

### 3.15 Email Service

| # | Requirement |
|---|---|
| MAIL1 | MetroFlow must have an email service for transactional system emails |
| MAIL2 | Email service must support sending passwordless-login OTPs |
| MAIL3 | Email service must support sending password-reset emails |
| MAIL4 | After successful Ticket issuance, MetroFlow must attempt to send the issued Ticket information to the passenger's registered email |
| MAIL5 | Ticket email delivery is a secondary delivery channel; the MetroFlow account remains the authoritative location for the Ticket |
| MAIL6 | Email delivery failure must not invalidate or cancel an otherwise successfully issued Ticket |
| MAIL7 | If Ticket email delivery fails, the passenger must still be able to retrieve the Ticket from their account |
| MAIL8 | Transactional email delivery must have a trackable state such as `PENDING`, `SENT`, or `FAILED` |
| MAIL9 | Email delivery failures must not change Payment, Ticket, or Journey state |
| MAIL10 | Promotional emails, newsletters, marketing automation, email campaigns, and email analytics are outside V1 |

### 3.16 Gate Simulator UI

| # | Requirement |
|---|---|
| GS1 | V1 must include a dedicated software Gate Simulator screen |
| GS2 | The Gate Simulator must allow selecting or identifying a Station and Gate |
| GS3 | The Gate Simulator must display the Gate type: `ENTRY` or `EXIT` |
| GS4 | The Gate Simulator must display the Gate operational status: `ACTIVE` or `INACTIVE` |
| GS5 | A user must be able to present/submit a Ticket identifier to the selected Gate |
| GS6 | For an `ACTIVE` Gate, the simulator must display the AFC decision: `ALLOW` or `REJECT` |
| GS7 | Rejected validations must display the machine-readable rejection reason |
| GS8 | The Gate Simulator must not implement fare or journey business rules locally; it must use the MetroFlow backend |
| GS9 | An `INACTIVE` Gate must not allow normal ticket validation |

---

## 4. V1 Failure Scenarios In Scope

| Scenario | V1 Handling |
|---|---|
| Payment failure | `FAILED` payment recorded; no ticket issued |
| Multiple failed payments for same Purchase | Allowed; each attempt recorded |
| Payment attempt after Purchase already fulfilled | Rejected |
| Payment success + ticket issuance failure | Inconsistency flagged; admin visible; manual recovery |
| Fare Quote expires after 10 minutes | New Purchase requires a new Fare Quote; an already-initiated Payment remains valid |
| Browser refresh during Payment | Purchase and Payment remain intact; later outcome can still be processed |
| Payment remains pending after communication timeout | Payment remains unresolved; passenger is not asked to pay again automatically |
| Payment SUCCESS arrives later | Payment is processed and Ticket issued/retrievable if valid |
| Payment succeeds after passenger leaves page | Ticket is still issued and associated with the passenger account |
| Invalid login credentials | Authentication rejected |
| Expired email OTP | Authentication rejected; new OTP required |
| Reused email OTP | Authentication rejected |
| Repeated invalid OTP attempts | Further attempts limited according to security policy |
| Expired password-reset token | Reset rejected; passenger must request another reset |
| Email OTP delivery failure | Login not completed; failure surfaced without affecting account data |
| Ticket email delivery failure | Ticket remains valid and available in passenger account |
| Duplicate payment success notification | Idempotency check; no duplicate ticket issued |
| Concurrent same-ticket entry | Concurrency protection; at most one journey created |
| Duplicate gate request (retry) | Idempotent response returned |
| Expired ticket presented at gate | `ENTRY_REJECTED` with `TICKET_EXPIRED` |
| Completed ticket reused | `ENTRY_REJECTED` with `TICKET_COMPLETED` |
| Exit without active journey | `EXIT_REJECTED` with `NO_ACTIVE_JOURNEY` |
| Wrong origin at entry | `ENTRY_REJECTED` with `WRONG_ORIGIN` |
| Journey exceeds 2.5 hours | Journey becomes `TIMED_OUT`; normal exit rejected with `JOURNEY_TIMED_OUT` |
| Ticket unused until end of service day | Ticket becomes `EXPIRED` |
| Inactive gate | `ENTRY_REJECTED` or `EXIT_REJECTED` with `GATE_INACTIVE` |
| Admin deactivates Gate | Subsequent validation unavailable/rejected with `GATE_INACTIVE` |

---

## 5. V1 Out-of-Scope (Explicit)

The following are valid domain concepts but are deferred to V2/Backlog:

```
Automated refund disbursement
Automated payment-to-ticket recovery (background reconciliation)
Google/social OAuth
Phone/SMS OTP
MFA / authenticator apps
Email verification as a separate onboarding workflow
Marketing emails
Newsletters
Promotional campaigns
Email analytics
Multiple email-provider failover
Advanced account recovery
Offline gate operation
Multi-journey / stored-value cards
Ticket cancellation by passenger
Razorpay Live Mode / real-money payments
Production financial settlement
Production payment reconciliation
Alternative payment providers
Season passes / subscription tickets
Concession fares (senior, student, etc.)
Revenue reporting & analytics dashboard
Push notifications
Train operations, scheduling, tracking
Physical gate hardware integration
Multi-city / multi-network support
```

---

## 6. V1 Definition of Done

V1 is complete when:

- [ ] All stations and gates are seeded and retrievable via API
- [ ] Fare engine calculates correct fares from stored rules
- [ ] Fare quotes are issued with a 10-minute validity window
- [ ] A purchase can be created from a valid fare quote
- [ ] Razorpay Test Mode payment can be initiated, succeeded, and failed
- [ ] A ticket is issued only after confirmed payment success
- [ ] Unused Tickets expire at end of service day
- [ ] Entry gate validation enforces all EG1–EG11 rules
- [ ] Exit gate validation enforces all XG1–XG9 rules
- [ ] Every gate interaction produces a gate event record
- [ ] Journey is created on entry and completed on exit
- [ ] Journey transitions `ACTIVE` → `TIMED_OUT` after the 2.5-hour maximum rule is reached
- [ ] A `TIMED_OUT` Journey cannot complete normal Exit
- [ ] Multiple failed Payment attempts are supported for one Purchase
- [ ] A fulfilled Purchase cannot accept another Payment attempt
- [ ] Dedicated Gate Simulator UI exists
- [ ] Gate Simulator supports `ENTRY` and `EXIT` Gates
- [ ] Gate Simulator displays `ALLOW` / `REJECT` and rejection reason
- [ ] Admin is read-only for Tickets, Journeys, Payments, and Fare Rules
- [ ] Admin can activate/deactivate Gates
- [ ] An `INACTIVE` Gate cannot process Ticket validation
- [ ] Payment-success / ticket-missing inconsistency is detectable by admin
- [ ] All rejection responses carry machine-readable reasons
- [ ] Admin API endpoints are protected by authentication
- [ ] Passenger endpoints are protected by authentication
- [ ] Passenger can register using email/password
- [ ] Passenger can login using email/password
- [ ] Passenger can login using a valid email OTP
- [ ] Expired or previously used OTPs are rejected
- [ ] Forgot-password flow sends a secure reset email
- [ ] Expired or previously used password-reset credentials are rejected
- [ ] Passenger and Admin roles are enforced
- [ ] Passengers cannot access another passenger's records
- [ ] Admin endpoints require Admin authorization
- [ ] Ticket issuance triggers a transactional email attempt
- [ ] Ticket email failure does not affect Ticket validity
- [ ] Passenger can retrieve the Ticket from their account even if email delivery fails
- [ ] Email delivery status is auditable
- [ ] Automated tests cover all happy paths
- [ ] Automated tests cover all V1 failure scenarios listed in Section 4
- [ ] Concurrency and idempotency behavior is covered by tests
- [ ] API is documented (OpenAPI/Swagger or equivalent)
- [ ] Passenger UI covers U1–U12
- [ ] Gate Simulator UI covers GS1–GS9
- [ ] Admin UI covers A1–A12
- [ ] README explains how to run the project end-to-end

---

## 7. Deferred Implementation Questions

The Phase 1 product decisions are now closed. The following implementation details are deferred to Phase 2/3 and must not expand V1 scope:

| # | Deferred question |
|---|---|
| DQ1 | What exact clock time defines the end of the metro service day? |
| DQ2 | How will the 2.5-hour Journey timeout be technically enforced? |
| DQ3 | How will Gate status changes be persisted and audited? |
| DQ4 | How will idempotency keys be represented and stored? |

---

## 8. Next Phase

After V1 requirements are confirmed:

```
PHASE 2
ARCHITECTURE & TECHNOLOGY DECISIONS
```

Architecture decisions should be driven by the requirements above — particularly:

- Concurrency protection (Section 3.6 EG10, EG11)
- Idempotency (PY6, EG11, XG9)
- Journey timeout enforcement mechanism (J6)
- Transactional consistency across ticket + journey + gate event
- Authentication and authorization for passenger and admin roles
- Transactional email delivery for OTPs, password resets, and issued Tickets
