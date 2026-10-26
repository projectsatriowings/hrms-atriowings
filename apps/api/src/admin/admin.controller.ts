import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import {
  departmentSchema, designationSchema, holidaySchema, paginationQuerySchema, z,
  type DepartmentInput, type DesignationInput, type HolidayInput,
} from "@hrms/shared";

const legalSchema = z.object({
  legalName: z.string().min(1).optional(),
  pan: z.string().optional(),
  gstin: z.string().optional(),
  cin: z.string().optional(),
  registeredOffice: z.string().optional(),
  headOffice: z.string().optional(),
});

const settingsSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  logoUrl: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
  legal: legalSchema.optional(),
});

@Controller("admin")
@Roles("hr", "md")
export class AdminController {
  constructor(private admin: AdminService) {}

  // Departments
  @Get("departments")
  departments(@CurrentUser() user: RequestUser) { return this.admin.listDepartments(user); }

  @Post("departments")
  createDepartment(@CurrentUser() user: RequestUser, @Body(ZodBody(departmentSchema)) body: DepartmentInput) {
    return this.admin.createDepartment(user, body);
  }

  @Patch("departments/:id")
  updateDepartment(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(departmentSchema)) body: DepartmentInput) {
    return this.admin.updateDepartment(user, id, body);
  }

  @Delete("departments/:id")
  deleteDepartment(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.admin.deleteDepartment(user, id);
  }

  // Designations
  @Get("designations")
  designations(@CurrentUser() user: RequestUser) { return this.admin.listDesignations(user); }

  @Post("designations")
  createDesignation(@CurrentUser() user: RequestUser, @Body(ZodBody(designationSchema)) body: DesignationInput) {
    return this.admin.createDesignation(user, body);
  }

  @Patch("designations/:id")
  updateDesignation(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(designationSchema)) body: DesignationInput) {
    return this.admin.updateDesignation(user, id, body);
  }

  @Delete("designations/:id")
  deleteDesignation(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.admin.deleteDesignation(user, id);
  }

  // Holidays
  @Get("holidays")
  holidays(@CurrentUser() user: RequestUser, @Query(ZodQuery(z.object({ year: z.coerce.number().int().optional() }))) q: { year?: number }) {
    return this.admin.listHolidays(user, q.year);
  }

  @Post("holidays")
  createHoliday(@CurrentUser() user: RequestUser, @Body(ZodBody(holidaySchema)) body: HolidayInput) {
    return this.admin.createHoliday(user, body);
  }

  @Delete("holidays/:id")
  deleteHoliday(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.admin.deleteHoliday(user, id);
  }

  // Company settings
  @Get("company/settings")
  @Roles("md")
  settings(@CurrentUser() user: RequestUser) { return this.admin.getSettings(user); }

  @Patch("company/settings")
  @Roles("md")
  updateSettings(@CurrentUser() user: RequestUser, @Body(ZodBody(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.admin.updateSettings(user, body);
  }

  // Audit log
  @Get("audit-logs")
  auditLogs(
    @CurrentUser() user: RequestUser,
    @Query(ZodQuery(paginationQuerySchema.extend({ entityType: z.string().optional(), action: z.string().optional() })))
    q: { page?: number; pageSize?: number; entityType?: string; action?: string },
  ) {
    return this.admin.auditLogs(user, q);
  }
}
