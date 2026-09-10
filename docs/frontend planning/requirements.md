# MetroFlow Frontend — V1 Requirements

> **Document:** `frontend-planning/requirements.md`  
> **Status:** Draft  
> **Purpose:** Define exactly what the MetroFlow V1 frontend must provide and what is intentionally outside V1.

---

## 1. Frontend Goal

MetroFlow V1 demonstrates a complete smart-metro passenger experience:

```text
Register/Login → Select stations → View fare → Pay → Receive QR ticket
→ Entry gate → Board simulated metro → Travel → Exit gate → Journey completed
```

The frontend must feel like one coherent transit product, not a collection of developer pages.

## 2. Frontend Experiences

### Passenger Application

Passengers can register, log in with password or email OTP, reset passwords, view dashboards, select stations, request fares, purchase tickets through Razorpay, view payment status, view QR tickets and history, open the Metro Simulator, manage basic account actions, and log out.

The experience is simple, trustworthy, modern, and mobile-friendly.

### Gate Simulator

The Gate Simulator represents a MetroFlow AFC gate and must not look like a developer form.

```text
IDLE → SCANNING → PROCESSING → ALLOW or REJECT
```

Entry and exit success states show clear messaging and gate-opening animation. Entry continues to the simulator; exit completes the backend journey. Rejections show a human-readable reason, with backend codes secondary and muted.

Operator configuration is hidden by default and visually separated. It may include station, gate, entry/exit mode, ticket fallback input, and recent scan history. Browser code must never expose the Gate API key.

### Metro Journey Simulator

The simulator is an experience layer around the real ticket and journey system; it does not replace backend state.

V1 uses polished 2D UI with lightweight 3D station/train scenes and guided cinematic movement. Unrestricted first-person WASD walking is out of scope.

States:

```text
READY_TO_ENTER → ENTRY_GATE → ENTRY_ALLOWED → STATION → BOARDING
→ TRAIN_DEPARTING → IN_TRANSIT → ARRIVING_STATION → AT_STATION
→ DESTINATION_REACHED → EXIT_GATE → JOURNEY_COMPLETED
```

`TIMED_OUT` is also supported.

Show origin, destination, intermediate stations, current and next station, passed and remaining stations, train position, and route progress.

Slow, Normal, and Fast affect only frontend animation timing. They must not modify backend journey state, ticket state, `entered_at`, `expires_at`, or the 2.5-hour backend timeout.

Reaching the simulated destination does not complete the real journey. The passenger must pass exit validation:

```text
Destination reached → Exit gate scan → EXIT ALLOW
→ Ticket COMPLETED → Journey COMPLETED
```

### Admin Experience

The admin interface is operational and information-dense. V1 supports dashboards; stations; gates; gate activation/deactivation where supported; tickets; journeys; payments; gate events; payment inconsistencies; DEAD outbox events; and supported filtering/search.

## 3. Payment UX

The frontend must show a purchase summary, open Razorpay Checkout, show payment confirmation, use the existing payment-status contract, handle delayed webhook confirmation, failed payment, valid retries, and browser close/reopen scenarios.

The frontend callback is never final payment authority and must never mark a ticket paid or issued by itself.

User-facing states:

```text
Ready to Pay · Opening Payment · Confirming Payment · Payment Successful
· Payment Failed · Taking Longer Than Expected
```

## 4. Ticket UX

Show QR code, origin, destination, fare paid, ticket status, and validity information.

Supported states and presentation:

| Backend state | User-facing copy |
|---|---|
| `ISSUED` | Ready to board |
| `IN_JOURNEY` | Journey active |
| `COMPLETED` | Journey completed |
| `EXPIRED` | Ticket expired |

Backend enum names are not primary user-facing copy.

## 5. Responsive Requirements

- Passenger: mobile-first; desktop may add sidebar/navigation.
- Simulator: desktop preferred; mobile remains usable with simplified layout/camera.
- Gate: dedicated kiosk-style display, usable in desktop browser testing.
- Admin: desktop-first; tables may scroll horizontally; critical actions remain usable on tablet/mobile.

## 6. Accessibility

Use semantic HTML, keyboard-accessible controls, visible focus states, sufficient contrast, labeled form controls, non-color-only errors, `prefers-reduced-motion`, and reduced-motion versions of gate/train animations.

## 7. Loading, Empty, and Error States

Every data-driven screen must deliberately handle loading, empty, success, and error states. This includes no tickets, no journeys, no purchases, payment processing/failure, gate unavailability, simulator loading, and service unavailability. Use human-friendly messages rather than raw backend errors.

## 8. Frontend Security Rules

- Follow the locked authentication design for access tokens.
- Never expose refresh tokens to JavaScript.
- Never expose the Gate API secret or Razorpay secret.
- Never display stack traces, SQL errors, or database errors.
- Never log OTPs, passwords, or token secrets.
- Treat the backend as authoritative for payment, ticket, and journey state.

## 9. V1 Visual Quality

All experiences share one MetroFlow identity:

- Passenger: clean, modern, transit-focused
- Gate: machine-like, immediate, high-contrast
- Simulator: immersive, cinematic, transit-focused
- Admin: operational, structured, information-dense

Exact colors, typography, component styles, and motion values are deferred to `design-system.md`.

## 10. V1 Out of Scope

- Unrestricted first-person WASD walking
- Full game-style station, realistic physics, or train-capacity simulation
- Live train GPS, real DMRC telemetry, or public timetable integration
- Multiplayer passengers
- Signalling or realistic metro operating-control simulation
- Offline gate operation
- OAuth/social login or push notifications
- Concession fares or multi-journey tickets
- Revenue analytics
- V2 route/topology exit behavior

Lightweight 3D scenes are allowed, but MetroFlow remains primarily a fare-collection engineering application.

## 11. Frontend V1 Definition of Done

Frontend planning is sufficient when implementation can begin without inventing required pages, user flows, simulator states, gate behavior, visual identity, component behavior, responsive rules, or important user-facing copy.

The goal is enough design information to build consistently, freeze frontend planning, and start implementation.
