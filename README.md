# MetroFlow

MetroFlow is a full-stack metro ticketing and journey simulation platform. Passengers can select stations, receive a fare quote, pay through Razorpay Test Mode, receive a QR ticket, enter through a gate, travel through the route, and exit at the destination or an intermediate station.

## V1 flow

```text
Register/Login -> Select stations -> Fare quote -> Razorpay payment
-> Digital ticket -> Entry gate -> Animated simulator
-> Intermediate/destination exit -> Completed journey
```

## Architecture

| Component | Location | Port | Responsibility |
|---|---|---:|---|
| Web | `apps/web` | 3000 | Passenger UI, payments, tickets and simulator |
| API Gateway | `apps/api-gateway` | 3001 | Public API boundary |
| Core API | `apps/core-api` | 3002 | Auth, fares, purchases, tickets and journeys |
| Payment Service | `apps/payment-service` | 3003 | Razorpay orders and webhooks |
| Worker | `apps/worker` | 3004 | Kafka email consumer and retries |
| Gate Service | `apps/gate-service` | 3005 | Protected gate-device boundary |
| PostgreSQL | Docker | 5433 | Core and payment databases |
| Redis/Kafka | Docker | 6379/9092 | Cache, rate limiting and events |

The browser communicates with the API Gateway only. Secrets and gate credentials remain server-side.

## Requirements

- Node.js 20+
- pnpm 10+
- Docker Desktop
- Razorpay Test Mode credentials
- ngrok for local webhook testing

## Local setup

```powershell
pnpm install
Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @metroflow/core-api db:migrate
pnpm --filter @metroflow/core-api db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Add Razorpay values only to `.env`:

```ini
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

Never commit `.env`; it is ignored by Git.

## Razorpay webhooks

Expose the payment service locally:

```powershell
ngrok http 3003
```

Set this URL in Razorpay Dashboard:

```text
https://your-ngrok-domain/webhooks/razorpay
```

Use Test Mode events such as `payment.captured` and `payment.failed`. Check the service with:

```powershell
Invoke-RestMethod http://localhost:3003/health
```

The ngrok inspector is available at [http://127.0.0.1:4040](http://127.0.0.1:4040).

## Journey simulator

Open the simulator from an issued ticket at `/journey/simulator/[ticketId]`. It loads the ticket’s ordered route and supports entry validation, station-by-station animation, speed controls, intermediate exits, destination exits, expiry handling, refresh/resume, reduced-motion behavior, and journey completion.

The development seed contains 35 stations. Chandni Chowk to Hauz Khas includes Civil Lines, Vishwavidyalaya, Vidhan Sabha, Model Town and Azadpur as intermediate demonstration stops. This is a simplified single-line demo route, not an authoritative live Delhi Metro map.

## Main API routes

```text
POST /api/v1/auth/register       POST /api/v1/auth/login
POST /api/v1/auth/refresh        POST /api/v1/auth/logout
GET  /api/v1/stations            POST /api/v1/fare-quotes
POST /api/v1/purchases            POST /api/v1/payments/initiate
POST /api/v1/payments/confirm     POST /webhooks/razorpay
GET  /api/v1/tickets              GET  /api/v1/tickets/:ticketId
GET  /api/v1/tickets/:ticketId/route
GET  /api/v1/journeys             GET  /api/v1/journeys/:journeyId
POST /api/v1/gate/validate-entry  POST /api/v1/gate/validate-exit
```

## Tests

```powershell
pnpm --filter @metroflow/contracts typecheck
pnpm --filter @metroflow/core-api typecheck
pnpm --filter @metroflow/api-gateway typecheck
pnpm --filter @metroflow/gate-service typecheck
pnpm --filter @metroflow/web typecheck
node scripts/check-http-parser.cjs
node scripts/test-simulator-api.cjs
```

The simulator database tests cover route ordering, ownership, invalid entry, duplicate scans, intermediate exit, fare retention, completion and expiry. Test fixtures are rolled back.

The complete local verification commands are:

```powershell
pnpm typecheck
pnpm test:lifecycle
pnpm test:permissions
pnpm test:admin-queries
pnpm test:worker-delivery
pnpm test:worker-notifications
pnpm test:e2e
```

The browser suite covers authenticated operations access, detail pages, sorting controls, session protection, and desktop/mobile layouts. The simulator route test is skipped unless `E2E_TICKET_ID` is supplied.

## Documentation

- [`docs/simulator.md`](docs/simulator.md) — simulator requirements and completion criteria
- [`metro-journey-simulator-spec.md`](metro-journey-simulator-spec.md) — simulator UX specification
- [`implemented on date/gate-implementation.md`](implemented%20on%20date/gate-implementation.md) — local interview notes, when present

## Security

- Use Razorpay Test Mode locally.
- Keep `.env`, access tokens, API keys and webhook secrets private.
- Never expose `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` or `GATE_API_KEY_SECRET` to the browser.
- Use the API Gateway as the only frontend API boundary.

## V1 scope

V1 includes authentication, fare quotes, Razorpay payments, tickets, QR identifiers, entry and exit gates, intermediate exits, journey lifecycle, animated simulation, shared contract foundations, and backend regression tests. Advanced 3D, live GPS, real-time feeds, physical scanners, multiplayer, refunds, and multi-line routing are outside the current scope.

## V1 status

The functional V1 is complete and the Razorpay Test Mode success/failure flow has been manually verified. Remaining work is production hardening: credential rotation, secret management, deployment configuration, monitoring and alerting, backups and restore procedures, rate limiting, audit retention, and replacement of the simplified demo line if authoritative network data is required.

The detailed local deployment and monitoring checklist is maintained in `v1-production-readiness.md` and is intentionally excluded from the GitHub codebase push.
