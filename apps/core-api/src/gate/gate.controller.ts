import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { GateValidationDto } from "./gate.validation.dto";
import { GateService } from "./gate.service";
@Controller("internal/v1/gate")
export class GateController { constructor(private readonly gates: GateService) {} @Get("entry-gates") list() { return this.gates.listEntryGates(); } @Post("validate-entry") validate(@Headers("idempotency-key") requestId: string, @Body() dto: GateValidationDto) { if (!requestId) throw new Error("Idempotency-Key is required."); return this.gates.validateEntry(dto, requestId); } }
