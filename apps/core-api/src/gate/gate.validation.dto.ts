import { IsUUID, IsString, MinLength } from "class-validator";
export class GateValidationDto { @IsUUID() gateId!: string; @IsString() @MinLength(1) ticketIdentifier!: string; }
