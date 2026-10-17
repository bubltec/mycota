import {
  AuthService,
  MYCOTA_AUTH_CONFIG,
  type MycotaAuthConfig,
  type User,
  UsersService,
} from '@bubltec/mycota-auth';
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { apiPrefixOf, MYCOTA_OAUTH_OPTIONS, type MycotaOAuthOptions } from './oauth.config.js';
import { OAuthError, OAuthService } from './oauth.service.js';
import { consentPage, errorPage, type PageBrand, signInPage } from './pages.js';
import { RETURN_COOKIE } from './well-known.js';

const AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;

@Controller('oauth')
export class OAuthController {
  private readonly prefix: string;
  private readonly brand: PageBrand;
  private readonly secure: boolean;

  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
    @Inject(MYCOTA_OAUTH_OPTIONS) private readonly options: MycotaOAuthOptions,
  ) {
    this.prefix = apiPrefixOf(options);
    this.brand = { appName: options.appName, css: options.css };
    this.secure = options.origin.startsWith('https:');
  }

  @Post('register')
  @HttpCode(201)
  async register(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      return reply.status(201).send(await this.oauth.register(body ?? {}));
    } catch (err) {
      return sendOAuthError(reply, err);
    }
  }

  @Post('token')
  @HttpCode(200)
  async token(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      const tokens = await this.oauth.token(body ?? {});
      return reply.header('cache-control', 'no-store').send(tokens);
    } catch (err) {
      return sendOAuthError(reply, err);
    }
  }

  @Get('authorize')
  async authorizePage(
    @Query() query: Record<string, string>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let req;
    try {
      req = await this.oauth.validateAuthorize(query);
    } catch (err) {
      return html(reply, 400, errorPage(this.brand, 'Can’t connect', message(err)));
    }
    const user = await this.sessionUser(request);
    if (!user) {
      this.setReturn(reply, request.url);
      return html(
        reply,
        200,
        signInPage(this.brand, {
          clientName: req.client.clientName,
          links: this.options.signIn ?? [],
          localAction: this.options.localSignInEmail ? `${this.prefix}/oauth/local-sign-in` : undefined,
        }),
      );
    }
    const who = user.email ?? user.displayName;
    if (!(await this.options.isAllowed(user))) {
      return html(reply, 403, errorPage(this.brand, 'Not allowed', `${who} isn’t allowed to connect ${this.options.appName}.`));
    }
    // Also come back here if they choose to sign in again from the consent page.
    this.setReturn(reply, request.url);
    const hidden: Record<string, string> = {};
    for (const key of AUTHORIZE_PARAMS) if (query[key]) hidden[key] = query[key];
    hidden.redirect_uri = req.redirectUri;
    return html(
      reply,
      200,
      consentPage(this.brand, {
        clientName: req.client.clientName,
        redirectHost: new URL(req.redirectUri).host,
        user: who,
        grants: this.options.grants,
        hidden,
        action: `${this.prefix}/oauth/authorize`,
        signInAgain: this.options.signIn?.[0],
      }),
    );
  }

  /**
   * The consent form posts here. The session cookie is SameSite=Lax, so a
   * cross-site form post arrives without it and is refused: that is the CSRF
   * protection, and why the user is re-checked here rather than trusted from GET.
   */
  @Post('authorize')
  async authorize(
    @Body() body: Record<string, string>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let req;
    try {
      req = await this.oauth.validateAuthorize(body ?? {});
    } catch (err) {
      return html(reply, 400, errorPage(this.brand, 'Can’t connect', message(err)));
    }
    const user = await this.sessionUser(request);
    if (!user || !(await this.options.isAllowed(user))) {
      return html(reply, 403, errorPage(this.brand, 'Not signed in', 'Sign in with an allowed account and try again.'));
    }
    // The consent page set a return cookie for its "sign in again" link; the decision is made, so drop it.
    reply.clearCookie(RETURN_COOKIE, { path: this.prefix });
    const target = new URL(req.redirectUri);
    if (req.state) target.searchParams.set('state', req.state);
    target.searchParams.set('iss', new URL(this.options.origin).origin);
    if (body.decision !== 'allow') {
      target.searchParams.set('error', 'access_denied');
    } else {
      target.searchParams.set('code', await this.oauth.issueCode(req, `${user.provider}:${user.providerAccountId}`));
    }
    return reply.redirect(target.toString(), 302);
  }

  /** Local and dev only (`localSignInEmail`): sign in as that user, then resume the authorize page. */
  @Post('local-sign-in')
  async localSignIn(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const email = this.options.localSignInEmail;
    if (!email) throw new NotFoundException();
    const user = await this.users.findOrCreateByEmail(email);
    reply.setCookie(this.config.sessionCookieName ?? 'session', this.auth.issueSessionToken(user), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secure,
      maxAge: 60 * 60 * 24 * 30,
    });
    const back = request.cookies?.[RETURN_COOKIE];
    reply.clearCookie(RETURN_COOKIE, { path: this.prefix });
    return reply.redirect(back?.startsWith(`${this.prefix}/oauth/authorize`) ? back : (this.options.localSignInRedirect ?? '/'), 302);
  }

  private setReturn(reply: FastifyReply, url: string) {
    reply.setCookie(RETURN_COOKIE, url, { path: this.prefix, httpOnly: true, sameSite: 'lax', secure: this.secure, maxAge: 600 });
  }

  private async sessionUser(request: FastifyRequest): Promise<User | undefined> {
    const token = request.cookies?.[this.config.sessionCookieName ?? 'session'];
    if (!token) return undefined;
    try {
      const payload = this.auth.verifySessionToken(token);
      return (await this.users.getByProviderAccount(payload.provider, payload.providerAccountId)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function html(reply: FastifyReply, status: number, body: string) {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'")
    .send(body);
}

function message(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function sendOAuthError(reply: FastifyReply, err: unknown) {
  if (err instanceof OAuthError) {
    return reply.status(err.status).header('cache-control', 'no-store').send({ error: err.error, error_description: err.description });
  }
  throw err;
}
