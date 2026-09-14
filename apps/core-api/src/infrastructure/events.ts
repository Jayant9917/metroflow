export type EmailEvent = {
  eventId: string;
  type: "otp.requested" | "password.reset.requested";
  email: string;
  codeOrToken: string;
  expiresInMinutes: number;
  url?: string;
};
