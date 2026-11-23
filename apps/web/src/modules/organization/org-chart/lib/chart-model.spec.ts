import { describe, expect, it } from 'vitest';
import { type OrgChartDepartmentDto, type OrgChartDto, type OrgChartJobDto } from '@ecms/contracts';
import {
  columnsOf,
  dropIndex,
  isPlacedAt,
  moveTargets,
  otherPlaceLabels,
  pickDepartment,
  placesAfter,
  reorderedIds,
  sameOrder,
} from './chart-model';

const OPS = 'a'.repeat(24);
const SEC = 'b'.repeat(24);
const TREASURY = 'c'.repeat(24);
const COUNTING = 'd'.repeat(24);

const ops: OrgChartDepartmentDto = {
  key: `catalog:${OPS}`,
  departmentCatalogId: OPS,
  editable: true,
  name: { ar: 'العمليات', en: 'Operations' },
  branches: [],
  linkedBranchIds: [],
  sections: [
    {
      key: `catalog:${TREASURY}`,
      sectionCatalogId: TREASURY,
      editable: true,
      name: { ar: 'الخزينة', en: 'Treasury' },
      branches: [],
      catalogVersion: 0,
    },
    {
      key: 'name:قديم',
      sectionCatalogId: null,
      editable: false,
      name: { ar: 'قديم', en: 'Old' },
      branches: [],
      catalogVersion: null,
    },
    {
      key: `catalog:${COUNTING}`,
      sectionCatalogId: COUNTING,
      editable: true,
      name: { ar: 'العد', en: 'Counting' },
      branches: [],
      catalogVersion: 0,
    },
  ],
};
const sec: OrgChartDepartmentDto = {
  ...ops,
  key: `catalog:${SEC}`,
  departmentCatalogId: SEC,
  name: { ar: 'الأمن', en: 'Security' },
  sections: [],
};

const job = (id: string, places: OrgChartJobDto['places']): OrgChartJobDto => ({
  id,
  code: id.toUpperCase(),
  name: { ar: id, en: id },
  version: 3,
  places,
});

describe('the org chart page model (P-ORG-3)', () => {
  it('opens the asked tile, else the first', () => {
    expect(pickDepartment([ops, sec], `catalog:${SEC}`)?.key).toBe(sec.key);
    expect(pickDepartment([ops, sec], 'catalog:gone')?.key).toBe(ops.key);
    expect(pickDepartment([ops, sec], null)?.key).toBe(ops.key);
    expect(pickDepartment([], null)).toBeNull();
  });

  it('puts each job in its columns, skipping places that are not shown, and counts jobs once', () => {
    const driver = job('driver', [
      { departmentCatalogId: OPS, sectionCatalogId: null, shown: true, position: null },
      { departmentCatalogId: OPS, sectionCatalogId: TREASURY, shown: true, position: null },
      { departmentCatalogId: SEC, sectionCatalogId: null, shown: true, position: null },
    ]);
    const hidden = job('hidden', [
      { departmentCatalogId: OPS, sectionCatalogId: COUNTING, shown: false, position: null },
    ]);
    const columns = columnsOf(ops, [driver, hidden]);
    expect(columns.direct.map((j) => j.id)).toEqual(['driver']);
    expect(columns.bySection.get(TREASURY)?.map((j) => j.id)).toEqual(['driver']);
    expect(columns.bySection.get(COUNTING)).toBeUndefined();
    expect(columns.jobCount).toBe(1);
  });

  it('offers moves to «directly under» and the editable sections only', () => {
    expect(moveTargets(ops).map((t) => t.sectionCatalogId)).toEqual([null, TREASURY, COUNTING]);
  });

  it('sends the whole set after one change, keeping stopped places and merging a move onto an existing one', () => {
    const driver = job('driver', [
      { departmentCatalogId: OPS, sectionCatalogId: TREASURY, shown: true, position: null },
      { departmentCatalogId: OPS, sectionCatalogId: COUNTING, shown: true, position: null },
      { departmentCatalogId: SEC, sectionCatalogId: null, shown: false, position: null },
    ]);
    expect(
      placesAfter(driver, { kind: 'move', departmentCatalogId: OPS, from: TREASURY, to: COUNTING }),
    ).toEqual([
      { departmentCatalogId: OPS, sectionCatalogId: COUNTING },
      { departmentCatalogId: SEC, sectionCatalogId: null },
    ]);
    expect(
      placesAfter(driver, { kind: 'remove', departmentCatalogId: OPS, sectionCatalogId: TREASURY }),
    ).toHaveLength(2);
    expect(
      placesAfter(driver, { kind: 'add', departmentCatalogId: OPS, sectionCatalogId: null }),
    ).toHaveLength(4);
    expect(isPlacedAt(driver, OPS, COUNTING)).toBe(true);
    expect(isPlacedAt(driver, OPS, null)).toBe(false);
  });

  it("names a job's other places for the add dialog", () => {
    const chart: OrgChartDto = { departments: [ops, sec], jobs: [] };
    const driver = job('driver', [
      { departmentCatalogId: OPS, sectionCatalogId: TREASURY, shown: true, position: null },
      { departmentCatalogId: SEC, sectionCatalogId: null, shown: true, position: null },
    ]);
    expect(
      otherPlaceLabels(driver, chart, 'ar', { departmentCatalogId: SEC, sectionCatalogId: null }),
    ).toEqual(['العمليات › الخزينة']);
  });

  // «لما باجي أشد حاجة عشان أغير ترتيبها» (§5.7).
  it('orders a column by position, unpositioned places after, else in the chart\'s job order', () => {
    const at = (position: number | null, sectionCatalogId: string | null = null) => ({
      departmentCatalogId: OPS,
      sectionCatalogId,
      shown: true,
      position,
    });
    const senior = job('senior', [at(1), at(null, TREASURY)]);
    const manager = job('manager', [at(0), at(0, TREASURY)]);
    const consultant = job('consultant', [at(null)]);
    const analyst = job('analyst', [at(null)]);
    const columns = columnsOf(ops, [consultant, senior, analyst, manager]);
    expect(columns.direct.map((j) => j.id)).toEqual(['manager', 'senior', 'consultant', 'analyst']);
    // Each column on its own: in Treasury the manager is first, the senior unpositioned after it.
    expect(columns.bySection.get(TREASURY)?.map((j) => j.id)).toEqual(['manager', 'senior']);
  });

  it('moves a job to the index it is to have, and reads a drop above or below a row', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(reorderedIds(ids, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(reorderedIds(ids, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderedIds(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderedIds(ids, 'x', 0)).toEqual(ids);
    // Dropped on the upper half of «b» → before it; on its lower half → after it.
    expect(reorderedIds(ids, 'd', dropIndex(ids, 'd', 1, false))).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderedIds(ids, 'a', dropIndex(ids, 'a', 1, true))).toEqual(['b', 'a', 'c', 'd']);
    // Dropped on itself, either half: no change.
    expect(sameOrder(reorderedIds(ids, 'b', dropIndex(ids, 'b', 1, false)), ids)).toBe(true);
    expect(sameOrder(reorderedIds(ids, 'b', dropIndex(ids, 'b', 1, true)), ids)).toBe(true);
    // Just below the row before it, or just above the row after it: no change either.
    expect(sameOrder(reorderedIds(ids, 'b', dropIndex(ids, 'b', 0, true)), ids)).toBe(true);
    expect(sameOrder(reorderedIds(ids, 'b', dropIndex(ids, 'b', 2, false)), ids)).toBe(true);
  });
});
