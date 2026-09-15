# MetroFlow Journey Simulator

## 1. Module purpose

The Journey Simulator is a passenger-facing, interactive visualization of the complete MetroFlow ticket lifecycle.

It combines the following stages on one page:

```text
Issued ticket
    ↓
Entry gate validation
    ↓
Passenger boards the metro
    ↓
Animated movement through route stations
    ↓
Passenger selects an intermediate station or destination
    ↓
Exit gate validation
    ↓
Completed journey
```

The simulator is a visual representation of real backend state. It must never open a gate, start a journey, or complete a journey without a successful backend response.

## 2. Passenger route

The new page will use the existing Next.js App Router structure:

```text
/journey/simulator/[ticketId]
```

Expected file location:

```text
apps/web/app/journey/simulator/[ticketId]/page.tsx
```

The simulator must be opened for a specific ticket. Links to this page should be available from the ticket detail page and, where appropriate, the active journey page.

## 3. Current system integration

The simulator must reuse the current MetroFlow architecture:

- Web application: `apps/web`
- Public API boundary: `apps/api-gateway`
- Durable business logic: `apps/core-api`
- Gate-device boundary: `apps/gate-service`
- Database: PostgreSQL
- Authentication: existing access token and refresh-token flow
- Styling: existing global CSS and MetroFlow application shell

The browser must call the API Gateway. It must not call the Core API or Gate Service directly.

The gate API key must remain server-side and must never appear in frontend code, browser storage, HTML, network request bodies, or public environment variables.

## 4. Backend prerequisites

### 4.1 Explicit station order

The current development implementation infers station order from station creation time. That is acceptable temporarily, but it is not a stable production route model.

The simulator requires an explicit station order. For the current single-line model, add:

```text
stations.line_order
```

Requirements:

- `line_order` must be an integer.
- Every active seeded station must receive a unique order.
- The seed must preserve the configured demonstration station order. The current seed is a simplified single-line demo, not the physical Delhi Metro network. Real routing requires a separately verified network and interchange model.
- Route queries must use `line_order`, not station name or creation timestamp.
- Both travel directions must be supported.

A future multi-line network should replace this simplified field with route and route-station tables.

### 4.2 Ticket route endpoint

Add an authenticated passenger endpoint:

```http
GET /api/v1/tickets/:ticketId/route
```

Responsibilities:

1. Authenticate the passenger.
2. Load the ticket.
3. Enforce ticket ownership.
4. Load origin and destination station order.
5. Determine ascending or descending travel direction.
6. Return all route stations in travel order, inclusive of origin and destination.
7. Include active entry and exit gates for each station.

Expected response:

```json
{
  "success": true,
  "data": {
    "origin": {
      "id": "station-id",
      "code": "ADARSH_NAGAR",
      "name": "Adarsh Nagar"
    },
    "destination": {
      "id": "station-id",
      "code": "JHANDEWALAN",
      "name": "Jhandewalan"
    },
    "stations": [
      {
        "id": "station-id",
        "code": "ADARSH_NAGAR",
        "name": "Adarsh Nagar",
        "lineOrder": 13,
        "gates": [
          {
            "id": "gate-id",
            "code": "GATE-A",
            "type": "ENTRY",
            "status": "ACTIVE"
          }
        ]
      }
    ]
  }
}
```

### 4.3 Journey endpoints

The simulator must be able to restore its state after a refresh. Add or complete:

```http
GET /api/v1/journeys?ticketId=:ticketId&status=:status
GET /api/v1/journeys/:journeyId
```

These endpoints must:

- Require passenger authentication.
- Enforce journey ownership.
- Return entry station and timestamp.
- Return actual exit station and timestamp when completed.
- Return journey expiry and timeout state.
- Support active and completed journey lookup by ticket.

### 4.4 Ticket identifier rule

The QR code and gate validation identifier must use one documented value consistently.

For V1, MetroFlow should use the ticket UUID as the QR identifier:

```text
ticket.identifier = ticket.id
```

If the database currently stores a different public identifier, gate lookup must explicitly support that identifier. The frontend must not guess which field the backend expects.

### 4.5 Gate endpoints

The simulator will use the existing public Gateway endpoints:

```http
POST /api/v1/gate/validate-entry
POST /api/v1/gate/validate-exit
```

Every distinct scan attempt must include a new UUID in:

```http
Idempotency-Key: <uuid>
```

