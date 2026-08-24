import type { Job, JobHandler, JobScheduler, ScheduleJobInput } from './ports.js';

export interface FakeJobSchedulerOptions {
  clock?: () => Date;
  maxAttempts?: number;
}

/**
 * In-memory scheduler. `processDue` is the local stand-in for EventBridge
 * invoking the worker at `runAt`.
 */
export class FakeJobScheduler implements JobScheduler {
  readonly jobs = new Map<string, Job>();
  private seq = 0;

  constructor(private readonly options: FakeJobSchedulerOptions = {}) {}

  async schedule(input: ScheduleJobInput): Promise<Job> {
    if (!input.name) throw new Error('job name is required');
    this.seq += 1;
    const job: Job = {
      id: `job_fake_${this.seq}`,
      name: input.name,
      payload: input.payload,
      runAt: input.runAt ?? this.now().toISOString(),
      status: 'scheduled',
      attempts: 0,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job ${id} not found`);
    if (job.status === 'succeeded' || job.status === 'cancelled') return;
    job.status = 'cancelled';
  }

  async get(id: string): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  async processDue(handler: JobHandler, now = this.now()): Promise<number> {
    const maxAttempts = this.options.maxAttempts ?? 5;
    const due = [...this.jobs.values()].filter(
      (job) => job.status === 'scheduled' && new Date(job.runAt).getTime() <= now.getTime(),
    );
    let ran = 0;
    for (const job of due) {
      job.status = 'running';
      job.attempts += 1;
      try {
        await handler({ ...job });
        job.status = 'succeeded';
      } catch {
        job.status = job.attempts >= maxAttempts ? 'failed' : 'scheduled';
      }
      ran += 1;
    }
    return ran;
  }

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }
}
