import { loadSsmConfig } from '@mycota/config';
import type { MycotaAuthConfig } from './auth.config.js';

export interface BuildMycotaAuthConfigFromSsmOptions {
  /** Top-level SSM prefix, e.g. 'myapp'. Matches @mycota/config's SsmConfigOptions.namespace. */
  namespace: string;
  /** Any string — 'dev', 'prod', 'pr-123'. Matches @mycota/config's SsmConfigOptions.env. */
  env: string;
  region?: string;
  /**
   * Anything here wins over what's in SSM — useful for values a CDK stack
   * already knows at deploy time (a table name derived from the stack's own
   * naming convention, a webOrigin derived from the actual domain) that are
   * more naturally passed directly than round-tripped through SSM.
   */
  overrides?: Partial<MycotaAuthConfig>;
}

/**
 * Documented SSM key convention this function reads, under
 * /{namespace}/{env}/* (falling back to /{namespace}/shared/* per
 * loadSsmConfig's normal merge order): jwt-secret, web-origin,
 * users-table-name, email-from-address, session-cookie-name, stage,
 * aws-region, bedrock-inference-profile-id, brave-search-api-key,
 * github-client-id, github-client-secret, github-callback-url,
 * google-client-id, google-client-secret, google-callback-url.
 *
 * Required MycotaAuthConfig fields fall back to obviously-fake generic
 * placeholders when missing (e.g. an ephemeral stack that hasn't been
 * cloned yet via @mycota/config's cloneSsmNamespace) — same "boots fine,
 * just non-functional until set" philosophy as the rest of this module.
 * Pass real values via `overrides` for anything you don't want sourced
 * from SSM at all.
 */
export async function buildMycotaAuthConfigFromSsm(
  options: BuildMycotaAuthConfigFromSsmOptions,
): Promise<MycotaAuthConfig> {
  const ssm = await loadSsmConfig({
    namespace: options.namespace,
    env: options.env,
    region: options.region,
  });

  const github =
    ssm['github-client-id'] || ssm['github-client-secret']
      ? {
          clientId: ssm['github-client-id'] ?? '',
          clientSecret: ssm['github-client-secret'] ?? '',
          callbackUrl: ssm['github-callback-url'] ?? '',
        }
      : undefined;

  const google =
    ssm['google-client-id'] || ssm['google-client-secret']
      ? {
          clientId: ssm['google-client-id'] ?? '',
          clientSecret: ssm['google-client-secret'] ?? '',
          callbackUrl: ssm['google-callback-url'] ?? '',
        }
      : undefined;

  const config: MycotaAuthConfig = {
    jwtSecret: ssm['jwt-secret'] ?? 'change-me-in-local-env',
    webOrigin: ssm['web-origin'] ?? 'http://localhost:5173',
    usersTableName: ssm['users-table-name'] ?? `${options.namespace}-${options.env}-users`,
    emailFromAddress: ssm['email-from-address'] ?? `noreply@${options.namespace}.example`,
    sessionCookieName: ssm['session-cookie-name'],
    stage: ssm['stage'] ?? options.env,
    awsRegion: ssm['aws-region'] ?? options.region,
    bedrockInferenceProfileId: ssm['bedrock-inference-profile-id'],
    braveSearchApiKey: ssm['brave-search-api-key'],
    github,
    google,
  };

  return { ...config, ...options.overrides };
}
