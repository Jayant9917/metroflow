import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException,
  UseGuards,
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
  events() { return this.gates.listEventsForOperations().then((events) => ({ success: true, data: { events } })); }
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
