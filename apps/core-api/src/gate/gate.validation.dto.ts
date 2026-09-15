import { IsUUID } from "class-validator";
export class GateValidationDto {
  @IsUUID() gateId!: string;
  @IsUUID() ticketIdentifier!: string;
}
