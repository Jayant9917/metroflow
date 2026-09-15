import { Body, Controller, Headers, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { InitiatePaymentDto } from "./initiate-payment.dto";
import { PaymentsService } from "./payments.service";
import { IsString, MinLength } from "class-validator";

class ConfirmPaymentDto {
  @IsString() @MinLength(1) razorpayOrderId!: string;
  @IsString() @MinLength(1) razorpayPaymentId!: string;
  @IsString() @MinLength(1) razorpaySignature!: string;
}

@Controller("api/v1/payments")
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("initiate")
  initiate(@CurrentUser() user: AuthUser, @Headers("idempotency-key") key: string, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(user.sub, dto, key);
  }

  @Post("confirm")
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmPaymentDto) {
    return this.payments.confirm(user.sub, dto);
  }
}
