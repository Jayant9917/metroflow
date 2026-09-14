import { IsUUID } from "class-validator";

export class CreateFareQuoteDto {
  @IsUUID()
  originStationId!: string;

  @IsUUID()
  destinationStationId!: string;
}
