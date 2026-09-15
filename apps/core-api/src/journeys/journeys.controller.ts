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
import { AuthUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JourneysService } from "./journeys.service";

@Controller("api/v1/journeys")
@UseGuards(JwtAuthGuard)
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}
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
