import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { RegisterDto } from "./register.dto";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./auth.decorators";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { AuthUser } from "./auth.types";
import { Roles } from "./auth.decorators";
import { RolesGuard } from "./roles.guard";
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("otp/request") async requestOtp(@Body("email") email: string) {
    return this.auth.requestLoginOtp(email);
  }
  @Post("otp/verify") async verifyOtp(
    @Body() body: { email: string; code: string },
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.auth.verifyLoginOtp(body.email, body.code);
    res.header("set-cookie", result.cookie);
    return { accessToken: result.accessToken, user: result.user };
  }
  @Post("email/resend") resendVerification(@Body("email") email: string) {
    return this.auth.resendVerification(email);
  }
  @Post("email/verify") verifyEmail(
    @Body() body: { email: string; code: string },
  ) {
    return this.auth.verifyEmail(body.email, body.code);
  }
  @Post("password-reset/request") requestReset(@Body("email") email: string) {
    return this.auth.requestPasswordReset(email);
  }
  @Post("password-reset/confirm") confirmReset(
    @Body() body: { token: string; password: string },
  ) {
    return this.auth.resetPassword(body.token, body.password);
  }
  @Post("register") @HttpCode(201) register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @Post("login") async login(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.auth.login(dto);
    res.header("set-cookie", result.cookie);
    return { accessToken: result.accessToken, user: result.user };
  }
  @Post("refresh") async refresh(
    @Headers("cookie") cookies: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = cookies?.match(/(?:^|;\s*)refresh_token=([^;]+)/)?.[1];
    if (!token)
      throw new UnauthorizedException({
        code: "REFRESH_TOKEN_INVALID",
        message: "Refresh token is invalid.",
      });
    const result = await this.auth.refresh(token);
    res.header("set-cookie", result.cookie);
    return { accessToken: result.accessToken };
  }
  @UseGuards(JwtAuthGuard) @Post("password/change") changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.auth.changePassword(
      user.sub,
      body.currentPassword,
      body.newPassword,
    );
  }
  @UseGuards(JwtAuthGuard) @Get("me") me(@CurrentUser() user: AuthUser) {
    return { user };
  }
  @UseGuards(JwtAuthGuard) @Get("sessions") sessions(
    @CurrentUser() user: AuthUser,
  ) {
    return { sessions: this.auth.listUserSessions(user.sub) };
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN", "OPERATOR")
  @Get("operations")
  operations() {
    return { status: "ok", scope: "operations" };
  }
  @UseGuards(JwtAuthGuard) @Post("logout") @HttpCode(200) async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.auth.logout(user.sessionId);
    res.header(
      "set-cookie",
      "refresh_token=; Max-Age=0; Path=/api/v1/auth/refresh; HttpOnly; SameSite=Strict",
    );
    return { success: true };
  }
}
