# MetroFlow Frontend — Wireframes

> **Document:** `frontend-planning/wireframes/README.md`  
> **Status:** LOCKED  
> **Purpose:** Define the V1 page layout skeletons and important visual states before implementation.

---

## 1. Wireframe Rules

Wireframes define page structure, content hierarchy, major actions, important states, and mobile/desktop layout intent.

They do not define exact colors, fonts, shadows, spacing tokens, final 3D models, or final animations. Those belong in `design-system.md` and `assets/`.

## 2. Auth Pages

### `/login`

```text
[ MetroFlow logo, centered ]
[ Tabs: Password | Email Code ]

Password: [ Email ] [ Password ] [ Forgot password ] [ Sign In ]
Email Code: [ Email ] [ Send Code ]

[ Divider: New here? ] [ Create Account ]
```

Centered, minimal, mobile-friendly auth card. Errors appear near the relevant form.

### `/register`

```text
[ MetroFlow logo ]
[ Email ] [ Password ] [ Confirm password ]
[ Create Account ]
[ Already have an account? Sign in ]
```

### `/otp`

```text
[ Back to login ] [ Enter your code ] [ Code sent to {email} ]
[ 6-digit OTP ] [ Countdown / resend ] [ Verify ]
```

States: code sent, invalid, expired, attempts exhausted, and resend available.

### `/forgot-password`

```text
[ Heading ] [ Explanation ] [ Email ] [ Send reset link ] [ Back to login ]
```

Success shows a generic confirmation message.

### `/reset-password`

```text
[ Heading ] [ New password ] [ Confirm password ] [ Update password ]
```

States: valid link, expired link, invalid link, and success.

## 3. Passenger Pages

### `/dashboard`

Mobile layout:

```text
[ Logo + account ]
[ New Journey ]
[ Active Ticket Card, when relevant ]
[ Recent Journeys ]
[ Account / quick summary ]
```

The active card shows route, status, View Ticket, and Resume Journey when applicable. Desktop adds a left sidebar and centered main content.

### `/journey/new`

```text
[ Heading ] [ Step indicator: Origin → Destination → Confirm ]
[ Station search/list ]
[ Selected route ] [ Fare quote ] [ Quote validity ] [ Proceed to Payment ]
```

Origin cannot equal destination. An expired quote visibly requires refresh/requote.

### `/journey/[purchaseId]/pay`

```text
[ Purchase summary: route, fare, reference ]
[ Pay with Razorpay ]
[ Dynamic payment status area ]
```

States: `READY`, `OPENING_PAYMENT`, `CONFIRMING_PAYMENT`, `TAKING_LONGER`, `FAILED`, and `SUCCESS`. Retry is shown only when backend rules permit. Final ticket success requires authoritative backend confirmation.

### `/tickets`

```text
[ Heading ] [ All / Issued / In Journey / Completed / Expired ]
[ Ticket cards: route, status, fare, validity/date ]
[ Empty state ]
```

### `/tickets/[ticketId]`

```text
[ Large QR ticket card ]
[ QR ] [ Origin → Destination ] [ Status ] [ Fare ] [ Validity ]
```

`ISSUED`: Ready to board. `IN_JOURNEY`: Journey active with Resume Metro Journey. `COMPLETED`: Journey completed with summary link. `EXPIRED`: Ticket expired.

### `/journeys`

```text
[ Heading ] [ All / Active / Completed / Timed Out ]
[ Journey list: route, entry, exit, status ] [ Empty state ]
```

### `/journeys/[journeyId]`

```text
[ Route heading ] [ Status ] [ Origin / entry ] [ Destination / exit ] [ Duration ]
```

Active journeys show Resume Metro Journey. Completed journeys show a summary; timed-out journeys show an explanation.

### `/purchases`

```text
[ Heading ]
[ Rows/cards: route, amount, purchase status, payment status, timestamp ]
[ Empty state ]
```

### `/account`

```text
[ Account header ] [ Email ] [ Role ]
[ Change Password: fields + submit + success/error ]
[ Logout ]
```

## 4. Simulator

Route: `/simulator/[journeyId]`

One route is driven by a visual state machine. No separate URL routes are created for states.

Persistent shell:

```text
[ Minimal MetroFlow top bar ] [ Return to dashboard ]
[ Full-bleed simulator scene ]
[ Route/progress UI ] [ Slow | Normal | Fast ]
```

### `READY_TO_ENTER`

Route summary, “Ready to board”, ticket QR shortcut, and “Proceed to Entry Gate”.

### `ENTRY_GATE`

Use the passenger Gate Experience. Operator configuration is not visible.

