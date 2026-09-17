import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
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
  operations(@Query("page") page?: string, @Query("pageSize") pageSize?: string) { const p = this.parsePage(page, "page", 1), s = this.parsePage(pageSize, "pageSize", 25); if (s > 100) throw new BadRequestException("pageSize must be between 1 and 100."); return this.purchases.listForOperations(p, s).then((data) => ({ success: true, data })); }
  private parsePage(value: string | undefined, name: string, fallback: number) { if (value === undefined) return fallback; if (!/^\d+$/.test(value) || Number(value) < 1) throw new BadRequestException(`${name} must be a positive integer.`); return Number(value); }

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
