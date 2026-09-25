# MetroFlow deployment guide for AWS EC2

This guide deploys the MetroFlow web app, API services, worker, PostgreSQL, Redis, and Kafka on one Ubuntu EC2 instance using Docker Compose.

This is suitable for a V1/staging deployment. For production traffic, use managed PostgreSQL/Redis/Kafka where possible, keep internal services private, and put the web app behind HTTPS.

## 1. Target architecture

The EC2 host runs these containers:

| Container | Internal port | Public exposure |
|---|---:|---|
| `web` | 3000 | 80/443 through a reverse proxy |
| `api-gateway` | 3001 | Internal only; web reaches it through the configured public API URL |
| `core-api` | 3002 | Internal only |
| `payment-service` | 3003 | Internal only; expose only a webhook path through a reverse proxy |
| `worker` | 3004 | Internal health check only |
| `gate-service` | 3005 | Internal only or restricted to gate devices |
| PostgreSQL | 5432 | Internal only |
| Redis | 6379 | Internal only |
| Kafka | 9092/29092 | Internal only |

Do not expose PostgreSQL, Redis, Kafka, Core API, Payment Service, or Worker directly to the internet.

## 2. Create the EC2 instance

Recommended starting point:

- Ubuntu Server 24.04 LTS.
- At least 2 vCPUs and 4 GB RAM for a small V1 deployment.
- An encrypted EBS volume with enough space for images, PostgreSQL, Kafka, and logs.
- An Elastic IP or DNS record.
- A security group allowing only:
  - TCP 22 from your administrator IP or VPN.
  - TCP 80 from the internet.
  - TCP 443 from the internet.

Do not open ports 3000, 3001, 3002, 3003, 3004, 3005, 5432, 6379, 9092, or 29092 in the security group.

Connect to the instance:

```bash
ssh -i /path/to/metroflow.pem ubuntu@YOUR_EC2_IP
```

Update the host and install Docker:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git ca-certificates curl nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
docker compose version
```

## 3. Checkout the repository

```bash
cd /opt
sudo git clone https://github.com/YOUR_GITHUB_USER/metroflow.git
sudo chown -R "$USER":"$USER" /opt/metroflow
cd /opt/metroflow
```

Use a deployment branch or a tagged commit rather than deploying an unreviewed `main` commit:

```bash
git checkout main
git pull --ff-only origin main
```

## 4. Create production environment variables

Create the file only on EC2. Never commit it:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set production values, including:

```ini
NODE_ENV=production
WEB_ORIGIN=https://metroflow.example.com
NEXT_PUBLIC_API_URL=https://api.metroflow.example.com

# Use Docker service names, not localhost, inside Compose.
CORE_DATABASE_URL=postgresql://metroflow:REPLACE_WITH_STRONG_PASSWORD@postgres:5432/metroflow_core
PAYMENT_DATABASE_URL=postgresql://metroflow:REPLACE_WITH_STRONG_PASSWORD@postgres:5432/metroflow_payment
REDIS_URL=redis://redis:6379
KAFKA_BROKERS=kafka:29092
CORE_API_URL=http://core-api:3002
PAYMENT_SERVICE_URL=http://payment-service:3003
GATE_SERVICE_URL=http://gate-service:3005

JWT_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
INTERNAL_SERVICE_KEY=REPLACE_WITH_LONG_RANDOM_SECRET
GATE_API_KEY_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET

RAZORPAY_KEY_ID=your_live_or_test_key_id
RAZORPAY_KEY_SECRET=your_provider_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
RESEND_API_KEY=your_resend_key
RESEND_FROM_EMAIL=MetroFlow <no-reply@your-domain.example>

METROFLOW_ADMIN_EMAIL=admin@your-domain.example
METROFLOW_OPERATOR_EMAIL=operator@your-domain.example
METROFLOW_ADMIN_PASSWORD=unique_strong_admin_password
METROFLOW_OPERATOR_PASSWORD=unique_strong_operator_password
```

Generate secrets instead of inventing short values:

```bash
openssl rand -hex 32
openssl rand -base64 48
```

The current Compose file is development-oriented and contains default database credentials and host port mappings. Before production, create a separate `docker-compose.prod.yml` that removes development defaults, binds internal services to the Compose network, and supplies production environment variables.

## 5. Prepare a production Compose file

Start from `docker-compose.yml`, then make these changes in the production file:

- Use `env_file: .env` for application containers.
- Add `restart: unless-stopped` to every service.
- Add health checks and service dependencies based on health, not only container start order.
- Remove public `ports` from databases, Redis, Kafka, Core API, Payment Service, Worker, and Gate Service.
- Publish only the web/reverse-proxy port.
- Set Kafka advertised listeners to the Docker service name, for example `INTERNAL://kafka:29092`.
- Use persistent named volumes for PostgreSQL, Kafka, and any required Redis data.
- Pin image versions; do not use `latest` for production infrastructure.
- Add resource limits and log rotation.

