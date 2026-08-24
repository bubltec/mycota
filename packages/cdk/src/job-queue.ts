import { Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement, Role, ServicePrincipal, type Grant, type IGrantable } from 'aws-cdk-lib/aws-iam';
import { CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface JobQueueProps {
  namespace: string;
  env: string;
}

/**
 * Worker queue + EventBridge Scheduler group for delayed jobs (campaign beats
 * days out). SQS delay is 15 minutes max — do not use it for `day_of`.
 *
 * Runtime: `@bubltec/mycota-jobs` EventBridgeJobScheduler creates `at()`
 * schedules that SendMessage to `queue`. A worker ConsumeMessages and runs
 * the payload.
 */
export class JobQueue extends Construct {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;
  readonly scheduleGroup: CfnScheduleGroup;
  readonly schedulerRole: Role;
  readonly groupName: string;

  constructor(scope: Construct, id: string, props: JobQueueProps) {
    super(scope, id);

    this.groupName = `${props.namespace}-${props.env}-jobs`;

    this.deadLetterQueue = new Queue(this, 'Dlq', {
      encryption: QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new Queue(this, 'Queue', {
      encryption: QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });

    this.scheduleGroup = new CfnScheduleGroup(this, 'Schedules', {
      name: this.groupName,
    });

    this.schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    this.queue.grantSendMessages(this.schedulerRole);
  }

  grantConsume(grantee: IGrantable): Grant {
    return this.queue.grantConsumeMessages(grantee);
  }

  grantSchedule(grantee: IGrantable): Grant {
    const stack = Stack.of(this);
    grantee.grantPrincipal.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
          'scheduler:UpdateSchedule',
        ],
        resources: [
          stack.formatArn({ service: 'scheduler', resource: 'schedule-group', resourceName: this.groupName }),
          stack.formatArn({ service: 'scheduler', resource: 'schedule', resourceName: `${this.groupName}/*` }),
        ],
      }),
    );
    this.schedulerRole.grantPassRole(grantee.grantPrincipal);
    return this.queue.grantSendMessages(grantee);
  }
}
