// The job envelope (A-1).
//
// The envelope is a WIRE FORMAT: messages sit in Redis across deploys, and during a rolling
// deploy two versions of the worker drain the same queue at once. So the tests here are mostly
// about compatibility in both directions — a new worker reading an old message, and an old worker
// reading a new one. Getting that wrong does not fail loudly; it drops real work on the floor.
import { describe, expect, it } from 'vitest';
import { JobEnvelopeSchema, QUEUES, DEFAULT_ATTEMPTS } from './jobs';

const V1_MESSAGE = { requestId: 'req_1', data: { some: 'payload' } };

describe('forward and backward compatibility', () => {
  it('parses a v1 message enqueued before any of this metadata existed', () => {
    // The case that matters during a rolling deploy. If the new fields were required, every job
    // already sitting in Redis would fail to parse and be lost.
    const parsed = JobEnvelopeSchema.parse(V1_MESSAGE);
    expect(parsed.requestId).toBe('req_1');
    expect(parsed.correlationId).toBeUndefined();
    expect(parsed.enqueuedAt).toBeUndefined();
  });

  it('ignores fields it does not know, so a NEWER producer does not break an older worker', () => {
    // Zod objects are non-strict by default; this pins that, because switching to `.strict()`
    // later would silently make the envelope non-additive.
    const parsed = JobEnvelopeSchema.parse({
      ...V1_MESSAGE,
      somethingAddedInA7: { nested: true },
    });
    expect(parsed.data).toEqual({ some: 'payload' });
  });

  it('keeps requestId and data required — they are the v1 contract', () => {
    expect(() => JobEnvelopeSchema.parse({ data: {} })).toThrow();
  });

  it('accepts a date that has been through JSON', () => {
    // Redis stores JSON, so `enqueuedAt` arrives as a string. `z.coerce.date()` is what makes the
    // round trip work; without it every message with metadata would fail on the way back in.
    const parsed = JobEnvelopeSchema.parse({
      ...V1_MESSAGE,
      enqueuedAt: '2026-07-29T10:00:00.000Z',
    });
    expect(parsed.enqueuedAt).toBeInstanceOf(Date);
  });
});

describe('the metadata a failed job can be traced with', () => {
  it('carries correlation, causation, tenancy, principal, time and retry state', () => {
    const parsed = JobEnvelopeSchema.parse({
      ...V1_MESSAGE,
      correlationId: 'corr_1',
      eventId: 'evt_1',
      branchId: 'branch_1',
      principal: { userId: 'u1', kind: 'automation' },
      enqueuedAt: new Date().toISOString(),
      attempt: 2,
      maxAttempts: 5,
    });

    expect(parsed).toMatchObject({
      correlationId: 'corr_1',
      eventId: 'evt_1',
      branchId: 'branch_1',
      principal: { userId: 'u1', kind: 'automation' },
      attempt: 2,
      maxAttempts: 5,
    });
  });

  it('defaults an unlabelled principal to a user rather than to automation', () => {
    // Getting this backwards would attribute a person's action to the automation engine in the
    // audit trail, which is the one place attribution has to be right.
    const parsed = JobEnvelopeSchema.parse({ ...V1_MESSAGE, principal: { userId: 'u1' } });
    expect(parsed.principal?.kind).toBe('user');
  });

  it('allows no principal at all, for system-initiated work', () => {
    // A sweep or a cron has no user behind it. Inventing one would be worse than omitting it.
    expect(JobEnvelopeSchema.parse(V1_MESSAGE).principal).toBeUndefined();
  });
});

describe('queues', () => {
  it('includes automation', () => {
    expect(QUEUES).toContain('automation');
  });

  it('names no provider — the queue is provider-agnostic', () => {
    // A queue named `n8n` would have to be renamed to swap providers, and renaming a queue means
    // draining it first. The name is a deployment commitment, so it must not carry a vendor.
    expect(QUEUES.join(',')).not.toMatch(/n8n|temporal|camunda/i);
  });

  it('exposes the retry ceiling the envelope reports', () => {
    expect(DEFAULT_ATTEMPTS).toBeGreaterThan(1);
  });
});
