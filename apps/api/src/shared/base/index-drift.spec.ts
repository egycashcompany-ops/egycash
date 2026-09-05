// The decision behind dropping a live index, which is the only irreversible thing the reconciler
// does. Pinned here are the three real drifts that reached production, and the two ways the
// reconciler could do harm: dropping something the schema never declared, and rebuilding an index
// that is already right.
import { describe, expect, it } from 'vitest';
import { findDrift, type IndexShape } from './index-drift';

const ID: IndexShape = { name: '_id_', key: { _id: 1 } };

describe('finding index drift', () => {
  /** hr_employees.ux_offer — the go-live outage: declared partial, live plain-unique. */
  it('flags a unique index the schema has since made partial', () => {
    const declared: IndexShape[] = [
      {
        name: 'ux_offer',
        key: { jobOfferId: 1 },
        unique: true,
        partialFilterExpression: { jobOfferId: { $type: 'objectId' }, isDeleted: false },
      },
    ];
    const live: IndexShape[] = [ID, { name: 'ux_offer', key: { jobOfferId: 1 }, unique: true }];
    expect(findDrift(declared, live)).toMatchObject([{ drop: 'ux_offer', declared: 'ux_offer' }]);
  });

  /**
   * The rename case, which matching by name alone walks straight past: an index built before the
   * schema named it carries Mongo's default `employeeNumber_1`. It must be matched by key shape.
   */
  it('finds a live index under Mongo’s default name when the schema names it differently', () => {
    const declared: IndexShape[] = [{ name: 'ix_employeeNumber', key: { employeeNumber: 1 } }];
    const live: IndexShape[] = [ID, { name: 'employeeNumber_1', key: { employeeNumber: 1 }, unique: true }];
    expect(findDrift(declared, live)).toMatchObject([
      { drop: 'employeeNumber_1', declared: 'ix_employeeNumber' },
    ]);
  });

  /** Idempotence: a second boot must find nothing. */
  it('reports nothing when the live index already matches', () => {
    const shape: IndexShape = {
      name: 'ux_offer',
      key: { jobOfferId: 1 },
      unique: true,
      partialFilterExpression: { jobOfferId: { $type: 'objectId' }, isDeleted: false },
    };
    expect(findDrift([shape], [ID, shape])).toEqual([]);
  });

  /** Same filter, different key order inside it — still the same filter. */
  it('treats a partial filter with reordered keys as equal', () => {
    const declared: IndexShape[] = [
      { name: 'ux', key: { a: 1 }, unique: true, partialFilterExpression: { x: 1, y: { $type: 'string' } } },
    ];
    const live: IndexShape[] = [
      { name: 'ux', key: { a: 1 }, unique: true, partialFilterExpression: { y: { $type: 'string' }, x: 1 } },
    ];
    expect(findDrift(declared, live)).toEqual([]);
  });

  /**
   * THE HARM IT MUST NOT DO. A live index the schema never declared is somebody's decision on a
   * production database — a hand-built one for a report, say — and is not drift.
   */
  it('never touches a live index the schema does not declare', () => {
    const declared: IndexShape[] = [{ name: 'ix_a', key: { a: 1 } }];
    const live: IndexShape[] = [ID, { name: 'ix_a', key: { a: 1 } }, { name: 'ix_handmade', key: { z: 1 }, unique: true }];
    expect(findDrift(declared, live)).toEqual([]);
  });

  /** A missing index is not drift — `createIndexes` simply builds it. */
  it('reports nothing for a declared index that does not exist yet', () => {
    const declared: IndexShape[] = [{ name: 'ux_new', key: { n: 1 }, unique: true }];
    expect(findDrift(declared, [ID])).toEqual([]);
  });

  /** Compound key ORDER is significant; {a,b} and {b,a} are different indexes, not a match. */
  it('does not match a compound index whose key order differs', () => {
    const declared: IndexShape[] = [{ name: 'ix_ab', key: { a: 1, b: 1 }, unique: true }];
    const live: IndexShape[] = [ID, { name: 'ix_ba', key: { b: 1, a: 1 } }];
    expect(findDrift(declared, live)).toEqual([]);
  });

  it('flags an index the schema made unique that the database holds as plain', () => {
    const declared: IndexShape[] = [{ name: 'ux_code', key: { code: 1 }, unique: true }];
    const live: IndexShape[] = [ID, { name: 'ux_code', key: { code: 1 } }];
    expect(findDrift(declared, live)).toHaveLength(1);
  });
});
