// The timeline id helpers (I9): identity must be unique and time-sortable, and the idempotency
// key must be derived from facts alone so a rebuild reproduces it exactly.
import { describe, expect, it } from 'vitest';
import { newCorrelationId, newEventId, timelineSourceKey } from './recruitment-timeline.keys';

describe('newEventId', () => {
  it('is unique across calls at the same instant', () => {
    const at = new Date('2026-07-27T10:00:00.000Z');
    const ids = new Set(Array.from({ length: 500 }, () => newEventId(at)));
    expect(ids.size).toBe(500);
  });

  it('sorts lexicographically in chronological order', () => {
    const earlier = newEventId(new Date('2026-07-27T10:00:00.000Z'));
    const later = newEventId(new Date('2026-07-27T10:00:00.001Z'));
    const muchLater = newEventId(new Date('2027-01-01T00:00:00.000Z'));
    expect([muchLater, later, earlier].sort()).toEqual([earlier, later, muchLater]);
  });

  it('is prefixed and fixed-width so ordering never breaks across epochs', () => {
    const id = newEventId(new Date('2026-07-27T10:00:00.000Z'));
    expect(id).toMatch(/^evt_[0-9a-f]{12}[0-9a-f]{20}$/);
  });
});

describe('timelineSourceKey', () => {
  const base = {
    applicantId: '65b000000000000000000001',
    type: 'interviewStarted',
    entityType: 'interview',
    entityId: '65b000000000000000000002',
  };

  it('is deterministic — the same facts always produce the same key', () => {
    expect(timelineSourceKey(base)).toBe(timelineSourceKey({ ...base }));
  });

  it('does not depend on the clock or randomness', () => {
    const first = timelineSourceKey(base);
    const second = timelineSourceKey({ ...base });
    expect(first).toBe(second);
    expect(first).not.toContain(String(Date.now()).slice(0, 8));
  });

  it('separates entries of the same type on the same entity by discriminator', () => {
    const attempt1 = timelineSourceKey({ ...base, discriminator: 1 });
    const attempt2 = timelineSourceKey({ ...base, discriminator: 2 });
    expect(attempt1).not.toBe(attempt2);
  });

  it('distinguishes event types on one entity', () => {
    expect(timelineSourceKey({ ...base, type: 'interviewCompleted' })).not.toBe(timelineSourceKey(base));
  });

  it('distinguishes candidates', () => {
    const other = timelineSourceKey({ ...base, applicantId: '65b000000000000000000009' });
    expect(other).not.toBe(timelineSourceKey(base));
  });

  it('renders absent parts as a placeholder rather than collapsing them', () => {
    const withoutEntity = timelineSourceKey({ applicantId: base.applicantId, type: 'applied' });
    expect(withoutEntity).toBe(`${base.applicantId}:applied:-:-:-`);
  });
});

describe('newCorrelationId', () => {
  it('is unique per call — one episode, one id', () => {
    const at = new Date('2026-07-27T10:00:00.000Z');
    const ids = new Set(Array.from({ length: 200 }, () => newCorrelationId(at)));
    expect(ids.size).toBe(200);
  });

  it('is prefixed so an episode id is never confused with an event id', () => {
    expect(newCorrelationId()).toMatch(/^cor_/);
    expect(newEventId()).toMatch(/^evt_/);
  });
});
