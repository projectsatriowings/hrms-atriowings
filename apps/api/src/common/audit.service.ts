import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Append-only audit log for high-impact actions. */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(input: {
    companyId: string;
    actorId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
  }) {
    await this.prisma.auditLog.create({
      data: {
        companyId: input.companyId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (input.before as object),
        after: input.after === undefined ? undefined : (input.after as object),
        ip: input.ip,
      },
    });
  }
}
