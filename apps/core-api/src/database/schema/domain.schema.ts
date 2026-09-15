import {
  boolean,
  bigserial,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  text,
  uuid,
  numeric,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth.schema";

export const gateType = pgEnum("gate_type", ["ENTRY", "EXIT"]);
export const gateStatus = pgEnum("gate_status_type", ["ACTIVE", "INACTIVE"]);
export const purchaseStatus = pgEnum("purchase_status_type", [
  "CREATED",
  "PAYMENT_PENDING",
  "PAID",
  "TICKET_ISSUED",
]);
export const ticketStatus = pgEnum("ticket_status_type", [
  "ISSUED",
  "IN_JOURNEY",
  "COMPLETED",
  "EXPIRED",
]);
export const journeyStatus = pgEnum("journey_status_type", [
  "ACTIVE",
  "COMPLETED",
  "TIMED_OUT",
]);
export const gateEventType = pgEnum("gate_event_type", [
  "ENTRY_ACCEPTED",
  "ENTRY_REJECTED",
  "EXIT_ACCEPTED",
  "EXIT_REJECTED",
]);
export const gateRejectionReason = pgEnum("gate_rejection_reason_type", [
  "TICKET_NOT_FOUND",
  "TICKET_EXPIRED",
  "TICKET_COMPLETED",
  "TICKET_ALREADY_IN_JOURNEY",
  "WRONG_ORIGIN",
  "WRONG_DESTINATION",
  "NO_ACTIVE_JOURNEY",
  "JOURNEY_TIMED_OUT",
  "GATE_INACTIVE",
]);
export const outboxStatus = pgEnum("outbox_status_type", [
  "PENDING",
  "PUBLISHED",
  "DEAD",
]);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    lineOrder: integer("line_order").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeUnique: uniqueIndex("uq_stations_code").on(t.code),
    lineOrderUnique: uniqueIndex("uq_stations_line_order").on(t.lineOrder),
  }),
);

export const gates = pgTable(
  "gates",
  {
    id: uuid("id").primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    code: text("code").notNull(),
    type: gateType("type").notNull(),
    status: gateStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    stationCodeUnique: uniqueIndex("uq_gates_station_code").on(
      t.stationId,
      t.code,
    ),
    stationIndex: index("idx_gates_station_id").on(t.stationId),
    statusIndex: index("idx_gates_status").on(t.status),
  }),
);

export const fareRules = pgTable(
  "fare_rules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    originStationId: uuid("origin_station_id")
      .notNull()
      .references(() => stations.id),
    destinationStationId: uuid("destination_station_id")
      .notNull()
      .references(() => stations.id),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    isActive: boolean("is_active").notNull().default(true),
    validFrom: timestamp("valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    originIndex: index("idx_fare_rules_origin").on(t.originStationId),
    destinationIndex: index("idx_fare_rules_destination").on(
      t.destinationStationId,
    ),
  }),
);

export const fareQuotes = pgTable(
  "fare_quotes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    originStationId: uuid("origin_station_id")
      .notNull()
      .references(() => stations.id),
    destinationStationId: uuid("destination_station_id")
      .notNull()
      .references(() => stations.id),
    fareRuleId: integer("fare_rule_id")
      .notNull()
      .references(() => fareRules.id),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIndex: index("idx_fare_quotes_user_id").on(t.userId),
    expiryIndex: index("idx_fare_quotes_expires_at").on(t.expiresAt),
    routeCheck: check(
      "chk_fare_quotes_different_stations",
      sql`${t.originStationId} <> ${t.destinationStationId}`,
    ),
  }),
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    fareQuoteId: uuid("fare_quote_id")
      .notNull()
      .references(() => fareQuotes.id),
    originStationId: uuid("origin_station_id")
      .notNull()
      .references(() => stations.id),
    destinationStationId: uuid("destination_station_id")
      .notNull()
      .references(() => stations.id),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: purchaseStatus("status").notNull().default("CREATED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    quoteUnique: uniqueIndex("uq_purchases_fare_quote_id").on(t.fareQuoteId),
    userIndex: index("idx_purchases_user_id").on(t.userId),
    statusIndex: index("idx_purchases_status").on(t.status),
    routeCheck: check(
      "chk_purchases_different_stations",
      sql`${t.originStationId} <> ${t.destinationStationId}`,
    ),
  }),
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    paymentId: uuid("payment_id").notNull(),
    originStationId: uuid("origin_station_id")
      .notNull()
      .references(() => stations.id),
    destinationStationId: uuid("destination_station_id")
      .notNull()
      .references(() => stations.id),
    paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("INR"),
    status: ticketStatus("status").notNull().default("ISSUED"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    paymentUnique: uniqueIndex("uq_tickets_payment_id").on(t.paymentId),
    purchaseUnique: uniqueIndex("uq_tickets_purchase_id").on(t.purchaseId),
    userIndex: index("idx_tickets_user_id").on(t.userId),
    statusIndex: index("idx_tickets_status").on(t.status),
    expiryIndex: index("idx_tickets_expires_at").on(t.expiresAt),
    expiryCheck: check("chk_tickets_expiry_after_issue", sql`${t.expiresAt} > ${t.issuedAt}`),
  }),
);

export const journeys = pgTable(
  "journeys",
  {
    id: uuid("id").primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entryStationId: uuid("entry_station_id")
      .notNull()
      .references(() => stations.id),
    exitStationId: uuid("exit_station_id").references(() => stations.id),
    entryGateId: uuid("entry_gate_id")
      .notNull()
      .references(() => gates.id),
    exitGateId: uuid("exit_gate_id").references(() => gates.id),
    status: journeyStatus("status").notNull().default("ACTIVE"),
    enteredAt: timestamp("entered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    timedOutAt: timestamp("timed_out_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ticketUnique: uniqueIndex("uq_journeys_ticket_id").on(t.ticketId),
    userIndex: index("idx_journeys_user_id").on(t.userId),
    statusIndex: index("idx_journeys_status").on(t.status),
    entryStationIndex: index("idx_journeys_entry_station").on(t.entryStationId),
    expiryIndex: index("idx_journeys_active_expires").on(t.expiresAt),
    expiryCheck: check("chk_journeys_expires_after_entry", sql`${t.expiresAt} > ${t.enteredAt}`),
  }),
);

export const gateEvents = pgTable(
  "gate_events",
  {
    id: uuid("id").primaryKey(),
    gateId: uuid("gate_id")
      .notNull()
      .references(() => gates.id),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    ticketId: uuid("ticket_id"),
    eventType: gateEventType("event_type").notNull(),
    rejectionReason: gateRejectionReason("rejection_reason"),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    gateIndex: index("idx_gate_events_gate_id").on(t.gateId),
    occurredIndex: index("idx_gate_events_occurred_at").on(t.occurredAt),
    ticketIndex: index("idx_gate_events_ticket_id").on(t.ticketId),
    requestUnique: uniqueIndex("uq_gate_events_request_id").on(t.requestId),
  }),
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    eventType: text("event_type").notNull(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pendingIndex: index("idx_outbox_pending").on(t.createdAt),
    deadIndex: index("idx_outbox_dead").on(t.attempts),
    attemptsCheck: check("chk_outbox_attempts_non_negative", sql`${t.attempts} >= 0`),
  }),
);
