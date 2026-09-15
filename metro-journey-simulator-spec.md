# MetroFlow Animated Journey Simulator Specification

## Product idea

MetroFlow should have an additional interactive page where the passenger can visually experience the complete metro journey in one place.

The page should combine:

- The passenger’s digital ticket
- The entry gate
- The metro train
- The ordered stations on the ticket route
- Intermediate station movement
- The exit-station choice
- The exit gate
- Journey completion

The goal is to make the system fun and understandable while still using the real MetroFlow backend lifecycle.

This is intended as a polished 2D/animated product demonstration for users, recruiters, and technical interviews. It should feel like a small interactive metro journey rather than a collection of disconnected forms.

## Suggested route

```text
/journey/simulator/[ticketId]
```

The simulator must be opened for a specific MetroFlow ticket. It must load the ticket from the backend and must not invent the origin, destination, fare, ticket status, or route.

## Example journey

For a ticket from Adarsh Nagar to Jhandewalan, the page could show:

```text
Adarsh Nagar → Azadpur → Shalimar Bagh → Jahangirpuri → Jhandewalan
```

The exact stations must come from the backend route data. The example above is only illustrative.

## Intended user experience

### Initial state: ticket ready

1. The user opens the simulator from an issued ticket.
2. The page displays the ticket summary:
   - Origin station
   - Destination station
   - Fare
   - Ticket status
   - Validity period
   - QR code or QR identifier
3. The origin station is highlighted on the route.
4. The entry gate is shown at the origin station.
5. The metro train is waiting at the origin station.
6. The primary action is **Enter metro** or **Scan at entry gate**.

### Entry state

1. The user clicks the entry action.
2. The frontend calls the real backend endpoint:

   ```http
   POST /api/v1/gate/validate-entry
   ```

3. The request contains the ticket identifier and the entry gate ID.
4. The UI waits for the backend response.
5. The entry gate animates open only when the backend returns `ALLOW`.
6. The ticket becomes `IN_JOURNEY` and the journey becomes `ACTIVE` in the database.
7. The user sees a short boarding animation.
8. The simulator changes to the train-in-transit state.

The frontend must never mark the ticket or journey as valid by itself.

### Train journey state

1. The metro train moves visually along the station route.
2. The current station is highlighted.
3. Passed stations change to a completed/visited state.
4. Upcoming stations remain inactive or muted.
5. The train should stop briefly at each station so the user can see the route.
6. The page may show:
   - Current station
   - Next station
   - Progress indicator
   - Journey timer
   - Entry time
   - Destination station
7. The animation must be deterministic and understandable on desktop and mobile.

The animation is a visual representation of a real active journey. It is not allowed to bypass backend validation.

### Exit station selection

The passenger may leave at the final destination or at an intermediate station between the origin and destination.

The exit station selector must:

- Exclude the origin station.
- Include every station between origin and destination.
- Include the final destination.
- Preserve the correct order for both travel directions.
- Never display stations outside the ticket route.

Example:

```text
Origin: Rajiv Chowk
Destination: Saket

Allowed exit stations:
- Hauz Khas
- Saket
```

The user should be able to choose an intermediate station if they no longer want to travel to the final destination.

For the current product rule:

- The original ticket fare is retained.
- No refund or fare recalculation is performed.
- The selected station becomes the actual exit station.
- The ticket and journey are completed after successful exit validation.

### Exit state

1. The train stops at the selected exit station.
2. The selected station becomes highlighted.
3. The exit gate is shown at that station.
4. The user clicks **Exit metro** or **Scan at exit gate**.
5. The frontend calls:

   ```http
   POST /api/v1/gate/validate-exit
   ```

6. The request contains:
   - Ticket identifier
   - Selected exit gate ID
7. The UI waits for the backend response.
8. The exit gate animates open only after an `ALLOW` response.
9. The backend marks:
   - Ticket as `COMPLETED`
   - Journey as `COMPLETED`
   - Actual exit station
   - Actual exit gate
   - Exit timestamp
10. The page displays a journey-completed summary.

## Backend truth and frontend animation

The most important architectural rule is:

```text
User action
    ↓
Frontend API request
    ↓
Backend validation
    ↓
Database state transition
    ↓
Frontend animation
```

The frontend should not simulate a successful journey independently of the backend.

The frontend must react to these real states:

```text
ISSUED
   ↓ entry validation succeeds
IN_JOURNEY + ACTIVE journey
   ↓ exit validation succeeds
COMPLETED
```

If the backend returns `REJECT`, the train and gate must remain closed and the UI must display the rejection reason.

## Gate behavior

### Entry gate

The entry gate is associated with the ticket origin station. The simulator should automatically select or filter gates at that station.

The user should not choose an unrelated station. If multiple physical gates exist at the same station, the simulator may show the physical gate choice for demonstration purposes.

### Exit gate

The exit gate is associated with the selected exit station. When the passenger changes the exit station, the available physical exit gates must update to that station.

The backend remains authoritative and must reject:

- Inactive gates
- Entry gates used for exit
- Stations outside the ticket route
- Tickets without an active journey
- Expired journeys
- Already completed tickets

## Visual design direction

The experience should look like a modern metro control interface rather than a plain CRUD form.

