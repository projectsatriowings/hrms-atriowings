import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { AttendanceService } from "./attendance.service";
import { CurrentUser, Public, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import { attendancePolicySchema, biometricPunchSchema, checkInSchema, correctAttendanceSchema, paginationQuerySchema, wfhDaySchema, wfhDecideSchema, wfhRequestSchema, z } from "@hrms/shared";

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const monthlyQuery = z.object({ year: z.coerce.number().int(), month: z.coerce.number().int().min(1).max(12), departmentId: z.string().optional() });
const exportQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), departmentId: z.string().optional() });
const historyQuery = paginationQuerySchema.extend({ from: z.string().optional(), to: z.string().optional() });

@Controller("attendance")
export class AttendanceController {
  constructor(private attendance: AttendanceService) {}

  // ── Employee self-service ──
  @Get("me/today")
  today(@CurrentUser() user: RequestUser) {
    return this.attendance.today(user);
  }

  @Post("check-in")
  checkIn(@CurrentUser() user: RequestUser, @Body(ZodBody(checkInSchema)) body: z.infer<typeof checkInSchema> | undefined) {
    return this.attendance.checkIn(user, body ?? {});
  }

  @Post("check-out")
  @HttpCode(200)
  checkOut(@CurrentUser() user: RequestUser) {
    return this.attendance.checkOut(user);
  }

  // ── Biometric device punch (no JWT; authenticated by device API key) ──
  @Public()
  @Post("biometric-punch")
  @HttpCode(200)
  biometricPunch(
    @Headers("x-device-key") deviceKey: string | undefined,
    @Body(ZodBody(biometricPunchSchema)) body: z.infer<typeof biometricPunchSchema>,
  ) {
    return this.attendance.biometricPunch(deviceKey ?? "", body);
  }

  @Get("me")
  myHistory(@CurrentUser() user: RequestUser, @Query(ZodQuery(historyQuery)) q: z.infer<typeof historyQuery>) {
    return this.attendance.myHistory(user, q);
  }

  // ── Work from home (employee self-service) ──
  @Post("wfh-requests")
  @HttpCode(201)
  requestWfh(@CurrentUser() user: RequestUser, @Body(ZodBody(wfhRequestSchema)) body: z.infer<typeof wfhRequestSchema>) {
    return this.attendance.requestWfh(user, body);
  }

  @Get("wfh-requests/me")
  myWfhRequests(@CurrentUser() user: RequestUser) {
    return this.attendance.myWfhRequests(user);
  }

  // ── HR views ──
  @Get("daily")
  @Roles("hr", "md")
  daily(@CurrentUser() user: RequestUser, @Query(ZodQuery(dateQuery.extend({ departmentId: z.string().optional() }))) q: { date: string; departmentId?: string }) {
    return this.attendance.daily(user, q.date, q.departmentId);
  }

  @Get("monthly")
  @Roles("hr", "md")
  monthly(@CurrentUser() user: RequestUser, @Query(ZodQuery(monthlyQuery)) q: z.infer<typeof monthlyQuery>) {
    return this.attendance.monthly(user, q.year, q.month, q.departmentId);
  }

  @Get("export")
  @Roles("hr", "md")
  async export(@CurrentUser() user: RequestUser, @Query(ZodQuery(exportQuery)) q: z.infer<typeof exportQuery>, @Res() res: Response) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=attendance-${q.from}-${q.to}.csv`);
    res.send(await this.attendance.exportCsv(user, q.from, q.to, q.departmentId));
  }

  @Post("records/:id/correct")
  @Roles("hr", "md")
  correct(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(correctAttendanceSchema)) body: Parameters<AttendanceService["correct"]>[2]) {
    return this.attendance.correct(user, id, body);
  }

  @Get("records/:id/corrections")
  @Roles("hr", "md")
  corrections(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.attendance.correctionHistory(user, id);
  }

  // ── Work from home (manager / HR decisions, admin WFH days) ──
  @Get("wfh-requests/team")
  @Roles("hr", "md")
  teamWfhRequests(@CurrentUser() user: RequestUser, @Query(ZodQuery(paginationQuerySchema.extend({ status: z.string().optional() }))) q: { status?: string }) {
    return this.attendance.teamWfhRequests(user, q.status);
  }

  @Post("wfh-requests/:id/approve")
  @Roles("hr", "md")
  @HttpCode(200)
  approveWfh(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(ZodBody(wfhDecideSchema.optional())) body: z.infer<typeof wfhDecideSchema> | undefined,
  ) {
    return this.attendance.decideWfh(user, id, "approved", body?.note);
  }

  @Post("wfh-requests/:id/reject")
  @Roles("hr", "md")
  @HttpCode(200)
  rejectWfh(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(ZodBody(wfhDecideSchema.optional())) body: z.infer<typeof wfhDecideSchema> | undefined,
  ) {
    return this.attendance.decideWfh(user, id, "rejected", body?.note);
  }

  @Get("wfh-days")
  @Roles("hr", "md")
  listWfhDays(@CurrentUser() user: RequestUser) {
    return this.attendance.listWfhDays(user);
  }

  @Post("wfh-days")
  @Roles("hr", "md")
  @HttpCode(201)
  addWfhDay(@CurrentUser() user: RequestUser, @Body(ZodBody(wfhDaySchema)) body: z.infer<typeof wfhDaySchema>) {
    return this.attendance.addWfhDay(user, body);
  }

  @Delete("wfh-days/:id")
  @Roles("hr", "md")
  removeWfhDay(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.attendance.removeWfhDay(user, id);
  }

  // ── Policies ──
  @Get("policies")
  @Roles("hr", "md")
  policies(@CurrentUser() user: RequestUser) {
    return this.attendance.listPolicies(user);
  }

  @Post("policies")
  @Roles("hr", "md")
  createPolicy(@CurrentUser() user: RequestUser, @Body(ZodBody(attendancePolicySchema)) body: Parameters<AttendanceService["createPolicy"]>[1]) {
    return this.attendance.createPolicy(user, body);
  }

  @Patch("policies/:id")
  @Roles("hr", "md")
  updatePolicy(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(ZodBody(attendancePolicySchema.partial())) body: Parameters<AttendanceService["updatePolicy"]>[2],
  ) {
    return this.attendance.updatePolicy(user, id, body);
  }
}