### `ENTRY_ALLOWED`

Entry success confirmation and gate-opening transition, only after backend `ALLOW`, then continue to `STATION`.

### `STATION`

Lightweight 3D platform scene, signage, track/platform, “You’re at {station}”, “Train arriving shortly”, and `Board Train` when ready.

### `BOARDING`

3D train, doors opening, “Please mind the gap”, and a guided cinematic transition. No unrestricted WASD movement.

### `TRAIN_DEPARTING`

Doors closing, departure visual, and “Departing {station}”.

### `IN_TRANSIT`

Train/tunnel motion with next station, passed/current/remaining stations, destination, station line, position, and Slow/Normal/Fast controls. Speed changes visual timing only.

### `ARRIVING_STATION`

Platform/signage entering view with “Arriving at {station}”.

### `AT_STATION`

Stopped train, briefly open doors, “Now at {station}”. Intermediate stations return to transit after a short pause.

### `DESTINATION_REACHED`

Final platform, “You’ve arrived at {destination}”, and “Proceed to the exit gate”. This does not complete backend journey state.

### `EXIT_GATE`

Use the Gate Experience in EXIT mode. Only backend `ALLOW` continues to `JOURNEY_COMPLETED`.

### `JOURNEY_COMPLETED`

Small celebration, “Journey complete”, route, fare, duration, completed status, and Back to Dashboard.

### `TIMED_OUT`

Dim/stop motion, warning icon, “Journey time expired”, “Your ticket can no longer be used for normal exit”, “Please contact station staff”, and Return to Dashboard. Backend remains authoritative.

## 5. Gate Simulator

Route: `/gate`

The page has two visually separate layers.

### Layer 1 — Operator/Test Configuration

Hidden by default behind a settings affordance. It may contain station, gate, gate status, entry/exit selection, fallback ticket ID, Start Gate Simulation, and the last five local scan results. It must not dominate the experience.

### Layer 2 — Passenger Gate Experience

Full-screen/kiosk-like layout:

```text
[ METROFLOW ] [ Station ] [ ENTRY/EXIT GATE ]
[ Large scan target ]
"Scan QR Ticket"
IDLE → SCANNING → PROCESSING → ALLOW / REJECT
```

`IDLE`: breathing scan target. `SCANNING`: pulse/scan feedback. `PROCESSING`: loading ring.

Entry allow shows success icon, `ENTRY ALLOWED`, “Welcome aboard”, and barrier opening. Exit allow shows success icon, `EXIT ALLOWED`, “Thanks for riding MetroFlow”, and barrier opening. Reject shows failure icon and human-readable reason, with backend code small/muted if shown.

## 6. Admin

Desktop-first shell:

```text
[ Left sidebar ] [ Top bar ] [ Main content ]
```

### `/admin`

Summary cards for active journeys, tickets today, dead outbox, and gate events today, plus operational links.

### `/admin/stations`

Search/filter and station rows. An expanded station shows gates, ID/name, ENTRY/EXIT, ACTIVE/INACTIVE, and the supported activate/deactivate control.

### `/admin/tickets`

Filter, search, and table for ticket, user, route, status, fare, created time, and validity.

### `/admin/journeys`

Filters and table for journey, ticket, route, entry, exit, and status.

### `/admin/payments`

Filters and table for payment, purchase, amount, status, latest attempt, and created time.

### `/admin/gate-events`

Filters for station, gate, event type, and date. Table shows ticket, station, gate, result, reason, and timestamp.

### `/admin/inconsistencies`

Filters and table for purchase/payment reference, user, amount, inconsistency, and created time. Operational inspection only.

### `/admin/outbox`

Filters and read-only table for event type, topic, status, attempts, last error, and timestamp.

## 7. Shared Layout Shells

```text
AUTH       → centered card, minimal chrome, MetroFlow branding
PASSENGER  → desktop sidebar, mobile bottom navigation, main content
SIMULATOR  → full-bleed visual experience, minimal chrome
GATE       → full-screen AFC experience, operator config hidden
ADMIN      → sidebar + top bar, dense operational content
```

## 8. Responsive Intent

Mobile prioritizes the passenger app, bottom navigation, and stacked cards/lists. The simulator retains all core states with simplified camera/layout. Desktop provides a richer simulator, passenger sidebar, wide admin tables, and kiosk-style gate presentation.

## 9. Wireframe Freeze

These wireframes define V1 structure. Visual details may evolve through `design-system.md`, but implementation must not invent new V1 pages, core simulator states, gate behavior, or business-critical flows without revisiting the locked planning documents.
