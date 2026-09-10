# MetroFlow Frontend — Content & Microcopy

> **Document:** `frontend-planning/content.md`  
> **Status:** LOCKED  
> **Purpose:** Define important V1 user-facing language and mappings from technical application states to clear product copy.

---

## 1. Voice & Tone

MetroFlow is clear, calm, direct, helpful, trustworthy, concise, modern, and transit-focused. Use short sentences and human language. Do not expose raw backend errors, developer terminology, unnecessary explanations, excessive exclamation marks, childish language, or fake marketing copy.

## 2. Navigation & Primary Actions

Use these labels consistently:

```text
New Journey · View Ticket · Resume Journey · Proceed to Payment
Pay with Razorpay · Retry Payment · Proceed to Entry Gate · Board Train
Proceed to Exit Gate · Back to Dashboard · Change Password · Log Out
```

## 3. Authentication

### Login

```text
Welcome back
Sign in to continue your journey.
Sign In · Email Code · Send Code · Forgot password? · Create Account
Email or password is incorrect.
We couldn't sign you in. Please try again.
```

### Registration

```text
Create your MetroFlow account
Create an account to buy tickets and manage your journeys.
Create Account · Already have an account? Sign in
Passwords don't match.
We couldn't create your account. Please try again.
```

### OTP

```text
Enter your code
We sent a 6-digit code to {email}.
Verify Code
You can request another code in {seconds}s.
Send another code
That code isn't correct. Try again.
That code has expired. Request a new one.
Too many incorrect attempts. Request a new code.
```

### Forgot and Reset Password

```text
Reset your password
Enter your email and we'll send you a reset link.
Send Reset Link
If an account exists for this email, we've sent password reset instructions.
Choose a new password
Update Password
Password updated.
You can now sign in with your new password.
This reset link is invalid or has expired.
Request a New Link
```

The forgot-password confirmation must not reveal whether an account exists.

## 4. Dashboard

Contextual greetings may use `Good morning`, `Good afternoon`, or `Good evening`. Use:

```text
Where are you going?
New Journey
Journey in progress
View Ticket · Resume Journey
No active journey
```

Do not create artificial urgency.

## 5. Journey Creation

```text
From · To · Search stations · Fare
Fare reserved for {time}
This fare quote has expired.
Refresh Fare
Choose a different destination.
Proceed to Payment
```

## 6. Payment

Communicate the distinct stages:

```text
Paying → Confirming → Confirmed
```

### States

| State | Copy |
|---|---|
| Ready | Complete your payment / Pay with Razorpay |
| Opening | Opening secure payment… |
| Confirming | Confirming payment / Your payment was submitted. We're confirming it securely. |
| Taking longer | Payment confirmation is taking longer than expected / Don't make another payment yet. We'll continue checking the status. |
| Confirmed | Payment confirmed / Your ticket is ready. / View Ticket |
| Failed | Payment unsuccessful / Your payment wasn't completed. / Retry Payment when permitted |

Do not show the ticket as ready until backend payment confirmation and ticket issuance. Do not imply every failed attempt permanently fails the Purchase.

Technical mappings:

```text
PAYMENT_INITIATION_IN_PROGRESS
→ Payment setup is already in progress.
→ Please wait while we prepare your payment.

PAYMENT_ATTEMPT_IN_PROGRESS
→ A payment attempt is already in progress.
→ Complete or wait for the current payment attempt before trying again.
```

The Razorpay callback is never authoritative.

## 7. Ticket

| State | Label | Supporting text |
|---|---|---|
| `ISSUED` | Ready to board | Scan this QR ticket at your entry gate. |
| `IN_JOURNEY` | Journey active | Your journey is in progress. |
| `COMPLETED` | Journey completed | This journey has been completed. |
| `EXPIRED` | Ticket expired | This ticket is no longer valid for entry. |

Actions are `Proceed to Entry Gate` for issued tickets and `Resume Journey` for active journeys. Use `Scan QR Ticket` and, optionally, `Keep the QR code fully visible when scanning.` Never cover the QR with unnecessary animation.

## 8. Entry Gate

```text
IDLE       → ENTRY GATE / Scan QR Ticket / Hold your QR near the scanner.
SCANNING   → Scanning ticket…
PROCESSING → Checking ticket…
ALLOW      → ENTRY ALLOWED / Welcome aboard / Gate opening…
```

Reject messages:

| Code | Passenger copy |
|---|---|
| `TICKET_NOT_FOUND` | Ticket not recognized. Check your QR ticket and try again. |
| `TICKET_EXPIRED` | Ticket expired. This ticket is no longer valid for entry. |
| `TICKET_COMPLETED` | Journey already completed. This ticket has already been used. |
| `TICKET_ALREADY_IN_JOURNEY` | Journey already active. This ticket has already been used for entry. |
| `WRONG_ORIGIN` | Wrong entry station. This ticket isn't valid for entry at this station. |
| `GATE_INACTIVE` | Gate unavailable. Please use another gate. |

When available, wrong-origin copy may add: `This ticket starts from {originStation}.`