A retry of the same uncertain network request should reuse its existing idempotency key.

## 5. Frontend module structure

Use the repository’s existing `apps/web/app` structure.

Recommended files:

```text
apps/web/app/journey/simulator/[ticketId]/page.tsx
apps/web/app/journey/simulator/[ticketId]/simulator-client.tsx
apps/web/app/journey/simulator/[ticketId]/use-simulator.ts
apps/web/app/journey/simulator/[ticketId]/simulator-api.ts

apps/web/app/journey/simulator/components/ticket-summary.tsx
apps/web/app/journey/simulator/components/metro-map.tsx
apps/web/app/journey/simulator/components/station-node.tsx
apps/web/app/journey/simulator/components/train.tsx
apps/web/app/journey/simulator/components/gate.tsx
apps/web/app/journey/simulator/components/status-panel.tsx
apps/web/app/journey/simulator/components/exit-station-selector.tsx
apps/web/app/journey/simulator/components/rejection-card.tsx
apps/web/app/journey/simulator/components/speed-controller.tsx
```

Shared API types should eventually move into `packages/contracts` or `packages/shared-types` instead of being duplicated across applications.

## 6. Frontend state machine

The simulator must use an explicit state machine:

```typescript
type SimulatorState =
  | "LOADING_TICKET"
  | "READY_TO_ENTER"
  | "VALIDATING_ENTRY"
  | "BOARDING"
  | "IN_TRANSIT"
  | "SELECTING_EXIT"
  | "ARRIVED_AT_EXIT"
  | "VALIDATING_EXIT"
  | "EXITING"
  | "JOURNEY_COMPLETED"
  | "ERROR";
```

### State transitions

```text
LOADING_TICKET
    ISSUED      → READY_TO_ENTER
    IN_JOURNEY  → IN_TRANSIT
    COMPLETED   → JOURNEY_COMPLETED
    EXPIRED     → ERROR

READY_TO_ENTER
    Enter action → VALIDATING_ENTRY

VALIDATING_ENTRY
    ALLOW → BOARDING
    REJECT/error → ERROR

BOARDING
    Gate animation complete → IN_TRANSIT

IN_TRANSIT
    Exit station selected → SELECTING_EXIT

SELECTING_EXIT
    Train reaches target → ARRIVED_AT_EXIT

ARRIVED_AT_EXIT
    Exit action → VALIDATING_EXIT

VALIDATING_EXIT
    ALLOW → EXITING
    REJECT/error → ERROR

EXITING
    Gate animation complete → JOURNEY_COMPLETED
```

Visual timers may advance animation states only after the relevant backend operation has succeeded.

## 7. Initial data loading

When the page opens:

1. Load the ticket.
2. Load the ordered ticket route.
3. Determine the state from the ticket status.
4. If the ticket is `IN_JOURNEY`, load its active journey.
5. If the ticket is `COMPLETED`, load its completed journey.
6. Choose the first active entry gate at the origin.
7. Default the selected exit station to the ticket destination.

Ticket status mapping:

| Ticket status | Simulator state |
|---|---|
| `ISSUED` | `READY_TO_ENTER` |
| `IN_JOURNEY` | `IN_TRANSIT` |
| `COMPLETED` | `JOURNEY_COMPLETED` |
| `EXPIRED` | `ERROR` |

## 8. Entry experience

The origin station comes from the ticket and cannot be changed by the passenger.

The simulator should:

1. Highlight the origin station.
2. Display the entry gate at the origin.
3. Automatically use the first active entry gate.
4. Show a small physical-gate selector only when multiple active entry gates exist.
5. Send the ticket QR identifier and selected gate ID to the backend.
6. Display a validating state while awaiting the response.
7. Keep the barrier closed on rejection.
8. Animate the barrier open after `ALLOW`.
9. Begin the train experience after the boarding animation.

## 9. Metro route and train experience

### Desktop

Display a horizontal route line with ordered station nodes.

### Mobile

Display a vertical route line so station names remain readable.

### Station states

Every station must clearly show one of these states:

- Origin
- Passed
- Current
- Upcoming
- Selected exit
- Final destination

### Train behavior

The train should move through the ordered station list.

The user can choose a visual speed:

| Speed | Suggested duration per station |
|---|---:|
| Slow | 5 seconds |
| Normal | 1.2 seconds |
| Fast | 0.3 seconds |

