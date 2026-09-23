export type EmailEvent = {
  eventId: string;
  type: "otp.requested" | "password.reset.requested" | "ticket.issued" | "payment.succeeded" | "payment.failed";
  email: string;
  codeOrToken?: string;
  expiresInMinutes?: number;
  url?: string;
  ticketId?: string;
  purchaseId?: string;
  amount?: string;
  currency?: string;
  origin?: string;
  destination?: string;
  reason?: string;
};
