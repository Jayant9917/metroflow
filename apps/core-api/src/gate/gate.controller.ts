import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
  UseGuards,
  Query,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import { GateValidationDto } from "./gate.validation.dto";
import { GateService } from "./gate.service";
import { Roles } from "../auth/auth.decorators";
import { RolesGuard } from "../auth/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
@Controller("internal/v1/gate")
export class GateController {
  constructor(private readonly gates: GateService) {}
  @Get("operations/events") @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN", "OPERATOR")
  events(@Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("eventType") eventType?: string) { const p = page ? Number(page) : 1, s = pageSize ? Number(pageSize) : 25; if (!Number.isInteger(p) || p < 1 || !Number.isInteger(s) || s < 1 || s > 100) throw new BadRequestException("Invalid pagination parameters."); if (eventType !== undefined && !["ENTRY_ACCEPTED", "ENTRY_REJECTED", "EXIT_ACCEPTED", "EXIT_REJECTED"].includes(eventType)) throw new BadRequestException("Invalid gate event type."); return this.gates.listEventsForOperations(p, s, eventType).then((data) => ({ success: true, data })); }
  private validateHeaders(key: string, requestId: string) {
    if (!key || key !== process.env.GATE_API_KEY_SECRET)
      throw new UnauthorizedException("Invalid gate API key.");
    if (!requestId || !isUUID(requestId))
      throw new BadRequestException("Idempotency-Key must be a UUID.");
  }
  @Get("entry-gates") list() {
    return this.gates.listEntryGates();
  }
  @Get("exit-gates") exits() {
    return this.gates.listExitGates();
  }
  @Post("validate-entry") validate(
    @Headers("x-gate-api-key") key: string,
    @Headers("idempotency-key") requestId: string,
    @Body() dto: GateValidationDto,
  ) {
    this.validateHeaders(key, requestId);
    return this.gates.validateEntry(dto, requestId);
  }
  @Post("validate-exit") validateExit(
    @Headers("x-gate-api-key") key: string,
    @Headers("idempotency-key") requestId: string,
    @Body() dto: GateValidationDto,
  ) {
    this.validateHeaders(key, requestId);
    return this.gates.validateExit(dto, requestId);
  }
}
