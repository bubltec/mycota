export { MycotaAuthModule, type MycotaAuthModuleAsyncOptions } from './auth.module.js';
export { MYCOTA_AUTH_CONFIG, type MycotaAuthConfig, type MycotaNetworkConfig } from './auth.config.js';
export type { AwsClientSettings } from './aws-client-defaults.js';
export {
  buildMycotaAuthConfigFromSsm,
  type BuildMycotaAuthConfigFromSsmOptions,
} from './auth-ssm-config.js';
export { enablePassportFastifyCompat } from './fastify-passport-compat.js';
export { AuthService } from './auth.service.js';
export { UsersService } from './users.service.js';
export { EmailCodeService } from './email-code.service.js';
export { OtpService, type ConfirmedAnonymousIdentity, type ConfirmedIdentity } from './otp.service.js';
export { DynamoOtpStore, InMemoryOtpStore, type OtpRecord, type OtpStore } from './otp.store.js';
export { hashAnonymousEmail, normalizeIdentifier, type OtpChannel } from './otp.js';
export { JwtAuthGuard } from './jwt-auth.guard.js';
export { VerifiedGuard } from './verified.guard.js';
export { CurrentUser } from './current-user.decorator.js';
export type { AuthenticatedUser, OAuthProfile, SessionJwtPayload } from './auth.types.js';
export type {
  AuthProvider,
  ProfessionalStatus,
  ProfessionalVerification,
  User,
} from './user.types.js';
