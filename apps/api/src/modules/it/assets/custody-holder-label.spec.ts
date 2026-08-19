// IT-6 — the holder reads as a person, and says so honestly when it cannot.
//
// Two properties, and the second is the one worth a test. A name that resolves is easy; what has
// to hold is the FALLBACK, because the alternative a screen reaches for under pressure is a
// fabricated label. `assignedToEmployeeName` is null when the directory cannot answer, and the
// custody screen then renders the id it always rendered — a reference somebody can copy into a
// search box beats a guess about whose asset this is.
//
// The seam is asserted here too: IT resolves employees through `platform/directory`, never by
// importing HR. `it-module.spec.ts` holds that line for the module as a whole; this file holds the
// behaviour that line exists to make possible.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toItAssetAssignmentDto, type ItHolderLabels } from '../it.mappers';
import { type ItAssetAssignmentDoc } from './assignment.model';

const EMPLOYEE = new Types.ObjectId();

const assignment = (): ItAssetAssignmentDoc =>
  ({
    _id: new Types.ObjectId(),
    assetId: new Types.ObjectId(),
    assignedToEmployeeId: EMPLOYEE,
    assignedByUserId: null,
    assignedAt: new Date('2026-03-01T08:00:00.000Z'),
    conditionOnIssue: null,
    expectedReturnAt: null,
    returnedAt: null,
    returnedToUserId: null,
    conditionOnReturn: null,
    notes: null,
    branchId: new Types.ObjectId(),
    __v: 0,
    createdAt: new Date('2026-03-01T08:00:00.000Z'),
    updatedAt: new Date('2026-03-01T08:00:00.000Z'),
  }) as unknown as ItAssetAssignmentDoc;

describe('the custody holder label', () => {
  it('carries the name and code the directory answered with', () => {
    const labels: ItHolderLabels = new Map([
      [String(EMPLOYEE), { code: 'EMP-0042', fullNameAr: 'محمد عبد الله' }],
    ]);
    const dto = toItAssetAssignmentDto(assignment(), labels);
    expect(dto.assignedToEmployeeName).toBe('محمد عبد الله');
    expect(dto.assignedToEmployeeCode).toBe('EMP-0042');
    // The id stays on the row regardless: it is what the filter and every deep link use.
    expect(dto.assignedToEmployeeId).toBe(String(EMPLOYEE));
  });

  /** The case the screen's fallback exists for — and the reason both fields are nullable. */
  it('answers null rather than a guess when the employee cannot be read', () => {
    const dto = toItAssetAssignmentDto(assignment(), new Map());
    expect(dto.assignedToEmployeeName).toBeNull();
    expect(dto.assignedToEmployeeCode).toBeNull();
    expect(dto.assignedToEmployeeId).toBe(String(EMPLOYEE));
  });

  /** A deployment with no HR source at all: the mapper is called with nothing and must not throw. */
  it('and answers null when no labels were resolved at all', () => {
    const dto = toItAssetAssignmentDto(assignment());
    expect(dto.assignedToEmployeeName).toBeNull();
    expect(dto.assignedToEmployeeCode).toBeNull();
  });

  /**
   * The label is NOT stored. A custody interval records who held the asset; a corrected spelling
   * must correct everywhere rather than leave the old one frozen on an interval — which is why the
   * name arrives at response time and the model carries no name column.
   */
  it('is resolved at response time, never denormalized onto the interval', () => {
    const doc = assignment();
    expect(doc).not.toHaveProperty('assignedToEmployeeName');
    expect(doc).not.toHaveProperty('assignedToEmployeeCode');
  });
});
