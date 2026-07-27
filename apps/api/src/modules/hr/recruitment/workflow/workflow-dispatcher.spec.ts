// The dispatcher's delivery contract (I15): every matching consumer runs, one failing consumer
// never blocks the others, and a failure is reported so the event stays queued for retry.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import {
  deliver,
  onWorkflowEvent,
  resetWorkflowConsumers,
  workflowConsumerIds,
} from './workflow-dispatcher';
import { WorkflowEvents } from './workflow-events';
import { type WorkflowEventDoc } from './workflow-event.model';

vi.mock('../../../../platform/kernel/event-bus', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const event = (name: string): WorkflowEventDoc =>
  ({
    eventId: 'evt_test',
    name,
    occurredAt: new Date(),
    actorUserId: null,
    applicantId: new Types.ObjectId(),
    applicantCode: 'APP-2026-000001',
    object: 'interview',
    entityType: 'interview',
    entityId: new Types.ObjectId(),
    attempt: 1,
    from: 'waiting',
    to: 'scheduled',
    reason: null,
    correlationId: 'cor_test',
    branchId: null,
    payload: {},
    dispatchedAt: null,
    dispatchAttempts: 0,
    dispatchError: null,
  }) as unknown as WorkflowEventDoc;

afterEach(() => resetWorkflowConsumers());

describe('consumer registration', () => {
  it('registers a consumer once per (id, pattern)', () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    onWorkflowEvent('timeline', '*', handler);
    onWorkflowEvent('timeline', '*', handler);
    expect(workflowConsumerIds()).toEqual(['timeline']);
  });
});

describe('deliver', () => {
  it('runs every consumer whose pattern matches', async () => {
    const all = vi.fn().mockResolvedValue(undefined);
    const interviews = vi.fn().mockResolvedValue(undefined);
    const offers = vi.fn().mockResolvedValue(undefined);
    onWorkflowEvent('timeline', '*', all);
    onWorkflowEvent('interview-notify', 'hr.interview.*', interviews);
    onWorkflowEvent('offer-notify', 'hr.jobOffer.*', offers);

    const result = await deliver(event(WorkflowEvents.InterviewScheduled));

    expect(all).toHaveBeenCalledTimes(1);
    expect(interviews).toHaveBeenCalledTimes(1);
    expect(offers).not.toHaveBeenCalled();
    expect(result.failures).toBe(0);
  });

  it('matches an exact event name', async () => {
    const exact = vi.fn().mockResolvedValue(undefined);
    onWorkflowEvent('audit', WorkflowEvents.InterviewStarted, exact);
    await deliver(event(WorkflowEvents.InterviewScheduled));
    expect(exact).not.toHaveBeenCalled();
    await deliver(event(WorkflowEvents.InterviewStarted));
    expect(exact).toHaveBeenCalledTimes(1);
  });

  it('keeps running consumers after one throws, and reports the failure', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('notifications are down'));
    const healthy = vi.fn().mockResolvedValue(undefined);
    onWorkflowEvent('notifications', '*', failing);
    onWorkflowEvent('timeline', '*', healthy);

    const result = await deliver(event(WorkflowEvents.InterviewScheduled));

    expect(failing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(result.failures).toBe(1);
  });

  it('reports zero failures when nothing is registered', async () => {
    const result = await deliver(event(WorkflowEvents.OfferSent));
    expect(result.failures).toBe(0);
  });
});
