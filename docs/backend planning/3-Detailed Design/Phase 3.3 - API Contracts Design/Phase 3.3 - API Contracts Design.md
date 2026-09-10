# MetroFlow — Phase 3.3: API Contracts Design

> **Document:** `architecture/phase-3-api-contracts.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 3 — Detailed Design
> **Section:** 3.3 — API Contracts Design
> **Status:** Approved
> **Depends on:** `phase-2-architecture.md`, `phase-3-repository-structure.md`, `phase-3-database-schema.md`

---

## 1. Purpose

This document defines every API contract for MetroFlow V1 — what clients can call, what they must send, what success returns, what errors can occur, what HTTP status represents them, what safe message the user sees, and what internal information stays only in logs.

It covers:

```
Global API conventions
Standard response and error envelopes
Error code registry
Auth APIs
Station APIs
Fare Quote APIs
Purchase APIs
Payment APIs (browser-facing via Core)
Ticket APIs
Journey APIs
Admin APIs
Gate Service APIs
Internal Core → Payment Service APIs
Razorpay webhook endpoint
Endpoint inventory
Authorization matrix
API decision register
Deferred decisions
```

Kafka event schemas are not REST contracts.

The payment-specific `payment.succeeded` event required by the payment flow
is defined in Phase 3.5.

System-wide Kafka conventions, event envelopes, consumer groups,
retry/DLQ behavior, ordering, idempotency, and schema evolution
are defined in Phase 3.7 — Kafka & Event Contracts.

---

## 2. Global API Conventions

### 2.1 Base URL and Versioning

All public APIs are versioned from day one.

```
Base path: /api/v1

Examples:
  /api/v1/auth/register
  /api/v1/fare-quotes
  /api/v1/tickets/{id}
