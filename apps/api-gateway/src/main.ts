import "reflect-metadata";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
@Controller()
class HealthController {
  @Get("health") health() {
    return { status: "ok", service: "api-gateway" };
  }
}
@Controller("api/v1/auth")
class AuthProxyController {
  @Post("password-reset/request") async requestReset(@Body() body: unknown) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/password-reset/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Post("password-reset/confirm") async confirmReset(@Body() body: unknown) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/password-reset/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Post("otp/request") async requestOtp(@Body() body: unknown) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/otp/request`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Post("otp/verify") async verifyOtp(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/otp/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    const cookie = response.headers.get("set-cookie");
    if (cookie) res.header("set-cookie", cookie);
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Post("register") async register(@Body() body: unknown) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
}
@Controller("api/v1/auth")
class LoginProxyController {
  @Post("login") async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: any,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    const cookie = response.headers.get("set-cookie");
    if (cookie) res.header("set-cookie", cookie);
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
}
@Controller("api/v1/auth")
class SessionProxyController {
  private async forward(
    path: string,
    headers: Record<string, string>,
    res: any,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`,
      { method: "POST", headers },
    );
    const data = await response.json();
    const cookie = response.headers.get("set-cookie");
    if (cookie) res.header("set-cookie", cookie);
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Post("refresh") refresh(
    @Headers("cookie") cookie: string,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.forward("/api/v1/auth/refresh", { cookie: cookie ?? "" }, res);
  }
  @Post("logout") logout(
    @Headers("authorization") authorization: string,
    @Res({ passthrough: true }) res: any,
  ) {
    return this.forward(
      "/api/v1/auth/logout",
      { authorization: authorization ?? "" },
      res,
    );
  }
}
@Controller("api/v1/auth")
class MeProxyController {
  @Get("me") async me(@Headers("authorization") authorization: string) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/me`,
      { headers: { authorization: authorization ?? "" } },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
}
@Controller("api/v1/auth")
class ProtectedAuthProxyController {
  @Post("password/change") async changePassword(
    @Headers("authorization") authorization: string,
    @Body() body: unknown,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/auth/password/change`,
      {
        method: "POST",
        headers: {
          authorization: authorization ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  private async get(path: string, authorization: string) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`,
      { headers: { authorization: authorization ?? "" } },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  @Get("sessions") sessions(@Headers("authorization") authorization: string) {
    return this.get("/api/v1/auth/sessions", authorization);
  }
  @Get("operations") operations(
    @Headers("authorization") authorization: string,
  ) {
    return this.get("/api/v1/auth/operations", authorization);
  }
}
@Controller("api/v1/stations")
class StationsProxyController {
  @Patch(":stationId/status") async setStation(@Headers("authorization") authorization: string, @Param("stationId") id: string, @Body() body: unknown) { return this.mutate(`/api/v1/stations/${id}/status`, authorization, body); }
  @Patch("gates/:gateId/status") async setGate(@Headers("authorization") authorization: string, @Param("gateId") id: string, @Body() body: unknown) { return this.mutate(`/api/v1/stations/gates/${id}/status`, authorization, body); }
  @Get("operations")
  async operations(@Headers("authorization") authorization: string) {
    return this.forward("/api/v1/stations/operations", authorization);
  }
  @Get()
  async list(@Headers("authorization") authorization: string) {
    return this.forward("/api/v1/stations", authorization);
  }
  private async forward(path: string, authorization: string) {
    const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { headers: { authorization: authorization ?? "" } });
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
  private async mutate(path: string, authorization: string, body: unknown) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { method: "PATCH", headers: { authorization: authorization ?? "", "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
}
@Controller("api/v1/fare-quotes")
class FareQuotesProxyController {
  @Post()
  async create(
    @Headers("authorization") authorization: string,
    @Body() body: unknown,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/fare-quotes`,
      {
        method: "POST",
        headers: {
          authorization: authorization ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
}
@Controller("api/v1/purchases")
class PurchasesProxyController {
  private async forward(
    path: string,
    method: string,
    authorization: string,
    body?: unknown,
  ) {
    const headers: Record<string, string> = { authorization: authorization ?? "" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }

  @Post()
  create(@Headers("authorization") authorization: string, @Body() body: unknown) {
    return this.forward("/api/v1/purchases", "POST", authorization, body);
  }
  @Get("operations")
  operations(@Headers("authorization") authorization: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string, @Query("search") search?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) { const query = new URLSearchParams(); if (page) query.set("page", page); if (pageSize) query.set("pageSize", pageSize); if (status) query.set("status", status); if (search) query.set("search", search); if (sortBy) query.set("sortBy", sortBy); if (sortDirection) query.set("sortDirection", sortDirection); return this.forward(`/api/v1/purchases/operations${query.size ? `?${query.toString()}` : ""}`, "GET", authorization); }

  @Get()
  list(@Headers("authorization") authorization: string) {
    return this.forward("/api/v1/purchases", "GET", authorization);
  }

  @Get(":purchaseId")
  get(@Headers("authorization") authorization: string, @Param("purchaseId") purchaseId: string) {
    return this.forward(`/api/v1/purchases/${purchaseId}`, "GET", authorization);
  }
}
@Controller("api/v1/payments")
class PaymentsProxyController {
  @Post("initiate")
  async initiate(
    @Headers("authorization") authorization: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() body: unknown,
  ) {
    const response = await fetch(
      `${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/payments/initiate`,
      {
        method: "POST",
        headers: {
          authorization: authorization ?? "",
          "idempotency-key": idempotencyKey ?? "",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }

  @Post("confirm")
  async confirm(@Headers("authorization") authorization: string, @Body() body: unknown) {
    const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/payments/confirm`, {
      method: "POST", headers: { authorization: authorization ?? "", "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new HttpException(data, response.status);
    return data;
  }
}
@Controller("api/v1/tickets")
class TicketsProxyController {
  private async get(path: string, authorization: string) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { headers: { authorization: authorization ?? "" } }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
  @Get() list(@Headers("authorization") authorization: string) { return this.get("/api/v1/tickets", authorization); }
  @Get("operations") operations(@Headers("authorization") authorization: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string, @Query("search") search?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) { const query = new URLSearchParams(); if (page) query.set("page", page); if (pageSize) query.set("pageSize", pageSize); if (status) query.set("status", status); if (search) query.set("search", search); if (sortBy) query.set("sortBy", sortBy); if (sortDirection) query.set("sortDirection", sortDirection); return this.get(`/api/v1/tickets/operations${query.size ? `?${query.toString()}` : ""}`, authorization); }
  @Get(":ticketId/route") route(@Headers("authorization") authorization: string, @Param("ticketId") id: string) { return this.get(`/api/v1/tickets/${id}/route`, authorization); }
  @Get(":ticketId") getTicket(@Headers("authorization") authorization: string, @Param("ticketId") id: string) { return this.get(`/api/v1/tickets/${id}`, authorization); }
}
@Controller("api/v1/journeys")
class JourneysProxyController {
  private async get(path: string, authorization: string) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { headers: { authorization: authorization ?? "" } }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
  @Get() list(@Headers("authorization") authorization: string, @Query("ticketId") ticketId?: string, @Query("status") status?: string) { const query = new URLSearchParams(); if (ticketId) query.set("ticketId", ticketId); if (status) query.set("status", status); const suffix = query.size ? `?${query.toString()}` : ""; return this.get(`/api/v1/journeys${suffix}`, authorization); }
  @Get("operations") operations(@Headers("authorization") authorization: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("status") status?: string, @Query("search") search?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) { const query = new URLSearchParams(); if (page) query.set("page", page); if (pageSize) query.set("pageSize", pageSize); if (status) query.set("status", status); if (search) query.set("search", search); if (sortBy) query.set("sortBy", sortBy); if (sortDirection) query.set("sortDirection", sortDirection); return this.get(`/api/v1/journeys/operations${query.size ? `?${query.toString()}` : ""}`, authorization); }
  @Get(":journeyId") journey(@Headers("authorization") authorization: string, @Param("journeyId") id: string) { return this.get(`/api/v1/journeys/${id}`, authorization); }
}
@Controller("api/v1/gate")
class GateProxyController {
  @Get("operations/events") async events(@Headers("authorization") authorization: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("eventType") eventType?: string) { const query = new URLSearchParams(); if (page) query.set("page", page); if (pageSize) query.set("pageSize", pageSize); if (eventType) query.set("eventType", eventType); return this.forward(`/internal/v1/gate/operations/events${query.size ? `?${query.toString()}` : ""}`, authorization); }
  @Get("entry-gates") async gates() { return this.listGates("entry-gates"); }
  @Get("exit-gates") async exitGates() { return this.listGates("exit-gates"); }
  private async listGates(path: string) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}/internal/v1/gate/${path}`); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
  private async forward(path: string, authorization: string) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { headers: { authorization: authorization ?? "" } }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
  @Post("validate-entry") async entry(@Headers("authorization") authorization: string, @Headers("idempotency-key") idempotencyKey: string, @Body() body: unknown) { await this.assertOwner(authorization, body); return this.validate("validate-entry", idempotencyKey, body); }
  @Post("validate-exit") async exit(@Headers("authorization") authorization: string, @Headers("idempotency-key") idempotencyKey: string, @Body() body: unknown) { await this.assertOwner(authorization, body); return this.validate("validate-exit", idempotencyKey, body); }
  private async assertOwner(authorization: string, body: unknown) {
    if (!authorization) throw new HttpException({ code: "UNAUTHORIZED", message: "Please sign in before scanning your ticket." }, 401);
    const id = (body as { ticketIdentifier?: unknown } | null)?.ticketIdentifier;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpException({ code: "VALIDATION_ERROR", message: "A valid ticket identifier is required." }, 400);
    const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}/api/v1/tickets/${id}`, { headers: { authorization }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new HttpException(await response.json(), response.status);
  }
  private async validate(path: string, idempotencyKey: string, body: unknown) { const response = await fetch(`${process.env.GATE_SERVICE_URL ?? "http://localhost:3005"}/api/v1/gate/${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey ?? "", "x-gate-api-key": process.env.GATE_API_KEY_SECRET ?? "" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
}
@Controller("api/v1/admin")
class AdminProxyController {
  private async get(path: string, authorization: string) { const response = await fetch(`${process.env.CORE_API_URL ?? "http://localhost:3002"}${path}`, { headers: { authorization: authorization ?? "" } }); const data = await response.json(); if (!response.ok) throw new HttpException(data, response.status); return data; }
  @Get("outbox") outbox(@Headers("authorization") authorization: string) { return this.get("/api/v1/admin/outbox", authorization); }
  @Get("inconsistencies") inconsistencies(@Headers("authorization") authorization: string) { return this.get("/api/v1/admin/inconsistencies", authorization); }
  @Get("analytics") analytics(@Headers("authorization") authorization: string) { return this.get("/api/v1/admin/analytics", authorization); }
  @Get("audit") audit(@Headers("authorization") authorization: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string, @Query("action") action?: string, @Query("sortBy") sortBy?: string, @Query("sortDirection") sortDirection?: string) { const query = new URLSearchParams(); if (page) query.set("page", page); if (pageSize) query.set("pageSize", pageSize); if (action) query.set("action", action); if (sortBy) query.set("sortBy", sortBy); if (sortDirection) query.set("sortDirection", sortDirection); return this.get(`/api/v1/admin/audit${query.size ? `?${query.toString()}` : ""}`, authorization); }
}
@Module({
  controllers: [
    HealthController,
    AuthProxyController,
    LoginProxyController,
    SessionProxyController,
    MeProxyController,
    ProtectedAuthProxyController,
    StationsProxyController,
    FareQuotesProxyController,
    PurchasesProxyController,
    PaymentsProxyController,
    TicketsProxyController,
    JourneysProxyController,
    GateProxyController,
    AdminProxyController,
  ],
})
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((request: any, response: any, next: () => void) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env.NODE_ENV === "production") {
      response.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
      const origin = request.headers.origin;
      const expected = process.env.WEB_ORIGIN;
      if (
        origin &&
        expected &&
        origin !== expected &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
      ) {
        response.status(403).json({
          code: "CSRF_ORIGIN_REJECTED",
          message: "Request origin is not allowed.",
        });
        return;
      }
    }
    next();
  });
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  });
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}
bootstrap();
