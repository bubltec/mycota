import { awsClientDefaults } from './aws-client-defaults.js';
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
import { SESClient } from '@aws-sdk/client-ses';
import { SesMailer, type Mailer } from '@bubltec/mycota-mail';
import type { SmsSender } from '@bubltec/mycota-sms';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AppleStrategy } from './apple.strategy.js';
import { FacebookStrategy } from './facebook.strategy.js';
import { MicrosoftStrategy } from './microsoft.strategy.js';
import { ProviderEnabledGuard } from './provider-enabled.guard.js';
import { sesClientFromSdk, sesMailerOptionsFromAuth } from './email-sender.service.js';
import { DynamoOtpStore, type OtpStore } from './otp.store.js';
import { MYCOTA_AUTH_MAILER, MYCOTA_AUTH_OTP_STORE, MYCOTA_AUTH_SMS_SENDER, OtpService } from './otp.service.js';

export interface MycotaAuthModuleAsyncOptions {
  useFactory: () => MycotaAuthConfig | Promise<MycotaAuthConfig>;
  /** Delivers email one-time codes. Defaults to SES using `config.emailFromAddress`. */
  mailer?: (config: MycotaAuthConfig) => Mailer;
  /** Delivers SMS one-time codes. Phone sign-in is disabled unless this is provided. */
  smsSender?: (config: MycotaAuthConfig) => SmsSender;
  /** Where pending codes live. Defaults to `OTP#` items in the users table. */
  otpStore?: (db: DynamoDBDocumentClient, config: MycotaAuthConfig) => OtpStore;
}

/**
 * Passport registers a strategy as a side effect of constructing it, and the
 * config is only known asynchronously, so each optional provider is a factory
 * that builds its strategy only when its config block is present.
 */
function optionalStrategy<T>(token: new (config: MycotaAuthConfig) => T, key: keyof MycotaAuthConfig) {
  return {
    provide: token,
    inject: [MYCOTA_AUTH_CONFIG],
    useFactory: (config: MycotaAuthConfig) => (config[key] ? new token(config) : null),
  };
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
        ProviderEnabledGuard,
        optionalStrategy(AppleStrategy, 'apple'),
        optionalStrategy(FacebookStrategy, 'facebook'),
        optionalStrategy(MicrosoftStrategy, 'microsoft'),
        OtpService,
        {
          provide: MYCOTA_AUTH_MAILER,
          inject: [MYCOTA_AUTH_CONFIG],
          useFactory: (config: MycotaAuthConfig) =>
            options.mailer?.(config) ??
            new SesMailer(
              sesClientFromSdk(new SESClient({ region: config.awsRegion ?? 'us-east-1', ...awsClientDefaults(config.network?.aws) })),
              sesMailerOptionsFromAuth(config),
            ),
        },
        {
          provide: MYCOTA_AUTH_SMS_SENDER,
          inject: [MYCOTA_AUTH_CONFIG],
          useFactory: (config: MycotaAuthConfig) => options.smsSender?.(config),
        },
        {
          provide: MYCOTA_AUTH_OTP_STORE,
          inject: [DYNAMO_DOC_CLIENT, MYCOTA_AUTH_CONFIG],
          useFactory: (db: DynamoDBDocumentClient, config: MycotaAuthConfig) =>
            options.otpStore?.(db, config) ?? new DynamoOtpStore(db, config.usersTableName),
        },
      ],
      exports: [AuthService, UsersService, EmailCodeService, OtpService, MYCOTA_AUTH_CONFIG],
    };
  }
}
