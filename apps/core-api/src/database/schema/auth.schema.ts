import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
export const userRole = pgEnum("user_role_type", [
  "PASSENGER",
  "OPERATOR",
  "ADMIN",
]);
export const sessionStatus = pgEnum("session_status_type", [
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
]);
export const otpPurpose = pgEnum("otp_purpose_type", [
  "LOGIN",
  "EMAIL_VERIFICATION",
]);
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    role: userRole("role").notNull().default("PASSENGER"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("uq_users_email").on(t.email),
    roleIndex: index("idx_users_role").on(t.role),
  }),
);
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    familyId: uuid("family_id").notNull(),
    rotationCounter: integer("rotation_counter").notNull().default(0),
    status: sessionStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    deviceInfo: text("device_info"),
  },
  (t) => ({
    tokenUnique: uniqueIndex("uq_sessions_refresh_token_hash").on(
      t.refreshTokenHash,
    ),
    userIndex: index("idx_sessions_user_id").on(t.userId),
    familyIndex: index("idx_sessions_family_id").on(t.familyId),
  }),
);
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: otpPurpose("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => ({
    userIndex: index("idx_otp_codes_user_id").on(t.userId),
    expiryIndex: index("idx_otp_codes_expires_at").on(t.expiresAt),
  }),
);
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("uq_password_reset_tokens_hash").on(t.tokenHash),
    userIndex: index("idx_password_reset_tokens_user_id").on(t.userId),
  }),
);

export const authAuditLogs = pgTable(
  "auth_audit_logs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIndex: index("idx_auth_audit_logs_user_id").on(t.userId),
    actionIndex: index("idx_auth_audit_logs_action").on(t.action),
    createdIndex: index("idx_auth_audit_logs_created_at").on(t.createdAt),
  }),
);
