import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { BiometricService } from "./biometric.service";
import { CurrentUser, RequestUser, Roles } from "../common/decorators";
import { ZodBody, ZodQuery } from "../common/zod.pipe";
import { biometricDeviceSchema, biometricMappingSchema, paginationQuerySchema, z } from "@hrms/shared";

const deviceUpdateSchema = biometricDeviceSchema.partial();

@Controller("admin/biometric")
export class BiometricController {
  constructor(private biometric: BiometricService) {}

  @Get("devices")
  @Roles("hr", "md")
  listDevices(@CurrentUser() user: RequestUser, @Query(ZodQuery(paginationQuerySchema)) q: z.infer<typeof paginationQuerySchema>) {
    return this.biometric.listDevices(user, q);
  }

  @Post("devices")
  @Roles("hr", "md")
  @HttpCode(201)
  createDevice(@CurrentUser() user: RequestUser, @Body(ZodBody(biometricDeviceSchema)) body: z.infer<typeof biometricDeviceSchema>) {
    return this.biometric.createDevice(user, body);
  }

  @Patch("devices/:id")
  @Roles("hr", "md")
  updateDevice(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(ZodBody(deviceUpdateSchema)) body: z.infer<typeof deviceUpdateSchema>,
  ) {
    return this.biometric.updateDevice(user, id, body);
  }

  @Delete("devices/:id")
  @Roles("hr", "md")
  deleteDevice(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.biometric.deleteDevice(user, id);
  }

  @Get("devices/:id/mappings")
  @Roles("hr", "md")
  listMappings(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.biometric.listMappings(user, id);
  }

  @Post("devices/:id/mappings")
  @Roles("hr", "md")
  @HttpCode(201)
  createMapping(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body(ZodBody(biometricMappingSchema)) body: z.infer<typeof biometricMappingSchema>,
  ) {
    return this.biometric.createMapping(user, id, body);
  }

  @Delete("devices/:id/mappings/:mappingId")
  @Roles("hr", "md")
  deleteMapping(@CurrentUser() user: RequestUser, @Param("id") id: string, @Param("mappingId") mappingId: string) {
    return this.biometric.deleteMapping(user, id, mappingId);
  }
}
