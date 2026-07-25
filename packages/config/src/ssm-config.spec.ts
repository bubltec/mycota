import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  SSMClient,
  GetParametersByPathCommand,
  PutParameterCommand,
  DeleteParametersCommand,
} from '@aws-sdk/client-ssm';
import {
  loadSsmConfig,
  pushSsmConfig,
  cloneSsmNamespace,
  deleteSsmNamespace,
} from './ssm-config.js';

const ssmMock = mockClient(SSMClient);

beforeEach(() => {
  ssmMock.reset();
});

describe('loadSsmConfig', () => {
  it('merges shared params first, then env-specific overrides on collision', async () => {
    ssmMock
      .on(GetParametersByPathCommand, { Path: '/myapp/shared/', Recursive: true })
      .resolves({
        Parameters: [
          { Name: '/myapp/shared/brave-search-api-key', Value: 'shared-brave-key' },
          { Name: '/myapp/shared/jwt-secret', Value: 'shared-jwt' },
        ],
      })
      .on(GetParametersByPathCommand, { Path: '/myapp/dev/', Recursive: true })
      .resolves({
        Parameters: [{ Name: '/myapp/dev/jwt-secret', Value: 'dev-jwt' }],
      });

    const result = await loadSsmConfig({ namespace: 'myapp', env: 'dev' });

    expect(result).toEqual({
      'brave-search-api-key': 'shared-brave-key',
      'jwt-secret': 'dev-jwt', // env-specific wins over shared
    });
  });

  it('returns {} for an unprovisioned/ephemeral environment instead of throwing', async () => {
    ssmMock.on(GetParametersByPathCommand).resolves({ Parameters: [] });

    const result = await loadSsmConfig({ namespace: 'myapp', env: 'pr-999', includeShared: false });

    expect(result).toEqual({});
  });

  it('skips the shared lookup when includeShared is false', async () => {
    ssmMock
      .on(GetParametersByPathCommand, { Path: '/myapp/dev/', Recursive: true })
      .resolves({ Parameters: [{ Name: '/myapp/dev/jwt-secret', Value: 'dev-jwt' }] });

    const result = await loadSsmConfig({ namespace: 'myapp', env: 'dev', includeShared: false });

    expect(result).toEqual({ 'jwt-secret': 'dev-jwt' });
    expect(
      ssmMock.commandCalls(GetParametersByPathCommand, { Path: '/myapp/shared/' }),
    ).toHaveLength(0);
  });

  it('follows NextToken pagination', async () => {
    ssmMock
      .on(GetParametersByPathCommand, { Path: '/myapp/dev/', Recursive: true })
      .resolvesOnce({
        Parameters: [{ Name: '/myapp/dev/key-a', Value: 'a' }],
        NextToken: 'page-2',
      })
      .resolves({
        Parameters: [{ Name: '/myapp/dev/key-b', Value: 'b' }],
      });

    const result = await loadSsmConfig({ namespace: 'myapp', env: 'dev', includeShared: false });

    expect(result).toEqual({ 'key-a': 'a', 'key-b': 'b' });
  });
});

describe('pushSsmConfig', () => {
  it('writes each non-empty value as a SecureString under the env path', async () => {
    ssmMock.on(PutParameterCommand).resolves({});

    const written = await pushSsmConfig(
      { namespace: 'myapp', env: 'dev' },
      { 'jwt-secret': 'real-value', 'unset-key': undefined, 'empty-key': '' },
    );

    expect(written).toEqual(['/myapp/dev/jwt-secret']);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(1);
    expect(ssmMock.commandCalls(PutParameterCommand)[0]?.args[0].input).toMatchObject({
      Name: '/myapp/dev/jwt-secret',
      Value: 'real-value',
      Type: 'SecureString',
      Overwrite: true,
    });
  });
});

describe('cloneSsmNamespace', () => {
  it('copies every source-env parameter to the target env', async () => {
    ssmMock.on(GetParametersByPathCommand, { Path: '/myapp/dev/', Recursive: true }).resolves({
      Parameters: [
        { Name: '/myapp/dev/jwt-secret', Value: 'dev-jwt' },
        { Name: '/myapp/dev/basic-auth-user', Value: 'admin' },
      ],
    });
    ssmMock.on(PutParameterCommand).resolves({});

    const written = await cloneSsmNamespace({
      namespace: 'myapp',
      sourceEnv: 'dev',
      targetEnv: 'pr-123',
    });

    expect(written.sort()).toEqual(
      ['/myapp/pr-123/jwt-secret', '/myapp/pr-123/basic-auth-user'].sort(),
    );
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(2);
  });
});

describe('deleteSsmNamespace', () => {
  it('returns [] without calling DeleteParameters when nothing exists', async () => {
    ssmMock.on(GetParametersByPathCommand).resolves({ Parameters: [] });

    const deleted = await deleteSsmNamespace({ namespace: 'myapp', env: 'pr-123' });

    expect(deleted).toEqual([]);
    expect(ssmMock.commandCalls(DeleteParametersCommand)).toHaveLength(0);
  });

  it('batches deletes at 10 names per call', async () => {
    const names = Array.from({ length: 23 }, (_, i) => `/myapp/pr-123/key-${i}`);
    ssmMock
      .on(GetParametersByPathCommand, { Path: '/myapp/pr-123/', Recursive: true })
      .resolves({ Parameters: names.map((name) => ({ Name: name, Value: 'v' })) });
    ssmMock.on(DeleteParametersCommand).resolves({});

    const deleted = await deleteSsmNamespace({ namespace: 'myapp', env: 'pr-123' });

    expect(deleted).toHaveLength(23);
    const calls = ssmMock.commandCalls(DeleteParametersCommand);
    expect(calls).toHaveLength(3); // 10 + 10 + 3
    expect(calls[0]?.args[0].input.Names).toHaveLength(10);
    expect(calls[2]?.args[0].input.Names).toHaveLength(3);
  });
});
