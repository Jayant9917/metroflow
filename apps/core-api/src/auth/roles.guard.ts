import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<string[]>("roles", [context.getHandler(), context.getClass()]) ?? [];
    if (!roles.length) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You do not have permission to access this resource.",
      });
    return true;
  }
}
