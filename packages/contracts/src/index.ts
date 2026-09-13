export const PAYMENT_SUCCEEDED_TOPIC = 'payment.succeeded' as const;
export type EventEnvelope<T> = { version: 1; eventId: string; occurredAt: string; payload: T };
