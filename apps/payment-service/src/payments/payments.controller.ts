import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { InitiatePaymentDto } from "./initiate-payment.dto";
import { ConfirmPaymentDto } from "./confirm-payment.dto";
import { PaymentsService } from "./payments.service";

@Controller("internal/v1/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  initiate(@Headers("idempotency-key") idempotencyKey: string, @Headers("x-internal-service-key") serviceKey: string, @Body() dto: InitiatePaymentDto) {
    if (process.env.NODE_ENV === "production" && (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY)) throw new UnauthorizedException();
    return this.payments.initiate(dto, idempotencyKey);
  }

  @Post("confirm")
  confirm(@Headers("x-internal-service-key") serviceKey: string, @Headers("x-user-id") userId: string, @Body() dto: ConfirmPaymentDto) {
    if (process.env.NODE_ENV === "production" && (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY)) throw new UnauthorizedException();
    return this.payments.confirm(dto, userId);
  }
}
