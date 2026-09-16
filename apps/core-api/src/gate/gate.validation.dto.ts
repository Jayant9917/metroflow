import { IsUUID } from "class-validator";
import type { GateValidationRequest } from "@metroflow/contracts";
export class GateValidationDto implements GateValidationRequest {
  @IsUUID() gateId!: string;
  @IsUUID() ticketIdentifier!: string;
}
