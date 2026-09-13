import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token)
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    try {
      request.user = this.auth.verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedException({
        code: "TOKEN_INVALID",
        message: "Token is invalid or expired.",
      });
    }
  }
}
