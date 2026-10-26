import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { EmployeesService } from "./employees.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import {
  createEmployeeSchema, paginationQuerySchema, salaryStructureSchema, updateEmployeeSchema,
  z, type CreateEmployeeInput, type SalaryStructureInput, type UpdateEmployeeInput,
} from "@hrms/shared";

const listQuery = paginationQuerySchema.extend({
  departmentId: z.string().optional(),
  status: z.string().optional(),
});

@Controller("employees")
export class EmployeesController {
  constructor(private employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query(ZodQuery(listQuery)) q: z.infer<typeof listQuery>) {
    return this.employees.list(user, q);
  }

  @Get("import/template")
  @Roles("hr", "md")
  template(@Res() res: Response) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=employee-import-template.csv");
    res.send(this.employees.importTemplate());
  }

  @Post()
  @Roles("hr", "md")
  create(@CurrentUser() user: RequestUser, @Body(ZodBody(createEmployeeSchema)) body: CreateEmployeeInput) {
    return this.employees.create(user, body);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.employees.get(user, id);
  }

  @Patch(":id")
  @Roles("hr", "md")
  update(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(updateEmployeeSchema)) body: UpdateEmployeeInput) {
    return this.employees.update(user, id, body);
  }

  @Post(":id/deactivate")
  @Roles("hr", "md")
  deactivate(
    @CurrentUser() user: RequestUser, @Param("id") id: string,
    @Body(ZodBody(z.object({ dateOfExit: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), reason: z.string().optional() })))
    body: { dateOfExit?: string; reason?: string },
  ) {
    return this.employees.deactivate(user, id, body.dateOfExit, body.reason);
  }

  @Post(":id/reactivate")
  @Roles("hr", "md")
  reactivate(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.employees.reactivate(user, id);
  }

  @Post(":id/create-login")
  @Roles("hr", "md")
  createLogin(
    @CurrentUser() user: RequestUser, @Param("id") id: string,
    @Body(ZodBody(z.object({ role: z.enum(["employee", "hr"]).default("employee") })))
    body: { role: "employee" | "hr" },
  ) {
    return this.employees.createLogin(user, id, body.role);
  }

  @Post("import/preview")
  @Roles("hr", "md")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  preview(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    @Body() body: { mapping?: string },
  ) {
    const mapping = body.mapping ? (JSON.parse(body.mapping) as Record<string, string>) : undefined;
    return this.employees.importPreview(user, file.buffer, mapping);
  }

  @Post("import/commit")
  @Roles("hr", "md")
  commit(
    @CurrentUser() user: RequestUser,
    @Body(ZodBody(z.object({ rows: z.array(z.record(z.string())) }))) body: { rows: Record<string, string>[] },
  ) {
    return this.employees.importCommit(user, body.rows);
  }

  @Get(":id/salary-structures")
  salaryStructures(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.employees.listSalaryStructures(user, id);
  }

  @Post(":id/salary-structures")
  @Roles("hr", "md")
  createSalaryStructure(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body(ZodBody(salaryStructureSchema)) body: SalaryStructureInput) {
    return this.employees.createSalaryStructure(user, id, body);
  }
}
