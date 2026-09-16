import { IsUUID } from "class-validator";
import type { InitiatePaymentRequest } from "@metroflow/contracts";

export class InitiatePaymentDto implements InitiatePaymentRequest {
  @IsUUID()
  purchaseId!: string;
}
