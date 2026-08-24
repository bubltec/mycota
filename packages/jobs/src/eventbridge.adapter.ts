import type { Job, JobScheduler, ScheduleJobInput } from './ports.js';

/**
 * Narrow EventBridge Scheduler surface. The consuming app passes the AWS
 * client (or a test double). Schedules target a queue/Lambda the app owns.
 */
export interface SchedulerClient {
  createSchedule(input: {
    name: string;
    runAt: string;
    payload: string;
  }): Promise<void>;
  deleteSchedule(name: string): Promise<void>;
}

export interface EventBridgeJobSchedulerOptions {
  /** Prefix applied to schedule names (EventBridge: [0-9a-zA-Z-_.]{1,64}). */
  namePrefix?: string;
}

function scheduleName(prefix: string, id: string): string {
  const raw = `${prefix}${id}`.replace(/[^0-9a-zA-Z-_.]/g, '-');
  return raw.slice(0, 64);
}

function atExpression(runAt: string): string {
  const iso = new Date(runAt).toISOString().replace(/\.\d{3}Z$/, '');
  return `at(${iso})`;
}

/**
 * One-time schedules via EventBridge Scheduler `at()`. Does not poll — AWS
 * invokes the target at `runAt`. `get` only sees jobs this process scheduled.
 */
export class EventBridgeJobScheduler implements JobScheduler {
  private readonly local = new Map<string, Job>();
  private seq = 0;

  constructor(
    private readonly client: SchedulerClient,
    private readonly options: EventBridgeJobSchedulerOptions = {},
  ) {}

  async schedule(input: ScheduleJobInput): Promise<Job> {
    if (!input.name) throw new Error('job name is required');
    this.seq += 1;
    const id = `job_${this.seq}_${Date.now()}`;
    const job: Job = {
      id,
      name: input.name,
      payload: input.payload,
      runAt: input.runAt ?? new Date().toISOString(),
      status: 'scheduled',
      attempts: 0,
    };
    await this.client.createSchedule({
      name: scheduleName(this.options.namePrefix ?? 'mycota-', job.id),
      runAt: atExpression(job.runAt),
      payload: JSON.stringify({ id: job.id, name: job.name, payload: job.payload, runAt: job.runAt }),
    });
    this.local.set(job.id, job);
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = this.local.get(id);
    if (!job) throw new Error(`job ${id} not found`);
    await this.client.deleteSchedule(scheduleName(this.options.namePrefix ?? 'mycota-', id));
    job.status = 'cancelled';
  }

  async get(id: string): Promise<Job | undefined> {
    const job = this.local.get(id);
    return job ? { ...job } : undefined;
  }
}

export { atExpression, scheduleName };