The speed affects only the animation. It does not alter backend journey timestamps, expiry, fare, or validation.

The animation should pause briefly at each station so the passenger can follow the route.

## 10. Exit station selection

Available exit stations are:

```text
Every route station after the origin, up to and including the destination
```

The origin must not be available as an exit option.

The destination is selected by default. The passenger may select an intermediate station.

When the selection changes:

1. Update the selected exit station.
2. Animate the train toward that station.
3. Stop at the selected station.
4. Load or select an active exit gate at that station.
5. Enable the exit action only after arrival.

Current fare policy:

- Keep the original paid fare.
- Do not calculate a refund.
- Store the actual exit station.
- Complete the ticket and journey after successful validation.

## 11. Exit experience

The simulator should:

1. Show the exit gate at the selected station.
2. Automatically use its first active exit gate.
3. Display an error if the station has no active exit gate.
4. Call the real exit-validation endpoint.
5. Keep the barrier closed while validating.
6. Keep the barrier closed on rejection.
7. Animate the barrier open after `ALLOW`.
8. Show the journey-completed summary.

The completed summary must include:

- Origin station
- Ticket destination
- Actual exit station
- Entry time
- Exit time
- Journey duration
- Original fare paid
- Completed status

## 12. Visual design

The simulator should look like a modern transit experience rather than a standard administration form.

Recommended colors:

```text
Background:       #0A0A0F
Card:             #111118
Border:           #2A2A38
Accent blue:      #4F6EF7
Success green:    #22C55E
Error red:        #EF4444
Warning amber:    #F59E0B
Text primary:     #F0F0F8
Text secondary:   #9090A8
Text muted:       #5A5A72
```

The simulator can use the current MetroFlow global CSS system. Framer Motion is not currently installed and is not required for the first implementation. Controlled CSS transitions and React state can provide the initial train and gate animations.

If Framer Motion is introduced later, it must be added deliberately and used with reduced-motion support.

## 13. Accessibility

The module must:

- Respect `prefers-reduced-motion`.
- Avoid relying only on color to communicate status.
- Provide visible text for current station and gate state.
- Use accessible buttons, labels, and select controls.
- Keep keyboard navigation functional.
- Disable actions while backend validation is pending.
- Maintain readable mobile layouts.

With reduced motion enabled:

- The train moves immediately to its target.
- Gates open immediately after backend approval.
- Pulsing and decorative movement are disabled.
- All business-state transitions still work.

## 14. Error handling

The frontend must map backend rejection codes to understandable messages.

| Backend code | Passenger message |
|---|---|
| `TICKET_NOT_FOUND` | Ticket not found. Please check your ticket. |
| `TICKET_EXPIRED` | This ticket has expired and is no longer valid. |
| `TICKET_ALREADY_IN_JOURNEY` | This ticket is already active on a journey. |
| `TICKET_COMPLETED` | This ticket has already been used. |
| `WRONG_ORIGIN` | This gate is not at your origin station. |
| `WRONG_DESTINATION` | This station is outside your permitted route. |
| `NO_ACTIVE_JOURNEY` | Enter through the origin gate before trying to exit. |
| `JOURNEY_TIMED_OUT` | Your journey has timed out. Please contact station staff. |
| `GATE_INACTIVE` | This gate is currently unavailable. |

Network errors must not change the ticket or journey state locally. The user should receive a retry option.

## 15. Refresh and resume behavior

The simulator must survive a browser refresh.

For an active journey:

- Reload the active journey from the backend.
- Restore `IN_TRANSIT`.
- Restore entry time and expiry.
- Restore the train to at least the entry/current known station.
- Allow exit selection.

For a completed journey:

- Load the completed journey.
- Restore `JOURNEY_COMPLETED`.
- Show the actual exit station and summary.

Frontend memory is never the only record of journey progress.

## 16. Idempotency and retry behavior

Each new scan action creates a UUID idempotency key.

```text
New user scan → new key
Retry after unknown network result → reuse key
Explicit new scan after a confirmed rejection → new key
```

Buttons must be disabled while a request is pending to prevent accidental duplicate scans.

## 17. Implementation stages

### Stage 1: data foundation

- Add explicit station order.
- Update station seed data.
- Add ticket route endpoint.
- Add journey list/detail endpoints.
- Add Gateway proxies.
- Add ownership tests.

### Stage 2: simulator shell