Suggested visual elements:

- MetroFlow branding and logo
- Dark rail/station background or a clean transit dashboard
- Horizontal or slightly curved rail line
- Station nodes with labels
- Animated train icon or train illustration
- Entry and exit gate illustrations
- Platform and track details
- Blue MetroFlow primary color
- Green success state
- Red rejection state
- Amber waiting/boarding state
- Clear movement between states
- Accessible text for every animation state

The page should remain usable when animation is disabled or reduced by the user’s operating-system accessibility settings.

## Animation states

Recommended frontend state machine:

```text
LOADING_TICKET
   ↓
READY_TO_ENTER
   ↓ entry request
VALIDATING_ENTRY
   ↓ ALLOW
BOARDING
   ↓
IN_TRANSIT
   ↓ station selection
ARRIVED_AT_EXIT
   ↓ exit request
VALIDATING_EXIT
   ↓ ALLOW
EXITING
   ↓
JOURNEY_COMPLETED
```

Rejected requests should transition to a visible error state and allow the user to retry where appropriate.

## Error states to support

The simulator should clearly handle:

- Ticket not found
- Ticket expired
- Ticket already in journey
- Ticket completed
- Wrong origin gate
- Wrong exit station
- No active journey
- Journey timed out
- Inactive gate
- Network failure
- Session expiry
- Duplicate request

Error messages should be written for users, while the technical rejection code may be available in a details area for development/debugging.

## Route data requirement

The simulator needs an ordered route between the ticket origin and destination.

The preferred production design is an explicit route model, for example:

```text
routes
route_stations
  route_id
  station_id
  sequence_number
```

Alternatively, a station may have an explicit line order for a single-line development model:

```text
stations.line_order
```

The UI must not hardcode the station list. It should receive the route from the backend so the design can scale from 30 stations to 90 or more.

The backend should ideally expose something like:

```http
GET /api/v1/tickets/:ticketId/route
```

Example response:

```json
{
  "success": true,
  "data": {
    "origin": { "id": "...", "name": "Adarsh Nagar" },
    "destination": { "id": "...", "name": "Jhandewalan" },
    "stations": [
      { "id": "...", "name": "Adarsh Nagar", "sequence": 12 },
      { "id": "...", "name": "Azadpur", "sequence": 11 },
      { "id": "...", "name": "Shalimar Bagh", "sequence": 10 },
      { "id": "...", "name": "Jhandewalan", "sequence": 8 }
    ]
  }
}
```

## Implementation phases

### Phase 1: route and data

1. Add an explicit station sequence or route table.
2. Add a backend route endpoint for a ticket.
3. Return origin, destination, and ordered stations.
4. Return active gates for each route station where needed.

### Phase 2: simulator shell

1. Create `/journey/simulator/[ticketId]`.
2. Load the ticket and route.
3. Display ticket summary.
4. Display station timeline.
5. Add responsive layout and reduced-motion support.

### Phase 3: entry experience

1. Highlight the origin station.
2. Show the entry gate.
3. Call the real entry validation endpoint.
4. Animate gate opening after `ALLOW`.
5. Move the train into the journey state.

### Phase 4: train experience

1. Animate the train along the route.
2. Highlight stations as the train passes.
3. Show current and next station.
4. Allow the user to select an intermediate exit station or destination.
5. Stop the train at the selected station.

### Phase 5: exit experience

1. Show the selected station’s exit gate.
2. Call the real exit validation endpoint.
3. Animate the exit gate after `ALLOW`.
4. Complete the journey in the UI only after the backend confirms it.
5. Show completion details and actual exit station.

### Phase 6: testing and polish

1. Test origin entry.
2. Test intermediate-station exit.
3. Test final-destination exit.
4. Test wrong station rejection.
5. Test expired ticket rejection.
6. Test duplicate entry and exit attempts.
7. Test refresh during every simulator state.
8. Test session expiry.
9. Test desktop and mobile layouts.
10. Test reduced-motion accessibility behavior.

## Acceptance criteria

The feature is complete when:

- A user can open the simulator from a valid ticket.
- The page displays the correct origin and destination.
- The route contains only stations between origin and destination.
- The origin entry gate is shown automatically.
- Entry validation uses the real backend.
- The gate opens only after a successful backend response.
- The train moves visibly through intermediate stations.
- The user can select an intermediate station or final destination.
- The selected station controls the exit gate.
- Exit validation uses the real backend.
- The original fare remains unchanged.
- The ticket and journey become completed after successful exit.
- The actual exit station is stored and displayed.
- Rejections leave the journey in the correct state.
- The page remains understandable without animation.
- No gate API key or service secret is exposed in browser code.

## Interview explanation

This feature demonstrates more than visual animation. It demonstrates a stateful distributed workflow:

- The ticket is the passenger’s authorization to travel.
- The Gate Service protects device-facing gate operations.
- The Core API owns the durable state transition.
- PostgreSQL transactions protect ticket and journey consistency.
- The frontend visualizes confirmed backend state.
- Intermediate exits are supported while preserving the original fare policy.
- Gate events provide an audit trail for entry and exit decisions.

The key interview statement is:

> The animation is not the source of truth. It is a user-friendly projection of the ticket and journey state confirmed by the backend.

