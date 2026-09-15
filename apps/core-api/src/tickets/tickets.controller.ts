import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TicketsService } from "./tickets.service";

@Controller("api/v1/tickets")
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.tickets.list(user.sub); }
  @Get(":ticketId") get(@CurrentUser() user: AuthUser, @Param("ticketId") id: string) { return this.tickets.get(user.sub, id); }
}
