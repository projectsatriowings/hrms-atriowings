import { ArgumentMetadata, Injectable, PipeTransform, UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";

/** Validates body/query/params against a shared Zod schema. Returns parsed data. */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: z.ZodTypeAny) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    // A POST with no body at all arrives as undefined. Treat it as an empty
    // object: object schemas with required fields still fail on the missing
    // fields, and non-object schemas still fail — only all-optional bodies
    // (e.g. check-in, whose controller declares the body optional) pass.
    const input = value === undefined ? {} : value;
    const result = this.schema.safeParse(input);
    if (!result.success) {
      throw new UnprocessableEntityException({
        code: "validation_error",
        message: "Validation failed",
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}

export const ZodBody = (schema: z.ZodTypeAny) => new ZodValidationPipe(schema);
export const ZodQuery = (schema: z.ZodTypeAny) => new ZodValidationPipe(schema);
