import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { Roles } from "../auth/auth.decorators";
import { RolesGuard } from "../auth/roles.guard";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TicketsService } from "./tickets.service";

@Controller("api/v1/tickets")
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}
  @Get("operations") @UseGuards(RolesGuard) @Roles("ADMIN", "OPERATOR")
  operations(@Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string) {
    const parsedPage = this.parsePositiveInteger(page, "page", 1);
    const parsedPageSize = this.parsePositiveInteger(pageSize, "pageSize", 25);
    if (parsedPageSize > 100) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "pageSize must be between 1 and 100." });
    if (status !== undefined && !["ISSUED", "IN_JOURNEY", "COMPLETED", "EXPIRED"].includes(status)) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "Invalid ticket status." });
    return this.tickets.listForOperations(parsedPage, parsedPageSize, status).then((data) => ({ success: true, data }));
  }
  private parsePositiveInteger(value: string | undefined, name: string, fallback: number) {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new BadRequestException({ code: "VALIDATION_ERROR", message: `${name} must be a positive integer.` });
    return Number(value);
  }
  @Get() list(@CurrentUser() user: AuthUser) { return this.tickets.list(user.sub); }
  @Get(":ticketId/route") route(@CurrentUser() user: AuthUser, @Param("ticketId", new ParseUUIDPipe()) id: string) { return this.tickets.route(user.sub, id); }
  @Get(":ticketId") get(@CurrentUser() user: AuthUser, @Param("ticketId", new ParseUUIDPipe()) id: string) { return this.tickets.get(user.sub, id); }
}
