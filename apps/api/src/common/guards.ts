import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@hrms/shared";
import { IS_PUBLIC_KEY, ROLES_KEY, RequestUser } from "./decorators";
import { PrismaService } from "../prisma/prisma.service";

const unauthorized = () => new UnauthorizedException({ code: "unauthenticated", message: "Authentication required" });

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw unauthorized();
    try {
      const payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
      // Confirm the user still exists and is active (revocation on disable)
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== "active") throw unauthorized();
      // Forced password change: a user on a temporary password may only use
      // auth endpoints (change-password, logout, me, MFA) until they set a
      // real password. All business routes answer 403 meanwhile.
      const url: string = req.originalUrl ?? req.url ?? "";
      if (user.mustChangePassword && !url.includes("/auth/")) {
        throw new ForbiddenException({ code: "password_change_required", message: "You must change your temporary password before using the app" });
      }
      const reqUser: RequestUser = {
        userId: user.id,
        companyId: user.companyId,
        role: user.role as Role,
        email: user.email,
        employeeId: user.employeeId,
      };
      req.user = reqUser;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException || e instanceof ForbiddenException) throw e;
      throw unauthorized();
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException({ code: "forbidden", message: "You do not have permission for this action" });
    }
    return true;
  }
}
