import { Body, Controller, Headers, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InitiatePaymentDto } from "./initiate-payment.dto";
import { PaymentsService } from "./payments.service";

@Controller("api/v1/payments")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("initiate")
  initiate(@CurrentUser() user: AuthUser, @Headers("idempotency-key") key: string, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(user.sub, dto, key);
  }
}
