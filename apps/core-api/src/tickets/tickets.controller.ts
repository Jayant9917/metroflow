import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
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
  operations() { return this.tickets.listForOperations().then((tickets) => ({ success: true, data: { tickets } })); }
  @Get() list(@CurrentUser() user: AuthUser) { return this.tickets.list(user.sub); }
  @Get(":ticketId/route") route(@CurrentUser() user: AuthUser, @Param("ticketId", new ParseUUIDPipe()) id: string) { return this.tickets.route(user.sub, id); }
  @Get(":ticketId") get(@CurrentUser() user: AuthUser, @Param("ticketId", new ParseUUIDPipe()) id: string) { return this.tickets.get(user.sub, id); }
}
