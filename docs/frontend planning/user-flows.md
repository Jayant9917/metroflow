# MetroFlow Frontend — User Flows

> **Document:** `frontend-planning/user-flows.md`  
> **Status:** LOCKED  
> **Purpose:** Define the major V1 user journeys and the important states connecting them.

---

## 1. Password Login

```text
/login
  → enter email/password
  → submit
  → authentication succeeds
  → /dashboard
```

Failure:

```text
submit → invalid credentials → remain on /login → human-friendly error
```

## 2. Email OTP Login

```text
/login → choose Email Code → /otp → request OTP → enter OTP → verify → /dashboard
```

Resend is disabled during cooldown. Invalid, expired, or exhausted attempts remain on `/otp` with an appropriate human-friendly message.

## 3. Registration

```text
/register
  → enter email/password/confirmation
  → create account
  → success
  → /login
```

No separate email-verification step is introduced.

## 4. Forgot / Reset Password

```text
/login → Forgot Password → /forgot-password → submit email
  → generic confirmation → follow reset link → /reset-password
  → enter new password → success → /login
```

## 5. Complete Ticket Purchase

```text
/dashboard → New Journey → /journey/new
  → select origin → select destination → receive fare quote → confirm
  → create purchase → /journey/[purchaseId]/pay
  → Razorpay Checkout → payment submitted → Confirming Payment
```

The frontend callback is not payment authority. Continue only after backend payment status confirms success:

```text
Payment confirmed → ticket issued → /tickets/[ticketId]
  → show QR → Ready to board
```

Additional outcomes:

```text
Payment failure → valid retry
Delayed confirmation → Taking Longer Than Expected
Browser closed → reopen purchase → retrieve authoritative status
Expired fare quote → return/requote
```

## 6. Entry Gate Flow

```text
ISSUED ticket → READY_TO_ENTER → Proceed to Entry Gate → ENTRY_GATE
  → scan QR → SCANNING → PROCESSING → backend gate validation
```

Allow:

```text
backend gate validation returns ALLOW
  → backend Ticket IN_JOURNEY and Journey ACTIVE
  → frontend shows ENTRY ALLOWED
  → gate opening animation
  → ENTRY_ALLOWED
  → STATION
```

Reject:

```text
REJECT → human-readable reason → remain at gate
```

The frontend never manufactures `ALLOW`.

## 7. Metro Simulation Flow

```text
STATION → train arriving → Board Train → BOARDING → doors opening
  → TRAIN_DEPARTING → doors closing → IN_TRANSIT
  → ARRIVING_STATION → AT_STATION
```

At each intermediate station:

```text
AT_STATION → short stop → doors close → IN_TRANSIT toward next station
```

Repeat until the destination:

```text
ARRIVING_STATION → DESTINATION_REACHED
```

Show current and next station, passed and remaining stations, route progress, and train position throughout. Slow, Normal, and Fast affect only frontend animation timing; they never modify backend journey timing or state.

## 8. Exit Gate Flow

```text
DESTINATION_REACHED → Proceed to Exit Gate → EXIT_GATE
  → scan QR → SCANNING → PROCESSING → backend gate validation
```

Allow:

```text
backend gate validation returns ALLOW
  → backend Ticket COMPLETED and Journey COMPLETED
  → frontend shows EXIT ALLOWED
  → gate opening
  → JOURNEY_COMPLETED
  → Back to Dashboard
```

Reject:

```text
REJECT → human-readable reason
```

The frontend never marks the journey completed.

## 9. Journey Timeout Flow

```text
ACTIVE journey → backend time reaches/exceeds expires_at
  → TIMED_OUT recognized → simulator enters TIMED_OUT
  → stop/dim motion → explain exit can no longer succeed
  → contact station staff → Return to Dashboard
```

Backend timeout remains authoritative.

## 10. Returning User / Active Journey

```text
Close browser during active journey → later log in → /dashboard
  → active ticket/journey detected → View Journey / Resume Simulator
  → /simulator/[journeyId]
```

The frontend reconstructs the experience from authoritative backend ticket/journey state. Visual animation may restart without changing backend state.

## 11. Admin Flow

```text
Admin login → /admin → choose operational section
```

Sections:

```text
Stations/Gates · Tickets · Journeys · Payments · Gate Events
· Inconsistencies · Outbox
```

Stations and gates:

```text
/admin/stations → select/expand station → view gates
  → activate/deactivate gate where supported → refresh state
```

Other sections:

```text
Open section → filter/search → inspect record/details → return to list
```

`/admin/outbox` is read-only in V1.

## 12. Logout Flow

```text
/account → Logout → backend session revoked
  → frontend auth state cleared → /login
```

## 13. Flow Authority Rules

Frontend may control:

- Navigation
- Animations
- Simulator visual progression
- Loading and display states

Backend controls:

- Authentication
- Fare and purchase state
- Payment state
- Ticket issuance and ticket state
- Gate `ALLOW`/`REJECT`
- Journey state and timeout

The frontend must never advance a business-critical state merely because an animation, timer, Razorpay callback, or local UI transition completed.
