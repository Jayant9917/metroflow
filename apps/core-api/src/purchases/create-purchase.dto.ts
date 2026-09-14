import { IsUUID } from "class-validator";

export class CreatePurchaseDto {
  @IsUUID()
  fareQuoteId!: string;
}
