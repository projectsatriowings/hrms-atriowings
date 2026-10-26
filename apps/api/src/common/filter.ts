import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

/** Uniform error shape: { error: { code, message, details? } }. Never leaks internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let message = "Something went wrong. Please try again.";
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as Record<string, unknown> | string;
      if (typeof body === "object" && body !== null && "code" in body) {
        code = String((body as Record<string, unknown>).code);
        message = String((body as Record<string, unknown>).message ?? message);
        details = (body as Record<string, unknown>).details;
      } else {
        message = exception.message;
        code = status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not_found" : "request_error";
      }
      if (status >= 500) {
        console.error("[api-error]", exception);
      }
    } else {
      console.error("[api-error] non-http", exception);
    }

    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
  }
}
