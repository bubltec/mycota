export type JobStatus = 'scheduled' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ScheduleJobInput {
  name: string;
  payload: unknown;
  /** ISO-8601. Defaults to now — the next `processDue` (fake) or the worker (prod) runs it. */
  runAt?: string;
}

export interface Job {
  id: string;
  name: string;
  payload: unknown;
  runAt: string;
  status: JobStatus;
  attempts: number;
}

/**
 * Delayed work: campaign beats, payout retries, token refresh. SQS delay is
 * capped at 15 minutes, so production uses EventBridge Scheduler `at()`, not
 * a delayed SQS send. Local/tests use FakeJobScheduler.processDue.
 */
export interface JobScheduler {
  schedule(input: ScheduleJobInput): Promise<Job>;
  cancel(id: string): Promise<void>;
  get(id: string): Promise<Job | undefined>;
}

export type JobHandler = (job: Job) => Promise<void>;
