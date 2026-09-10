# MetroFlow — Phase 3.4: Authentication & Authorization Design

> **Document:** `architecture/phase-3-auth-design.md`
> **Project:** MetroFlow — Smart Transit Fare Collection Platform
> **Phase:** Phase 3 — Detailed Design
> **Section:** 3.4 — Authentication & Authorization Design
> **Status:** Approved
> **Depends on:** `phase-2-architecture.md`, `phase-3-database-schema.md`, `phase-3-api-contracts.md`

---

## 1. Purpose

This document defines the complete authentication and authorization model for MetroFlow V1.

It covers:

```
JWT access token design
Refresh token and session design
sessions table (Phase 3.2 schema amendment)
Password authentication
OTP authentication
Password reset
Authorization model (PASSENGER vs ADMIN)
Gate authentication boundary
Security flows (all auth paths)
Threat model
Error mapping
```

**V1 scope boundary:**

```
In scope:    Email + password login
             Email OTP / magic login
             Refresh token sessions
             Password reset
             PASSENGER and ADMIN roles
             Gate API key authentication (boundary only)

Out of scope: OAuth / Google login
              Phone / SMS OTP
              MFA / TOTP / authenticator apps
              Biometrics
              Social login
              Admin session management UI
              Device fingerprinting
```

---

## 2. Phase 3.2 Schema Amendment — `sessions` Table

### 2.1 Decision

Refresh token revocation, rotation, and reuse detection require durable server-side session state. Redis alone is insufficient as the sole source of truth because Redis restart or data loss would make revoked sessions valid again.

**Locked decision:**

```
PostgreSQL sessions table  =  authoritative session state
Redis                      =  optional fast cache, rate limiting, short-lived data
```

### 2.2 `sessions` Table Definition

This is a justified amendment to Phase 3.2. It adds one table to the Core PostgreSQL database.

```sql
CREATE TYPE session_status_type AS ENUM (
  'ACTIVE',
  'REVOKED',
  'EXPIRED'
);

CREATE TABLE sessions (
  id                   UUID                 PRIMARY KEY,
  user_id              UUID                 NOT NULL REFERENCES users (id),

  refresh_token_hash   TEXT                 NOT NULL,
  -- SHA-256 hash of the refresh token
  -- plaintext refresh token is never persisted

  family_id            UUID                 NOT NULL,
  -- Groups all rotated tokens that belong to the same login event
  -- Used for reuse detection: if a rotated-away token is presented,
  -- the entire family is revoked

  rotation_counter     INTEGER              NOT NULL DEFAULT 0,
  -- Incremented on every successful refresh
  -- Helps identify which generation of token a session is on

  status               session_status_type  NOT NULL DEFAULT 'ACTIVE',

  created_at           TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  expires_at           TIMESTAMPTZ          NOT NULL,
  -- Set to created_at + refresh token TTL at login time

  last_used_at         TIMESTAMPTZ,
  -- Updated on every successful refresh

  revoked_at           TIMESTAMPTZ,
  -- NULL until session is revoked

  device_info          TEXT,
  -- Optional; user agent or device hint if provided by client
  -- Not used for auth decisions in V1

  CONSTRAINT chk_sessions_revoked_has_timestamp
    CHECK (
      status <> 'REVOKED'
      OR revoked_at IS NOT NULL
    ),

  CONSTRAINT chk_sessions_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX idx_sessions_family_id
  ON sessions (family_id);

CREATE INDEX idx_sessions_status
  ON sessions (status)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_sessions_refresh_token_hash
  ON sessions (refresh_token_hash);
-- Refresh token lookup by hash must be unique
```

Each refresh-token generation creates a new session row. Rotated rows are retained with `status = REVOKED` so their token hash remains available for refresh-token reuse detection.

**Session lifecycle:**

```
Login
  → session created: status = ACTIVE, family_id = new UUID, rotation_counter = 0

Refresh
  → old session: status = REVOKED, revoked_at = NOW()
  → new session row inserted with same family_id, incremented rotation_counter

Logout
  → session: status = REVOKED, revoked_at = NOW()

Expiry
  → background sweep or on-read: sessions past expires_at treated as EXPIRED
  → status may be lazily updated to EXPIRED by background job

Reuse detection (stolen token used after rotation)
  → incoming token matches a REVOKED session
  → all sessions with same family_id are immediately REVOKED
  → the affected login/session family must authenticate again
  → other independent session families remain active
```

---

## 3. JWT Access Token Design

### 3.1 Algorithm

```
Algorithm: RS256 (RSA + SHA-256)
```

**Why RS256 over HS256:**

RS256 uses asymmetric keys — a private key signs tokens, a public key verifies them. In a multi-service architecture (Core, Gate Service, Payment Service), services can verify tokens using the public key without ever having access to the private key. HS256 requires sharing the secret across services, which increases the attack surface.

```
Private key  →  Core API (signs tokens)
Public key   →  Any service that needs to verify (Gate Service, etc.)
```

Key rotation is possible without a coordinated secret change.

### 3.2 Claims

```json
{
  "sub":       "01932b4c-...",
  "role":      "PASSENGER",
  "sessionId": "01932b4c-...",
  "iat":       1723714800,
  "exp":       1723715700
}
```

| Claim | Type | Description |
|---|---|---|
| `sub` | string (UUID v7) | User ID — `users.id` |
| `role` | string | `PASSENGER` or `ADMIN` |
| `sessionId` | string (UUID v7) | `sessions.id` — links token to server-side session |
| `iat` | number | Issued-at timestamp (Unix seconds) |
| `exp` | number | Expiry timestamp (Unix seconds) |

