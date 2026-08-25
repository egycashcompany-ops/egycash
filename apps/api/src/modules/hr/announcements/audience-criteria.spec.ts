// Who a company-wide message reaches, decided without a database.
//
// This is the file to be paranoid in. Everything else in an announcement is recoverable — a typo
// in the body is embarrassing, a wrong priority is noise — but the audience is the one field whose
// mistake cannot be taken back once the notifications exist. Two shapes of that mistake:
//
//   • REACHING SOMEBODY WHO SHOULD NOT BE REACHED. A login outlives an exit, so an audience that
//     forgets to exclude ended employments announces the company's internal business to people who
//     left. The employed statuses are the default for exactly that reason.
//
//   • REACHING MORE PEOPLE THAN WERE ASKED FOR. Criteria have to AND. Written as an OR by
//     accident — a plausible slip, since each criterion is itself a list — "the drivers in Maadi"
//     becomes "every driver, and everybody in Maadi", which for one branch's message is the whole
//     company.
import { describe, expect, it } from 'vitest';
import { EMPLOYED_STATUSES, type AnnouncementAudience } from '@ecms/contracts';
import { Types } from 'mongoose';
import {
  audienceCriteria,
  filterCriteria,
  recipientUserIds,
  splitReachable,
  statusCriterion,
} from './audience-criteria';

/** A valid 24-char hex id. 'u1'/'b1' are NOT hex, and BSON refuses them — as it should. */
const id = (n: number): string => n.toString(16).padStart(24, '0');
const BRANCH = id(0xb1);
const DEPT = id(0xd1);

/** The `$and` clauses of a criteria object, whatever shape it came out as. */
const clauses = (criteria: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(criteria.$and) ? (criteria.$and as Record<string, unknown>[]) : [criteria];

describe('who is excluded unless asked for by name', () => {
  it('leaves out ended employments by default', () => {
    // The exact leak: they still have a login, so "everyone" would otherwise include them.
    const statuses = statusCriterion(undefined).status as { $in: string[] };
    expect(statuses.$in).toEqual([...EMPLOYED_STATUSES]);
    expect(statuses.$in).not.toContain('exited');
  });

  it('and does the same for a filter that names no status', () => {
    const statuses = (filterCriteria({ branchIds: [BRANCH] }).$and as Record<string, unknown>[])
      .map((clause) => clause.status as { $in: string[] } | undefined)
      .find((clause) => clause !== undefined);
    expect(statuses?.$in).not.toContain('exited');
  });

  it('but honours a status the sender typed, including exited', () => {
    // Deliberate and occasionally right — a final payslip notice goes to somebody who has left.
    expect(statusCriterion(['exited']).status).toEqual({ $in: ['exited'] });
  });

  it('does not impose the default on a hand-picked list', () => {
    // Naming somebody IS the intent. A filter is a description and can be wrong by accident; a
    // list of ids cannot be.
    const criteria = audienceCriteria({ kind: 'employees', employeeIds: [id(0xe1), id(0xe2)] });
    expect(criteria.status).toBeUndefined();
    expect((criteria._id as { $in: Types.ObjectId[] }).$in).toHaveLength(2);
  });
});

describe('criteria narrow each other rather than widening', () => {
  const audience: AnnouncementAudience = {
    kind: 'filter',
    filter: { branchIds: [BRANCH], departmentIds: [DEPT] },
  };

  it('ANDs two criteria — the drivers IN Maadi, not every driver AND everybody in Maadi', () => {
    const criteria = audienceCriteria(audience);
    expect(Array.isArray(criteria.$and)).toBe(true);
    // The one thing that must never appear at the top: a union of the criteria.
    expect(criteria.$or).toBeUndefined();
  });

  it('ORs the values WITHIN one criterion', () => {
    const branch = clauses(filterCriteria({ branchIds: [BRANCH, id(0xb2)] })).find(
      (clause) => clause.branchId !== undefined,
    );
    expect((branch?.branchId as { $in: unknown[] }).$in).toHaveLength(2);
  });

  it('carries every criterion it was given, and no more', () => {
    const criteria = filterCriteria({
      branchIds: [BRANCH],
      jobTitleIds: [id(0x71)],
      genders: ['male'],
      religions: ['مسلم'],
    });
    const fields = clauses(criteria).flatMap((clause) => Object.keys(clause));
    expect(fields.sort()).toEqual(
      ['branchId', 'employment.jobTitleId', 'personal.gender', 'personal.religion', 'status'].sort(),
    );
  });

  it('ignores a criterion present but empty rather than matching nothing', () => {
    // `{$in: []}` matches no document at all — a filter that silently sends to nobody is as wrong
    // as one that sends to everybody, and harder to notice.
    const fields = clauses(filterCriteria({ branchIds: [] })).flatMap((c) => Object.keys(c));
    expect(fields).toEqual(['status']);
  });
});

describe('ids are cast, or they match nothing at all', () => {
  it('turns id criteria into ObjectIds', () => {
    // A string id against an ObjectId field matches zero documents, and the send looks like a
    // filter that was simply too narrow.
    const branch = clauses(filterCriteria({ branchIds: [BRANCH] })).find((c) => c.branchId !== undefined);
    const [value] = (branch?.branchId as { $in: unknown[] }).$in;
    expect(value).toBeInstanceOf(Types.ObjectId);
  });

  it('leaves plain-text criteria as text', () => {
    const religion = clauses(filterCriteria({ religions: ['مسلم'] })).find(
      (c) => c['personal.religion'] !== undefined,
    );
    expect((religion?.['personal.religion'] as { $in: unknown[] }).$in).toEqual(['مسلم']);
  });
});

describe('an audience is chosen in employees and delivered to logins', () => {
  const employees = [
    { userId: new Types.ObjectId(id(0xa1)) },
    { userId: null },
    { userId: new Types.ObjectId(id(0xa2)) },
    { userId: undefined },
  ];

  it('counts the ones who cannot be reached at all', () => {
    // A company of 300 with 180 accounts reaches 180 people. A sender told only "sent to everyone"
    // is wrong about their own announcement and nothing corrects them.
    const { recipients, unreachable } = splitReachable(employees);
    expect(recipients).toHaveLength(2);
    expect(unreachable).toBe(2);
  });

  it('sends one notification per person, however they were matched', () => {
    const twice = [...employees, { userId: new Types.ObjectId(id(0xa1)) }];
    expect(recipientUserIds(twice)).toHaveLength(2);
  });
});

describe('everyone is its own audience', () => {
  it('resolves to the employed, with no other criterion', () => {
    const criteria = audienceCriteria({ kind: 'everyone' });
    expect(Object.keys(criteria)).toEqual(['status']);
    expect((criteria.status as { $in: string[] }).$in).toEqual([...EMPLOYED_STATUSES]);
  });
});
