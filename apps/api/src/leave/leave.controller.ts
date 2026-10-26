import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { LeaveService } from "./leave.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import {
  applyLeaveSchema, decideLeaveSchema, leaveAdjustmentSchema, leaveTypeSchema,
  paginationQuerySchema, z,
  type ApplyLeaveInput, type DecideLeaveInput, type LeaveAdjustmentInput, type LeaveTypeInput,
} from "@hrms/shared";

const yearQuery = z.object({ year: z.coerce.number().int().default(new Date().getFullYear()) });
const calendarQuery = z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12), departmentId: z.string().optional() });

@Controller("leave")
export class LeaveController {
  constructor(private leave: LeaveService) {}

  @Get("types")
  types(@CurrentUser() user: RequestUser) {
    return this.leave.listTypes(user);
  }

  @Post("types")
  @Roles("hr", "md")
  createType(@CurrentUser() user: RequestUser, @Body(ZodBody(leaveTypeSchema)) body: LeaveTypeInput) {
    return this.leave.createType(user, body);
  }

  @Patch("types/:id")
  @Roles("hr", "md")
  updateType(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(leaveTypeSchema.partial())) body: Partial<LeaveTypeInput>) {
    return this.leave.updateType(user, id, body);
  }

  @Get("balances/me")
  myBalances(@CurrentUser() user: RequestUser, @Query(ZodQuery(yearQuery)) q: { year: number }) {
    return this.leave.myBalances(user, q.year);
  }

  @Get("balances/:employeeId")
  @Roles("hr", "md")
  employeeBalances(@CurrentUser() user: RequestUser, @Param("employeeId") employeeId: string, @Query(ZodQuery(yearQuery)) q: { year: number }) {
    return this.leave.balancesFor(user, employeeId, q.year);
  }

  @Post("balances/:employeeId/adjust")
  @Roles("hr", "md")
  adjust(@CurrentUser() user: RequestUser, @Param("employeeId") employeeId: string, @Body(ZodBody(leaveAdjustmentSchema)) body: LeaveAdjustmentInput) {
    return this.leave.adjustBalance(user, employeeId, body);
  }

  @Post("requests")
  apply(@CurrentUser() user: RequestUser, @Body(ZodBody(applyLeaveSchema)) body: ApplyLeaveInput) {
    return this.leave.apply(user, body);
  }

  @Get("requests/me")
  myRequests(
    @CurrentUser() user: RequestUser,
    @Query(ZodQuery(paginationQuerySchema.extend({ status: z.string().optional() }))) q: { page?: number; pageSize?: number; status?: string },
  ) {
    return this.leave.myRequests(user, q.status, q.page, q.pageSize);
  }

  @Get("requests/pending")
  @Roles("hr", "md")
  pending(@CurrentUser() user: RequestUser, @Query(ZodQuery(paginationQuerySchema)) q: { page?: number; pageSize?: number }) {
    return this.leave.pendingInbox(user, q.page, q.pageSize);
  }

  @Post("requests/:id/decide")
  @Roles("hr", "md")
  decide(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(decideLeaveSchema)) body: DecideLeaveInput) {
    return this.leave.decide(user, id, body);
  }

  @Post("requests/:id/cancel")
  cancel(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.leave.cancel(user, id);
  }

  @Get("calendar")
  calendar(@CurrentUser() user: RequestUser, @Query(ZodQuery(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    return this.leave.calendar(user, q.year, q.month, q.departmentId);
  }
}
