import { DynamicModule, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersService } from './users.service.js';
import { GithubStrategy } from './github.strategy.js';
import { GoogleStrategy } from './google.strategy.js';
import { EmailCodeService } from './email-code.service.js';
import { BedrockClassifierService } from './bedrock-classifier.service.js';
import { EmailSenderService } from './email-sender.service.js';
import { HomepageFetcherService } from './homepage-fetcher.service.js';
import { SearchHistoryService } from './search-history.service.js';
import { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig } from './auth.config.js';

export interface MycotaAuthModuleAsyncOptions {
  useFactory: () => MycotaAuthConfig | Promise<MycotaAuthConfig>;
}

@Module({})
export class MycotaAuthModule {
  /**
   * `useFactory` is only invoked when Nest actually resolves the
   * MYCOTA_AUTH_CONFIG provider (during NestFactory.create()), not when
   * this method is called — that's the whole point. In the Lambda entry
   * point (apps/bff/src/lambda.ts), GITHUB_CLIENT_SECRET is fetched from
   * SSM asynchronously *before* createApp() runs; if useFactory's result
   * were read eagerly here (e.g. `forRoot(buildConfig())` with a plain
   * object), it would read that env var before the SSM fetch completes and
   * silently ship an empty secret. Called twice below (config provider +
   * JwtModule's secret) — harmless, it's a pure process.env read, not
   * worth a second module just to dedupe one cheap call.
   */
  static forRootAsync(options: MycotaAuthModuleAsyncOptions): DynamicModule {
    return {
      module: MycotaAuthModule,
      global: true,
      imports: [
        PassportModule.register({ session: false }),
        JwtModule.registerAsync({
          useFactory: async () => {
            const config = await options.useFactory();
            return { secret: config.jwtSecret, signOptions: { expiresIn: '30d' } };
          },
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: MYCOTA_AUTH_CONFIG, useFactory: options.useFactory },
        AuthService,
        UsersService,
        GithubStrategy,
        GoogleStrategy,
        EmailCodeService,
        BedrockClassifierService,
        EmailSenderService,
        HomepageFetcherService,
        SearchHistoryService,
      ],
      exports: [AuthService, UsersService, EmailCodeService, MYCOTA_AUTH_CONFIG],
    };
  }
}
