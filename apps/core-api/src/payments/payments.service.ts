import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";
import { InitiatePaymentDto } from "./initiate-payment.dto";
import { TicketsService } from "../tickets/tickets.service";
import { KafkaPublisher } from "../infrastructure/kafka.publisher";

@Injectable()
export class PaymentsService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  constructor(private readonly tickets: TicketsService, private readonly publisher: KafkaPublisher) {}
  private async notifyFailure(userId: string, purchaseId: string, reason: string) {
    const user = (await this.pool.query("SELECT email FROM users WHERE id=$1", [userId])).rows[0];
    if (user?.email) void this.publisher.publish({ eventId: uuidv7(), type: "payment.failed", email: user.email, purchaseId, reason }).catch((error) => console.error("payment failure notification publish failed", error));
  }

  async initiate(userId: string, dto: InitiatePaymentDto, idempotencyKey: string) {
    if (!idempotencyKey) throw new HttpException({ code: "VALIDATION_ERROR", message: "Idempotency-Key is required." }, HttpStatus.BAD_REQUEST);
    const purchase = (await this.pool.query<{ id: string; amount: string; currency: string; status: string }>(
      "SELECT id, amount, currency, status FROM purchases WHERE id = $1 AND user_id = $2",
      [dto.purchaseId, userId],
    )).rows[0];
    if (!purchase) throw new HttpException({ code: "PURCHASE_NOT_FOUND", message: "Purchase not found." }, HttpStatus.NOT_FOUND);
    if (purchase.status === "PAID" || purchase.status === "TICKET_ISSUED") throw new ConflictException({ code: "PURCHASE_ALREADY_PAID", message: "This purchase has already been paid." });

    let response: Response;
    try {
      response = await fetch(`${process.env.PAYMENT_SERVICE_URL ?? "http://localhost:3003"}/internal/v1/payments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-internal-service-key": process.env.INTERNAL_SERVICE_KEY ?? "",
        },
        body: JSON.stringify({ purchaseId: purchase.id, userId, amount: purchase.amount, currency: purchase.currency }),
      });
    } catch {
      await this.notifyFailure(userId, purchase.id, "Payment service is temporarily unavailable.");
      throw new HttpException({ code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." }, HttpStatus.BAD_GATEWAY);
    }
    const data = await response.json().catch(() => ({ code: "PAYMENT_PROVIDER_ERROR", message: "Payment service returned an invalid response." }));
    if (!response.ok) { await this.notifyFailure(userId, purchase.id, data.message ?? "Payment initiation failed."); throw new HttpException(data, response.status); }
    await this.pool.query("UPDATE purchases SET status = 'PAYMENT_PENDING', updated_at = NOW() WHERE id = $1 AND status IN ('CREATED', 'PAYMENT_PENDING')", [purchase.id]);
    const payment = data.data?.payment;
    return {
      success: true,
      data: {
        payment: {
          ...payment,
          purchaseId: purchase.id,
          razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? null,
        },
      },
      requestId: uuidv7(),
    };
  }

  async confirm(userId: string, dto: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    let response: Response;
    try {
      response = await fetch(`${process.env.PAYMENT_SERVICE_URL ?? "http://localhost:3003"}/internal/v1/payments/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-service-key": process.env.INTERNAL_SERVICE_KEY ?? "", "x-user-id": userId },
        body: JSON.stringify(dto),
      });
    } catch {
      await this.notifyFailure(userId, dto.razorpayOrderId, "Payment service is temporarily unavailable.");
      throw new HttpException({ code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." }, HttpStatus.BAD_GATEWAY);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { await this.notifyFailure(userId, data.data?.purchaseId ?? dto.razorpayOrderId, data.message ?? "Payment confirmation failed."); throw new HttpException(data, response.status); }
    const purchaseId = data.data?.purchaseId;
    const owned = purchaseId && (await this.pool.query("SELECT id FROM purchases WHERE id = $1 AND user_id = $2", [purchaseId, userId])).rowCount;
    if (!owned) throw new HttpException({ code: "PURCHASE_NOT_FOUND", message: "Purchase not found." }, HttpStatus.NOT_FOUND);
    await this.pool.query("UPDATE purchases SET status = 'PAID', updated_at = NOW() WHERE id = $1 AND status IN ('CREATED', 'PAYMENT_PENDING')", [purchaseId]);
    const ticket = await this.tickets.issueForPurchase(purchaseId, data.data.paymentId);
    const user = (await this.pool.query("SELECT email FROM users WHERE id=$1", [userId])).rows[0];
    if (user?.email) void this.publisher.publish({ eventId: uuidv7(), type: "payment.succeeded", email: user.email, purchaseId, amount: String(ticket.paidAmount), currency: ticket.currency }).catch((error) => console.error("payment notification publish failed", error));
    data.data.ticket = ticket;
    return data;
  }
}