- Create simulator route.
- Load ticket, route, and journey.
- Add ticket summary.
- Add state machine hook.
- Add loading and error states.

### Stage 3: entry flow

- Add origin gate visual.
- Connect real entry validation.
- Animate successful entry.
- Display rejection behavior.

### Stage 4: train and stations

- Render ordered station line.
- Animate the train.
- Add current/passed/upcoming station states.
- Add speed controls.
- Add responsive vertical layout.

### Stage 5: exit flow

- Add intermediate exit selection.
- Animate arrival.
- Connect real exit validation.
- Animate successful exit.
- Display completion summary.

### Stage 6: resilience and testing

- Add refresh/resume behavior.
- Add journey polling.
- Add reduced-motion behavior.
- Add unit, integration, and browser E2E tests.
- Complete regression testing for existing ticket and gate pages.

## 18. Module scope

### Included

- One passenger journey simulator page
- Real ticket data
- Ordered route stations
- Real entry and exit validation
- Intermediate station exit
- Original fare retention
- Animated train and gates
- Speed control
- Refresh/resume support
- Responsive desktop/mobile behavior
- Reduced-motion support
- User-friendly errors
- Journey completion summary

### Excluded

- 3D metaverse environment
- Multiplayer passengers
- Real GPS train tracking
- Live Delhi Metro operational feeds
- Fare refund for early exit
- Dynamic route transfers between multiple metro lines
- OAuth or social login
- Analytics and telemetry dashboards
- Physical scanner hardware integration
- Sound effects as a requirement

These can be considered future enhancements after the V1 simulator is stable.

## 19. Definition of completion

The Journey Simulator module is complete only when all conditions below are satisfied.

### Data and APIs

- [ ] Every seeded station has an explicit line order.
- [ ] The ticket route endpoint returns correctly ordered stations in both directions.
- [ ] The route endpoint enforces ticket ownership.
- [ ] Active and completed journeys can be loaded by ticket.
- [ ] Journey detail enforces ownership.
- [ ] Route stations include active gates.
- [ ] Ticket QR identifier usage is consistent across the frontend and backend.

### Entry lifecycle

- [ ] An issued ticket opens in `READY_TO_ENTER`.
- [ ] The origin station is fixed by the ticket.
- [ ] The entry gate is selected from active origin gates.
- [ ] The gate stays closed while validation is pending.
- [ ] The gate opens only after backend `ALLOW`.
- [ ] Backend rejection leaves the ticket unchanged.
- [ ] Successful entry creates an active journey and changes the ticket to `IN_JOURNEY`.

### Train experience

- [ ] All route stations are displayed in travel order.
- [ ] The train visibly moves through intermediate stations.
- [ ] Current, passed, upcoming, origin, destination, and selected-exit states are distinct.
- [ ] Slow, normal, and fast animation controls work.
- [ ] Animation speed does not change backend business time.

### Exit lifecycle

- [ ] The user can select any route station after the origin.
- [ ] The destination is selected by default.
- [ ] The train reaches the selected station before exit is enabled.
- [ ] An active exit gate is selected at that station.
- [ ] The exit gate opens only after backend `ALLOW`.
- [ ] The original fare remains unchanged.
- [ ] The actual exit station and timestamp are stored.
- [ ] The ticket and journey become `COMPLETED`.

### Reliability and UX

- [ ] Refreshing an active journey restores `IN_TRANSIT`.
- [ ] Refreshing a completed journey restores the completion summary.
- [ ] Timed-out journeys display a correct error state.
- [ ] Duplicate scans do not create duplicate journeys or events.
- [ ] Network failures provide safe retry behavior.
- [ ] No gate credential is exposed to the browser.
- [ ] Desktop and mobile layouts are usable.
- [ ] Reduced-motion mode preserves functionality.
- [ ] Existing ticket, payment, entry-gate, and exit-gate flows still pass regression tests.

### Verification

- [ ] Core API typecheck passes.
- [ ] API Gateway typecheck passes.
- [ ] Gate Service typecheck passes.
- [ ] Web typecheck passes.
- [ ] Production build passes when no development process is locking `.next`.
- [ ] Automated API tests cover route, ownership, entry, intermediate exit, and completion.
- [ ] Browser E2E covers the complete issued-ticket-to-completed-journey flow.

When every item above is complete and verified, the MetroFlow Journey Simulator is considered finished.
