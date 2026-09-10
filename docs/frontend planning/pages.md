# MetroFlow Frontend Pages

> **Document:** `frontend-planning/pages.md`  
> **Status:** Draft  
> **Purpose:** Define the V1 route inventory and the implementation responsibilities of each page.

---

## 1. Auth

### `/login`

**Experience/role:** Passenger — unauthenticated  
**Purpose:** Sign in with email and password.  
**Primary actions:** Submit credentials; go to registration; choose OTP login.  
**Important UI states:** Loading; invalid credentials; service error; success.  
**Access:** Public.

### `/register`

**Experience/role:** Passenger — unauthenticated  
**Purpose:** Create a passenger account.  
**Primary actions:** Submit email and password; go to login.  
**Important UI states:** Editing; validation error; duplicate email; loading; success.  
**Access:** Public.

### `/otp`

**Experience/role:** Passenger — unauthenticated  
**Purpose:** Request and verify an email OTP for passwordless login.  
**Primary actions:** Request code; enter code; verify; request a new code when allowed.  
**Important UI states:** Code sent; cooldown; invalid/expired code; attempts exhausted; loading; success.  
**Access:** Public.

### `/forgot-password`

**Experience/role:** Passenger — unauthenticated  
**Purpose:** Start password recovery by email.  
**Primary actions:** Submit email; return to login.  
**Important UI states:** Loading; submitted; rate limited; service error.  
**Access:** Public.

### `/reset-password`

**Experience/role:** Passenger — unauthenticated  
**Purpose:** Set a new password using a reset link/token.  
**Primary actions:** Submit new password; go to login.  
**Important UI states:** Valid token; invalid/expired token; validation error; loading; success.  
**Access:** Public with reset token.

## 2. Passenger

### `/dashboard`

**Experience/role:** Passenger  
**Purpose:** Main passenger home after authentication.  
**Primary actions:** Start new journey; view active ticket; open ticket; view recent journeys.  
**Important UI states:** No active ticket; issued ticket; in-journey ticket; loading; error.  
**Access:** Authenticated `PASSENGER`.

### `/journey/new`

**Experience/role:** Passenger  
**Purpose:** Select origin and destination and request the authoritative fare quote.  
**Primary actions:** Choose stations; view fare; continue to payment.  
**Important UI states:** Loading stations; same-station validation; quote available; quote expired; error.  
**Access:** Authenticated `PASSENGER`.

### `/journey/[purchaseId]/pay`

**Experience/role:** Passenger  
**Purpose:** Review a purchase and complete Razorpay Test Mode payment.  
**Primary actions:** Review purchase; open checkout; retry a valid failed attempt; return to status.  
**Important UI states:** Ready to pay; opening payment; confirming payment; successful; failed; taking longer than expected.  
**Access:** Authenticated `PASSENGER`, authorized for the purchase.

### `/tickets`

**Experience/role:** Passenger  
**Purpose:** View issued and historical tickets.  
**Primary actions:** Open a ticket; review ticket status.  
**Important UI states:** Loading; no tickets; ticket list; service error.  
**Access:** Authenticated `PASSENGER`.

### `/tickets/[ticketId]`

**Experience/role:** Passenger  
**Purpose:** Display one digital QR ticket and its travel information.  
**Primary actions:** Present QR ticket; view origin, destination, fare, status, and validity.  
**Important UI states:** `ISSUED`; `IN_JOURNEY`; `COMPLETED`; `EXPIRED`; loading; not found.  
**Access:** Authenticated `PASSENGER`, authorized for the ticket.

### `/journeys`

**Experience/role:** Passenger  
**Purpose:** View current and historical journeys.  
**Primary actions:** Open a journey; review journey status.  
**Important UI states:** Loading; no journeys; active journey; completed journey; error.  
**Access:** Authenticated `PASSENGER`.

### `/journeys/[journeyId]`

**Experience/role:** Passenger  
**Purpose:** Show one journey’s route and lifecycle information.  
**Primary actions:** Open the active simulator; view route progress and journey status.  
**Important UI states:** Active; completed; timed out; loading; not found.  
**Access:** Authenticated `PASSENGER`, authorized for the journey.

### `/purchases`

**Experience/role:** Passenger  
**Purpose:** View purchase and payment history.  
**Primary actions:** Open a purchase; review payment status and attempts.  
**Important UI states:** Loading; no purchases; payment pending; payment successful; failed attempts; error.  
**Access:** Authenticated `PASSENGER`.

### `/account`

**Experience/role:** Passenger  
**Purpose:** Provide basic account actions.  
**Primary actions:** View account details; change password; log out.  
**Important UI states:** Loading; account loaded; password update in progress; password updated; password validation error; logout in progress; error.  
**Access:** Authenticated `PASSENGER`.