The application images are built from the repository Dockerfiles:

```bash
docker compose -f docker-compose.prod.yml build --pull
```

If you prefer a registry, tag and push the images to Amazon ECR, then change the production Compose file to use those image tags. Keep the ECR repository private and attach an EC2 IAM role with pull permission instead of storing AWS keys on the server.

## 6. Run database migrations and seed only the intended data

Start infrastructure and application containers:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f core-api
```

Run migrations inside the Core API container using the repository’s package script:

```bash
docker compose -f docker-compose.prod.yml exec core-api pnpm db:migrate
```

Seed only when provisioning a new environment and after reviewing the seed data:

```bash
docker compose -f docker-compose.prod.yml exec core-api pnpm db:seed
```

Do not run seed commands during routine deployments if they can create or overwrite staff/test data.

## 7. Configure Nginx and HTTPS

Create DNS records pointing to the EC2 Elastic IP:

- `metroflow.example.com` → web application.
- `api.metroflow.example.com` → API gateway, if the frontend uses a separate API origin.

Example Nginx server block:

```nginx
server {
    listen 80;
    server_name metroflow.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.metroflow.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it, then issue certificates:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d metroflow.example.com -d api.metroflow.example.com
sudo certbot renew --dry-run
```

Set secure cookie, CORS, and webhook origins to the HTTPS domains. Never use `localhost` in production browser configuration.

## 8. Configure Razorpay webhooks

In the Razorpay dashboard, configure the HTTPS webhook URL:

```text
https://api.metroflow.example.com/webhooks/razorpay
```

Use the exact webhook secret stored in `.env`. Verify payment success and failure events in Test Mode first. For live payments, replace keys only after the staging flow passes and confirm that gateway secrets never appear in browser responses or logs.

## 9. Verify the deployment

Check container health and logs:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api-gateway core-api payment-service worker
```

Check public endpoints:

```bash
curl -fsS https://metroflow.example.com
curl -fsS https://api.metroflow.example.com/health
curl -fsS http://127.0.0.1:3004/health
```

Run the non-destructive checks from a controlled environment:

```bash
pnpm typecheck
pnpm test:permissions
pnpm test:admin-queries
pnpm test:worker-notifications
pnpm test:e2e
```

Then manually verify the complete staging flow: register/login, quote, payment success, payment failure, QR ticket, entry, simulator, intermediate exit, destination exit, timeout, notification delivery, admin dashboard, and operator permissions.

## 10. Backups and operations

- Schedule encrypted PostgreSQL backups and test restoration before launch.
- Record recovery point and recovery time objectives.
- Monitor EBS disk usage, Docker volume usage, CPU, memory, and container restarts.
- Configure CloudWatch Agent or another log/metrics collector.
- Alert on API 5xx responses, payment failures, Kafka lag, worker dead letters, database exhaustion, and certificate renewal failures.
- Keep a deployment rollback command and the previous known-good image/tag.
- Apply OS security updates and rotate credentials on a documented schedule.

## 11. Updating the application

```bash
cd /opt/metroflow
git fetch origin
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.prod.yml build --pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec core-api pnpm db:migrate
docker compose -f docker-compose.prod.yml ps
```

For safer releases, deploy a tagged commit, run migrations during a maintenance window, verify health checks, and keep the previous image available for rollback.

## 12. Important security rules

- Do not commit `.env`, private keys, database dumps, or provider credentials.
- Do not expose PostgreSQL, Redis, Kafka, or internal services through the EC2 security group.
- Do not expose Razorpay secrets, JWT secrets, OTPs, passwords, or raw payment payloads to the frontend.
- Do not use development staff credentials in production.
- Do not use the simplified 35-station demo line as authoritative transit data without verification.