```

The API Gateway routes `/api/v1/*` to Core API for all passenger and admin endpoints, and `/api/v1/gate/*` to Gate Service.

Internal service-to-service endpoints use `/internal/` prefix and are **not reachable through the API Gateway**.

```
Internal base: /internal/v1

Examples:
  /internal/v1/payments
  /internal/v1/gate/validate-entry
```

### 2.2 Authentication

**Passenger and Admin endpoints:**

```
Header: Authorization: Bearer <access_token>
```

The access token is a signed JWT. Short-lived — exact TTL defined in Phase 3.4.

The refresh token is delivered as an `httpOnly`, `SameSite=Strict` cookie named `refresh_token`. JavaScript cannot read it. It is sent automatically by the browser on refresh requests.

```
Cookie: refresh_token=<token>; HttpOnly; SameSite=Strict; Secure; Path=/api/v1/auth/refresh
```

**Gate Service endpoints:**

```
Header: X-Gate-Api-Key: <api_key>
```

A per-gate or per-simulator API key. Validated by Gate Service before forwarding to Core.

**Webhook endpoint (Razorpay → Payment Service):**

No bearer token. Verified via HMAC signature in `X-Razorpay-Signature` header.

**Internal endpoints:**

Not accessible through the API Gateway. No passenger or admin auth token. Internal network only. Exact internal service authentication mechanism (e.g. service credentials or mTLS) is deferred to Phase 3.11 — Observability, Security & Deployment.

### 2.3 Request ID

Every request receives a server-generated `requestId` (UUID v7). It is:

- Logged with every log line for the request
- Returned in every response (success and error)
- Propagated across service calls for distributed tracing

```
Response header: X-Request-Id: <uuid>
Response body:   "requestId": "<uuid>"
```

### 2.4 Content Type

All request and response bodies use:

```
Content-Type: application/json
```

### 2.5 Date and Time Format

All timestamps are **ISO 8601 with UTC timezone**:

```
"2025-08-15T10:35:00.000Z"
```

Never return Unix epoch integers or local timezone strings.

### 2.6 Money Representation

All monetary amounts are returned as **strings representing decimals** to avoid floating-point issues in JSON parsers:

```json
"amount": "40.00",
"currency": "INR"
```

Never return amounts as JSON numbers.

### 2.7 UUID Representation

All IDs are UUID v7 strings in standard hyphenated format:

```
"id": "01932b4c-7e3a-7f00-8b2a-4f1c9d3e2a1b"
```

### 2.8 Pagination

List endpoints that may return large result sets use cursor-based pagination.

**Request query parameters:**

```
limit   integer   Max items to return (default 20, max 100)
cursor  string    Opaque cursor from previous response (optional)
```

**Response envelope for paginated lists:**

```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "limit": 20,
      "hasMore": true,
      "nextCursor": "01932b4c-..."
    }
  },
  "requestId": "..."
}
```

`nextCursor` is `null` when there are no more results.

### 2.9 Idempotency Key Header

Gate requests must supply a client-generated idempotency key:

```
Header: Idempotency-Key: <uuid>
```

This maps to `request_id` in `gate_events`. Gate Service stores the result in Redis with TTL. On retry with the same key, the cached result is returned without re-executing business logic.

---

## 3. Standard Response Envelopes

### 3.1 Success Response

```json
{
  "success": true,
  "data": { ... },
  "requestId": "01932b4c-7e3a-7f00-8b2a-4f1c9d3e2a1b"
}
```

For endpoints that return no body (e.g. logout):

```json
{
  "success": true,
  "data": null,
  "requestId": "..."
}
```

### 3.2 Error Response

```json
{
  "success": false,
  "error": {
    "code": "FARE_QUOTE_EXPIRED",
    "message": "This fare quote has expired. Please select your journey again.",
    "details": null
  },
  "requestId": "01932b4c-7e3a-7f00-8b2a-4f1c9d3e2a1b"
}
```

| Field | Purpose |
|---|---|
| `error.code` | Stable machine-readable string for frontend logic |
| `error.message` | Safe, user-friendly message. Never exposes internals |
| `error.details` | Field-level validation errors only (see 3.3). `null` for business errors |
| `requestId` | Correlation ID for log lookup and support |

### 3.3 Validation Error Details

For `VALIDATION_ERROR` responses only, `details` contains field-level information:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid fields.",
    "details": [
      {
        "field": "originStationId",
        "message": "Origin station is required."
      },
      {
        "field": "destinationStationId",
        "message": "Destination station is required."
      }
    ]
  },
  "requestId": "..."
}
```

`details` must **never** contain SQL errors, stack traces, database constraint names, internal service names, Redis errors, or Kafka errors.

### 3.4 Internal Error Hiding Rule

| Internal condition | API response |
|---|---|
| `UNIQUE constraint violation` | Appropriate business error code (e.g. `TICKET_ALREADY_ISSUED`) |
| `Redis connection refused` | `SERVICE_TEMPORARILY_UNAVAILABLE` |
| `Kafka producer error` | `SERVICE_TEMPORARILY_UNAVAILABLE` |
| `Database connection timeout` | `SERVICE_TEMPORARILY_UNAVAILABLE` |
| `Payment Service unreachable` | `SERVICE_TEMPORARILY_UNAVAILABLE` |
| `NullPointerException / unhandled error` | `INTERNAL_ERROR` |
| `Razorpay API error` | `PAYMENT_PROVIDER_ERROR` |

The real technical error is always logged with the same `requestId`. The passenger never sees it.

---

## 4. Error Code Registry

Every business error has a stable code, HTTP status, and safe user-facing message.

### 4.1 Authentication Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | "The email or password you entered is incorrect." |
| `ACCOUNT_NOT_FOUND` | 404 | "No account found with this email address." |
| `TOKEN_EXPIRED` | 401 | "Your session has expired. Please log in again." |
| `TOKEN_INVALID` | 401 | "Your session is invalid. Please log in again." |
| `REFRESH_TOKEN_INVALID` | 401 | "Your session has expired. Please log in again." |
| `OTP_INVALID` | 400 | "The code you entered is incorrect." |
| `OTP_EXPIRED` | 400 | "This code has expired. Please request a new one." |
| `OTP_ALREADY_USED` | 400 | "This code has already been used. Please request a new one." |
| `OTP_RATE_LIMITED` | 429 | "Too many attempts. Please wait before requesting a new code." |
| `PASSWORD_RESET_TOKEN_INVALID` | 400 | "This password reset link is invalid." |
| `PASSWORD_RESET_TOKEN_EXPIRED` | 400 | "This password reset link has expired. Please request a new one." |
| `PASSWORD_RESET_TOKEN_USED` | 400 | "This password reset link has already been used." |
| `EMAIL_ALREADY_REGISTERED` | 409 | "An account with this email address already exists." |

### 4.2 Authorization Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `UNAUTHORIZED` | 401 | "Authentication is required to access this resource." |
| `FORBIDDEN` | 403 | "You do not have permission to access this resource." |

### 4.3 Station and Gate Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `STATION_NOT_FOUND` | 404 | "Station not found." |
| `GATE_NOT_FOUND` | 404 | "Gate not found." |
| `GATE_INACTIVE` | 422 | "This gate is currently unavailable." |

### 4.4 Fare and Quote Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `FARE_NOT_FOUND` | 404 | "No fare is available for this journey." |
| `SAME_ORIGIN_DESTINATION` | 422 | "Origin and destination stations must be different." |
| `FARE_QUOTE_NOT_FOUND` | 404 | "Fare quote not found." |
| `FARE_QUOTE_EXPIRED` | 422 | "This fare quote has expired. Please select your journey again." |
| `FARE_QUOTE_ALREADY_USED` | 409 | "This fare quote has already been used to create a purchase." |

### 4.5 Purchase Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `PURCHASE_NOT_FOUND` | 404 | "Purchase not found." |
| `PURCHASE_ALREADY_PAID` | 409 | "This purchase has already been paid." |

### 4.6 Payment Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `PAYMENT_NOT_FOUND` | 404 | "Payment not found." |
| `PAYMENT_ALREADY_COMPLETED` | 409 | "This payment has already been completed." |
| `PAYMENT_PROVIDER_ERROR` | 502 | "We were unable to process your payment. Please try again." |
| `PAYMENT_INITIATION_IN_PROGRESS` | 409 | "Payment setup is already in progress. Please wait a moment and try again." |
| `PAYMENT_ATTEMPT_IN_PROGRESS` | 409 | "A payment attempt is already in progress. Please complete it or wait for it to finish." |

### 4.7 Ticket Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `TICKET_NOT_FOUND` | 404 | "Ticket not found." |
| `TICKET_ALREADY_ISSUED` | 409 | "A ticket has already been issued for this purchase." |
| `TICKET_EXPIRED` | 422 | "This ticket has expired." |
| `TICKET_ALREADY_USED` | 422 | "This ticket has already been used for a completed journey." |
| `TICKET_IN_JOURNEY` | 422 | "This ticket is already being used for an active journey." |

### 4.8 Gate Validation Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `TICKET_NOT_FOUND` | 404 | "Ticket not found." |
| `WRONG_ENTRY_STATION` | 422 | "This ticket is not valid for entry at this station." |
| `WRONG_EXIT_STATION` | 422 | "This ticket is not valid for exit at this station." |
| `NO_ACTIVE_JOURNEY` | 422 | "No active journey found for this ticket." |
| `JOURNEY_TIMED_OUT` | 422 | "Your journey time limit has been exceeded. Please contact station staff." |

### 4.9 Journey Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `JOURNEY_NOT_FOUND` | 404 | "Journey not found." |

### 4.10 System Errors

| Code | HTTP | User-Facing Message |
|---|---|---|
| `VALIDATION_ERROR` | 400 | "The request contains invalid fields." |
| `NOT_FOUND` | 404 | "The requested resource was not found." |
| `INTERNAL_ERROR` | 500 | "Something went wrong on our end. Please try again." |
| `SERVICE_TEMPORARILY_UNAVAILABLE` | 503 | "We couldn't complete your request right now. Please try again shortly." |

---

## 5. Auth APIs

**Base path:** `/api/v1/auth`
**Ownership:** Core API
**Access:** Public (no auth required)

---

### POST /api/v1/auth/register

Register a new passenger account.

**Request body:**

```json
{
  "email": "passenger@example.com",
  "password": "SecurePass123!"
}
```

**Validation:**

```
email     required, valid email format, max 255 chars
password  required, min 8 chars, max 128 chars
```

**Success — 201 Created:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "01932b4c-...",
      "email": "passenger@example.com",
      "role": "PASSENGER"
    },
    "accessToken": "eyJ..."
  },
  "requestId": "..."
}
```

Refresh token set as `httpOnly` cookie.

**Errors:**

| Code | When |
|---|---|
| `EMAIL_ALREADY_REGISTERED` | Email already exists |
| `VALIDATION_ERROR` | Invalid email or password too short |

---

### POST /api/v1/auth/login

Login with email and password.

**Request body:**

```json
{
  "email": "passenger@example.com",
  "password": "SecurePass123!"
}
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "01932b4c-...",
      "email": "passenger@example.com",
      "role": "PASSENGER"
    },
    "accessToken": "eyJ..."
  },
  "requestId": "..."
}
```

Refresh token set as `httpOnly` cookie.

**Errors:**

| Code | When |
|---|---|
| `INVALID_CREDENTIALS` | Wrong email or password |
| `VALIDATION_ERROR` | Missing fields |

---

### POST /api/v1/auth/otp/request

Request a one-time login code sent to the passenger's email.

**Request body:**

```json
{
  "email": "passenger@example.com"
}
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "message": "If an account exists for this email, a login code has been sent."
  },
  "requestId": "..."
}
```

Response is the same whether or not the account exists — prevents email enumeration.

**Errors:**

| Code | When |
|---|---|
| `OTP_RATE_LIMITED` | Too many OTP requests in window |
| `VALIDATION_ERROR` | Invalid email format |

---

### POST /api/v1/auth/otp/verify

Verify a one-time login code and issue tokens.

**Request body:**

```json
{
  "email": "passenger@example.com",
  "code": "847291"
}
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "01932b4c-...",
      "email": "passenger@example.com",
      "role": "PASSENGER"
    },
    "accessToken": "eyJ..."
  },
  "requestId": "..."
}
```

Refresh token set as `httpOnly` cookie.

**Errors:**

| Code | When |
|---|---|
| `OTP_INVALID` | Code does not match |
| `OTP_EXPIRED` | Code TTL has elapsed |
| `OTP_ALREADY_USED` | Code already consumed |
| `ACCOUNT_NOT_FOUND` | No account for this email |
| `OTP_RATE_LIMITED` | Too many failed attempts |

---

### POST /api/v1/auth/refresh

Exchange a valid refresh token cookie for a new access token.

**Request:** No body. Refresh token read from `httpOnly` cookie automatically.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ..."
  },
  "requestId": "..."
}
```

New refresh token set as `httpOnly` cookie (token rotation).

**Errors:**

| Code | When |
|---|---|
| `REFRESH_TOKEN_INVALID` | Cookie missing, tampered, or already rotated |
| `TOKEN_EXPIRED` | Refresh token TTL has elapsed |

---

### POST /api/v1/auth/logout

Invalidate the current session.

**Auth:** Bearer token required.

**Request:** No body.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": null,
  "requestId": "..."
}
```

Refresh token cookie is cleared. Exact server-side token invalidation strategy is a Phase 3.4 decision.

---

### POST /api/v1/auth/password/forgot

Request a password reset email.

**Request body:**

```json
{
  "email": "passenger@example.com"
}
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "message": "If an account exists for this email, a password reset link has been sent."
  },
  "requestId": "..."
}
```

Same response whether account exists or not — prevents enumeration.

**Errors:**

| Code | When |
|---|---|
| `VALIDATION_ERROR` | Invalid email format |

---

### POST /api/v1/auth/password/reset

Reset password using a valid reset token.

**Request body:**

```json
{
  "token": "abc123...",
  "newPassword": "NewSecurePass456!"
}
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "message": "Your password has been reset successfully."
  },
  "requestId": "..."
}
```

**Errors:**

| Code | When |
|---|---|
| `PASSWORD_RESET_TOKEN_INVALID` | Token not found or tampered |
| `PASSWORD_RESET_TOKEN_EXPIRED` | Token TTL elapsed |
| `PASSWORD_RESET_TOKEN_USED` | Token already consumed |
| `VALIDATION_ERROR` | Password too short or missing |

---

## 6. Station APIs

**Base path:** `/api/v1/stations`
**Ownership:** Core API
**Access:** Passenger-authenticated

---

### GET /api/v1/stations

List all active stations. Used to populate journey selection UI.

**Auth:** Bearer token required.

**Query parameters:** None (station list is small; no pagination in V1).

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "stations": [
      {
        "id": "01932b4c-...",
        "code": "RAJIV_CHOWK",
        "name": "Rajiv Chowk"
      },
      {
        "id": "01932b4c-...",
        "code": "HAUZ_KHAS",
        "name": "Hauz Khas"
      }
    ]
  },
  "requestId": "..."
}
```

Only `is_active = TRUE` stations are returned. Inactive stations are not exposed to passengers.

---

## 7. Fare Quote APIs

**Base path:** `/api/v1/fare-quotes`
**Ownership:** Core API
**Access:** Passenger-authenticated

---

### POST /api/v1/fare-quotes

Calculate an authoritative fare for a requested journey and issue a time-limited fare quote.

**Auth:** Bearer token required.

**Request body:**

```json
{
  "originStationId": "01932b4c-...",
  "destinationStationId": "01932b4c-..."
}
```

**Validation:**

```
originStationId       required, valid UUID, must exist and be active
destinationStationId  required, valid UUID, must exist and be active
originStationId !== destinationStationId
```

**Success — 201 Created:**

```json
{
  "success": true,
  "data": {
    "fareQuote": {
      "id": "01932b4c-...",
      "originStation": {
        "id": "01932b4c-...",
        "code": "RAJIV_CHOWK",
        "name": "Rajiv Chowk"
      },
      "destinationStation": {
        "id": "01932b4c-...",
        "code": "HAUZ_KHAS",
        "name": "Hauz Khas"
      },
      "amount": "40.00",
      "currency": "INR",
      "expiresAt": "2025-08-15T10:45:00.000Z"
    }
  },
  "requestId": "..."
}
```

**Errors:**

| Code | When |
|---|---|
| `SAME_ORIGIN_DESTINATION` | Same station selected for both |
| `STATION_NOT_FOUND` | Either station ID does not exist |
| `FARE_NOT_FOUND` | No active fare rule for this route |
| `VALIDATION_ERROR` | Missing or malformed fields |

**Notes:**
- The client must not send a fare amount — the server calculates it
- Quote is valid for 10 minutes from `expiresAt`
- `fareQuote.id` is used when creating a purchase

---

## 8. Purchase APIs

**Base path:** `/api/v1/purchases`
**Ownership:** Core API
**Access:** Passenger-authenticated

---

### POST /api/v1/purchases

Create a purchase from a valid fare quote.

**Auth:** Bearer token required.

**Request body:**

```json
{
  "fareQuoteId": "01932b4c-..."
}
```

**Validation:**

```
fareQuoteId   required, valid UUID
```

**Business rules enforced:**
- Fare quote must exist and belong to the authenticated user
- Fare quote must not be expired
- Fare quote must not already have been used for another purchase

**Success — 201 Created:**

```json
{
  "success": true,
  "data": {
    "purchase": {
      "id": "01932b4c-...",
      "originStation": {
        "id": "...",
        "code": "RAJIV_CHOWK",
        "name": "Rajiv Chowk"
      },
      "destinationStation": {
        "id": "...",
        "code": "HAUZ_KHAS",
        "name": "Hauz Khas"
      },
      "amount": "40.00",
      "currency": "INR",
      "status": "CREATED",
      "createdAt": "2025-08-15T10:35:00.000Z"
    }
  },
  "requestId": "..."
}
```

**Errors:**

| Code | When |
|---|---|
| `FARE_QUOTE_NOT_FOUND` | Quote ID not found or belongs to another user |
| `FARE_QUOTE_EXPIRED` | Quote validity window has elapsed |
| `FARE_QUOTE_ALREADY_USED` | Quote already consumed by another purchase |
| `VALIDATION_ERROR` | Missing or malformed fields |

---

### GET /api/v1/purchases/{purchaseId}

Retrieve a specific purchase and its current status.

**Auth:** Bearer token required.

**Authorization:** Passenger may only retrieve their own purchases.

**Path parameter:** `purchaseId` — UUID

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "purchase": {
      "id": "01932b4c-...",
      "originStation": { "id": "...", "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
      "destinationStation": { "id": "...", "code": "HAUZ_KHAS", "name": "Hauz Khas" },
      "amount": "40.00",
      "currency": "INR",
      "status": "TICKET_ISSUED",
      "createdAt": "2025-08-15T10:35:00.000Z"
    }
  },
  "requestId": "..."
}
```

`status` reflects Core's purchase lifecycle: `CREATED | PAYMENT_PENDING | PAID | TICKET_ISSUED`

**Errors:**

| Code | When |
|---|---|
| `PURCHASE_NOT_FOUND` | ID not found or belongs to another user |

---

### GET /api/v1/purchases

List the authenticated passenger's purchases.

**Auth:** Bearer token required.

**Query parameters:** `limit`, `cursor`

**Success — 200 OK:** Paginated list of purchases (same shape as single purchase response, wrapped in `items` array).

---

## 9. Payment APIs (Browser-Facing via Core)

Passengers never call Payment Service directly. Payment initiation goes:

```
Next.js → Core API → Payment Service (internal)
```

**Base path:** `/api/v1/payments`
**Ownership:** Core API (public-facing layer)
**Access:** Passenger-authenticated

---

### POST /api/v1/payments/initiate

Initiate payment for a purchase. Core calls Payment Service internally and returns a Razorpay session to the frontend.

**Auth:** Bearer token required.

**Request body:**

```json
{
  "purchaseId": "01932b4c-..."
}
```

**Business rules enforced:**
- Purchase must exist.
- Purchase must belong to the authenticated user.
- Purchase.status may be `CREATED` or `PAYMENT_PENDING`.
- `PAID` or `TICKET_ISSUED` returns `PURCHASE_ALREADY_PAID`.
- When Purchase.status = `PAYMENT_PENDING`, Core still forwards the initiation request to Payment Service.
- Payment Service decides whether an initiation reservation is already `IN_PROGRESS`, an active `PENDING` PaymentAttempt already exists, the previous attempt `FAILED` and a new attempt may be created, or the parent Payment is already `SUCCESS`.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "01932b4c-...",
      "purchaseId": "01932b4c-...",
      "amount": "40.00",
      "currency": "INR",
      "razorpayOrderId": "order_xyz123",
      "razorpayKeyId": "rzp_test_xxx"
    }
  },
  "requestId": "..."
}
```

The frontend uses `razorpayOrderId` and `razorpayKeyId` to open the Razorpay checkout widget.

**Errors:**

| Code | When |
|---|---|
| `PURCHASE_NOT_FOUND` | Purchase not found or belongs to another user |
| `PURCHASE_ALREADY_PAID` | Purchase status is `PAID` or `TICKET_ISSUED` |
| `PAYMENT_INITIATION_IN_PROGRESS` | A durable initiation reservation is already `IN_PROGRESS` |
| `PAYMENT_ATTEMPT_IN_PROGRESS` | An active `PENDING` PaymentAttempt/Razorpay Order already exists |
| `PAYMENT_PROVIDER_ERROR` | Razorpay order creation failed |
| `SERVICE_TEMPORARILY_UNAVAILABLE` | Payment Service unreachable |

**Notes:**
- Core sets `purchases.status = PAYMENT_PENDING` when this succeeds
- Core does not wait for payment completion — it returns the Razorpay session immediately
- The passenger completes payment in the Razorpay checkout widget

---

### GET /api/v1/payments/{paymentId}

Get payment status for a specific payment. Used by the frontend to poll for outcome after checkout.

**Auth:** Bearer token required.

**Authorization:** Passenger may only retrieve payments for their own purchases.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "01932b4c-...",
      "purchaseId": "01932b4c-...",
      "amount": "40.00",
      "currency": "INR",
      "status": "PENDING",
      "latestAttemptStatus": "FAILED"
    }
  },
  "requestId": "..."
}
```

`payment.status` values returned to client: `CREATED | PENDING | SUCCESS`

`latestAttemptStatus` values: `PENDING | SUCCESS | FAILED | null`

Core retrieves payment status by calling Payment Service's internal status endpoint.
Only safe payment state required for passenger UX is exposed.

`latestAttemptStatus` is exposed so the frontend can distinguish a payment still
being processed from a failed attempt that can be retried.

Razorpay payment IDs, signatures, provider payloads, provider error internals,
and full attempt history are never exposed to the passenger.

**Errors:**

| Code | When |
|---|---|
| `PAYMENT_NOT_FOUND` | Payment not found or belongs to another user |

---

## 10. Ticket APIs

**Base path:** `/api/v1/tickets`
**Ownership:** Core API
**Access:** Passenger-authenticated

---

### GET /api/v1/tickets

List the authenticated passenger's tickets.

**Auth:** Bearer token required.

**Query parameters:**

```
status    optional, filter by: ISSUED | IN_JOURNEY | COMPLETED | EXPIRED
limit     optional, default 20
cursor    optional
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "purchaseId": "01932b4c-...",
        "originStation": { "id": "...", "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
        "destinationStation": { "id": "...", "code": "HAUZ_KHAS", "name": "Hauz Khas" },
        "paidAmount": "40.00",
        "currency": "INR",
        "status": "ISSUED",
        "issuedAt": "2025-08-15T10:36:00.000Z",
        "expiresAt": "2025-08-15T23:59:59.000Z"
      }
    ],
    "pagination": {
      "limit": 20,
      "hasMore": false,
      "nextCursor": null
    }
  },
  "requestId": "..."
}
```

---

### GET /api/v1/tickets/{ticketId}

Get a specific ticket including its QR identifier.

**Auth:** Bearer token required.

**Authorization:** Passenger may only retrieve their own tickets.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "ticket": {
      "id": "01932b4c-...",
      "purchaseId": "01932b4c-...",
      "originStation": { "id": "...", "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
      "destinationStation": { "id": "...", "code": "HAUZ_KHAS", "name": "Hauz Khas" },
      "paidAmount": "40.00",
      "currency": "INR",
      "status": "ISSUED",
      "identifier": "01932b4c-...",
      "issuedAt": "2025-08-15T10:36:00.000Z",
      "expiresAt": "2025-08-15T23:59:59.000Z"
    }
  },
  "requestId": "..."
}
```

`identifier` is the value encoded in the QR code. In V1, this is the ticket `id`. The Gate Simulator presents this to the gate.

**Errors:**

| Code | When |
|---|---|
| `TICKET_NOT_FOUND` | Ticket not found or belongs to another user |

---

## 11. Journey APIs

**Base path:** `/api/v1/journeys`
**Ownership:** Core API
**Access:** Passenger-authenticated

---

### GET /api/v1/journeys

List the authenticated passenger's journeys.

**Auth:** Bearer token required.

**Query parameters:**

```
status    optional, filter by: ACTIVE | COMPLETED | TIMED_OUT
limit     optional, default 20
cursor    optional
```

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "ticketId": "01932b4c-...",
        "entryStation": { "id": "...", "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
        "exitStation": { "id": "...", "code": "HAUZ_KHAS", "name": "Hauz Khas" },
        "status": "COMPLETED",
        "enteredAt": "2025-08-15T10:40:00.000Z",
        "exitedAt": "2025-08-15T11:10:00.000Z",
        "expiresAt": "2025-08-15T13:10:00.000Z"
      }
    ],
    "pagination": {
      "limit": 20,
      "hasMore": false,
      "nextCursor": null
    }
  },
  "requestId": "..."
}
```

`exitStation` and `exitedAt` are `null` for `ACTIVE` journeys.

---

### GET /api/v1/journeys/{journeyId}

Get a specific journey.

**Auth:** Bearer token required.
**Authorization:** Passenger may only retrieve their own journeys.

**Success — 200 OK:** Single journey (same shape as list item).

**Errors:**

| Code | When |
|---|---|
| `JOURNEY_NOT_FOUND` | Journey not found or belongs to another user |

---

## 12. Admin APIs

**Base path:** `/api/v1/admin`
**Ownership:** Core API
**Access:** Admin role required

All admin endpoints require `Authorization: Bearer <admin_access_token>` where the JWT contains `role: ADMIN`. Passengers cannot access any `/admin/` route.

---

### GET /api/v1/admin/stations

List all stations including inactive ones.

**Success — 200 OK:** Full station list including `is_active` field.

---

### GET /api/v1/admin/gates

List all gates across all stations.

**Query parameters:** `stationId` (optional filter), `status` (optional: `ACTIVE | INACTIVE`)

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "station": { "id": "...", "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
        "code": "GATE-A1",
        "type": "ENTRY",
        "status": "ACTIVE"
      }
    ]
  },
  "requestId": "..."
}
```

---

### PATCH /api/v1/admin/gates/{gateId}/status

Change a gate's operational status between `ACTIVE` and `INACTIVE`.

**Request body:**

```json
{
  "status": "INACTIVE"
}
```

**Validation:** `status` must be `ACTIVE` or `INACTIVE`.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "gate": {
      "id": "01932b4c-...",
      "code": "GATE-A1",
      "status": "INACTIVE",
      "updatedAt": "2025-08-15T10:35:00.000Z"
    }
  },
  "requestId": "..."
}
```

**Business rule:** Gate status changes take effect immediately on subsequent validation requests. This is the only mutation admin can perform in V1.

**Errors:**

| Code | When |
|---|---|
| `GATE_NOT_FOUND` | Gate ID not found |
| `VALIDATION_ERROR` | Invalid status value |

---

### GET /api/v1/admin/tickets

List all tickets across all passengers. Paginated.

**Query parameters:** `status`, `userId`, `limit`, `cursor`

**Success — 200 OK:** Paginated ticket list (same shape as passenger ticket list with additional `userId` field).

---

### GET /api/v1/admin/journeys

List all journeys. Paginated.

**Query parameters:** `status`, `userId`, `limit`, `cursor`

---

### GET /api/v1/admin/gate-events

List gate events. Paginated.

**Query parameters:** `ticketId`, `stationId`, `gateId`, `eventType`, `limit`, `cursor`

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "gate": { "id": "...", "code": "GATE-A1" },
        "station": { "id": "...", "name": "Rajiv Chowk" },
        "ticketId": "01932b4c-...",
        "eventType": "ENTRY_REJECTED",
        "rejectionReason": "WRONG_ORIGIN",
        "occurredAt": "2025-08-15T10:30:00.000Z"
      }
    ],
    "pagination": { "limit": 20, "hasMore": true, "nextCursor": "..." }
  },
  "requestId": "..."
}
```

---

### GET /api/v1/admin/payments

List all payments across purchases. Paginated. Calls Payment Service internally to assemble payment data.

**Query parameters:** `status`, `purchaseId`, `limit`, `cursor`

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "purchaseId": "01932b4c-...",
        "amount": "40.00",
        "currency": "INR",
        "status": "SUCCESS"
      }
    ],
    "pagination": { "limit": 20, "hasMore": false, "nextCursor": null }
  },
  "requestId": "..."
}
```

Razorpay order IDs and signatures are **not** exposed in admin API responses. They remain in Payment Service's database for internal reconciliation only.

---

### GET /api/v1/admin/inconsistencies

List payment-success / ticket-missing inconsistencies for admin review.

Returns purchases where `status = PAID` but no associated ticket exists.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "purchaseId": "01932b4c-...",
        "userId": "01932b4c-...",
        "amount": "40.00",
        "currency": "INR",
        "paidAt": "2025-08-15T10:36:00.000Z"
      }
    ]
  },
  "requestId": "..."
}
```

---

### GET /api/v1/admin/outbox/dead

List dead outbox events requiring investigation.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01932b4c-...",
        "eventType": "TICKET_ISSUED",
        "topic": "ticket.issued",
        "attempts": 5,
        "lastAttemptedAt": "2025-08-15T10:40:00.000Z",
        "errorMessage": "Kafka broker unavailable"
      }
    ]
  },
  "requestId": "..."
}
```

**Note:** `errorMessage` is surfaced to admin only — never to passengers.

---

## 13. Gate Service APIs

**Base path:** `/api/v1/gate`
**Ownership:** Gate Service (proxies to Core)
**Access:** Gate-authenticated (`X-Gate-Api-Key`)

The Gate API key must never be exposed to browser JavaScript. The Gate Simulator browser calls a Next.js server/BFF route. The Next.js server stores the Gate API key securely and forwards the request to Gate Service.

```
Browser Gate Simulator
        ↓
Next.js server/BFF
        ↓ X-Gate-Api-Key
API Gateway
        ↓
Gate Service
```

Gate Simulator (Next.js) calls these endpoints via the API Gateway. Gate Service authenticates the request, enforces rate limiting and idempotency, then calls Core internally.

---

### POST /api/v1/gate/validate-entry

Submit a ticket for entry gate validation.

**Auth:** `X-Gate-Api-Key` header required.
**Idempotency:** `Idempotency-Key` header required.

**Request body:**

```json
{
  "gateId": "01932b4c-...",
  "ticketIdentifier": "01932b4c-..."
}
```

**Validation:**

```
gateId             required, valid UUID
ticketIdentifier   required, non-empty string
Idempotency-Key    required header
```

**Success — 200 OK (ALLOW):**

```json
{
  "success": true,
  "data": {
    "decision": "ALLOW",
    "ticket": {
      "id": "01932b4c-...",
      "originStation": { "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
      "destinationStation": { "code": "HAUZ_KHAS", "name": "Hauz Khas" }
    },
    "journey": {
      "id": "01932b4c-...",
      "enteredAt": "2025-08-15T10:40:00.000Z",
      "expiresAt": "2025-08-15T13:10:00.000Z"
    }
  },
  "requestId": "..."
}
```

**Success — 200 OK (REJECT):**

```json
{
  "success": true,
  "data": {
    "decision": "REJECT",
    "rejectionCode": "WRONG_ORIGIN",
    "message": "This ticket is not valid for entry at this station."
  },
  "requestId": "..."
}
```

Gate validation decisions (ALLOW and REJECT) both return HTTP 200. The `decision` field carries the business outcome. HTTP error codes are reserved for system-level failures (service unavailable, auth failure).

**System errors:**

| Code | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `VALIDATION_ERROR` | 400 | Missing gateId or ticketIdentifier |
| `SERVICE_TEMPORARILY_UNAVAILABLE` | 503 | Core unreachable |

**Idempotency behavior:**

```
First request with Idempotency-Key: REQ-100
→ Processed normally, result cached in Redis

Second request with Idempotency-Key: REQ-100
→ Cached result returned (no business logic re-executed)
→ Same response as first request
```

---

### POST /api/v1/gate/validate-exit

Submit a ticket for exit gate validation.

**Auth:** `X-Gate-Api-Key` header required.
**Idempotency:** `Idempotency-Key` header required.

**Request body:**

```json
{
  "gateId": "01932b4c-...",
  "ticketIdentifier": "01932b4c-..."
}
```

**Success — 200 OK (ALLOW):**

```json
{
  "success": true,
  "data": {
    "decision": "ALLOW",
    "ticket": {
      "id": "01932b4c-...",
      "originStation": { "code": "RAJIV_CHOWK", "name": "Rajiv Chowk" },
      "destinationStation": { "code": "HAUZ_KHAS", "name": "Hauz Khas" }
    },
    "journey": {
      "id": "01932b4c-...",
      "enteredAt": "2025-08-15T10:40:00.000Z",
      "exitedAt": "2025-08-15T11:10:00.000Z"
    }
  },
  "requestId": "..."
}
```

**Success — 200 OK (REJECT):** Same shape as entry reject with appropriate `rejectionCode`.

**Rejection codes for exit:**

```
NO_ACTIVE_JOURNEY
WRONG_EXIT_STATION
JOURNEY_TIMED_OUT
GATE_INACTIVE
TICKET_NOT_FOUND
```

---

## 14. Internal Core → Payment Service APIs

**Base path:** `/internal/v1`
**Ownership:** Payment Service
**Access:** Internal network only. Not reachable through API Gateway.
**Auth:** Internal service authentication mechanism — Phase 3.11 — Observability, Security & Deployment.

These endpoints are called by Core API. The browser never calls them.

---

### POST /internal/v1/payments

Initiate or resume the payment lifecycle for a Purchase.

Payment Service owns one parent Payment per Purchase.

Depending on current durable state, this operation may:

- create the parent Payment if it does not exist,
- return a previously completed idempotent initiation result,
- report that initiation is already `IN_PROGRESS`,
- return/report an existing active `PENDING` PaymentAttempt,
- create the first PaymentAttempt,
- create a new PaymentAttempt after the previous attempt has `FAILED`,
- reject initiation if the parent Payment is already `SUCCESS`.

**Request body:**

```json
{
  "purchaseId": "01932b4c-...",
  "userId": "01932b4c-...",
  "amount": "40.00",
  "currency": "INR"
}
```

**Header:** `Idempotency-Key: <uuid>`

Payment Service generates `paymentId`. Core supplies `purchaseId` and the idempotency key. If the request is retried, Payment Service returns the already-created Payment instead of creating another one.

**Success — 201 Created:**

```json
{
  "success": true,
  "data": {
    "paymentId": "01932b4c-...",
    "paymentAttemptId": "01932b4c-...",
    "razorpayOrderId": "order_xyz123",
    "razorpayKeyId": "rzp_test_xxx",
    "amount": "40.00",
    "currency": "INR"
  },
  "requestId": "..."
}
```

**Errors:**

| Code | When |
|---|---|
| `PAYMENT_INITIATION_IN_PROGRESS` | An `IN_PROGRESS` initiation reservation already exists. |
| `PAYMENT_ATTEMPT_IN_PROGRESS` | A `PENDING` PaymentAttempt already exists. |
| `PAYMENT_ALREADY_COMPLETED` | `paymentId` already has a successful attempt |
| `PAYMENT_PROVIDER_ERROR` | Provider definitively failed to create the Razorpay Order. |

---

### GET /internal/v1/payments/{paymentId}

Get current payment status. Called by Core when the passenger polls `GET /api/v1/payments/{id}`.

**Success — 200 OK:**

```json
{
  "success": true,
  "data": {
    "paymentId": "01932b4c-...",
    "purchaseId": "01932b4c-...",
    "status": "PENDING",
    "latestAttemptStatus": "FAILED",
    "amount": "40.00",
    "currency": "INR"
  },
  "requestId": "..."
}
```

The internal endpoint exposes parent Payment status and the safe latest
PaymentAttempt status required by Core.

It does not expose Razorpay signatures, raw provider events, provider credentials,
or unnecessary provider internals.

---

### GET /internal/v1/payments?purchaseId={purchaseId}

Get payment status by purchase ID. Used for admin inconsistency queries.

**Success — 200 OK:** Same shape as single payment status response.

---

## 15. Razorpay Webhook Endpoint

**Ownership:** Payment Service
**Access:** Razorpay servers only. Verified by HMAC signature.
**Not routed through API Gateway.**

---

### POST /webhooks/razorpay

Receive payment event notifications from Razorpay.

**Headers:**

```
X-Razorpay-Signature: <hmac_sha256_signature>
Content-Type: application/json
```

**Request body:** Razorpay webhook payload (see Razorpay documentation).

The exact raw HTTP request bytes are retained transiently in memory for HMAC
verification. After signature verification succeeds, the parsed webhook JSON
payload is stored as PostgreSQL JSONB in `provider_events.raw_payload`.
`provider_events.raw_payload` is not a byte-identical copy of the HTTP body.

**Processing:**

```
1. Capture exact raw request bytes.

2. Verify HMAC signature.
   → Invalid: return HTTP 400.
   → Do not mutate payment state.

3. Parse JSON after successful verification.

4. Resolve provider event / PaymentAttempt and determine event category.

5. Process transactionally:

   payment.captured
   → persist provider event
   → PaymentAttempt PENDING → SUCCESS
   → Payment PENDING → SUCCESS
   → insert payment.succeeded outbox event

   payment.failed
   → persist provider event
   → PaymentAttempt PENDING → FAILED
   → parent Payment remains PENDING

   Unknown Razorpay Order
   → persist provider event with payment_id = NULL
   → inconsistency_code = UNKNOWN_RAZORPAY_ORDER
   → no Payment/Attempt mutation

   Amount mismatch
   → persist provider event
   → inconsistency_code = PAYMENT_AMOUNT_MISMATCH
   → no Payment SUCCESS
   → no payment.succeeded

   Contradictory terminal event
   → persist provider event
   → inconsistency_code = PAYMENT_STATE_INCONSISTENCY
   → do not reverse terminal financial state

6. Duplicate committed provider event
   → HTTP 200
   → no repeated business effects

7. HTTP 200 only after all required durable effects for that event category commit.

8. Temporary internal/database failure before required commit
   → rollback
   → HTTP 5xx so Razorpay retries.
```

`provider_events` is INSERT-only. The final `inconsistency_code` is determined
before the provider-event row is inserted.

**Success — 200 OK:**

```json
{ "received": true }
```

Razorpay stops retrying after a successful 200 response. Payment Service returns 5xx when a temporary internal or database failure occurs before durable persistence so Razorpay can retry.

**Failure — 400 Bad Request:** Returned for an invalid HMAC signature.

---

## 16. Endpoint Inventory

### Core API — Public Passenger Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/v1/auth/register | Public | Register new account |
| POST | /api/v1/auth/login | Public | Login with password |
| POST | /api/v1/auth/otp/request | Public | Request OTP |
| POST | /api/v1/auth/otp/verify | Public | Verify OTP and login |
| POST | /api/v1/auth/refresh | Cookie | Refresh access token |
| POST | /api/v1/auth/logout | Bearer | Logout |
| POST | /api/v1/auth/password/forgot | Public | Request reset email |
| POST | /api/v1/auth/password/reset | Public | Reset password |
| GET | /api/v1/stations | Bearer | List active stations |
| POST | /api/v1/fare-quotes | Bearer | Create fare quote |
| POST | /api/v1/purchases | Bearer | Create purchase |
| GET | /api/v1/purchases | Bearer | List own purchases |
| GET | /api/v1/purchases/{id} | Bearer | Get purchase |
| POST | /api/v1/payments/initiate | Bearer | Initiate payment |
| GET | /api/v1/payments/{id} | Bearer | Get payment status |
| GET | /api/v1/tickets | Bearer | List own tickets |
| GET | /api/v1/tickets/{id} | Bearer | Get ticket + QR identifier |
| GET | /api/v1/journeys | Bearer | List own journeys |
| GET | /api/v1/journeys/{id} | Bearer | Get journey |

### Core API — Admin Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/v1/admin/stations | Admin | List all stations |
| GET | /api/v1/admin/gates | Admin | List all gates |
| PATCH | /api/v1/admin/gates/{id}/status | Admin | Change gate status |
| GET | /api/v1/admin/tickets | Admin | List all tickets |
| GET | /api/v1/admin/journeys | Admin | List all journeys |
| GET | /api/v1/admin/gate-events | Admin | List gate events |
| GET | /api/v1/admin/payments | Admin | List all payments |
| GET | /api/v1/admin/inconsistencies | Admin | Payment/ticket inconsistencies |
| GET | /api/v1/admin/outbox/dead | Admin | Dead outbox events |

### Gate Service Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/v1/gate/validate-entry | Gate API Key | Entry validation |
| POST | /api/v1/gate/validate-exit | Gate API Key | Exit validation |

### Payment Service — Internal Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /internal/v1/payments | Internal | Create payment + Razorpay order |
| GET | /internal/v1/payments/{id} | Internal | Get payment status |
| GET | /internal/v1/payments?purchaseId= | Internal | Get payment by purchase |
| POST | /webhooks/razorpay | HMAC | Razorpay webhook receiver |

### Operational Endpoints (all services)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /health | None | Available as required for deployment/load-balancer health checks |
| GET | /metrics | Internal monitoring only | Prometheus metrics; not public internet-facing |

---

## 17. Authorization Matrix

| Resource | Passenger | Admin | Gate | Internal | Public |
|---|---|---|---|---|---|
| Auth endpoints | — | — | — | — | ✅ |
| Own purchases/tickets/journeys | ✅ | — | — | — | — |
| Other passengers' data | ❌ | ✅ | — | — | — |
| Gate status mutation | ❌ | ✅ | — | — | — |
| Admin read endpoints | ❌ | ✅ | — | — | — |
| Gate validation | — | — | ✅ | — | — |
| Internal payment APIs | — | — | — | ✅ | — |
| Razorpay webhook | — | — | — | HMAC | — |
| /health | — | — | — | — | ✅ |
| /metrics | — | — | — | ✅ | — |

---

## 18. API Design Decision Register

| ID | Decision | Rationale |
|---|---|---|
| API-001 | `/api/v1/` versioning prefix from day one | Breaking changes can be introduced as `/api/v2/` without disrupting v1 clients |
| API-002 | Bearer token in Authorization header; refresh token as httpOnly cookie | Access token accessible to JS for Authorization header; refresh token protected from XSS by httpOnly |
| API-003 | Gate validation returns HTTP 200 for both ALLOW and REJECT | REJECT is a valid business outcome, not an error; HTTP error codes reserved for system failures |
| API-004 | Amounts as decimal strings, not JSON numbers | Prevents floating-point precision loss in JSON parsers |
| API-005 | Timestamps as ISO 8601 UTC strings | Unambiguous, timezone-safe, human-readable |
| API-006 | Internal error codes never exposed to passengers | Raw DB errors, stack traces, Kafka errors, Redis errors stay in logs only |
| API-007 | `requestId` in every response | Enables log correlation and support ticket resolution |
| API-008 | OTP request/forgot-password return same response regardless of account existence | Prevents email enumeration attacks |
| API-009 | Passenger never calls Payment Service directly | Payment initiation goes through Core; Core orchestrates the internal call |
| API-010 | Razorpay webhook retries are safe because `provider_event_id` is idempotently deduplicated | Duplicate deliveries return 200; temporary failures before durable persistence return 5xx so Razorpay can retry |
| API-011 | Payment Service owns and generates `paymentId` | Core supplies `purchaseId` and an idempotency key; retries return the already-created Payment instead of creating another one |
| API-012 | Gate API uses `Idempotency-Key` header, not request body field | Header-based idempotency is standard; keeps request body clean |
| API-013 | Cursor-based pagination, not offset | Offset pagination produces inconsistent results on high-write tables (gate_events); cursors are stable |
| API-014 | `ticket.identifier` = `ticket.id` in V1 | Simple and correct for V1; future fare media types may use different identifiers |
| API-015 | Admin endpoints under `/api/v1/admin/` prefix | Clear routing boundary; easy to apply role guard at the controller level |
| API-016 | Razorpay references not exposed in admin API responses | Sensitive provider references stay in Payment Service for internal reconciliation |
| API-017 | `VALIDATION_ERROR` details are field-level only | Field messages help users fix input; no internal details leak through details array |

---

## 19. Deferred Decisions (Phase 3.4 and later)

The following are intentionally not defined in this document:

```
JWT access token structure (claims, algorithm)   → Phase 3.4 Auth Design
JWT access token TTL                             → Phase 3.4 Auth Design
Refresh token TTL                                → Phase 3.4 Auth Design
Server-side refresh token invalidation strategy  → Phase 3.4 Auth Design
OTP TTL value                                    → Phase 3.4 Auth Design
OTP code length and character set                → Phase 3.4 Auth Design
Password reset token TTL                         → Phase 3.4 Auth Design
Internal service authentication mechanism        → Phase 3.11 Observability, Security & Deployment
Gate API key generation and rotation strategy    → Phase 3.7 Gate Design
Exact Razorpay webhook event types handled       → Future Payment extension / V2 Backlog
Cursor implementation strategy (opaque token)    → implementation decision
Rate limiting thresholds per endpoint            → Phase 3.8 Redis Design
Exact Prometheus metric names                    → Phase 3.11 Observability
```

---

## 20. Phase 3.3 Definition of Done

Phase 3.3 is complete when:

- [x] Global API conventions defined (versioning, auth, envelope, money, time, UUIDs, pagination)
- [x] Standard success and error response envelopes defined
- [x] Validation error format defined
- [x] Internal error hiding rule documented
- [x] Error code registry complete with HTTP status and safe user messages
- [x] Auth APIs defined (register, login, OTP, refresh, logout, password reset)
- [x] Station APIs defined
- [x] Fare Quote APIs defined
- [x] Purchase APIs defined
- [x] Payment APIs defined (browser-facing via Core)
- [x] Ticket APIs defined
- [x] Journey APIs defined
- [x] Admin APIs defined (read-only + gate status mutation)
- [x] Gate Service APIs defined (entry, exit validation)
- [x] Internal Core → Payment Service APIs defined
- [x] Razorpay webhook endpoint defined
- [x] Endpoint inventory complete
- [x] Authorization matrix defined
- [x] Idempotency strategy documented for gate requests and payment initiation
- [x] API design decision register complete
- [x] Deferred decisions explicitly listed
- [x] No new V1 features introduced
- [x] No architecture or schema decisions changed

---

## 21. Next Phase 3 Document

```
Phase 3.4 — Authentication & Authorization Design
  → JWT structure, claims, algorithm
  → Access and refresh token TTL
  → Server-side token invalidation
  → OTP flow, TTL, rate limiting
  → Password reset token design
  → Role enforcement in NestJS (Guards, Decorators)
```
