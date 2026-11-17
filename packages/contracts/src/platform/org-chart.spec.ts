import { describe, expect, it } from 'vitest';
import {
  AddChartSectionSchema,
  JobPlaceInputSchema,
  JobPlacesInputSchema,
  RenameChartSectionSchema,
  StopChartSectionSchema,
} from './org-chart.js';

const id = (n: number): string => n.toString(16).padStart(24, '0');
const name = { ar: 'الخزينة', en: 'Treasury' };

describe('org chart contracts (P-ORG-3)', () => {
  it('a job place names a department entry, and a section entry or none', () => {
    expect(JobPlaceInputSchema.safeParse({ departmentCatalogId: id(1), sectionCatalogId: null }).success).toBe(true);
    expect(JobPlaceInputSchema.safeParse({ departmentCatalogId: id(1), sectionCatalogId: id(2) }).success).toBe(true);
    // The section is stated, never implied: «directly under the department» is an explicit null.
    expect(JobPlaceInputSchema.safeParse({ departmentCatalogId: id(1) }).success).toBe(false);
    expect(JobPlaceInputSchema.safeParse({ departmentCatalogId: 'x', sectionCatalogId: null }).success).toBe(false);
    expect(
      JobPlaceInputSchema.safeParse({ departmentCatalogId: id(1), sectionCatalogId: null, headcount: 3 }).success,
    ).toBe(false);
  });

  it('a set of places is capped at 50, and duplicates pass to the server, which merges them', () => {
    const place = { departmentCatalogId: id(1), sectionCatalogId: null };
    expect(JobPlacesInputSchema.safeParse([place, place]).success).toBe(true);
    expect(JobPlacesInputSchema.safeParse(Array.from({ length: 51 }, () => place)).success).toBe(false);
  });

  it('a section is added in at least one branch, each once', () => {
    const base = { departmentCatalogId: id(1), name };
    expect(AddChartSectionSchema.safeParse({ ...base, branchIds: [id(5)] }).success).toBe(true);
    expect(AddChartSectionSchema.safeParse({ ...base, branchIds: [] }).success).toBe(false);
    expect(AddChartSectionSchema.safeParse({ ...base, branchIds: [id(5), id(5)] }).success).toBe(false);
    expect(AddChartSectionSchema.safeParse({ ...base, branchIds: [id(5)], name: { ar: 'الخزينة', en: '' } }).success).toBe(
      false,
    );
  });

  it('rename and stop carry the section entry version', () => {
    expect(RenameChartSectionSchema.safeParse({ name, version: 0 }).success).toBe(true);
    expect(RenameChartSectionSchema.safeParse({ name }).success).toBe(false);
    expect(StopChartSectionSchema.safeParse({ version: 3 }).success).toBe(true);
    expect(StopChartSectionSchema.safeParse({}).success).toBe(false);
  });
});