### 3.3 Access Token TTL

```
Access token TTL: 15 minutes
```

Short TTL limits the damage window if an access token is stolen. After 15 minutes, the client must use the refresh token to get a new access token.

### 3.4 Validation Rules

On every authenticated request, the JWT guard must:

```
1. Extract Bearer token from Authorization header
2. Verify signature using RS256 public key
3. Check exp — reject if expired (return TOKEN_EXPIRED)
4. Check iat — reject if in the future beyond clock skew (return TOKEN_INVALID)
5. Check sub is a valid UUID
6. Check role is PASSENGER or ADMIN
7. Check sessionId is present
```

**Clock skew tolerance:** 30 seconds. Tokens with `iat` up to 30 seconds in the future are accepted to handle minor client/server clock drift.

### 3.5 What Must Never Be in JWT Payloads

```
Password hash or any credential
Email address
Full name or PII beyond what is strictly needed
Database connection strings
Internal service URLs
Razorpay keys or provider credentials
Redis or Kafka configuration
Session token or refresh token
Any data that would be damaging if decoded by a client
```

JWT payloads are base64-encoded, not encrypted. Anyone with the token can read the claims. Only non-sensitive identifiers belong in the payload.

### 3.6 Access Token Delivery

```
Returned in response body:
  { "accessToken": "eyJ..." }

Stored by frontend:
  In-memory JavaScript variable only

Used on requests:
  Authorization: Bearer <access_token>

Never stored in:
  localStorage
  sessionStorage
  cookies (access token only — refresh uses cookie)
```

In-memory storage means the access token is lost on page refresh. This is intentional — the refresh token cookie is used to obtain a new access token transparently.

---

## 4. Refresh Token and Session Design

### 4.1 Refresh Token Format

```
Format: cryptographically random opaque token
Generation: crypto.randomBytes(64).toString('hex') — 128 hex characters
Type: opaque (not JWT)
```

Refresh tokens are opaque strings. They are not JWTs. The server looks up the session by hashing the token and querying the `sessions` table.

**Why opaque, not JWT:**

A JWT refresh token cannot be invalidated server-side without a revocation list — the token is self-contained. An opaque token requires a server-side lookup, which enables instant revocation on logout and reuse detection.

### 4.2 Refresh Token TTL

```
Refresh token TTL: 30 days
```

### 4.3 Token Hashing Before Storage

The plaintext refresh token is **never stored** in the database.

```
Plaintext refresh token  →  delivered to client in httpOnly cookie
                         →  hashed using SHA-256
                         →  hash stored in sessions.refresh_token_hash
```

On refresh:

```
Client sends cookie: refresh_token=<plaintext>
Server: hash = SHA256(<plaintext>)
Server: SELECT * FROM sessions WHERE refresh_token_hash = hash
```

SHA-256 is used (not bcrypt) for refresh token hashing because:
- Refresh tokens are already 64 random bytes — they are not user-chosen passwords and do not need bcrypt's work factor
- Lookup speed matters — this runs on every token refresh
- The entropy is in the token itself, not a password-guessing resistance function

### 4.4 Refresh Token Cookie

```
Cookie name:  refresh_token
HttpOnly:     true      (JavaScript cannot read it)
Secure:       true      (HTTPS only)
SameSite:     Strict    (not sent on cross-site requests)
Path:         /api/v1/auth/refresh
Domain:       (same origin — not set explicitly)
Max-Age:      2592000   (30 days in seconds)
```

Restricting `Path` to `/api/v1/auth/refresh` means the browser only sends the cookie on refresh requests — not on every API call. Logout clears the cookie by sending `Set-Cookie: refresh_token=; Max-Age=0` with the same `Path`, `Domain`, `Secure`, and `SameSite` attributes as the original cookie. Logout does not need to read the cookie because `sessionId` comes from the access token.

### 4.5 Token Rotation

Every successful use of a refresh token issues a new refresh token and invalidates the old one.

```
Client sends: refresh_token cookie (V1 token)

Server:
  1. Hash V1 token
  2. Look up session by hash
  3. Verify session is ACTIVE and not expired
  4. Generate V2 token (new random bytes)
  5. Hash V2 token
  6. Mark old session: status = REVOKED, revoked_at = NOW()
  7. Insert new session row: same family_id, rotation_counter++, hash(V2), status = ACTIVE
  8. Return new access token in body
  9. Set new refresh_token cookie (V2)

V1 token is now invalid.
```

**Concurrency safety:** Refresh-token rotation runs inside a single PostgreSQL transaction using a conditional `UPDATE`. The transition from `ACTIVE` → `REVOKED` is atomic:

```sql
UPDATE sessions
SET status = 'REVOKED', revoked_at = NOW(), last_used_at = NOW()
WHERE id = $sessionId
  AND status = 'ACTIVE'
  AND expires_at > NOW()
RETURNING id;
```

If zero rows are returned, the token was already rotated, revoked, or expired — no new session is created and `REFRESH_TOKEN_INVALID` is returned. If one row is returned, the new session generation is inserted in the same transaction. This prevents two simultaneous refresh requests from both succeeding and producing two child sessions from the same parent token.

### 4.6 Reuse Detection (Token Family Revocation)

If a client presents a refresh token that has already been rotated away (i.e. the hash matches a REVOKED session), it indicates one of:

```
Attacker stole V1 token and used it after the legitimate client already refreshed to V2
Attacker is replaying an old token
Client bug causing double-submission
```

**Response:**

```
Incoming token hash → matches REVOKED session → family_id extracted
→ All sessions with same family_id → status = REVOKED, revoked_at = NOW()
→ The affected login/session family is revoked. Other independent session families for the same user remain active.
→ Return REFRESH_TOKEN_INVALID to caller
```

