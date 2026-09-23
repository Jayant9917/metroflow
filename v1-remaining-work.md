# MetroFlow V1 — Remaining Work

Last updated: 23 September 2026

## Current status

MetroFlow’s core passenger lifecycle is working end to end:

```text
Register/login → Plan journey → Pay → Receive ticket → Enter gate
→ Journey simulator → Exit at valid station → Complete journey
```

The functional prototype is approximately **90% complete**. Production readiness is approximately **70% complete**.

## Completed

### Passenger experience

- Registration and password login.
- OTP login, password reset, and password change.
- Fare quotes and Razorpay test-mode payments.
- Failed payment retry using a new Razorpay order.
- Digital ticket issuance and QR identifier.
- Ticket expiry handling.
- Entry validation at the origin station.
- Exit validation at the destination or an intermediate station.
- Original fare retained for intermediate exits.
- Animated journey simulator with route stations.
- Journey refresh/resume behavior.
- Ticket and journey completion lifecycle.

### Admin and operator operations

- Separate ADMIN, OPERATOR, and PASSENGER roles.
- Role-based redirects and protected operations routes.
- Operator station activation/deactivation.
- Operator gate activation/deactivation.
- Admin analytics and revenue summaries.
- Payment health counts without exposing Razorpay details.
- Ticket, journey, payment, gate-event, and audit pages.
- Pagination and status filters.
- Ticket, journey, and payment search.
- Ticket sorting.
- Operator action audit logging.
- Audit pagination and action filtering.
- Operations logout.

### Engineering and testing

- pnpm/Turborepo monorepo.
- Shared contracts package.
- PostgreSQL migrations and seed data.
- Kafka-backed worker foundation.
- Notification retry and dead-letter foundation.
- Simulator API regression tests.
- HTTP parser regression tests.
- Permission tests for admin, operator, and passenger access.
- Playwright smoke tests.
- TypeScript checks for all packages.

## Remaining work for V1

### 1. Finish admin operations

- Add sorting to journeys, payments, and audit events.
- Add detail pages for individual tickets, journeys, purchases, and audit records.
- Add loading, empty, and retry states to all operations tables.
- Add safe query validation tests for search, sorting, and pagination.

### 2. Complete notifications

- Publish a ticket-issued notification event after successful ticket creation.
- Publish payment-success and payment-failure notification events.
- Send ticket email after successful issuance.
- Send payment success/failure and retry notifications.
- Store or expose safe notification delivery status.
- Add an admin notification-status summary without showing gateway secrets or raw payloads.
- Connect the existing worker retry/dead-letter foundation to these events.

### 3. Improve automated coverage

- Add authenticated Playwright fixtures.
- Automate payment success and payment failure flows.
- Automate ticket issuance and QR display.
- Automate origin entry, intermediate exit, destination exit, and timeout flows.
- Add admin detail-page tests.
- Add sorting and search tests for all operation tables.
- Add notification worker tests.
- Add mobile and desktop visual regression tests.

### 4. Improve resilience

- Add consistent loading and empty states across the web application.
- Add user-friendly network failure messages.
- Redirect expired sessions consistently to login.
- Add request timeout and retry policies to important service calls.
- Standardize error envelopes across all services.

### 5. Production readiness

- Replace development staff credentials before deployment.
- Move secrets to a secure secret manager.
- Add production deployment configuration.
- Add monitoring, metrics, logging, and alerts.
- Add database backup and migration procedures.
- Add rate limiting and stronger audit retention.
- Verify the demo station line against an authoritative metro network if the app becomes production-oriented.

## Explicitly outside V1 scope

- 3D metaverse environment.
- Live GPS train tracking.
- Real-time Delhi Metro feeds.
- Multi-line interchange routing.
- Refund calculation for early exits.
- Physical scanner hardware.
- Multiplayer passengers.

## V1 completion definition

V1 is complete when:

1. A passenger can complete payment, receive a QR ticket, enter, travel in the simulator, and exit at a valid station.
2. Failed and retried payments are handled safely.
3. Duplicate requests replay safely without duplicate business records.
4. Admin and operator permissions are clearly separated and tested.
5. Operators can manage station and gate availability.
6. Admins can monitor tickets, journeys, payments, gates, audit records, inconsistencies, and safe payment health summaries.
7. Ticket and payment notifications are delivered with retry/dead-letter handling.
8. The complete lifecycle is covered by automated API and browser tests.
9. The full regression flow passes without manual database repair.
10. Development secrets and credentials are removed from the production configuration.

## Recommended next order

1. Finish journey/payment/audit sorting.
2. Add operational detail pages and empty/loading states.
3. Connect ticket and payment notification events to the worker.
4. Add authenticated full-flow browser tests.
5. Run the complete regression flow.
6. Complete deployment and monitoring configuration.
