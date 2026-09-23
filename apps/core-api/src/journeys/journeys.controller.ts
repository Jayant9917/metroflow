import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import { CurrentUser } from "../auth/auth.decorators";
import { Roles } from "../auth/auth.decorators";
import { RolesGuard } from "../auth/roles.guard";
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JourneysService } from "./journeys.service";

@Controller("api/v1/journeys")
@UseGuards(JwtAuthGuard)
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}
  @Get("operations") @UseGuards(RolesGuard) @Roles("ADMIN", "OPERATOR")
  operations(@Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string, @Query("search") search?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) {
    const p = this.parsePage(page, "page", 1), s = this.parsePage(pageSize, "pageSize", 25);
    if (s > 100) throw new BadRequestException("pageSize must be between 1 and 100.");
    if (status !== undefined && !["ACTIVE", "COMPLETED", "TIMED_OUT"].includes(status)) throw new BadRequestException("Invalid journey status.");
    if (sortBy && !["createdAt", "enteredAt", "status", "email"].includes(sortBy)) throw new BadRequestException("Invalid journey sort field.");
    if (sortDirection && !["asc", "desc"].includes(sortDirection)) throw new BadRequestException("Invalid sort direction.");
    return this.journeys.listForOperations(p, s, status, search, sortBy, sortDirection).then((data) => ({ success: true, data }));
  }
  private parsePage(value: string | undefined, name: string, fallback: number) { if (value === undefined) return fallback; if (!/^\d+$/.test(value) || Number(value) < 1) throw new BadRequestException(`${name} must be a positive integer.`); return Number(value); }
  @Get() list(
    @CurrentUser() user: AuthUser,
    @Query("ticketId") ticketId?: string,
    @Query("status") status?: string,
  ) {
    if (ticketId !== undefined && !isUUID(ticketId))
      throw new BadRequestException("ticketId must be a UUID.");
    if (
      status !== undefined &&
      !["ACTIVE", "COMPLETED", "TIMED_OUT"].includes(status)
    )
      throw new BadRequestException("Invalid journey status.");
    return this.journeys.list(user.sub, ticketId, status);
  }
  @Get(":journeyId") get(
    @CurrentUser() user: AuthUser,
    @Param("journeyId", new ParseUUIDPipe()) id: string,
  ) {
    return this.journeys.get(user.sub, id);
  }
}