This ensures a stolen refresh token can be detected and neutralized even if it is used after the legitimate client has already rotated.

### 4.7 Multi-Device Sessions

Each login creates a new session row with a new `family_id`. A user may have multiple active sessions simultaneously (one per device/browser).

Logout revokes only the session identified by the sessionId claim in the authenticated access token. Other login sessions for the same user remain active.

```
Device A: Session S1 (ACTIVE)
Device B: Session S2 (ACTIVE)

Device A logs out → S1 REVOKED
Device B: Session S2 still ACTIVE
```

Admin-level session revocation (revoking all sessions for a user) is not exposed in V1 but is possible by querying `sessions` where `user_id = X AND status = ACTIVE`.

### 4.8 Session Expiry Handling

Sessions have a hard `expires_at`. Presenting a refresh token for an expired session:

```
Session found, status = ACTIVE, but NOW() > expires_at
→ Update status = EXPIRED lazily
→ Return TOKEN_EXPIRED
→ User must log in again
```

A background cleanup job can periodically transition `ACTIVE` sessions past `expires_at` to `EXPIRED` for housekeeping. This is not a security enforcement mechanism — `expires_at` check on read is.

---

## 5. Password Authentication

### 5.1 Hashing Algorithm

```
Algorithm: bcrypt
Cost factor: 12
```

V1 baseline: bcrypt cost factor 12. Actual hashing latency must be benchmarked on the production deployment environment. The cost factor is configuration-driven and can be adjusted based on measured security and performance trade-offs.

### 5.2 Password Validation Rules

```
Minimum length: 8 characters
Maximum length: 128 characters
No character-class requirements in V1 (complexity rules add friction without proportional security gain when length is enforced)
Password is validated before hashing
```

### 5.3 Login Flow

```
POST /api/v1/auth/login
{ email, password }

1. Look up user by email
   → Not found: return INVALID_CREDENTIALS (do not reveal whether email exists)

2. Check password_hash is NOT NULL
   → NULL means OTP-only account: return INVALID_CREDENTIALS

3. bcrypt.compare(password, user.password_hash)
   → False: return INVALID_CREDENTIALS
   → True: proceed

4. Generate access token (RS256 JWT)
5. Generate refresh token (random bytes)
6. Create session row in sessions table
7. Return access token in body + set refresh_token cookie
```

**Generic invalid-credential response:** Both "email not found" and "wrong password" return `INVALID_CREDENTIALS`. This prevents user enumeration through login.

### 5.4 Timing-Safe Verification

bcrypt.compare is inherently timing-safe because it always runs the full comparison. However, the "email not found" branch must also perform a dummy bcrypt comparison to prevent timing attacks that reveal whether an email is registered:

```
User not found:
  → bcrypt.compare(password, DUMMY_HASH)  // runs regardless
  → return INVALID_CREDENTIALS

User found, wrong password:
  → bcrypt.compare(password, user.password_hash)
  → return INVALID_CREDENTIALS

Both paths take approximately the same time.
```

`DUMMY_HASH` is a pre-computed bcrypt hash of a random string, initialized at startup.

---

## 6. OTP Authentication

### 6.1 OTP Specification

```
Length:       6 digits
Format:       Numeric only (000000 – 999999)
TTL:          10 minutes
Generation:   cryptographically random (crypto.randomInt)
```

### 6.2 OTP Storage Strategy

**Redis** is the authoritative OTP validation store. PostgreSQL `otp_codes` is the audit record only (no hash stored — confirmed in Phase 3.2).

**Redis key structure:**

```
otp:login:{userId}         → hashed OTP value
otp:attempts:{userId}      → attempt counter (for rate limiting)
otp:cooldown:{email}       → request rate limiter (blocks new OTP requests)
```

**OTP hashing in Redis:**

```
Plaintext OTP: 847291
SHA-256 hash stored in Redis: sha256("847291")
```

Plaintext OTP is never persisted. It exists only transiently in application memory during generation and email delivery. If Redis is read by an attacker, they get hashes of 6-digit numbers — still brute-forceable given the small space, but the attempt counter and TTL limit live attacks.

### 6.3 OTP Request Flow

```
POST /api/v1/auth/otp/request
{ email }

1. Check otp:cooldown:{email} in Redis
   → Key exists: return OTP_RATE_LIMITED

2. Look up user by email
   → Not found: return same 200 response (no enumeration)

3. Generate 6-digit OTP via crypto.randomInt(0, 999999).toString().padStart(6, '0')

4. Hash OTP: sha256(otp)

5. SET otp:login:{userId} = hash  EX 600          (10 min TTL)
6. SET otp:attempts:{userId} = 0  EX 600
7. SET otp:cooldown:{email} = 1   EX 60            (1 min cooldown between requests)

8. Insert audit record into otp_codes:
   { user_id, purpose='LOGIN', expires_at = NOW() + 10 min }

9. Publish otp.requested Kafka event → Worker sends email

10. Return 200: "If an account exists for this email, a login code has been sent."
```

### 6.4 OTP Verification Flow

```
POST /api/v1/auth/otp/verify
{ email, code }

1. Look up user by email → not found: return OTP_INVALID

2. GET otp:login:{userId} from Redis
   → Key missing (expired or never set): return OTP_EXPIRED

3. GET otp:attempts:{userId} from Redis
   → Value >= 5: return OTP_RATE_LIMITED

4. sha256(code) == stored hash?
   → No:
       INCR otp:attempts:{userId}
       return OTP_INVALID

5. DEL otp:login:{userId}                          (consume OTP — one use only)
6. DEL otp:attempts:{userId}

7. UPDATE otp_codes SET consumed_at = NOW()
   WHERE user_id = X AND consumed_at IS NULL
   ORDER BY created_at DESC LIMIT 1

8. Generate access token + refresh token + create session

9. Return tokens
```

