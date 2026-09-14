import { Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import { PaymentsService } from "./payments.service";

@Controller("webhooks/razorpay")
export class RazorpayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(200)
  handle(
    @Headers("x-razorpay-signature") signature: string,
    @Headers("x-razorpay-event-id") eventId: string,
    @Req() request: { rawBody?: Buffer },
  ) {
    return this.payments.handleWebhook(request.rawBody ?? Buffer.alloc(0), signature, eventId);
  }
}
