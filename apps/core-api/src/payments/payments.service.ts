import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";
import { InitiatePaymentDto } from "./initiate-payment.dto";

@Injectable()
export class PaymentsService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });

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
      throw new HttpException({ code: "PAYMENT_SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." }, HttpStatus.BAD_GATEWAY);
    }
    const data = await response.json().catch(() => ({ code: "PAYMENT_PROVIDER_ERROR", message: "Payment service returned an invalid response." }));
    if (!response.ok) throw new HttpException(data, response.status);
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
}