**Replacing an OTP before it expires:**

If a user requests a new OTP before the previous one expires:

```
New OTP request
→ SET otp:login:{userId} = new_hash  EX 600   (overwrites old key)
→ Old OTP is immediately invalid
→ New audit row in otp_codes
```

### 6.5 OTP Rate Limits

| Limit | Value | Enforcement |
|---|---|---|
| Requests per email per minute | 1 | `otp:cooldown:{email}` TTL 60s |
| Failed verification attempts | 5 | `otp:attempts:{userId}` counter |
| OTP validity window | 10 minutes | Redis key TTL |

---

## 7. Password Reset

### 7.1 Token Generation

```
Format: cryptographically random bytes
Generation: crypto.randomBytes(32).toString('hex') — 64 hex characters
Storage: SHA-256 hash stored in password_reset_tokens.token_hash
Plaintext: sent in reset email link only, never persisted
TTL: 1 hour
```

### 7.2 Password Reset Request Flow

```
POST /api/v1/auth/password/forgot
{ email }

1. Look up user by email
   → Not found: return 200 with same message (no enumeration)

2. Invalidate previous unused reset tokens for this user:
   UPDATE password_reset_tokens
   SET used_at = NOW()
   WHERE user_id = X AND used_at IS NULL

3. Generate plaintext token (32 random bytes → hex string)

4. Hash: sha256(token)

5. INSERT password_reset_tokens:
   { user_id, token_hash, expires_at = NOW() + 1 hour }

6. Publish password.reset.requested Kafka event → Worker sends email
   Email contains: https://app.metroflow.dev/reset-password?token=<plaintext>

7. Return 200: "If an account exists for this email, a password reset link has been sent."
```

### 7.3 Password Reset Verification Flow

```
POST /api/v1/auth/password/reset
{ token, newPassword }

1. Validate newPassword length (8–128 chars)

2. hash = sha256(token)

3. SELECT * FROM password_reset_tokens WHERE token_hash = hash
   → Not found: return PASSWORD_RESET_TOKEN_INVALID
   → used_at IS NOT NULL: return PASSWORD_RESET_TOKEN_USED
   → NOW() > expires_at: return PASSWORD_RESET_TOKEN_EXPIRED

4. Hash new password: bcrypt(newPassword, 12)

5. BEGIN TRANSACTION
   UPDATE users SET password_hash = new_hash, updated_at = NOW() WHERE id = X
   UPDATE password_reset_tokens SET used_at = NOW() WHERE id = Y
   UPDATE sessions SET status = 'REVOKED', revoked_at = NOW()
     WHERE user_id = X AND status = 'ACTIVE'
   COMMIT

6. Return 200: "Your password has been reset successfully."
```

**Existing sessions after password reset:** All active sessions are revoked. The user must log in again on all devices. This prevents an attacker who had gained access from maintaining sessions after the password is changed.

---

## 8. Authorization Design

### 8.1 Roles

```
PASSENGER   Default role for all registered users
ADMIN       Elevated role for internal operators
```

Role is stored in `users.role` and encoded in JWT `role` claim. There is no role assignment API in V1 — admin accounts are created via database seed or direct database update.

### 8.2 NestJS Guard Strategy

**Guards (applied globally or per-controller):**

```typescript
JwtAuthGuard        Validates Bearer token on every request
                    Skipped for @Public() routes

RolesGuard          Checks JWT role claim against @Roles() decorator
                    Applied globally; no-op if no @Roles() decorator
```

**Custom decorators:**

```typescript
@Public()
// Marks a route as unauthenticated (skips JwtAuthGuard)
// Used on: register, login, OTP request/verify, forgot-password, reset

@Roles('ADMIN')
// Requires ADMIN role claim in JWT
// Used on: all /admin/* controllers

@CurrentUser()
// Parameter decorator — extracts authenticated user from request
// Usage: handler(@CurrentUser() user: AuthUser)
// AuthUser = { id, email, role, sessionId }
```

**Resource ownership enforcement:**

Ownership checks are not in Guards — they are in service methods:

```typescript
// tickets.service.ts
async getTicket(ticketId: string, requestingUserId: string): Promise<Ticket> {
  const ticket = await this.ticketsRepository.findById(ticketId);
  if (!ticket) throw new TicketNotFoundException();
  if (ticket.userId !== requestingUserId) throw new ForbiddenException();
  return ticket;
}
```

This pattern applies to:

```
purchases    ticket.purchase.userId === requestingUserId
tickets      ticket.userId === requestingUserId
journeys     journey.userId === requestingUserId
payments     payment.userId (via Core→Payment lookup)
```

### 8.3 Admin Authorization Boundary

```
ADMIN role gives access to:
  All /api/v1/admin/* endpoints
  PATCH /api/v1/admin/gates/{id}/status (only mutation in V1)

ADMIN role does NOT give:
  Access to auth endpoints beyond normal passenger use
  Ability to modify Tickets, Journeys, Purchases, Payments, or Fare Rules
  Access to other admin accounts
```

Admin accounts use the same JWT flow as passengers. The `role = ADMIN` claim in the JWT activates admin access. There is no separate admin login endpoint.

### 8.4 Gate Authentication

Gate authentication is completely separate from passenger/admin JWT auth.

