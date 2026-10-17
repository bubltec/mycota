import { Body, Controller, Delete, Get, Inject, Post, Req, Res, type DynamicModule, type InjectionToken, Module, type OptionalFactoryDependency, type Type } from '@nestjs/common';
import { OAuthBearerService, type OAuthPrincipal } from '@bubltec/mycota-oauth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type JsonRpcMessage, McpServer, type McpServerOptions } from './mcp-server.js';

export const MCP_SERVER = Symbol('MYCOTA_MCP_SERVER');
export const MYCOTA_MCP_OPTIONS = Symbol('MYCOTA_MCP_OPTIONS');

export interface MycotaMcpOptions extends McpServerOptions {
  /** Who a write is recorded as. Default `<email or display name> (mcp)`. */
  attribution?(principal: OAuthPrincipal): string;
}

export interface MycotaMcpModuleAsyncOptions {
  /**
   * Route the endpoint is served at (under the global prefix). Default `mcp`.
   * It must match the OAuth module's `resourcePath` (`/api/mcp` for `mcp` under `/api`).
   */
  route?: string;
  imports?: DynamicModule['imports'];
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useFactory: (...args: any[]) => MycotaMcpOptions | Promise<MycotaMcpOptions>;
}

/** The controller is built per route, since a decorator's path is fixed when the class is defined. */
function mcpController(route: string): Type<unknown> {
  @Controller(route)
  class McpController {
    constructor(
      @Inject(MCP_SERVER) private readonly server: McpServer,
      @Inject(MYCOTA_MCP_OPTIONS) private readonly options: MycotaMcpOptions,
      private readonly bearer: OAuthBearerService,
    ) {}

    @Get()
    get(@Res() reply: FastifyReply) {
      return reply.status(405).header('allow', 'POST').send({ error: 'POST only; this server sends no server-initiated messages.' });
    }

    @Delete()
    del(@Res() reply: FastifyReply) {
      return reply.status(405).header('allow', 'POST').send();
    }

    @Post()
    async post(@Body() body: JsonRpcMessage | JsonRpcMessage[], @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
      const principal = await this.bearer.authenticate(request.headers.authorization);
      if (!principal) {
        return reply
          .status(401)
          .header('www-authenticate', this.bearer.challenge())
          .send({ error: 'invalid_token', error_description: 'Sign in to use this server.' });
      }
      const by = this.options.attribution?.(principal) ?? `${principal.user.email ?? principal.user.displayName} (mcp)`;
      const response = await this.server.handleBody(body, by);
      return response === undefined ? reply.status(202).send() : reply.status(200).send(response);
    }
  }
  return McpController;
}

/**
 * An MCP endpoint behind the OAuth server: every call needs a bearer token that
 * `MycotaOAuthModule` issued to a user it still allows. Import this after
 * `MycotaOAuthModule` (which is global).
 */
@Module({})
export class MycotaMcpModule {
  static forRootAsync(options: MycotaMcpModuleAsyncOptions): DynamicModule {
    return {
      module: MycotaMcpModule,
      imports: options.imports ?? [],
      controllers: [mcpController(options.route ?? 'mcp')],
      providers: [
        { provide: MYCOTA_MCP_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        { provide: MCP_SERVER, inject: [MYCOTA_MCP_OPTIONS], useFactory: (o: MycotaMcpOptions) => new McpServer(o) },
      ],
      exports: [MCP_SERVER],
    };
  }
}
