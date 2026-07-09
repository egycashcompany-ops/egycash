// F1/F2 — timeline merge ordering (BD-007's content-selection logic is exercised in
// the integration suite, where real permission contexts and streams are available).
import { describe, expect, it } from 'vitest';
import { type TimelineEntryDto } from '@ecms/contracts';
import { mergeTimelineEntries } from './audit.timeline';

const activity = (at: string, id: string): TimelineEntryDto => ({
  source: 'activity',
  id,
  at,
  actorId: 'u1',
  messageKey: 'file.uploaded',
  params: {},
});

const audit = (at: string, id: string): TimelineEntryDto => ({
  source: 'audit',
  id,
  at,
  actorId: 'u1',
  action: 'update',
  changes: [],
});

describe('mergeTimelineEntries', () => {
  it('interleaves activity and audit entries newest-first by `at`', () => {
    const merged = mergeTimelineEntries([
      activity('2026-07-01T10:00:00.000Z', 'a1'),
      audit('2026-07-03T10:00:00.000Z', 'd1'),
      activity('2026-07-02T10:00:00.000Z', 'a2'),
      audit('2026-07-01T09:00:00.000Z', 'd2'),
    ]);
    expect(merged.map((e) => e.id)).toEqual(['d1', 'a2', 'a1', 'd2']);
  });

  it('does not mutate the input array', () => {
    const input = [activity('2026-07-01T10:00:00.000Z', 'a1'), audit('2026-07-02T10:00:00.000Z', 'd1')];
    const originalOrder = input.map((e) => e.id);
    mergeTimelineEntries(input);
    expect(input.map((e) => e.id)).toEqual(originalOrder);
  });

  it('returns a single-source list unchanged in order when already sorted', () => {
    const merged = mergeTimelineEntries([
      audit('2026-07-03T00:00:00.000Z', 'd1'),
      audit('2026-07-02T00:00:00.000Z', 'd2'),
      audit('2026-07-01T00:00:00.000Z', 'd3'),
    ]);
    expect(merged.map((e) => e.id)).toEqual(['d1', 'd2', 'd3']);
  });
});