```
Gate Simulator UI (browser)
  → calls Next.js BFF server route
  → BFF holds GATE_API_KEY server-side (environment variable)
  → BFF adds X-Gate-Api-Key header
  → calls API Gateway → Gate Service

Gate Service:
  → validates X-Gate-Api-Key against known key(s)
  → rejects with 401 if invalid or missing
  → Gate API key is never in browser JavaScript or NEXT_PUBLIC_* env vars
```

Gate authentication does not use JWT. Gate Service does not check `sessions` table. It is a separate credential system.

Exact API key generation, rotation strategy, and per-gate key assignment are Phase 3.7 (Gate Service Design) decisions.

---

## 9. Security Flow Diagrams

### 9.1 Registration

```
Client
  → POST /api/v1/auth/register { email, password }
  → Core validates input
  → Checks email uniqueness (uq_users_email)
     → Already exists: EMAIL_ALREADY_REGISTERED
  → bcrypt(password, 12) → password_hash
  → INSERT users { id, email, password_hash, role='PASSENGER' }
  → Generate access token (RS256 JWT)
  → Generate refresh token (random bytes)
  → SHA-256 hash refresh token
  → INSERT sessions { id, user_id, refresh_token_hash, family_id=new UUID, status='ACTIVE' }
  → Return: { accessToken } + Set-Cookie: refresh_token=<plaintext>; HttpOnly; ...
```

### 9.2 Password Login

```
Client
  → POST /api/v1/auth/login { email, password }
  → Look up user by email
     → Not found: bcrypt.compare(password, DUMMY_HASH) → INVALID_CREDENTIALS
  → bcrypt.compare(password, user.password_hash)
     → False: INVALID_CREDENTIALS
  → Generate access token
  → Generate refresh token
  → INSERT sessions { ... family_id=new UUID, rotation_counter=0 }
  → Return: { accessToken } + Set-Cookie
```

### 9.3 OTP Login

```
Client
  → POST /api/v1/auth/otp/request { email }
  → Rate limit check (Redis cooldown key)
  → Look up user (silent if not found)
  → Generate OTP, hash, store in Redis with TTL
  → Publish otp.requested → Worker → Email
  → Return 200 (same regardless of account existence)

Client receives email, enters code
  → POST /api/v1/auth/otp/verify { email, code }
  → Look up user → hash code → check Redis
  → Attempt counter check
  → Consume OTP (DEL Redis key)
  → Update otp_codes audit record
  → Generate access token + refresh token
  → INSERT session
  → Return: { accessToken } + Set-Cookie
```

### 9.4 Token Refresh

```
Client (access token expired, sends cookie automatically)
  → POST /api/v1/auth/refresh
  → Read refresh_token from httpOnly cookie
  → SHA-256 hash token
  → SELECT session WHERE refresh_token_hash = hash
     → Not found: REFRESH_TOKEN_INVALID
     → status = REVOKED:
         Check family_id → revoke all family sessions → REFRESH_TOKEN_INVALID
         (reuse detection — full family revocation)
     → NOW() > expires_at: mark EXPIRED → TOKEN_EXPIRED
  → Generate new access token
  → Generate new refresh token (V+1)
  → UPDATE old session: status = REVOKED, revoked_at = NOW()
  → INSERT new session: same family_id, rotation_counter+1, hash(V2), status = ACTIVE
  → Return: { accessToken } + Set-Cookie (new refresh token)
```

### 9.5 Logout

```
Client
  → POST /api/v1/auth/logout  (Bearer token)
  → Extract sessionId from the Bearer token's JWT claims
  → UPDATE sessions SET status='REVOKED', revoked_at=NOW() WHERE id=sessionId
  → Clear refresh_token cookie (Set-Cookie: refresh_token=; Max-Age=0)
  → Return 200
```

The cookie-clearing response must use the same `Path`, `Domain`, `Secure`, and `SameSite` attributes as the original cookie. Logout does not need to read the refresh cookie because the session ID comes from the access token.

### 9.6 Expired Access Token (Normal Client Flow)

```
Client sends request with expired access token
  → JwtAuthGuard: exp < NOW() → TOKEN_EXPIRED (401)

Client catches 401 TOKEN_EXPIRED
  → POST /api/v1/auth/refresh (cookie sent automatically)
  → New access token received
  → Retry original request with new access token
```

### 9.7 Stolen/Replayed Refresh Token After Rotation

```
Legitimate client refreshes: V1 → V2
  → V1 session row is REVOKED
  → V2 session row is created with the same family_id

Attacker later presents V1:
  → SHA-256(V1 token) → look up session
  → Session found, status = REVOKED (V1 was rotated away)
  → Extract family_id
  → UPDATE sessions SET status='REVOKED', revoked_at=NOW()
     WHERE family_id = X AND status = 'ACTIVE'
  → The active session in this token family is revoked. Other independent device/browser sessions remain unaffected.
  → Return REFRESH_TOKEN_INVALID

Legitimate client next refresh attempt:
  → Session is REVOKED → REFRESH_TOKEN_INVALID
  → User must log in again
```

### 9.8 Forgot Password / Password Reset

```
Client
  → POST /api/v1/auth/password/forgot { email }
  → Silent lookup (same response if not found)
  → Invalidate old unused reset tokens
  → Generate token → hash → store in password_reset_tokens
  → Publish password.reset.requested → Worker → Email with link

Client clicks link, submits new password
  → POST /api/v1/auth/password/reset { token, newPassword }
  → sha256(token) → look up in password_reset_tokens
  → Validate not used, not expired
  → BEGIN TRANSACTION
       UPDATE users SET password_hash = new_hash
       UPDATE password_reset_tokens SET used_at = NOW()
       UPDATE sessions SET status = 'REVOKED', revoked_at = NOW()
         WHERE user_id = X AND status = 'ACTIVE'
     COMMIT
  → Return 200
```