## 3. Simulator

### `/simulator/[journeyId]`

**Experience/role:** Passenger  
**Purpose:** Guide the passenger through the simulated metro journey around the real backend journey.  
**Primary actions:** Proceed through gate, station, boarding, travel, destination, and exit steps; open exit gate validation.  
**Important UI states:** `READY_TO_ENTER`; `ENTRY_GATE`; `ENTRY_ALLOWED`; `STATION`; `BOARDING`; `TRAIN_DEPARTING`; `IN_TRANSIT`; `ARRIVING_STATION`; `AT_STATION`; `DESTINATION_REACHED`; `EXIT_GATE`; `JOURNEY_COMPLETED`; `TIMED_OUT`; loading; error.  
**Access:** Authenticated `PASSENGER`, authorized for the journey.

All simulator states are driven inside this single route. They must not become separate URL routes. Simulation speed changes only frontend animation timing; destination arrival does not complete the backend journey until exit validation succeeds.

## 4. Gate

### `/gate`

**Experience/role:** Gate Simulator — passenger-facing gate and hidden operator layer  
**Purpose:** Simulate an AFC gate scan for entry or exit.  
**Primary actions:** Present/scan a ticket; receive the gate decision; use separated operator configuration when enabled.  
**Important UI states:** `IDLE`; `SCANNING`; `PROCESSING`; `ALLOW`; `REJECT`; loading; unavailable.  
**Access:** Gate Simulator access through the protected server/BFF path; Gate API key is never exposed to browser JavaScript.

The passenger-facing AFC experience is the primary surface. Station, gate, direction, fallback ticket input, and scan-history controls remain hidden by default.

## 5. Admin

### `/admin`

**Experience/role:** Admin  
**Purpose:** Show an operational summary.  
**Primary actions:** Review system areas and open operational records.  
**Important UI states:** Loading; summary available; empty data; service error.  
**Access:** Authenticated `ADMIN`.

### `/admin/stations`

**Experience/role:** Admin  
**Purpose:** View stations and their configured gates.  
**Primary actions:** View/filter stations; expand a station to view its gates; activate/deactivate gates where supported by the locked API contract.  
**Important UI states:** Loading; stations loaded; expanded gate list; ACTIVE gate; INACTIVE gate; update in progress; empty; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/tickets`

**Experience/role:** Admin  
**Purpose:** View ticket operations.  
**Primary actions:** Search and filter tickets; open ticket details.  
**Important UI states:** Loading; records; empty; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/journeys`

**Experience/role:** Admin  
**Purpose:** View journey operations.  
**Primary actions:** Search and filter journeys; inspect statuses.  
**Important UI states:** Loading; records; empty; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/payments`

**Experience/role:** Admin  
**Purpose:** View payment and attempt operations.  
**Primary actions:** Search and filter payments; inspect attempts and statuses.  
**Important UI states:** Loading; records; pending; failed attempts; success; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/gate-events`

**Experience/role:** Admin  
**Purpose:** Inspect gate validation history and audit events.  
**Primary actions:** Search and filter gate events; inspect outcomes.  
**Important UI states:** Loading; records; empty; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/inconsistencies`

**Experience/role:** Admin  
**Purpose:** Inspect payment/provider inconsistencies requiring operational attention.  
**Primary actions:** Search and filter inconsistencies; inspect evidence.  
**Important UI states:** Loading; unresolved records; no inconsistencies; error.  
**Access:** Authenticated `ADMIN`.

### `/admin/outbox`

**Experience/role:** Admin  
**Purpose:** Inspect outbox records, including exhausted `DEAD` events.  
**Primary actions:** Search and filter outbox records; inspect publication status.  
**Important UI states:** Loading; pending records; published records; DEAD records; empty; error.  
**Access:** Authenticated `ADMIN`.

## V1 Page Inventory

| Route | Experience |
|---|---|
| `/login` | Auth |
| `/register` | Auth |
| `/otp` | Auth |
| `/forgot-password` | Auth |
| `/reset-password` | Auth |
| `/dashboard` | Passenger |
| `/journey/new` | Passenger |
| `/journey/[purchaseId]/pay` | Passenger |
| `/tickets` | Passenger |
| `/tickets/[ticketId]` | Passenger |
| `/journeys` | Passenger |
| `/journeys/[journeyId]` | Passenger |
| `/purchases` | Passenger |
| `/account` | Passenger |
| `/simulator/[journeyId]` | Simulator |
| `/gate` | Gate |
| `/admin` | Admin |
| `/admin/stations` | Admin |
| `/admin/tickets` | Admin |
| `/admin/journeys` | Admin |
| `/admin/payments` | Admin |
| `/admin/gate-events` | Admin |
| `/admin/inconsistencies` | Admin |
| `/admin/outbox` | Admin |
