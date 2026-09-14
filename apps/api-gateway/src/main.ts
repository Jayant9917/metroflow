import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Module,
  Post,
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
@Module({
  controllers: [
    HealthController,
    AuthProxyController,
    LoginProxyController,
    SessionProxyController,
    MeProxyController,
    ProtectedAuthProxyController,
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
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}
bootstrap();
