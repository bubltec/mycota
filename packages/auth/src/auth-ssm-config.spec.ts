import { describe, expect, it, vi } from 'vitest';

const { loadSsmConfig } = vi.hoisted(() => ({
  loadSsmConfig: vi.fn(),
}));

vi.mock('@mycota/config', () => ({ loadSsmConfig }));

describe('buildMycotaAuthConfigFromSsm', () => {
  it('maps the documented SSM key convention onto MycotaAuthConfig', async () => {
    loadSsmConfig.mockResolvedValue({
      'jwt-secret': 'real-secret',
      'web-origin': 'https://example.com',
      'users-table-name': 'myapp-dev-users',
      'email-from-address': 'noreply@example.com',
      'session-cookie-name': 'session',
      stage: 'dev',
      'aws-region': 'us-west-2',
      'bedrock-inference-profile-id': 'profile-1',
      'brave-search-api-key': 'brave-key',
      'github-client-id': 'gh-id',
      'github-client-secret': 'gh-secret',
      'github-callback-url': 'https://example.com/auth/github/callback',
      'google-client-id': 'go-id',
      'google-client-secret': 'go-secret',
      'google-callback-url': 'https://example.com/auth/google/callback',
    });

    const { buildMycotaAuthConfigFromSsm } = await import('./auth-ssm-config.js');
    const config = await buildMycotaAuthConfigFromSsm({ namespace: 'myapp', env: 'dev' });

    expect(loadSsmConfig).toHaveBeenCalledWith({
      namespace: 'myapp',
      env: 'dev',
      region: undefined,
    });
    expect(config).toEqual({
      jwtSecret: 'real-secret',
      webOrigin: 'https://example.com',
      usersTableName: 'myapp-dev-users',
      emailFromAddress: 'noreply@example.com',
      sessionCookieName: 'session',
      stage: 'dev',
      awsRegion: 'us-west-2',
      bedrockInferenceProfileId: 'profile-1',
      braveSearchApiKey: 'brave-key',
      github: {
        clientId: 'gh-id',
        clientSecret: 'gh-secret',
        callbackUrl: 'https://example.com/auth/github/callback',
      },
      google: {
        clientId: 'go-id',
        clientSecret: 'go-secret',
        callbackUrl: 'https://example.com/auth/google/callback',
      },
    });
  });

  it('uses placeholders when SSM is empty (unprovisioned ephemeral env)', async () => {
    loadSsmConfig.mockResolvedValue({});

    const { buildMycotaAuthConfigFromSsm } = await import('./auth-ssm-config.js');
    const config = await buildMycotaAuthConfigFromSsm({ namespace: 'myapp', env: 'pr-123' });

    expect(config.jwtSecret).toBe('change-me-in-local-env');
    expect(config.webOrigin).toBe('http://localhost:5173');
    expect(config.usersTableName).toBe('myapp-pr-123-users');
    expect(config.emailFromAddress).toBe('noreply@myapp.example');
    expect(config.stage).toBe('pr-123');
    expect(config.github).toBeUndefined();
    expect(config.google).toBeUndefined();
  });

  it('lets overrides win over both SSM values and placeholders', async () => {
    loadSsmConfig.mockResolvedValue({
      'jwt-secret': 'from-ssm',
      'web-origin': 'https://from-ssm.example',
    });

    const { buildMycotaAuthConfigFromSsm } = await import('./auth-ssm-config.js');
    const config = await buildMycotaAuthConfigFromSsm({
      namespace: 'myapp',
      env: 'dev',
      overrides: {
        jwtSecret: 'from-override',
        usersTableName: 'stack-derived-users',
      },
    });

    expect(config.jwtSecret).toBe('from-override');
    expect(config.webOrigin).toBe('https://from-ssm.example');
    expect(config.usersTableName).toBe('stack-derived-users');
  });

  it('omits an OAuth provider when neither client id nor secret is present', async () => {
    loadSsmConfig.mockResolvedValue({
      'github-client-id': 'gh-id',
      'github-client-secret': 'gh-secret',
      'github-callback-url': 'https://example.com/callback',
    });

    const { buildMycotaAuthConfigFromSsm } = await import('./auth-ssm-config.js');
    const config = await buildMycotaAuthConfigFromSsm({ namespace: 'myapp', env: 'dev' });

    expect(config.github).toEqual({
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
      callbackUrl: 'https://example.com/callback',
    });
    expect(config.google).toBeUndefined();
  });
});
