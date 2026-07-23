import { describe, expect, it, vi } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EphemeralConfig } from './ephemeral-config.js';

describe('EphemeralConfig (synth)', () => {
  it('wires a Lambda-backed custom resource scoped to source and target env paths', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new EphemeralConfig(stack, 'Config', {
      namespace: 'myapp',
      sourceEnv: 'dev',
      targetEnv: 'pr-123',
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Lambda::Function', 2); // the handler + the Provider framework's own onEvent shim
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      Namespace: 'myapp',
      SourceEnv: 'dev',
      TargetEnv: 'pr-123',
    });

    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('arn:aws:ssm:*:*:parameter/myapp/dev/*');
    expect(json).toContain('arn:aws:ssm:*:*:parameter/myapp/pr-123/*');
  });

  it('grants write+delete (not just read) on the target env, since it bootstraps and tears it down', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');

    new EphemeralConfig(stack, 'Config', { namespace: 'myapp', sourceEnv: 'dev', targetEnv: 'pr-123' });

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ssm:PutParameter', 'ssm:DeleteParameters']),
            Resource: 'arn:aws:ssm:*:*:parameter/myapp/pr-123/*',
          }),
        ]),
      },
    });
  });
});

describe('EphemeralConfig handler logic', () => {
  const { cloneSsmNamespace, deleteSsmNamespace } = vi.hoisted(() => ({
    cloneSsmNamespace: vi.fn().mockResolvedValue(['/myapp/pr-123/jwt-secret']),
    deleteSsmNamespace: vi.fn().mockResolvedValue(['/myapp/pr-123/jwt-secret']),
  }));

  vi.mock('@mycota/config', () => ({ cloneSsmNamespace, deleteSsmNamespace }));

  const resourceProperties = { Namespace: 'myapp', SourceEnv: 'dev', TargetEnv: 'pr-123' };

  it('clones source -> target on Create', async () => {
    const { handler } = await import('./lambda/ephemeral-config-handler.js');
    const result = await handler({
      RequestType: 'Create',
      ResourceProperties: resourceProperties,
    } as never);

    expect(cloneSsmNamespace).toHaveBeenCalledWith({
      namespace: 'myapp',
      sourceEnv: 'dev',
      targetEnv: 'pr-123',
    });
    expect(deleteSsmNamespace).not.toHaveBeenCalled();
    expect(result.Data).toEqual({ ClonedParameterCount: 1 });
  });

  it('deletes the target env on Delete', async () => {
    cloneSsmNamespace.mockClear();
    deleteSsmNamespace.mockClear();
    const { handler } = await import('./lambda/ephemeral-config-handler.js');
    const result = await handler({
      RequestType: 'Delete',
      ResourceProperties: resourceProperties,
    } as never);

    expect(deleteSsmNamespace).toHaveBeenCalledWith({ namespace: 'myapp', env: 'pr-123' });
    expect(cloneSsmNamespace).not.toHaveBeenCalled();
    expect(result.Data).toEqual({ DeletedParameterCount: 1 });
  });

  it('does nothing on Update', async () => {
    cloneSsmNamespace.mockClear();
    deleteSsmNamespace.mockClear();
    const { handler } = await import('./lambda/ephemeral-config-handler.js');
    await handler({
      RequestType: 'Update',
      ResourceProperties: resourceProperties,
    } as never);

    expect(cloneSsmNamespace).not.toHaveBeenCalled();
    expect(deleteSsmNamespace).not.toHaveBeenCalled();
  });
});
