// D8 — a record says what it said, forever.
//
// THE WHOLE POINT OF THIS MODULE is a sentence somebody needs years later: «Ahmed completed
// defensive driving on 5 March 2026.» That sentence has to survive the course being renamed, the
// trainer leaving and the session being deleted — so the record COPIES every name it shows instead
// of pointing at one, and nothing may edit those copies afterwards.
//
// NOTHING ELSE HOLDS THIS. Mongoose will happily `$set` any field; TypeScript sees a document with
// writable properties; and a well-meaning "fix the typo in the course name" would rewrite history
// on every certificate ever issued from that course. So it is held here, by source.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** CODE ONLY — these files explain the immutability at length, in words a matcher would trip on. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const SERVICE = code('training-record.service.ts');
const MODEL = code('training-record.model.ts');

/** What the record SAYS. None of it may be written after creation. */
const FROZEN = [
  'employeeCode',
  'employeeName',
  'courseKey',
  'courseNameAr',
  'courseNameEn',
  'sessionCode',
  'trainerName',
  'startedAt',
  'completedAt',
] as const;

describe('a record copies what it says rather than pointing at it (D8)', () => {
  it.each(FROZEN)('stores its own %s', (field) => {
    expect(MODEL).toContain(`${field}:`);
  });

  /**
   * The ids are kept so somebody can still TRACE the row — but nothing the record shows depends on
   * them resolving, which is the difference between a reference and a receipt.
   */
  it('keeps the ids as well, for tracing rather than for reading', () => {
    expect(MODEL).toContain('courseId: Types.ObjectId;');
    expect(MODEL).toContain('sessionId: Types.ObjectId;');
  });
});

/**
 * The FIELDS the one update writes — the `$set` object and nothing around it.
 *
 * Slicing the whole `attachCertificate` method was the obvious way and it is wrong: the event it
 * emits afterwards carries `courseKey` and `sessionCode` in its payload, which read as writes to a
 * matcher and are not. The assertion is about what reaches the database, so it is made against the
 * argument that reaches the database.
 */
const updateSet = (): string => {
  const method = SERVICE.slice(SERVICE.indexOf('async attachCertificate'));
  const from = method.indexOf('trainingRecordRepository.updateById');
  return method.slice(from, method.indexOf('{ by: ctx.userId', from));
};

describe('and nothing edits what it says', () => {
  /**
   * The service has exactly ONE update path — `attachCertificate` — and it touches three fields.
   * Counting the calls is what makes this an assertion rather than a hope: a second one would pass
   * a «does not update the name» check while quietly being able to.
   */
  it('updates a record in exactly one place', () => {
    const updates = SERVICE.split('trainingRecordRepository.updateById').length - 1;
    expect(updates).toBe(1);
  });

  it.each(FROZEN)('never writes %s after creation', (field) => {
    expect(updateSet()).not.toContain(`${field}:`);
  });

  it('the one update writes only the certificate and its expiry', () => {
    const set = updateSet();
    expect(set).toContain('certificateFileId:');
    expect(set).toContain('certificateFileName:');
    expect(set).toContain('expiresAt:');
  });
});

/**
 * D7 — PRESENCE IS NOT QUALIFICATION, asserted where it could most easily be lost.
 *
 * The tempting shortcut is one line: complete everybody marked `attended`. It would pass every
 * other test in this repository, and it would be the system inventing an assessment rule nobody
 * gave it — issuing certificates as a claim the company makes about a person on no evidence.
 */
describe('completion is named, not derived (D7)', () => {
  it('writes records for the enrollments the caller named', () => {
    expect(SERVICE).toContain('input.completing');
  });

  it('never selects who completed by their attendance', () => {
    const complete = SERVICE.slice(SERVICE.indexOf('async complete'), SERVICE.indexOf('async list'));
    // No query or filter that gathers the attendees and turns them into records.
    expect(complete).not.toMatch(/status:\s*'attended'/);
    expect(complete).not.toMatch(/listFiltered\(/);
    expect(complete).not.toMatch(/filter\(\s*\(?\w+\)?\s*=>\s*\w+\.status === 'attended'/);
  });

  /** But an empty chair cannot be qualified: the DECISION is the caller's, the FACTS are not. */
  it('refuses to complete somebody who was absent', () => {
    expect(SERVICE).toContain("seat.status === 'absent'");
  });

  /** And marking the room writes no record — that is the line D7 draws. */
  it('marking attendance creates nothing', () => {
    const mark = SERVICE.slice(
      SERVICE.indexOf('async markAttendance'),
      SERVICE.indexOf('async markAttendanceBulk'),
    );
    expect(mark).not.toContain('trainingRecordRepository');
  });
});

/**
 * D10 — an expiry is recorded and gates nothing.
 *
 * The machinery that would ACT on one is what must not appear: a sweep, a scheduled job, a
 * notification over expiring certificates would all be enforcing a safety rule nobody has given.
 */
describe('an expiry is recorded and consumed by nothing (D10)', () => {
  it('stores it', () => {
    expect(MODEL).toContain('expiresAt: Date | null;');
  });

  it('and nothing here sweeps, schedules or warns on it', () => {
    for (const forbidden of ['registerJob', 'scheduleJob', 'cron', 'sweep', 'expiring']) {
      expect(SERVICE, forbidden).not.toContain(forbidden);
    }
    // No read filters on it either — a query by expiry is the first half of a compliance report.
    expect(SERVICE).not.toMatch(/expiresAt:\s*\{/);
  });
});
