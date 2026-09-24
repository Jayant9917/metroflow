# V1 production-readiness checklist

The functional V1 is complete. This file describes the remaining work required before exposing it to real users. It is a deployment and operations plan, not a replacement for the application test suite.

## 1. Replace development credentials

Development admin and operator credentials must not be reused in production.

- Create unique staff accounts with strong, individually assigned passwords.
- Require password rotation and disable shared accounts.
- Store no real production password in Git, `.env.example`, screenshots, logs, or CI output.
- Rotate JWT signing keys and all service keys before the first production deployment.
- Verify that development-only login shortcuts and test payment behavior are disabled when `NODE_ENV=production`.

## 2. Move secrets to a secret manager

The deployment must inject secrets at runtime from a managed secret store such as AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or a sealed Kubernetes secret.

Secrets include:

- JWT signing key and refresh-token configuration.
- Core and payment PostgreSQL connection strings.
- Razorpay keys and webhook secret.
- Resend/email API key and sender identity.
- Kafka broker credentials and TLS settings.
- Redis URL and credentials.
- Internal service keys, gate API keys, and database encryption keys.

Grant each service only the secrets it needs. Add a rotation procedure and confirm that secrets never appear in frontend bundles or API responses.

## 3. Production deployment configuration

Define separate deployable processes for the web application, API gateway, Core API, payment service, gate service, worker, PostgreSQL, Redis, and Kafka.

Required deployment work:

- Use production Docker images with pinned base-image and package versions.
- Provide environment-specific configuration without committing secrets.
- Add readiness and liveness probes for every service.
- Run database migrations as a controlled release step before application rollout.
- Use TLS at the edge and private networking between internal services.
- Configure domain names, CORS, secure cookies, proxy headers, and HTTPS redirects.
- Add rolling deployment and rollback instructions.
- Set resource limits, restart policies, connection pools, and graceful shutdown handling.
- Keep PostgreSQL, Redis, and Kafka data on persistent volumes with encryption at rest.

## 4. Health checks, metrics, logs, dashboards, and alerts

Health checks answer whether a process is alive and whether its dependencies are usable. Metrics and logs explain why it is unhealthy.

Expose or collect:

- Request count, latency, HTTP error rate, and rate-limit responses by service.
- Login, OTP, payment, ticket, entry, exit, timeout, and notification outcomes.
- Kafka consumer lag, worker processed/sent/retried/dead-letter counts.
- Redis connectivity and memory pressure.
- PostgreSQL connection usage, slow queries, locks, replication, and disk capacity.
- Payment webhook failures and unmatched provider events.
- Active journeys, expired journeys, rejected scans, and outbox backlog.

Use structured JSON logs with request IDs and user-safe identifiers. Never log passwords, OTPs, JWTs, payment signatures, gateway secrets, or raw provider payloads.

Create dashboards for API health, payments, journeys/gates, notifications, and infrastructure. Alert on sustained 5xx errors, high latency, database exhaustion, Kafka lag, dead letters, payment failures, expired certificates, and low disk space.

## 5. Backups, restore testing, and migrations

- Schedule encrypted PostgreSQL backups and define retention periods.
- Test restoring a backup into an isolated environment on a regular schedule.
- Document recovery point objective (RPO) and recovery time objective (RTO).
- Keep migration files immutable and run them through staging first.
- Document forward migration, rollback limitations, and manual repair procedures.
- Back up or recreate Redis/Kafka only according to their role; do not treat transient queues as the source of truth.
- Verify that restored data preserves ticket, payment, journey, gate, audit, and notification consistency.

## 6. Rate limiting and audit retention

- Rate-limit login, OTP requests, password reset, payment initiation, webhook endpoints, and gate scans.
- Apply limits per IP, account, service key, and idempotency key where appropriate.
- Return consistent `429` responses with retry guidance.
- Retain authentication, payment, gate, operator, and administrative audit records for a documented period.
- Prevent deletion or modification of audit records by ordinary operators.
- Define archival and deletion rules that satisfy the intended legal and privacy requirements.

## 7. Authoritative metro network data

The current 35-station line is a verified demo model only. If MetroFlow becomes production-oriented:

- Select an authoritative Delhi Metro data source.
- Import station IDs, line IDs, order, interchange relationships, operating status, and gate metadata.
- Recalculate fare rules and validate routes against the imported network.
- Add an approval/versioning process for network changes.
- Run regression tests for every line, interchange, direction, and station closure.

## Recommended rollout order

1. Create the production environment and secret-management policy.
2. Replace credentials and rotate all keys.
3. Containerize and deploy services with TLS and health probes.
4. Configure migrations, backups, restore testing, and rollback procedures.
5. Add dashboards, alerts, structured logs, rate limits, and audit retention.
6. Run the full payment, ticket, gate, journey, notification, and recovery regression suite in staging.
7. Perform a security review and controlled production canary release.

This checklist is intentionally kept local and is excluded from the GitHub commit requested for the codebase push.
