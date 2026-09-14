CREATE TYPE payment_status_type AS ENUM ('CREATED', 'PENDING', 'SUCCESS');
CREATE TYPE payment_attempt_status_type AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE payment_idempotency_status_type AS ENUM ('IN_PROGRESS', 'COMPLETED', 'RETRYABLE');
CREATE TYPE payment_outbox_status_type AS ENUM ('PENDING', 'PUBLISHED', 'DEAD');

CREATE TABLE payments (
  id UUID PRIMARY KEY, purchase_id UUID NOT NULL, user_id UUID NOT NULL,
  amount NUMERIC(10, 2) NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
  status payment_status_type NOT NULL DEFAULT 'CREATED',
  razorpay_payment_id TEXT, razorpay_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payments_positive_amount CHECK (amount > 0)
);
CREATE UNIQUE INDEX uq_payments_purchase_id ON payments (purchase_id);
CREATE UNIQUE INDEX uq_payments_razorpay_payment_id ON payments (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments (status);

CREATE TABLE payment_attempts (
  id UUID PRIMARY KEY, payment_id UUID NOT NULL REFERENCES payments (id),
  razorpay_order_id TEXT NOT NULL, razorpay_payment_id TEXT,
  status payment_attempt_status_type NOT NULL DEFAULT 'PENDING', failure_reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payment_attempts_payment_id ON payment_attempts (payment_id);
CREATE UNIQUE INDEX uq_payment_attempts_one_success ON payment_attempts (payment_id) WHERE status = 'SUCCESS';
CREATE UNIQUE INDEX uq_payment_attempts_one_pending ON payment_attempts (payment_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX uq_payment_attempts_razorpay_order_id ON payment_attempts (razorpay_order_id);
CREATE UNIQUE INDEX uq_payment_attempts_razorpay_payment_id ON payment_attempts (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;

CREATE TABLE provider_events (
  id UUID PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'RAZORPAY', event_type TEXT NOT NULL,
  provider_event_id TEXT NOT NULL, payment_id UUID, raw_payload JSONB NOT NULL,
  inconsistency_code TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_provider_events_id UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_provider_events_payment_id ON provider_events (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX idx_provider_events_received_at ON provider_events (received_at DESC);

CREATE TABLE payment_idempotency_keys (
  id UUID PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, purchase_id UUID NOT NULL,
  payment_id UUID NOT NULL REFERENCES payments (id), reserved_attempt_id UUID NOT NULL,
  payment_attempt_id UUID, razorpay_order_id TEXT, response_payload JSONB,
  status payment_idempotency_status_type NOT NULL DEFAULT 'IN_PROGRESS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_payment_idempotency_purchase_id ON payment_idempotency_keys (purchase_id);
CREATE INDEX idx_payment_idempotency_expires_at ON payment_idempotency_keys (expires_at);
CREATE UNIQUE INDEX uq_payment_idempotency_one_in_progress_per_payment ON payment_idempotency_keys (payment_id) WHERE status = 'IN_PROGRESS';

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY, event_type TEXT NOT NULL, topic TEXT NOT NULL, payload JSONB NOT NULL,
  status payment_outbox_status_type NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ, published_at TIMESTAMPTZ, error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payment_outbox_attempts_non_negative CHECK (attempts >= 0)
);
CREATE INDEX idx_payment_outbox_pending ON outbox_events (created_at ASC) WHERE status = 'PENDING';
CREATE INDEX idx_payment_outbox_dead ON outbox_events (attempts DESC) WHERE status = 'DEAD';
