import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { compare, hash } from "bcryptjs";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomInt,
} from "node:crypto";
import { uuidv7 } from "uuidv7";
import { sign, verify } from "jsonwebtoken";
import { AuthUser } from "./auth.types";
import { RegisterDto } from "./register.dto";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEe.6JxQ8d0L3J8u8p4m3t1VYq5X8m2Z9W";

@Injectable()
export class AuthService {
  private readonly pool = new Pool({
    connectionString: process.env.CORE_DATABASE_URL,
  });
  private readonly privateKey =
    process.env.JWT_PRIVATE_KEY ??
    generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
  private readonly otpRequestTimes = new Map<string, number>();
  verifyAccessToken(token: string): AuthUser {
    const payload = verify(token, this.privateKey, {
      algorithms: ["RS256"],
    }) as AuthUser;
    if (!payload.sub || !payload.sessionId || !payload.role)
      throw new Error("Invalid claims");
    return payload;
  }

  private accessToken(user: { id: string; role: string }, sessionId: string) {
    return sign({ role: user.role, sessionId }, this.privateKey, {
      algorithm: "RS256",
      subject: user.id,
      expiresIn: "15m",
    });
  }
  private cookie(token: string) {
    return `refresh_token=${token}; Max-Age=2592000; Path=/api/v1/auth/refresh; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  }
  async requestLoginOtp(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const previousRequest = this.otpRequestTimes.get(email);
    const cooldownSeconds = 60;
    if (
      previousRequest &&
      Date.now() - previousRequest < cooldownSeconds * 1000
    ) {
      throw new UnauthorizedException({
        code: "OTP_RATE_LIMITED",
        message: "Please wait before requesting another code.",
      });
    }
    this.otpRequestTimes.set(email, Date.now());
    const user = (
      await this.pool.query("SELECT id FROM users WHERE email=$1", [email])
    ).rows[0];
    if (user) {
      const code = String(randomInt(100000, 1000000));
      const codeHash = sha256(code);
      const ttl = Number(process.env.OTP_TTL_MINUTES ?? 10);
      await this.pool.query(
        "UPDATE otp_codes SET consumed_at=NOW() WHERE user_id=$1 AND purpose='LOGIN' AND consumed_at IS NULL",
        [user.id],
      );
      await this.pool.query(
        "INSERT INTO otp_codes (id,user_id,purpose,code_hash,expires_at) VALUES ($1,$2,'LOGIN',$3,NOW()+($4 * INTERVAL '1 minute'))",
        [uuidv7(), user.id, codeHash, ttl],
      );
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: [email],
          subject: "Your MetroFlow login code",
          html: `<!doctype html><html><body style="margin:0;background:#f3f7fc;font-family:Arial,sans-serif;color:#10233f"><div style="max-width:560px;margin:32px auto;padding:0 16px"><div style="background:#102b4e;border-radius:18px 18px 0 0;padding:28px 32px;color:#fff"><div style="font-size:24px;font-weight:700;letter-spacing:-.5px">Metro<span style="color:#6ea8ff">Flow</span></div><div style="margin-top:20px;font-size:14px;color:#c9d8ed;letter-spacing:1px;text-transform:uppercase">Secure sign in</div></div><div style="background:#fff;padding:32px;border-radius:0 0 18px 18px;box-shadow:0 8px 24px rgba(16,43,78,.10)"><h1 style="margin:0 0 12px;font-size:24px;color:#10233f">Your login code</h1><p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#526b89">Use this one-time code to continue signing in to your MetroFlow account.</p><div style="background:#edf4ff;border:1px solid #c9dcfa;border-radius:12px;padding:18px;text-align:center"><div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1769e0">${code}</div></div><p style="margin:22px 0 0;font-size:14px;color:#526b89">This code expires in <strong>${ttl} minutes</strong> and can only be used once.</p><div style="margin-top:28px;padding-top:20px;border-top:1px solid #e5edf7;font-size:13px;line-height:1.6;color:#71839a">If you did not request this code, you can safely ignore this email. Never share your login code with anyone.</div></div><p style="text-align:center;font-size:12px;color:#8495aa;margin:18px 0">MetroFlow · Smart transit, clear journeys.</p></div></body></html>`,
        }),
      });
      if (!response.ok) throw new Error("Email provider rejected the request.");
    }
    return {
      message:
        "If an account exists for that email, a login code has been sent.",
    };
  }
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const passwordHash = await hash(dto.password, 12);
    try {
      const result = await this.pool.query(
        "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, role, created_at",
        [uuidv7(), email, passwordHash],
      );
      const user = result.rows[0];
      const code = String(randomInt(100000, 1000000));
      const ttl = Number(process.env.OTP_TTL_MINUTES ?? 10);
      await this.pool.query(
        "INSERT INTO otp_codes (id,user_id,purpose,code_hash,expires_at) VALUES ($1,$2,'EMAIL_VERIFICATION',$3,NOW()+($4 * INTERVAL '1 minute'))",
        [uuidv7(), user.id, sha256(code), ttl],
      );
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: [email],
          subject: "Verify your MetroFlow email",
          html: `<div style="font-family:Arial;max-width:560px;margin:32px auto;padding:32px;background:#f3f7fc;color:#10233f"><h1 style="color:#1769e0">Welcome to MetroFlow</h1><p>Your verification code is:</p><div style="padding:18px;text-align:center;background:#fff;border-radius:12px;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1769e0">${code}</div><p>This code expires in ${ttl} minutes.</p></div>`,
        }),
      });
      return {
        user,
        message: "Account created. Check your email to verify your address.",
      };
    } catch (error: any) {
      if (error.code === "23505")
        throw new ConflictException({
          code: "EMAIL_ALREADY_REGISTERED",
          message: "An account with this email already exists.",
        });
      throw error;
    }
  }
  async login(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const result = await this.pool.query(
      "SELECT id, email, role, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = result.rows[0];
    const valid = await compare(
      dto.password,
      user?.password_hash ?? DUMMY_HASH,
    );
    if (!user || !user.password_hash || !valid)
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
      });
    const sessionId = uuidv7();
    const refreshToken = randomBytes(64).toString("hex");
    const familyId = uuidv7();
    await this.pool.query(
      "INSERT INTO sessions (id, user_id, refresh_token_hash, family_id, expires_at) VALUES ($1, $2, $3, $4, NOW() + interval '30 days')",
      [sessionId, user.id, sha256(refreshToken), familyId],
    );
    return {
      accessToken: this.accessToken(user, sessionId),
      refreshToken,
      cookie: this.cookie(refreshToken),
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
  async refresh(refreshToken: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const old = (
        await client.query(
          "SELECT * FROM sessions WHERE refresh_token_hash = $1 FOR UPDATE",
          [sha256(refreshToken)],
        )
      ).rows[0];
      if (!old)
        throw new UnauthorizedException({
          code: "REFRESH_TOKEN_INVALID",
          message: "Refresh token is invalid.",
        });
      if (old.status === "REVOKED") {
        await client.query(
          "UPDATE sessions SET status='REVOKED', revoked_at=NOW() WHERE family_id=$1 AND status='ACTIVE'",
          [old.family_id],
        );
        throw new UnauthorizedException({
          code: "REFRESH_TOKEN_INVALID",
          message: "Refresh token is invalid.",
        });
      }
      if (old.status !== "ACTIVE" || new Date(old.expires_at) <= new Date()) {
        await client.query(
          "UPDATE sessions SET status='EXPIRED' WHERE id=$1 AND status='ACTIVE'",
          [old.id],
        );
        throw new UnauthorizedException({
          code: "TOKEN_EXPIRED",
          message: "Session has expired.",
        });
      }
      const nextToken = randomBytes(64).toString("hex");
      const nextId = uuidv7();
      await client.query(
        "UPDATE sessions SET status='REVOKED', revoked_at=NOW(), last_used_at=NOW() WHERE id=$1 AND status='ACTIVE' AND expires_at>NOW()",
        [old.id],
      );
      await client.query(
        "INSERT INTO sessions (id,user_id,refresh_token_hash,family_id,rotation_counter,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          nextId,
          old.user_id,
          sha256(nextToken),
          old.family_id,
          old.rotation_counter + 1,
          old.expires_at,
        ],
      );
      await client.query("COMMIT");
      const user = (
        await this.pool.query("SELECT id,email,role FROM users WHERE id=$1", [
          old.user_id,
        ])
      ).rows[0];
      return {
        accessToken: this.accessToken(user, nextId),
        cookie: this.cookie(nextToken),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async logout(sessionId: string) {
    await this.pool.query(
      "UPDATE sessions SET status='REVOKED', revoked_at=NOW() WHERE id=$1 AND status='ACTIVE'",
      [sessionId],
    );
    return { success: true };
  }
  async verifyLoginOtp(emailInput: string, code: string) {
    const email = emailInput.trim().toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = (
        await client.query(
          "SELECT id,email,role,email_verified_at FROM users WHERE email=$1",
          [email],
        )
      ).rows[0];
      const otp = user
        ? (
            await client.query(
              "SELECT * FROM otp_codes WHERE user_id=$1 AND purpose='LOGIN' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
              [user.id],
            )
          ).rows[0]
        : undefined;
      const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);
      if (!user?.email_verified_at)
        throw new UnauthorizedException({
          code: "EMAIL_NOT_VERIFIED",
          message: "Please verify your email before signing in.",
        });
      if (
        !otp ||
        new Date(otp.expires_at) <= new Date() ||
        otp.attempts >= maxAttempts ||
        sha256(code) !== otp.code_hash
      ) {
        if (otp && otp.attempts < maxAttempts)
          await client.query(
            "UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1",
            [otp.id],
          );
        await client.query("COMMIT");
        throw new UnauthorizedException({
          code: "OTP_INVALID",
          message: "The login code is invalid or expired.",
        });
      }
      await client.query("UPDATE otp_codes SET consumed_at=NOW() WHERE id=$1", [
        otp.id,
      ]);
      const sessionId = uuidv7();
      const refreshToken = randomBytes(64).toString("hex");
      const familyId = uuidv7();
      await client.query(
        "INSERT INTO sessions (id,user_id,refresh_token_hash,family_id,expires_at) VALUES ($1,$2,$3,$4,NOW()+interval '30 days')",
        [sessionId, user.id, sha256(refreshToken), familyId],
      );
      await client.query("COMMIT");
      return {
        accessToken: this.accessToken(user, sessionId),
        cookie: this.cookie(refreshToken),
        user: { id: user.id, email: user.email, role: user.role },
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  async verifyEmail(emailInput: string, code: string) {
    return this.verifyEmailCode(emailInput, code);
  }
  async resendVerification(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = (
      await this.pool.query(
        "SELECT id,email_verified_at FROM users WHERE email=$1",
        [email],
      )
    ).rows[0];
    if (user && !user.email_verified_at) {
      const code = String(randomInt(100000, 1000000));
      const ttl = Number(process.env.OTP_TTL_MINUTES ?? 10);
      await this.pool.query(
        "UPDATE otp_codes SET consumed_at=NOW() WHERE user_id=$1 AND purpose='EMAIL_VERIFICATION' AND consumed_at IS NULL",
        [user.id],
      );
      await this.pool.query(
        "INSERT INTO otp_codes (id,user_id,purpose,code_hash,expires_at) VALUES ($1,$2,'EMAIL_VERIFICATION',$3,NOW()+($4 * INTERVAL '1 minute'))",
        [uuidv7(), user.id, sha256(code), ttl],
      );
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: [email],
          subject: "Verify your MetroFlow email",
          html: `<p>Your MetroFlow verification code is <strong>${code}</strong>. It expires in ${ttl} minutes.</p>`,
        }),
      });
    }
    return {
      message: "If the account needs verification, a new code has been sent.",
    };
  }
  private async verifyEmailCode(emailInput: string, code: string) {
    const email = emailInput.trim().toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const user = (
        await client.query(
          "SELECT id,email_verified_at FROM users WHERE email=$1",
          [email],
        )
      ).rows[0];
      const otp = user
        ? (
            await client.query(
              "SELECT * FROM otp_codes WHERE user_id=$1 AND purpose='EMAIL_VERIFICATION' AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
              [user.id],
            )
          ).rows[0]
        : undefined;
      if (
        !user ||
        user.email_verified_at ||
        !otp ||
        new Date(otp.expires_at) <= new Date() ||
        sha256(code) !== otp.code_hash
      ) {
        await client.query("ROLLBACK");
        throw new UnauthorizedException({
          code: "VERIFICATION_INVALID",
          message: "The verification code is invalid or expired.",
        });
      }
      await client.query("UPDATE otp_codes SET consumed_at=NOW() WHERE id=$1", [
        otp.id,
      ]);
      await client.query(
        "UPDATE users SET email_verified_at=NOW(), updated_at=NOW() WHERE id=$1",
        [user.id],
      );
      await client.query("COMMIT");
      return { verified: true };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  async requestPasswordReset(emailInput: string) {
    const email = emailInput.trim().toLowerCase();
    const user = (
      await this.pool.query("SELECT id FROM users WHERE email=$1", [email])
    ).rows[0];
    if (user) {
      const token = randomBytes(32).toString("hex");
      const resetUrl = `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/reset-password?token=${token}`;
      await this.pool.query(
        "UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
      await this.pool.query(
        "INSERT INTO password_reset_tokens (id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,NOW()+interval '15 minutes')",
        [uuidv7(), user.id, sha256(token)],
      );
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: [email],
          subject: "Reset your MetroFlow password",
          html: `<div style="font-family:Arial;max-width:560px;margin:32px auto;padding:32px;background:#f3f7fc;color:#10233f"><h1 style="color:#1769e0">Reset your MetroFlow password</h1><p>Click the button below to choose a new password.</p><p><a href="${resetUrl}" style="display:inline-block;padding:14px 22px;background:#1769e0;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Reset password</a></p><p style="font-size:13px">This link expires in 15 minutes. If the button does not work, use this token: <strong>${token}</strong></p></div>`,
        }),
      });
    }
    return {
      message:
        "If an account exists for that email, reset instructions have been sent.",
    };
  }
  async resetPassword(token: string, password: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const record = (
        await client.query(
          "SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL FOR UPDATE",
          [sha256(token)],
        )
      ).rows[0];
      if (!record || new Date(record.expires_at) <= new Date())
        throw new UnauthorizedException({
          code: "RESET_TOKEN_INVALID",
          message: "The password reset token is invalid or expired.",
        });
      await client.query(
        "UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2",
        [await hash(password, 12), record.user_id],
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1",
        [record.id],
      );
      await client.query(
        "UPDATE sessions SET status='REVOKED', revoked_at=NOW() WHERE user_id=$1 AND status='ACTIVE'",
        [record.user_id],
      );
      await client.query("COMMIT");
      return { success: true };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const result = await this.pool.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [userId],
    );
    const user = result.rows[0];
    if (!user || !(await compare(currentPassword, user.password_hash ?? "")))
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Current password is incorrect.",
      });
    await this.pool.query(
      "UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2",
      [await hash(newPassword, 12), userId],
    );
    await this.pool.query(
      "UPDATE sessions SET status='REVOKED', revoked_at=NOW() WHERE user_id=$1 AND status='ACTIVE'",
      [userId],
    );
    return { success: true };
  }
  async listUserSessions(userId: string) {
    const result = await this.pool.query(
      "SELECT id, family_id, rotation_counter, status, created_at, expires_at, last_used_at, revoked_at, device_info FROM sessions WHERE user_id=$1 ORDER BY created_at DESC",
      [userId],
    );
    return result.rows;
  }
}
