import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import { createUserSchema, paginationQuerySchema, roleSchema, z, type CreateUserInput, type Role } from "@hrms/shared";

const statusSchema = z.object({ status: z.enum(["active", "disabled"]) });

@Controller("users")
@Roles("hr", "md")
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(ZodQuery(paginationQuerySchema)) q: { page?: number; pageSize?: number; search?: string }) {
    return this.users.list(user, q);
  }

  @Post()
  @Roles("md")
  create(@CurrentUser() user: RequestUser, @Body(ZodBody(createUserSchema)) body: CreateUserInput) {
    return this.users.create(user, body);
  }

  @Patch(":id/role")
  @Roles("md")
  setRole(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(z.object({ role: roleSchema }))) body: { role: Role }) {
    return this.users.setRole(user, id, body.role);
  }

  @Patch(":id/status")
  @Roles("md")
  setStatus(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(statusSchema)) body: { status: "active" | "disabled" }) {
    return this.users.setStatus(user, id, body.status);
  }

  @Post(":id/reset-password")
  adminResetPassword(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.users.adminResetPassword(user, id);
  }
}
