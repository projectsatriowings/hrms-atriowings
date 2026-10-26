import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@hrms/shared";

export interface RequestUser {
  userId: string;
  companyId: string;
  role: Role;
  email: string;
  employeeId: string | null;
}

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);
