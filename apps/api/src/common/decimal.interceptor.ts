import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

/** Recursively converts Prisma Decimal instances to JSON numbers. */
function convert(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof StreamableFile) return value;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = convert(v);
    return out;
  }
  return value;
}

@Injectable()
export class DecimalInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => convert(data)));
  }
}
