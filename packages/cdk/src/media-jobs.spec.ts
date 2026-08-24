import { describe, expect, it } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { JobQueue } from './job-queue.js';
import { MediaBucket } from './media-bucket.js';

describe('MediaBucket', () => {
  it('creates a private bucket and a CloudFront distribution by default', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const media = new MediaBucket(stack, 'Media', { namespace: 'sloth', env: 'dev' });
    expect(media.publicBaseUrl).toContain('https://');

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: Match.objectLike({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
      }),
    });
  });

  it('omits CloudFront when cloudFront is false', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new MediaBucket(stack, 'Media', { namespace: 'sloth', env: 'dev', cloudFront: false });
    Template.fromStack(stack).resourceCountIs('AWS::CloudFront::Distribution', 0);
  });
});

describe('JobQueue', () => {
  it('creates a queue, DLQ, schedule group, and scheduler send role', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const jobs = new JobQueue(stack, 'Jobs', { namespace: 'sloth', env: 'dev' });
    const worker = new Role(stack, 'Worker', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') });
    jobs.grantConsume(worker);
    jobs.grantSchedule(worker);

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::Scheduler::ScheduleGroup', { Name: 'sloth-dev-jobs' });
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('scheduler:CreateSchedule');
    expect(json).toContain('sqs:ReceiveMessage');
  });
});
