import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { Public, CurrentUser, RequestUser } from "../common/decorators";
import { ZodBody } from "../common/zod.pipe";
import {
  changePasswordSchema, forgotPasswordSchema, loginWithCompanySchema,
  mfaDisableSchema, mfaSetupVerifySchema, mfaVerifySchema, resetPasswordSchema,
  type ChangePasswordInput, type ForgotPasswordInput, type LoginWithCompanyInput,
  type MfaDisableInput, type MfaSetupVerifyInput, type MfaVerifyInput, type ResetPasswordInput,
} from "@hrms/shared";

const COOKIE_NAME = "refresh_token";
const isProd = process.env.NODE_ENV === "production";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: Number(process.env.JWT_REFRESH_TTL ?? 30 * 24 * 3600) * 1000,
  });
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body(ZodBody(loginWithCompanySchema)) body: LoginWithCompanyInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password, body.companyCode, req.ip);
    if ("mfaRequired" in result) return result;
    setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user, mustChangePassword: result.mustChangePassword };
  }

  @Public()
  @Post("mfa/verify")
  @HttpCode(200)
  async mfaVerify(@Body(ZodBody(mfaVerifySchema)) body: MfaVerifyInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyMfa(body.mfaToken, body.code, req.ip);
    setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user, mustChangePassword: result.mustChangePassword };
  }

  @Post("mfa/setup")
  async mfaSetup(@CurrentUser() user: RequestUser) {
    return this.auth.mfaSetup(user.userId);
  }

  @Post("mfa/verify-setup")
  async mfaVerifySetup(@CurrentUser() user: RequestUser, @Body(ZodBody(mfaSetupVerifySchema)) body: MfaSetupVerifyInput) {
    return this.auth.mfaVerifySetup(user.userId, body.secret, body.code);
  }

  @Post("mfa/disable")
  async mfaDisable(@CurrentUser() user: RequestUser, @Body(ZodBody(mfaDisableSchema)) body: MfaDisableInput) {
    return this.auth.mfaDisable(user.userId, body.password, body.code);
  }

  @Post("change-password")
  async changePassword(@CurrentUser() user: RequestUser, @Req() req: Request, @Body(ZodBody(changePasswordSchema)) body: ChangePasswordInput) {
    return this.auth.changePassword(user.userId, body.currentPassword, body.newPassword, req.cookies?.[COOKIE_NAME]);
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  async forgotPassword(@Body(ZodBody(forgotPasswordSchema)) body: ForgotPasswordInput, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.forgotPassword(body.email);
    if (!result.emailConfigured) {
      res.status(503);
      return { error: { code: "email_not_configured", message: "Password reset email is not configured — ask HR to reset your password" } };
    }
    // Enumeration-safe: same shape whether or not the account exists.
    return { ok: true, message: "If an account exists for this email, a reset link has been sent" };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(@Body(ZodBody(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.auth.resetPassword(body.token, body.newPassword);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token: string | undefined = req.cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: { code: "invalid_session", message: "Session expired. Please log in again." } });
      return;
    }
    const result = await this.auth.refresh(token, req.ip);
    setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentUser() user: RequestUser) {
    await this.auth.logout(req.cookies?.[COOKIE_NAME], user.userId);
    res.clearCookie(COOKIE_NAME, { path: "/api/v1/auth" });
    return { ok: true };
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.userId);
  }
}
