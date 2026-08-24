import { describe, expect, it, vi } from 'vitest';
import { EventBridgeJobScheduler, atExpression, type SchedulerClient } from './eventbridge.adapter.js';
import { FakeJobScheduler } from './fake.adapter.js';

describe('FakeJobScheduler', () => {
  it('runs due jobs and retries failures until maxAttempts', async () => {
    const scheduler = new FakeJobScheduler({
      clock: () => new Date('2026-09-01T12:00:00.000Z'),
      maxAttempts: 2,
    });
    await scheduler.schedule({
      name: 'campaign.publish',
      payload: { beat: 'announce' },
      runAt: '2026-09-01T11:00:00.000Z',
    });
    await scheduler.schedule({
      name: 'campaign.publish',
      payload: { beat: 'day_of' },
      runAt: '2026-09-02T20:00:00.000Z',
    });

    const ran = await scheduler.processDue(async (job) => {
      if (job.payload && typeof job.payload === 'object' && 'beat' in job.payload) {
        throw new Error('boom');
      }
    });
    expect(ran).toBe(1);
    expect((await scheduler.get('job_fake_1'))?.status).toBe('scheduled');

    await scheduler.processDue(async () => {
      throw new Error('boom');
    });
    expect((await scheduler.get('job_fake_1'))?.status).toBe('failed');
    expect((await scheduler.get('job_fake_2'))?.status).toBe('scheduled');
  });

  it('cancel is a no-op after success', async () => {
    const scheduler = new FakeJobScheduler();
    const job = await scheduler.schedule({ name: 'ping', payload: {} });
    await scheduler.processDue(async () => undefined);
    await scheduler.cancel(job.id);
    expect((await scheduler.get(job.id))?.status).toBe('succeeded');
  });
});

describe('EventBridgeJobScheduler', () => {
  it('creates an at() schedule and cancels by name', async () => {
    const client: SchedulerClient = {
      createSchedule: vi.fn(async () => undefined),
      deleteSchedule: vi.fn(async () => undefined),
    };
    const scheduler = new EventBridgeJobScheduler(client, { namePrefix: 'sloth-' });
    const job = await scheduler.schedule({
      name: 'campaign.publish',
      payload: { eventId: 'e1' },
      runAt: '2026-09-01T20:00:00.000Z',
    });
    expect(client.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        runAt: atExpression('2026-09-01T20:00:00.000Z'),
      }),
    );
    await scheduler.cancel(job.id);
    expect(client.deleteSchedule).toHaveBeenCalled();
  });
});