### 9.9 Admin Login

```
Admin uses same login endpoints as passenger.
Role = ADMIN is stored in users.role and encoded in JWT.
There is no separate admin login endpoint.
Admin accounts are seeded directly in the database.
```

---

## 10. Threat Model

### 10.1 Stolen Access Token

**Risk:** Attacker intercepts access token (e.g. via man-in-the-middle or XSS).

**Mitigations:**
- Access token TTL is 15 minutes — limited damage window
- Access token is stored in memory only (not localStorage) — XSS cannot persist it across page loads
- HTTPS only — prevents interception in transit
- RS256 — token cannot be forged without private key

**Residual risk:** Access token valid for up to 15 minutes after theft. Acceptable trade-off for stateless access token design.

### 10.2 Stolen Refresh Token

**Risk:** Attacker gains access to refresh token cookie.

**Mitigations:**
- httpOnly cookie — JavaScript cannot read it (XSS cannot steal it)
- Secure flag — HTTPS only
- SameSite=Strict — not sent on cross-site requests (CSRF protection)
- Token rotation — each use generates a new token
- Reuse detection — using an old token revokes the entire family

### 10.3 Refresh Token Replay

**Risk:** Attacker uses a stolen refresh token before the legitimate client rotates it, or replays an old token after rotation.

**Mitigation:** Token family revocation. If a rotated-away token is presented, all sessions in that family are immediately revoked. The legitimate user is notified implicitly (forced login) and can investigate.

### 10.4 Brute-Force Password Login

**Risk:** Attacker tries many passwords against a known email.

**Mitigations:**
- bcrypt cost factor 12 — configuration-driven and benchmarked on the deployment environment
- Generic INVALID_CREDENTIALS response — does not reveal whether email exists
- Rate limiting on login endpoint — Phase 3.8 (Redis Design) decision

### 10.5 OTP Brute Force

**Risk:** Attacker tries all 1,000,000 possible 6-digit OTPs.

**Mitigations:**
- 5 failed attempts → OTP_RATE_LIMITED, further verification blocked
- 10-minute TTL — limited time window
- 1-minute cooldown between OTP requests — limits new token generation
- sha256 hash in Redis — not plaintext, though brute-force risk is low given attempt limits

### 10.6 Email Enumeration

**Risk:** Attacker probes whether emails are registered by comparing response behavior.

**Mitigations:**
- Login: generic INVALID_CREDENTIALS for both "not found" and "wrong password"
- OTP request: same 200 response regardless of account existence
- Forgot password: same 200 response regardless of account existence
- Timing: dummy bcrypt compare runs even when user is not found

### 10.7 XSS Impact

**Risk:** Attacker injects JavaScript that reads auth tokens.

**Mitigations:**
- Access token in memory only — not in localStorage or sessionStorage
- Refresh token in httpOnly cookie — JavaScript cannot read it
- XSS can steal the access token from memory (window variable) but only within the current page session
- Access token is short-lived (15 min) — limits post-XSS damage
- Content Security Policy (CSP) headers — Phase 3.11 Observability/Deployment decision

**Residual risk:** In-memory access tokens are readable by XSS within the page lifetime. This is the accepted trade-off for not using cookies for the access token.

### 10.8 CSRF Impact on Refresh Cookie

**Risk:** Attacker tricks browser into sending refresh cookie to `/api/v1/auth/refresh`.

**Mitigation:** `SameSite=Strict` cookie — browser does not send the cookie on cross-origin requests. CSRF attack would require the request to originate from the same site.

### 10.9 Token Leakage in Logs

**Risk:** Access tokens or refresh tokens appear in server logs.

**Mitigations:**
- Never log Authorization header values
- Never log cookie values
- Never log request/response bodies containing tokens
- Log only `requestId`, `userId`, `sessionId` for correlation

### 10.10 Session Fixation

**Risk:** Attacker forces a known session onto a victim.

**Mitigation:** Sessions are created server-side at login. The client receives a random refresh token — there is no mechanism to "force" a session ID onto another user. New family_id on every login.

### 10.11 Privilege Escalation

**Risk:** Passenger modifies JWT to claim ADMIN role.

**Mitigation:** RS256 signature — JWT cannot be modified without the private key. Any tampering invalidates the signature and the request is rejected with TOKEN_INVALID.

### 10.12 Replay After Logout

**Risk:** Attacker captures a valid access token before logout and replays it after.

**Mitigation:** Access token TTL is 15 minutes. After logout, the refresh session is revoked — no new access tokens can be obtained. The captured access token is valid only until its `exp`. Stateless access token design means there is no server-side access token blacklist.

**Accepted trade-off:** Access tokens cannot be instantly invalidated (they are stateless). The 15-minute TTL is the damage window. This is an explicit design trade-off for stateless access token scalability.

---

## 11. Token and Session Lifecycle Summary

```
LOGIN
  ↓
Session created: ACTIVE, rotation_counter=0
Access token issued (15 min)
Refresh token issued (30 days)

REFRESH (when access token renewal is needed)
  ↓
Old session generation: REVOKED
New session generation: ACTIVE
  → same family_id
  → rotation_counter = previous + 1
New refresh token issued
New access token issued

LOGOUT
  ↓
Session: REVOKED
Refresh cookie cleared
Access token: valid until exp (max 15 min remaining)

SESSION EXPIRY (30 days)
  ↓
Session: status → EXPIRED (lazily on next refresh attempt)
User must log in again

PASSWORD RESET
  ↓
All ACTIVE sessions for user: REVOKED
User must log in on all devices

REUSE DETECTION
  ↓
All sessions in family: REVOKED
User must log in again
```

