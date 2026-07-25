import { describe, expect, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { grantSsmConfigRead } from './grant-ssm-config-read.js';

function synthWithGrant(options: Parameters<typeof grantSsmConfigRead>[1]) {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const role = new Role(stack, 'TestRole', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  grantSsmConfigRead(role, options);
  return Template.fromStack(stack);
}

describe('grantSsmConfigRead', () => {
  it('grants the three SSM read actions on both the env path and shared path by default', () => {
    const template = synthWithGrant({ namespace: 'myapp', env: 'dev' });

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith([
              'ssm:GetParameter',
              'ssm:GetParameters',
              'ssm:GetParametersByPath',
            ]),
            Resource: Match.arrayWith([
              'arn:aws:ssm:*:*:parameter/myapp/dev/*',
              'arn:aws:ssm:*:*:parameter/myapp/shared/*',
            ]),
          }),
        ]),
      },
    });
  });

  it('omits the shared path when includeShared is false', () => {
    const template = synthWithGrant({ namespace: 'myapp', env: 'dev', includeShared: false });

    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('arn:aws:ssm:*:*:parameter/myapp/dev/*');
    expect(json).not.toContain('shared');
  });
});
