import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { Roles } from "../auth/auth.decorators";
import { RolesGuard } from "../auth/roles.guard";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreatePurchaseDto } from "./create-purchase.dto";
import { PurchasesService } from "./purchases.service";

@Controller("api/v1/purchases")
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}
  @Get("operations") @UseGuards(RolesGuard) @Roles("ADMIN", "OPERATOR")
  operations() { return this.purchases.listForOperations().then((purchases) => ({ success: true, data: { purchases } })); }

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