---

## 12. OTP Lifecycle Summary

```
Request OTP
  ↓
Redis: otp:login:{userId} = sha256(otp)  TTL=10min
Redis: otp:cooldown:{email} = 1           TTL=60s
PostgreSQL: otp_codes row (audit, no hash)

Verify OTP (success)
  ↓
DEL otp:login:{userId}     (consumed)
DEL otp:attempts:{userId}
UPDATE otp_codes.consumed_at

Verify OTP (failure)
  ↓
INCR otp:attempts:{userId}
Return OTP_INVALID

Max attempts exceeded
  ↓
Return OTP_RATE_LIMITED
OTP remains in Redis until TTL expires (but unverifiable)

OTP TTL expires
  ↓
Redis key auto-deleted
Next verification attempt: key not found → OTP_EXPIRED

New OTP request before old expires
  ↓
Redis key overwritten (old OTP invalidated immediately)
New audit row in otp_codes
```

---

## 13. Password Reset Lifecycle Summary

```
Request reset
  ↓
Old unused tokens invalidated (used_at = NOW())
New token: sha256(plaintext) → password_reset_tokens
Email sent with plaintext token in link

Use reset link (success)
  ↓
Token hash found, not used, not expired
Password updated (bcrypt hash)
Token consumed (used_at = NOW())
All active sessions REVOKED

Use reset link (failure cases)
  ↓
Token not found          → PASSWORD_RESET_TOKEN_INVALID
Token already used       → PASSWORD_RESET_TOKEN_USED
Token expired (>1 hour)  → PASSWORD_RESET_TOKEN_EXPIRED
```

---

## 14. JWT Claim Table

| Claim | Value | Source | Notes |
|---|---|---|---|
| `sub` | UUID v7 | `users.id` | Subject — identifies the user |
| `role` | `PASSENGER` or `ADMIN` | `users.role` | Used by RolesGuard |
| `sessionId` | UUID v7 | `sessions.id` | Links to server-side session for revocation |
| `iat` | Unix timestamp | Server clock | Issued-at time |
| `exp` | Unix timestamp | `iat + 900` | Expiry (15 minutes) |

---

## 15. Authorization Matrix

