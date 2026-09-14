import { ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";
import { InitiatePaymentDto } from "./initiate-payment.dto";

type PaymentResult = {
  paymentId: string;
  paymentAttemptId: string;
  razorpayOrderId: string;
  amount: string;
  currency: string;
};

@Injectable()
export class PaymentsService {
  private readonly pool = new Pool({ connectionString: process.env.PAYMENT_DATABASE_URL });

  private paise(amount: string) {
    const [whole, fraction = ""] = amount.split(".");
    return Number(`${whole}${fraction.padEnd(2, "0")}`);
  }

  private validSignature(rawBody: Buffer, signature: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const actual = Buffer.from(signature, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  }

  async handleWebhook(rawBody: Buffer, signature: string, providerEventId: string) {
    if (!this.validSignature(rawBody, signature)) {
      throw new UnauthorizedException({ code: "WEBHOOK_SIGNATURE_INVALID", message: "Webhook signature is invalid." });
    }
    if (!providerEventId) throw new ConflictException({ code: "WEBHOOK_EVENT_ID_MISSING", message: "Webhook event ID is required." });
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new ConflictException({ code: "WEBHOOK_PAYLOAD_INVALID", message: "Webhook payload is invalid." });
    }
    const eventType = String(payload.event ?? "");
    const entity = payload.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const razorpayPaymentId = entity?.id;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attempt = orderId ? (await client.query<{ id: string; payment_id: string; amount: string; currency: string; status: string; purchase_id: string; user_id: string }>(
        `SELECT a.id, a.payment_id, p.amount, p.currency, a.status, p.purchase_id, p.user_id
           FROM payment_attempts a JOIN payments p ON p.id = a.payment_id
          WHERE a.razorpay_order_id = $1 FOR UPDATE`, [orderId])).rows[0] : undefined;
      const inconsistency = !attempt ? "UNKNOWN_RAZORPAY_ORDER" : undefined;
      const inserted = (await client.query<{ id: string }>(
        `INSERT INTO provider_events (id, event_type, provider_event_id, payment_id, raw_payload, inconsistency_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
        [uuidv7(), eventType, providerEventId, attempt?.payment_id ?? null, payload, inconsistency],
      )).rows[0];
      if (!inserted) {
        await client.query("COMMIT");
        return { success: true, data: { duplicate: true }, requestId: uuidv7() };
      }
      if (attempt && eventType === "payment.captured") {
        const providerAmount = Number(entity?.amount);
        if (providerAmount !== this.paise(attempt.amount) || entity?.currency !== attempt.currency) {
          await client.query("UPDATE provider_events SET inconsistency_code = 'PAYMENT_AMOUNT_MISMATCH' WHERE id = $1", [inserted.id]);
        } else if (attempt.status === "PENDING") {
          await client.query("UPDATE payment_attempts SET status = 'SUCCESS', razorpay_payment_id = $1, resolved_at = NOW() WHERE id = $2", [razorpayPaymentId, attempt.id]);
          await client.query("UPDATE payments SET status = 'SUCCESS', razorpay_payment_id = $1, razorpay_signature = $2, updated_at = NOW() WHERE id = $3", [razorpayPaymentId, signature, attempt.payment_id]);
          await client.query(
            `INSERT INTO outbox_events (id, event_type, topic, payload)
             VALUES ($1, 'PAYMENT_SUCCEEDED', 'payment.succeeded', $2)`,
            [uuidv7(), JSON.stringify({ eventId: uuidv7(), eventType: "PAYMENT_SUCCEEDED", version: "1.0", occurredAt: new Date().toISOString(), paymentId: attempt.payment_id, purchaseId: attempt.purchase_id, userId: attempt.user_id, amount: attempt.amount, currency: attempt.currency })],
          );
        }
      } else if (attempt && eventType === "payment.failed" && attempt.status === "PENDING") {
        await client.query("UPDATE payment_attempts SET status = 'FAILED', failure_reason = $1, resolved_at = NOW() WHERE id = $2", [payload.payload?.payment?.entity?.error_description ?? "Payment failed.", attempt.id]);
      }
      await client.query("COMMIT");
      return { success: true, data: { received: true }, requestId: uuidv7() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async createOrder(amount: string, currency: string, receipt: string) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !secret) {
      if (process.env.NODE_ENV === "production") throw new InternalServerErrorException({ code: "PAYMENT_PROVIDER_ERROR", message: "Payment provider is not configured." });
      return `order_dev_${receipt}`;
    }
    let response: Response;
    try {
      response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: this.paise(amount), currency, receipt }),
      });
    } catch {
      throw new InternalServerErrorException({ code: "PAYMENT_PROVIDER_ERROR", message: "Payment provider could not be reached. Please try again." });
    }
    if (!response.ok) throw new InternalServerErrorException({ code: "PAYMENT_PROVIDER_ERROR", message: "We were unable to initiate payment. Please try again." });
    const order = (await response.json()) as { id?: string };
    if (!order.id) throw new InternalServerErrorException({ code: "PAYMENT_PROVIDER_ERROR", message: "Payment provider returned an invalid order." });
    return order.id;
  }

  async initiate(dto: InitiatePaymentDto, idempotencyKey: string) {
    if (!idempotencyKey) throw new ConflictException({ code: "VALIDATION_ERROR", message: "Idempotency-Key is required." });
    const client = await this.pool.connect();
    let paymentId: string;
    let attemptId: string;
    try {
      await client.query("BEGIN");
      const existing = (await client.query<{ status: string; response_payload: PaymentResult | null }>("SELECT status, response_payload FROM payment_idempotency_keys WHERE idempotency_key = $1 FOR UPDATE", [idempotencyKey])).rows[0];
      if (existing?.status === "COMPLETED" && existing.response_payload) {
        await client.query("COMMIT");
        return { success: true, data: { payment: existing.response_payload }, requestId: uuidv7() };
      }
      const payment = (await client.query<{ id: string; status: string }>(
        `INSERT INTO payments (id, purchase_id, user_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, 'CREATED')
         ON CONFLICT (purchase_id) DO UPDATE SET updated_at = NOW()
         RETURNING id, status`,
        [uuidv7(), dto.purchaseId, dto.userId, dto.amount, dto.currency],
      )).rows[0];
      paymentId = payment.id;
      if (payment.status === "SUCCESS") throw new ConflictException({ code: "PAYMENT_ALREADY_COMPLETED", message: "This payment has already been completed." });
      const pending = (await client.query<{ id: string; razorpay_order_id: string }>("SELECT id, razorpay_order_id FROM payment_attempts WHERE payment_id = $1 AND status = 'PENDING'", [paymentId])).rows[0];
      if (pending && !existing) throw new ConflictException({ code: "PAYMENT_ATTEMPT_IN_PROGRESS", message: "A payment attempt is already in progress. Please complete it or wait for it to finish." });
      attemptId = pending?.id ?? uuidv7();
      if (existing?.status === "IN_PROGRESS") throw new ConflictException({ code: "PAYMENT_INITIATION_IN_PROGRESS", message: "Payment setup is already in progress. Please wait a moment and try again." });
      await client.query(
        `INSERT INTO payment_idempotency_keys (id, idempotency_key, purchase_id, payment_id, reserved_attempt_id, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', NOW() + INTERVAL '24 hours')`,
        [uuidv7(), idempotencyKey, dto.purchaseId, paymentId, attemptId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const orderId = await this.createOrder(dto.amount, dto.currency, attemptId!);
    const result: PaymentResult = { paymentId: paymentId!, paymentAttemptId: attemptId!, razorpayOrderId: orderId, amount: dto.amount, currency: dto.currency };
    const finalizeClient = await this.pool.connect();
    try {
      await finalizeClient.query("BEGIN");
      await finalizeClient.query("INSERT INTO payment_attempts (id, payment_id, razorpay_order_id, status) VALUES ($1, $2, $3, 'PENDING')", [attemptId!, paymentId!, orderId]);
      await finalizeClient.query("UPDATE payments SET status = 'PENDING', updated_at = NOW() WHERE id = $1", [paymentId!]);
      await finalizeClient.query("UPDATE payment_idempotency_keys SET status = 'COMPLETED', payment_attempt_id = $1, razorpay_order_id = $2, response_payload = $3, updated_at = NOW() WHERE idempotency_key = $4", [attemptId!, orderId, JSON.stringify(result), idempotencyKey]);
      await finalizeClient.query("COMMIT");
    } catch (error) {
      await finalizeClient.query("ROLLBACK");
      throw error;
    } finally {
      finalizeClient.release();
    }
    return { success: true, data: { payment: result }, requestId: uuidv7() };
  }
}
