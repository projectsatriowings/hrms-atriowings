import { z } from "zod";
import { ZodValidationPipe } from "./zod.pipe";

describe("ZodValidationPipe missing-body handling", () => {
  const allOptional = new ZodValidationPipe(z.object({ latitude: z.number().optional() }));
  const withRequired = new ZodValidationPipe(z.object({ name: z.string() }));
  const nonObject = new ZodValidationPipe(z.string());

  it("treats a missing body as {} for all-optional object schemas", () => {
    expect(allOptional.transform(undefined, {} as never)).toEqual({});
  });

  it("still rejects a missing body when the schema has required fields", () => {
    expect(() => withRequired.transform(undefined, {} as never)).toThrow();
  });

  it("still rejects a missing body for non-object schemas", () => {
    expect(() => nonObject.transform(undefined, {} as never)).toThrow();
  });

  it("passes through real bodies unchanged", () => {
    expect(allOptional.transform({ latitude: 12.5 }, {} as never)).toEqual({ latitude: 12.5 });
  });
});