## 9. Simulator

```text
READY_TO_ENTER   → Ready to board / Your ticket is ready for entry. / Proceed to Entry Gate
ENTRY_ALLOWED    → Entry allowed / Welcome aboard
STATION          → You're at {station} / Train arriving shortly
BOARDING         → Doors opening / Please mind the gap / Board Train
TRAIN_DEPARTING  → Departing {station}
IN_TRANSIT       → Next station / {nextStation} / Destination / {destination}
ARRIVING_STATION → Arriving at / {station}
AT_STATION       → Now at {station} / Doors opening
DESTINATION_REACHED → You've arrived at {destination} / Proceed to the exit gate
JOURNEY_COMPLETED  → Journey complete / Thanks for riding MetroFlow. / Back to Dashboard
```

`DESTINATION_REACHED` is visual only. Do not say `Journey completed` until backend exit validation returns `ALLOW` and the authoritative states are completed.

## 10. Exit Gate

```text
IDLE       → EXIT GATE / Scan QR Ticket
SCANNING   → Scanning ticket…
PROCESSING → Checking journey…
ALLOW      → EXIT ALLOWED / Thanks for riding MetroFlow / Gate opening…
```

| Code | Passenger copy |
|---|---|
| `WRONG_DESTINATION` | Wrong exit station. This ticket is valid for exit at {destinationStation}. |
| `NO_ACTIVE_JOURNEY` | No active journey found. This ticket doesn't have an active journey to exit. |
| `JOURNEY_TIMED_OUT` | Journey time expired. Your ticket can no longer be used for normal exit. Please contact station staff. |
| `GATE_INACTIVE` | Gate unavailable. Please use another gate. |

V1 allows exit only at the ticket destination; do not introduce early-exit messaging.

## 11. Journey Timeout

```text
Journey time expired
Your ticket can no longer be used for normal exit.
Please contact station staff.
Return to Dashboard
```

Do not imply that a frontend timer caused the timeout. Backend journey state remains authoritative.

## 12. Empty States

```text
No tickets yet
Your MetroFlow tickets will appear here.
New Journey

No journeys yet
Your completed and active journeys will appear here.
New Journey

No purchases yet
Your ticket purchases will appear here.

No active journey
Start a new journey when you're ready to travel.
New Journey

No results found
Try changing your search or filters.
```

## 13. Loading States

```text
Loading tickets… · Loading journeys… · Preparing payment…
Confirming payment… · Preparing your ticket… · Loading journey…
Preparing simulator… · Checking ticket… · Checking journey…
```

Prefer skeletons where structure is predictable. Do not rotate fake progress messages.

## 14. Network & Generic Errors

```text
We couldn't connect to MetroFlow.
Check your connection and try again.
Try Again

Something went wrong.
Please try again.
```

Never expose stack traces, SQL errors, provider errors, internal service names, or raw exceptions to passengers.

## 15. Admin Copy

Admin may display technical identifiers and backend states when useful:

```text
Purchase ID · Payment ID · Ticket ID · Journey ID
Gate ID · Request ID · Event ID
```

Operational information should remain clear enough for debugging.

## 16. Destructive Actions

Use specific labels such as `Deactivate Gate` and `Activate Gate`.

```text
Deactivate this gate?
Passengers will not be able to use this gate until it is activated again.
Cancel · Deactivate Gate
```

Avoid generic `Yes`, `OK`, or `Confirm` labels when a specific action is clearer.

## 17. Copy Consistency Rules

- Use `Log Out`, not `Logout`, `Sign Out`, or `Sign off`.
- Use `New Journey` consistently.
- Use `Resume Journey` for an `ACTIVE` journey.
- Use `Proceed to Entry Gate` and `Proceed to Exit Gate`.
- Use `Journey complete` only after authoritative exit completion.
- Use `Journey time expired` for `TIMED_OUT`.
- Use `Payment confirmed` only after authoritative backend confirmation.

## 18. Backend Code → Passenger Copy Rule

Maintain a centralized mapping from public-safe backend codes to product language:

```text
WRONG_ORIGIN      → Wrong entry station. This ticket starts from {originStation}.
JOURNEY_TIMED_OUT → Journey time expired. Please contact station staff.
WRONG_DESTINATION → Wrong exit station. This ticket is valid for exit at {destinationStation}.
Unknown code      → Something went wrong. Please try again.
```

Never manufacture a successful business state while handling an error.

## 19. Accessibility & Content

Do not rely on icons alone: use `✓ Entry allowed`, not only `✓`. Use clear labels such as `Proceed to Payment`, `Proceed to Entry Gate`, `Proceed to Exit Gate`, and `View Ticket`. Icon-only controls need screen-reader labels. Announce dynamic payment, gate, and simulator states accessibly without repeatedly interrupting users.

## 20. Content Freeze Rule

Minor grammar/layout adjustments and dynamic station/time/amount insertion are allowed. Backend codes map through centralized human-readable messages. Raw internal errors never appear in passenger UI, and copy must not change business-state meaning or introduce page-by-page terminology variants.
