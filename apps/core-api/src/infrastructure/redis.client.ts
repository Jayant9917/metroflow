import Redis from "ioredis";
export const redis = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { lazyConnect: true, maxRetriesPerRequest: 3 },
);
export const otpKey = (purpose: string, userId: string) =>
  `metroflow:otp:${purpose}:${userId}`;
export const rateLimitKey = (purpose: string, email: string) =>
  `metroflow:rate:${purpose}:${email}`;