| Endpoint Group | PASSENGER | ADMIN | Gate | Public |
|---|---|---|---|---|
| Auth endpoints | — | — | — | ✅ |
| GET /stations | ✅ | ✅ | — | — |
| POST /fare-quotes | ✅ | — | — | — |
| POST /purchases | ✅ | — | — | — |
| GET /purchases/{id} (own only) | ✅ | — | — | — |
| POST /payments/initiate | ✅ | — | — | — |
| GET /payments/{id} (own only) | ✅ | — | — | — |
| GET /tickets (own only) | ✅ | — | — | — |
| GET /tickets/{id} (own only) | ✅ | — | — | — |
| GET /journeys (own only) | ✅ | — | — | — |
| GET /journeys/{id} (own only) | ✅ | — | — | — |
| GET /admin/* | ❌ | ✅ | — | — |
| PATCH /admin/gates/{id}/status | ❌ | ✅ | — | — |
| POST /gate/validate-entry | — | — | ✅ | — |
| POST /gate/validate-exit | — | — | ✅ | — |
| /health | ✅ | ✅ | ✅ | ✅ |
| /metrics | ❌ | ❌ | ❌ | Internal only |

---

## 16. Error Mapping

| Condition | Error Code | Notes |
|---|---|---|
| Email/password mismatch | `INVALID_CREDENTIALS` | Same code for both cases |
| Email not found at login | `INVALID_CREDENTIALS` | No enumeration |
| Access token signature invalid | `TOKEN_INVALID` | |
| Access token expired | `TOKEN_EXPIRED` | |
| Refresh token not found or revoked | `REFRESH_TOKEN_INVALID` | |
| Refresh token expired | `TOKEN_EXPIRED` | |
| OTP code incorrect | `OTP_INVALID` | |
| OTP TTL elapsed | `OTP_EXPIRED` | Redis key gone |
| OTP already consumed | `OTP_ALREADY_USED` | |
| Too many OTP requests or attempts | `OTP_RATE_LIMITED` | |
| Password reset token not found | `PASSWORD_RESET_TOKEN_INVALID` | |
| Password reset token expired | `PASSWORD_RESET_TOKEN_EXPIRED` | |
| Password reset token already used | `PASSWORD_RESET_TOKEN_USED` | |
| No Bearer token on protected route | `UNAUTHORIZED` | |
| Wrong role for endpoint | `FORBIDDEN` | |
| Accessing another user's resource | `FORBIDDEN` | Not `NOT_FOUND` |
| bcrypt error / unexpected auth failure | `INTERNAL_ERROR` | Never expose internals |
| Redis unavailable during OTP | `SERVICE_TEMPORARILY_UNAVAILABLE` | |

---

## 17. Security Decision Register

| ID | Decision | Rationale |
|---|---|---|
| AUTH-001 | RS256 (asymmetric) for JWT signing | Services can verify tokens using public key without sharing private key |
| AUTH-002 | 15-minute access token TTL | Limits stolen token damage window while keeping UX reasonable |
| AUTH-003 | 30-day refresh token TTL | Balances security (forced re-login) with UX (not too frequent) |
| AUTH-004 | Opaque refresh token, not JWT | Enables server-side revocation; JWT refresh tokens cannot be instantly invalidated |
| AUTH-005 | SHA-256 for refresh token hashing | High-entropy token (64 random bytes) doesn't need bcrypt work factor; SHA-256 is fast for lookup |
| AUTH-006 | bcrypt cost factor 12 for passwords | V1 baseline; actual hashing latency is benchmarked in the production deployment environment and the configuration can be adjusted based on measured trade-offs |
| AUTH-007 | One session row per refresh-token generation | Rotated rows remain REVOKED with preserved hashes, while family_id and rotation_counter enable full family revocation on reuse detection |
| AUTH-008 | All sessions revoked on password reset | Ensures attacker loses access immediately after victim changes password |
| AUTH-009 | Access token in memory, refresh in httpOnly cookie | XSS cannot steal refresh token; memory-only access token is lost on refresh |
| AUTH-010 | No localStorage or sessionStorage for tokens | Prevents token persistence across page loads; limits XSS persistence |
| AUTH-011 | SameSite=Strict on refresh cookie | Prevents CSRF attacks on the refresh endpoint |
| AUTH-012 | Path=/api/v1/auth/refresh on cookie | Cookie only sent on refresh requests, not every API call |
| AUTH-013 | Generic INVALID_CREDENTIALS for login | Prevents email enumeration through login endpoint |
| AUTH-014 | Dummy bcrypt compare when user not found | Prevents timing attacks revealing email existence |
| AUTH-015 | Same 200 response for OTP/forgot-password regardless of account | Prevents email enumeration through these endpoints |
| AUTH-016 | OTP hashed in Redis (SHA-256) | Plaintext OTP is never persisted; it exists only transiently during generation and email delivery |
| AUTH-017 | PostgreSQL otp_codes is audit-only (no hash) | Redis is authoritative; PostgreSQL provides audit trail only |
| AUTH-018 | 5-attempt limit on OTP verification | Limits brute-force attack on 6-digit space |
| AUTH-019 | 1-minute cooldown between OTP requests | Prevents rapid OTP generation; limits email spam |
| AUTH-020 | sessions table in PostgreSQL | Durable, survives Redis restart, enables reuse detection and future admin revocation |
| AUTH-021 | Gate credentials held server-side in Next.js BFF | Browser JS never holds Gate API key; prevents credential exposure in DevTools |
| AUTH-022 | Admin uses same login flow as PASSENGER | No separate admin endpoint; role is JWT claim, not login path |
| AUTH-023 | Admin accounts seeded directly — no role assignment API | Prevents privilege escalation through API; admin creation is an operational act |
| AUTH-024 | Resource ownership checked in service layer, not Guard | Guards handle authentication; services handle authorization for specific resources |

---

## 18. Deferred Decisions

The following are intentionally not defined in this document:

```
Exact RS256 key size (2048-bit or 4096-bit)         → implementation decision
Key rotation strategy for RS256 keypair              → Phase 3.11 / Deployment
Rate limiting thresholds for login endpoint          → Phase 3.8 Redis Design
Redis persistence configuration (RDB/AOF)            → Phase 3.8 Redis Design
Content Security Policy (CSP) headers               → Phase 3.11 Observability
Session cleanup background job schedule             → Phase 3.9 Worker Design
CORS configuration                                  → Phase 3.11 / Deployment
Exact Gate API key format and rotation              → Phase 3.7 Gate Design
Device info collection strategy                     → future enhancement
Admin session management UI/API                     → V2 Backlog
```

---

## 19. Phase 3.4 Definition of Done

Phase 3.4 is complete when:

- [x] JWT algorithm, claims, and TTL defined
- [x] Access token delivery strategy confirmed (memory + Bearer header)
- [x] Refresh token format defined (opaque, random bytes)
- [x] Refresh token TTL defined (30 days)
- [x] Refresh token hashing strategy defined (SHA-256)
- [x] httpOnly cookie attributes defined (Secure, SameSite, Path)
- [x] sessions table defined as Phase 3.2 amendment
- [x] Token rotation on every refresh defined
- [x] Token family / reuse detection defined
- [x] Logout flow defined (single session revocation)
- [x] Password hashing algorithm defined (bcrypt, cost 12)
- [x] Password validation rules defined
- [x] Timing-safe login verification defined (dummy bcrypt)
- [x] OTP specification defined (6-digit numeric, 10-min TTL)
- [x] OTP Redis key structure defined
- [x] OTP rate limits defined (5 attempts, 1-min cooldown)
- [x] OTP one-time consumption defined
- [x] PostgreSQL OTP table confirmed as audit-only
- [x] Password reset token format defined (32 random bytes, SHA-256 hash)
- [x] Password reset TTL defined (1 hour)
- [x] Password reset single-use enforcement defined
- [x] Session revocation on password reset defined
- [x] NestJS Guard strategy defined (JwtAuthGuard, RolesGuard)
- [x] Custom decorators defined (@Public, @Roles, @CurrentUser)
- [x] Resource ownership check strategy defined (service layer)
- [x] Gate authentication boundary confirmed (separate from JWT)
- [x] All 9 security flows documented
- [x] Threat model covers 12 attack scenarios
- [x] Error mapping complete and consistent with Phase 3.3 codes
- [x] No new V1 features introduced
- [x] No existing API paths or schema decisions changed (except sessions table amendment)

---

## 20. Next Phase 3 Document

```
Phase 3.5 — Payment & Razorpay Integration Design
Status: Approved — V1 Locked

→ Payment Service ownership
→ Payment / PaymentAttempt lifecycle
→ Razorpay Order integration
→ durable payment initiation idempotency
→ webhook signature verification
→ authoritative payment confirmation
→ transactional outbox
→ payment.succeeded
→ PAID → Ticket issuance recovery
```
