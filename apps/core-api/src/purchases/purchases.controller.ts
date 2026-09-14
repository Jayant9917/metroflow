import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreatePurchaseDto } from "./create-purchase.dto";
import { PurchasesService } from "./purchases.service";

@Controller("api/v1/purchases")
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePurchaseDto) {
    return this.purchases.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.purchases.list(user.sub);
  }

  @Get(":purchaseId")
  get(@CurrentUser() user: AuthUser, @Param("purchaseId") purchaseId: string) {
    return this.purchases.get(user.sub, purchaseId);
  }
}
