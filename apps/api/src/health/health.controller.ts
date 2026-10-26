import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Public } from "../common/decorators";

/** Public health endpoint (no auth). URL is /api/v1/health because the
 *  global prefix in main.ts applies to every controller. It pings Prisma
 *  for real: db is "down" (and the endpoint still returns 200 with
 *  status "ok") when the ping throws, so load balancers can read db health
 *  from the body without the endpoint itself going down. */
@Controller("health")
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "up" as const };
    } catch {
      return { status: "ok", db: "down" as const };
    }
  }
}
