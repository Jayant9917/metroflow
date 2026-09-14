import { IsIn, IsString, IsUUID, Matches } from "class-validator";

export class InitiatePaymentDto {
  @IsUUID()
  purchaseId!: string;

  @IsUUID()
  userId!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @IsIn(["INR"])
  currency!: string;
}
