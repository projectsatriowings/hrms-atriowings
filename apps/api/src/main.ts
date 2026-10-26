import { NestFactory, Reflector } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filter";
import { DecimalInterceptor } from "./common/decimal.interceptor";
import { JwtAuthGuard, RolesGuard } from "./common/guards";
import { PrismaService } from "./prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api/v1");
  // Trust the first reverse proxy so express-rate-limit keys on the real
  // client IP (X-Forwarded-For) instead of lumping all proxied users into
  // one shared limit bucket.
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").split(","),
    credentials: true,
  });
  // Rate-limit auth endpoints (brute-force protection)
  app.use(
    "/api/v1/auth/login",
    rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }),
  );
  // Rate-limit biometric punch endpoint (per device key abuse protection)
  app.use(
    "/api/v1/attendance/biometric-punch",
    rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }),
  );
  // Rate-limit refresh: refresh tokens are long-lived, so hammering this
  // endpoint must not be free (kept generous: legitimate clients refresh
  // at most every 15 minutes per access-token lifetime).
  app.use(
    "/api/v1/auth/refresh",
    rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }),
  );

  const reflector = app.get(Reflector);
  const jwt = app.get(JwtService);
  const prisma = app.get(PrismaService);
  app.useGlobalGuards(new JwtAuthGuard(jwt, prisma, reflector), new RolesGuard(reflector));
  app.useGlobalInterceptors(new DecimalInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`HRMS API listening on :${port}`);
}
bootstrap();
