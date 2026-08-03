// The timeline schema must PERSIST `metadata`, including when it is empty.
//
// Mongoose minimization deletes empty objects on the way to the database. With it on, an entry
// written with nothing to add — `applied`, `identityVerified`, `note`, every entry that is not an
// interview attempt — was stored with no `metadata` field at all, while `{ attempt: n }` survived.
// Reads are `.lean()`, which returns raw BSON and applies no schema default, so those entries came
// back as `metadata: undefined` and broke `RecruitmentTimelineEntryDto`'s `Record<string, unknown>`
// guarantee: the renderer reads `entry.metadata['attempt']` and the candidate page died on any
// applicant whose history had no interview.
//
// This asserts the document Mongoose hands the driver, which is where the field was being lost.
import { describe, expect, it } from 'vitest';
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

  it('keeps it for every entry type whose writers pass no metadata', () => {
    for (const type of ['applied', 'identityVerified', 'note', 'rejected', 'withdrawn']) {
      expect(Object.keys(entry(type, {})), `${type} lost its metadata`).toContain('metadata');
    }
  });
});
