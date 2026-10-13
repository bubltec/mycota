import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { UsersService } from './users.service.js';
import { EmailCodeService } from './email-code.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';
import type { AuthenticatedUser, OAuthProfile } from './auth.types.js';
import { RequestEmailSignInDto } from './dto/request-email-sign-in.dto.js';
import { ConfirmEmailSignInDto } from './dto/confirm-email-sign-in.dto.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { ConfirmOtpDto } from './dto/confirm-otp.dto.js';
import { RequestAnonEmailDto, ConfirmAnonEmailDto } from './dto/anon-email.dto.js';
import { OtpService } from './otp.service.js';
import { PROVIDER_KEY, ProviderEnabledGuard } from './provider-enabled.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly users: UsersService,
    private readonly emailCode: EmailCodeService,
    private readonly otp: OtpService,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  @Get('github')
  @UseGuards(AuthGuard('github'))
  githubLogin(): void {}

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubCallback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    await this.completeOAuthLogin(req, res);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin(): void {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    await this.completeOAuthLogin(req, res);
  }

  @Get('apple')
  @SetMetadata(PROVIDER_KEY, 'apple')
  @UseGuards(ProviderEnabledGuard, AuthGuard('apple'))
  appleLogin(): void {}

  /** Apple posts the result back cross-site (`form_post`); the app must register `@fastify/formbody`. */
  @Post('apple/callback')
  @SetMetadata(PROVIDER_KEY, 'apple')
  @UseGuards(ProviderEnabledGuard, AuthGuard('apple'))
  async appleCallback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    await this.completeOAuthLogin(req, res);
  }

  @Get('facebook')
  @SetMetadata(PROVIDER_KEY, 'facebook')
  @UseGuards(ProviderEnabledGuard, AuthGuard('facebook'))
  facebookLogin(): void {}

  @Get('facebook/callback')
  @SetMetadata(PROVIDER_KEY, 'facebook')
  @UseGuards(ProviderEnabledGuard, AuthGuard('facebook'))
  async facebookCallback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    await this.completeOAuthLogin(req, res);
  }

  @Get('microsoft')
  @SetMetadata(PROVIDER_KEY, 'microsoft')
  @UseGuards(ProviderEnabledGuard, AuthGuard('microsoft'))
  microsoftLogin(): void {}

  @Get('microsoft/callback')
  @SetMetadata(PROVIDER_KEY, 'microsoft')
  @UseGuards(ProviderEnabledGuard, AuthGuard('microsoft'))
  async microsoftCallback(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    await this.completeOAuthLogin(req, res);
  }

  /** Which sign-in methods this deployment offers, so the UI renders only working buttons. */
  @Get('providers')
  providers() {
    return {
      github: !!this.config.github,
      google: !!this.config.google,
      apple: !!this.config.apple,
      facebook: !!this.config.facebook,
      microsoft: !!this.config.microsoft,
      email: true,
      phone: this.otp.phoneEnabled,
      anonymousEmail: this.otp.anonymousEmailEnabled,
    };
  }

  /**
   * Passwordless sign-in/sign-up by one-time code over email or SMS. Works
   * for any address (no organizational-email screening), and is the same
   * flow for new and returning users.
   */
  @Post('otp/request')
  async requestOtp(@Body() dto: RequestOtpDto) {
    await this.otp.request(dto.channel, dto.identifier);
    return { sent: true };
  }

  @Post('otp/confirm')
  async confirmOtp(@Body() dto: ConfirmOtpDto, @Res() res: FastifyReply) {
    const identity = await this.otp.confirm(dto.channel, dto.identifier, dto.code);
    if (!identity) throw new UnauthorizedException('Invalid or expired code');
    const user = await this.users.findOrCreateByIdentifier(identity.channel, identity.identifier);
    this.setSessionCookie(res, this.authService.issueSessionToken(user));
    res.send({ confirmed: true });
  }

  /**
   * Anonymous sign-in/sign-up: the address is used to send the code and is
   * never stored (only an HMAC of it is). Email travels in the body, never the
   * URL, so it stays out of access logs.
   */
  @Post('anon-email/request')
  async requestAnonymousEmail(@Body() dto: RequestAnonEmailDto) {
    await this.otp.requestAnonymousEmail(dto.email);
    return { sent: true };
  }

  @Post('anon-email/confirm')
  async confirmAnonymousEmail(@Body() dto: ConfirmAnonEmailDto, @Res() res: FastifyReply) {
    const identity = await this.otp.confirmAnonymousEmail(dto.email, dto.code);
    if (!identity) throw new UnauthorizedException('Invalid or expired code');
    const user = await this.users.findOrCreateByIdentifier('anon_email', identity.accountId);
    this.setSessionCookie(res, this.authService.issueSessionToken(user));
    res.send({ confirmed: true });
  }

  /** E2E only; same stage gating as `otp/test-code`. */
  @Post('anon-email/test-code')
  async getAnonymousEmailTestCode(@Body() dto: RequestAnonEmailDto) {
    const code = await this.otp.getAnonymousTestCode(dto.email);
    if (!code) throw new NotFoundException();
    return { code };
  }

  /** E2E only. 404s unless the configured stage is explicitly `local` or `test`. */
  @Get('otp/test-code')
  async getOtpTestCode(@Query('channel') channel?: string, @Query('identifier') identifier?: string) {
    if ((channel !== 'email' && channel !== 'phone') || !identifier) throw new BadRequestException('channel and identifier required');
    const code = await this.otp.getTestCode(channel, identifier);
    if (!code) throw new NotFoundException();
    return { code };
  }

  /**
   * Standalone sign-in with just an organizational email — no GitHub/Google
   * account required. Same domain/MX validation and Bedrock classification
   * as adding org verification to an existing session
   * (`ProfessionalVerificationController`), but this creates the identity
   * and the session in one flow rather than requiring one to already exist.
   */
  @Post('email/request')
  async requestEmailSignIn(@Body() dto: RequestEmailSignInDto) {
    const user = await this.users.findOrCreateByEmail(dto.email);
    return this.emailCode.request(
      { provider: user.provider, providerAccountId: user.providerAccountId },
      dto.email,
    );
  }

  @Post('email/confirm')
  async confirmEmailSignIn(@Body() dto: ConfirmEmailSignInDto, @Res() res: FastifyReply) {
    const providerAccountId = dto.email.toLowerCase();
    const user = await this.users.getByProviderAccount('email', providerAccountId);
    if (!user) throw new BadRequestException('Request a code first');

    const confirmed = await this.emailCode.confirm(
      { provider: 'email', providerAccountId },
      dto.code,
    );
    if (!confirmed) throw new UnauthorizedException('Invalid or expired code');

    this.setSessionCookie(res, this.authService.issueSessionToken(user));
    res.send({ confirmed: true });
  }

  /**
   * E2E-testing only: lets automated tests complete real sign-in without
   * reading an inbox. Refuses outright in prod (mirrors UsersService.getTestCode
   * — belt and suspenders, since the plaintext code is never even written to
   * the prod table in the first place). See docs/e2e-testing.md.
   */
  @Get('email/test-code')
  async getEmailTestCode(@Query('email') email?: string) {
    if (this.config.stage === 'prod') throw new NotFoundException();
    if (!email) throw new BadRequestException('email query param required');

    const code = await this.users.getTestCode('email', email.toLowerCase());
    if (!code) throw new NotFoundException('No pending code for that email');
    return { code };
  }

  /**
   * E2E-testing only: the pop quiz (QuizDialog) is regenerated with random
   * correct answers per attempt, so a generated Playwright script can't
   * hardcode them any more than it can read a real inbox for the email
   * code above. Same gating, same reasoning, requires an authenticated
   * session so it can only verify the caller's own account. See
   * docs/e2e-testing.md.
   */
  @Post('test/verify')
  @UseGuards(JwtAuthGuard)
  async testVerify(@CurrentUser() user: AuthenticatedUser) {
    if (this.config.stage === 'prod') throw new NotFoundException();
    await this.users.markVerified(user.provider, user.providerAccountId);
    return { verified: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    // Live DB state, not the JWT's claims — those go stale the moment the
    // quiz is passed or a professional verification is approved, since
    // neither reissues the session token. See VerifiedGuard for the same fix.
    const account = await this.users.getByProviderAccount(user.provider, user.providerAccountId);
    return account ?? user;
  }

  @Get('logout')
  logout(@Res() res: FastifyReply) {
    res.clearCookie(this.config.sessionCookieName ?? 'session', { path: '/' });
    // Explicit 302 required: Fastify's redirect(url) only defaults to 302
    // when no status was ever set on the reply; NestJS's Fastify adapter
    // already calls .code() earlier in the pipeline, so the implicit
    // default silently falls back to whatever that was (200) instead —
    // a 200 with a Location header, which browsers don't follow, so
    // sign-out/sign-in both looked like a blank page.
    res.redirect(this.config.webOrigin, 302);
  }

  private async completeOAuthLogin(
    req: FastifyRequest & { user?: unknown },
    res: FastifyReply,
  ) {
    const profile = req.user as unknown as OAuthProfile;
    const user = await this.users.upsertFromOAuth(profile);
    this.setSessionCookie(res, this.authService.issueSessionToken(user));
    res.redirect(`${this.config.webOrigin}/?signedIn=1`, 302);
  }

  private setSessionCookie(res: FastifyReply, token: string) {
    res.setCookie(this.config.sessionCookieName ?? 'session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}
