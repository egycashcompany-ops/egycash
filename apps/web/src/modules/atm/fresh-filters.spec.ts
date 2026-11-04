// The area's list starts over each time it opens, on every ATM table that has an area column
// (2026-11-03): «عايز كمان فى الفلتر الكبير اللى فوق الجدول لما أضغط على فلتر (المنطقة فقط) يعمله
// Reset وأقدر أختار من الأول في كل الصفحات بتاعت ATM».
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRESH_ON_OPEN } from './lib/fresh-filters';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), 'utf8');

describe('the area’s list starts over', () => {
  it('is the area only — every other column keeps its picks while its list opens', () => {
    expect(FRESH_ON_OPEN).toEqual(['area']);
  });

  it.each([
    'pages/ReplenishmentsPage.tsx',
    'pages/MaintenancePage.tsx',
    'pages/ReplenishmentsDonePage.tsx',
    'pages/MaintenanceDonePage.tsx',
    'pages/MailTicketsPage.tsx',
    'pages/MailLogPage.tsx',
    'pages/CassetteLayoutsPage.tsx',
  ])('on %s', (page) => {
    expect(read(page)).toContain('freshOnOpen: FRESH_ON_OPEN,');
  });

  it('on control’s data tab, a table built by hand', () => {
    expect(read('components/settlements/ControlDataTab.tsx')).toContain(
      'freshOnOpen={FRESH_ON_OPEN.includes(column.key)}',
    );
  });

  it('and the shared table hands the rule to the column’s list', () => {
    expect(read('../../shared/ui/DataTable.tsx')).toContain(
      'freshOnOpen={columnFilters.freshOnOpen?.includes(c.key) === true}',
    );
  });
});
