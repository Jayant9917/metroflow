# MetroFlow V1 Implementation Audit

Last reviewed: 17 September 2026

## Current progress

Estimated completion:

- **Functional V1 prototype: approximately 80% complete**
- **Production-ready platform: approximately 55–60% complete**

The prototype percentage is higher because the main passenger lifecycle works end to end. The production percentage is lower because deployment, monitoring, security hardening, complete audit tooling, email delivery, and comprehensive automated coverage are still incomplete.

## Completed and working

### Passenger journey

- Passenger registration and password login.
- Email OTP login flow.
- Password reset and password change flows.
- Fare quote creation.
- Purchase creation.
- Razorpay test-mode Checkout integration.
- Razorpay payment confirmation and signature verification.
- Payment retry after failed attempts.
- Ticket issuance after confirmed payment.
- Digital ticket page.
- Ticket QR code generation and display.
- Ticket list and ticket detail pages.
- Ticket expiry handling.

### Entry and exit gates

- Entry gate validation at the ticket origin station.
- Exit gate validation at the destination or an intermediate station.
- Route validation for allowed exit stations.
- Ticket and journey completion after exit.
- Fare remains unchanged for intermediate exits.
- Gate API-key validation.
- Gate idempotency keys.
- Duplicate scan handling.
- Complete idempotency replay payloads.
- Gate-event audit records.

### Journey simulator

- Ordered 35-station demonstration line.
- Origin and destination route display.
- Intermediate station selection.
- Animated train movement between stations.
- Entry and exit gate visual states.
- Reduced-motion support.
- Slow, normal, and fast simulation speeds.
- Refresh/resume visual checkpoint support.
- Backend polling for active journey updates.
- Journey timeout handling.
- Completed journey summary.

### Admin and operator operations

- Separate `ADMIN` and `OPERATOR` roles in the database.
- Development seed credentials for both roles.
- Role-based login redirect.
- Passenger dashboard protection from operations users.
- Admin/operator operations dashboard.
- Stations and gates monitoring page.
- Ticket operations page.
- Journey operations page.
- Payment/purchase operations page.
- Gate-event audit page.
- Outbox monitoring page.
- Lifecycle inconsistency page.
- Analytics summary cards.
- API Gateway proxy routes for operations endpoints.
- Basic responsive admin styling.

### Shared engineering foundation

- Monorepo with pnpm and Turborepo.
- Shared contracts package.
- Shared ticket, journey, station, gate, payment, and request types.
- Core API, API Gateway, payment service, gate service, worker, and web app.
- Database migrations and seed data.
- 35 demo stations and generated directional fare rules.
- Playwright browser test foundation.
- Simulator API lifecycle regression tests.
- HTTP parser regression checks.
- Root README and simulator documentation.

## Partially complete

### Role permissions

The roles exist and are enforced against passenger users, but operators and admins currently have mostly the same read-only operations access.

Target behavior:

- Operator: read-only operational monitoring.
- Admin: monitoring plus station, gate, user, and configuration management.

### Admin analytics

Summary counts are implemented. Charts, date ranges, trends, filtering, and export are not implemented yet.

### Admin tables

The tables load real data, but pagination, search, status filters, sorting, and detail drill-downs remain limited.

### Idempotency

Gate replay responses now preserve the original payload. Payment idempotency is implemented in the payment service, but complete replay-contract coverage across every payment response should still be verified.

### Webhooks

Payment webhook infrastructure exists, but full reconciliation monitoring and operator-facing webhook audit screens remain to be completed.

## Remaining V1 implementation work

### 1. Admin permissions and management

- Add admin-only station management.
- Add admin-only gate activation/deactivation.
- Add admin-only user and role management.
- Prevent operators from receiving mutation endpoints.
- Add confirmation dialogs and audit records for admin mutations.

### 2. Admin analytics and tables

- Add charts for ticket, payment, journey, and gate-event status.
- Add date-range filters.
- Add pagination to tickets, journeys, payments, and events.
- Add search by email, ticket ID, purchase ID, and journey ID.
- Add sorting and status filters.
- Add detail pages for individual operational records.

### 3. Payment and webhook operations

- Add payment-attempt audit screen.
- Add webhook delivery and reconciliation screen.
- Show Razorpay order ID, payment ID, attempt status, and failure reason.
- Reconcile delayed or duplicate webhook events.
- Add safe operator retry/reconciliation actions where appropriate.

### 4. Notifications

- Send ticket email after successful issuance.
- Send payment success notification.
- Send payment failure and retry notification.
- Add worker retry and dead-letter handling for email delivery.
- Add notification delivery status to the admin area.

### 5. API quality and resilience

- Add consistent pagination and query DTO validation.
- Improve network-failure messages in the frontend.
- Handle expired sessions with a single clean redirect.
- Add request timeouts and retry policy where appropriate.
- Return consistent error envelopes from every service.
- Complete shared contract adoption across all API responses.

### 6. Automated testing

- Add authenticated Playwright fixtures.
- Automate payment success and failure flows.
- Automate ticket issuance and QR display.
- Automate entry, intermediate exit, destination exit, and timeout flows.
- Test admin and operator permissions separately.
- Add API tests for forbidden mutations and invalid query parameters.
- Add mobile and desktop visual regression coverage.

### 7. Production readiness

- Replace development credentials before deployment.
- Move all secrets to a secure secret manager.
- Add production deployment configuration.
- Add health, metrics, logs, and alerting.
- Add database backup and migration procedures.
- Add rate limiting and stronger audit logging.
- Verify the station model against an authoritative metro network source.

## Explicitly out of V1 scope

- 3D metaverse environment.
- Live GPS train tracking.
- Real-time Delhi Metro feeds.
- Multi-line interchange routing.
- Refund calculation for early exits.
- Physical scanner hardware integration.
- Multiplayer passenger simulation.

## Recommended implementation order

1. Fix and verify Gateway routes for all admin endpoints.
2. Finish admin/operator permission separation.
3. Add admin table pagination, filters, and charts.
4. Add payment and webhook audit screens.
5. Add ticket and payment email notifications.
6. Add authenticated browser E2E fixtures and full-flow tests.
7. Run the complete payment-to-exit regression flow.
8. Commit, push, and update the project README with the final V1 scope.

## Definition of V1 completion

V1 is complete when:

- A passenger can complete payment, receive a QR ticket, enter, travel in the simulator, and exit at a valid station.
- Failed and retried payments are handled safely.
- Duplicate requests replay safely and do not create duplicate business records.
- Admins and operators have clearly separated permissions.
- Operations users can monitor payments, tickets, journeys, gates, events, and inconsistencies.
- Notifications and webhook reconciliation are observable.
- The complete lifecycle is covered by automated API and browser tests.
- The application passes the documented regression flow without manual database repairs.
