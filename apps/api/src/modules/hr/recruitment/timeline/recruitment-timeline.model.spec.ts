// The timeline schema must PERSIST `metadata`, including when it is empty.
//
// Mongoose minimization deletes empty objects on the way to the database. With it on, an entry
// written with nothing to add was stored with no `metadata` field at all, while `{ attempt: n }`
// survived. Reads are `.lean()`, which returns raw BSON and applies no schema default, so those
// entries came back as `metadata: undefined` and broke `RecruitmentTimelineEntryDto`'s
// `Record<string, unknown>` guarantee: the renderer reads `entry.metadata['attempt']` and the
// candidate page died on any applicant whose history had no interview.
//
// Two writers pass no metadata today (`identityVerified`, `note`), but the assertion below is
// deliberately per-TYPE rather than per-writer: the DTO promises the field for every entry, so the
// schema must keep it for any type, whatever a future writer chooses to pass.
//
// This asserts the document Mongoose hands the driver, which is where the field was being lost.
import { describe, expect, it } from 'vitest';
import { RECRUITMENT_TIMELINE_TYPES } from '@ecms/contracts';
import { RecruitmentTimelineModel } from './recruitment-timeline.model';

const entry = (type: string, metadata: Record<string, unknown>) =>
  new RecruitmentTimelineModel({
    eventId: `evt-${type}`,
    applicantId: '64b1f0aaaaaaaaaaaaaaaa01',
    applicantCode: 'APP-0001',
    at: new Date(),
    actorUserId: null,
    actorName: '',
    type,
    correlationType: 'applicant',
    correlationId: 'corr-1',
    sourceKey: `key-${type}`,
    metadata,
  }).toObject();

describe('recruitment timeline schema — metadata durability', () => {
  it('keeps an EMPTY metadata object on an entry that carries no extra facts', () => {
    const doc = entry('identityVerified', {});
    expect(Object.keys(doc)).toContain('metadata');
    expect(doc.metadata).toEqual({});
  });

  it('keeps metadata on the entry types that populate it', () => {
    expect(entry('interviewScheduled', { attempt: 2 }).metadata).toEqual({ attempt: 2 });
  });

  it('keeps it for EVERY entry type in the vocabulary, not just the two that need it today', () => {
    for (const type of RECRUITMENT_TIMELINE_TYPES) {
      expect(Object.keys(entry(type, {})), `${type} lost its metadata`).toContain('metadata');
    }
  });
});
