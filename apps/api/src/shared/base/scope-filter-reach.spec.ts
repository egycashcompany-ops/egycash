// The clause a multi-unit reach becomes — and the two things it must never do: match nothing when a
// list is given, and widen when a list is absent.
//
// `scopeFilter` is protected, so it is read through the thinnest subclass that can call it. No
// database: the property is the shape of the filter, not what Mongo does with it.
import { describe, expect, it } from 'vitest';
import mongoose, { Schema, type Types } from 'mongoose';
import { BaseRepository } from './base.repository';
import { type ScopeSelector } from '../types';

interface Row {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
  schemaVersion: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
}

const model =
  (mongoose.models.ScopeReachSpecRow as mongoose.Model<Row> | undefined) ??
  mongoose.model<Row>('ScopeReachSpecRow', new Schema<Row>({ branchId: Schema.Types.ObjectId, departmentId: Schema.Types.ObjectId }));

class Probe extends BaseRepository<Row> {
  constructor() {
    super(model, { branchField: 'branchId', departmentField: 'departmentId' });
  }
  filterFor(selector: ScopeSelector) {
    return this.scopeFilter(selector) as Record<string, unknown>;
  }
}

const A = '650000000000000000000010';
const B = '650000000000000000000011';
const D1 = '650000000000000000000101';
const D2 = '650000000000000000000102';

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: 'u1',
  branchId: A,
  departmentId: null,
  sectionId: null,
  ...over,
});

const ids = (clause: unknown): string[] =>
  ((clause as { $in: Types.ObjectId[] }).$in ?? []).map(String);

describe('a branch reach', () => {
  it('becomes one $in over every reached branch', () => {
    const f = new Probe().filterFor(selector({ branchIds: [A, B] }));
    expect(ids(f.branchId)).toEqual([A, B]);
  });

  /** ABSENT list → the single home id, byte for byte what every pre-reach caller got. */
  it('falls back to the home branch when no list is given', () => {
    const f = new Probe().filterFor(selector({}));
    expect(String(f.branchId)).toBe(A);
  });

  it('treats an empty list as absent rather than as "match nothing"', () => {
    const f = new Probe().filterFor(selector({ branchIds: [] }));
    expect(String(f.branchId)).toBe(A);
  });
});

describe('a department reach', () => {
  it('becomes one $in over every branch copy of the department', () => {
    const f = new Probe().filterFor(selector({ scope: 'department', departmentIds: [D1, D2] }));
    expect(ids(f.departmentId)).toEqual([D1, D2]);
  });

  /** A whole branch beside department copies is the OR of the two units (Gap 1) — never an AND. */
  it('reads a whole branch and department copies as separate units, OR-ed', () => {
    const f = new Probe().filterFor(
      selector({ scope: 'branch', departmentIds: [D1, D2], branchIds: [B] }),
    ) as { $or?: Record<string, unknown>[] };
    expect(f.$or).toHaveLength(2);
    expect(ids(f.$or?.[0]?.branchId)).toEqual([B]);
    expect(ids(f.$or?.[1]?.departmentId)).toEqual([D1, D2]);
  });

  it('falls back to the home department when no list is given', () => {
    const f = new Probe().filterFor(selector({ scope: 'department', departmentId: D1 }));
    expect(String(f.departmentId)).toBe(D1);
  });
});
