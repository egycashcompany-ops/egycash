// Who the IT employee box finds — «لما يعمل بحث او يضيف حاجه او اى حاجه يختار اسم الموظف يظهرله
// اسم الموظف من الاتش ار كل المواظفين سواء اللى مشى او اللى موجود لكن فى حاله الاضافه اللى موجود
// بس».
//
// Two populations, one box:
//   • a SEARCH — the custody register's holder filter — finds everyone HR has, leavers included;
//   • a HAND-OVER — assign, transfer — finds the people who work here today, and nobody else.
//
// The first half is proven against the request that actually leaves the browser. The second half
// is source-level, because that is the shape of the rule: a hand-over box that quietly starts
// offering leavers renders perfectly well, and nothing but the owner noticing would catch it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ItApiModule from './api/it-api';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped: a rule about the code must not be satisfied — or broken — by prose. */
const code = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('the employee search sent to HR', () => {
  let api: typeof ItApiModule;
  const asked: URL[] = [];

  beforeEach(async () => {
    asked.length = 0;
    vi.resetModules();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      asked.push(new URL(String(input)));
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    api = await import('./api/it-api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the employed only by default — a hand-over never offers a leaver', async () => {
    await api.searchEmployees('مصطفى');

    expect(asked).toHaveLength(1);
    expect(asked[0]?.pathname).toMatch(/\/hr\/employees$/u);
    expect(asked[0]?.searchParams.get('search')).toBe('مصطفى');
    expect(asked[0]?.searchParams.get('employed')).toBe('true');
  });

  it('drops the filter for a search, so HR answers with every status, leavers included', async () => {
    await api.searchEmployees('مصطفى', { includeExited: true });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('search')).toBe('مصطفى');
    // Absent, not `false`: `employed` narrows the list whatever its value, and only its absence
    // means every status.
    expect(asked[0]?.searchParams.has('employed')).toBe(false);
  });
});

describe('which box asks for which population', () => {
  it('the custody register’s holder filter — a search — finds leavers too', () => {
    const page = code('pages/CustodyPage.tsx');
    expect(page).toMatch(/<EmployeePicker\s+includeExited\b/u);
  });

  it('assign and transfer — hand-overs — never ask for them', () => {
    const dialogs = code('components/CustodyDialogs.tsx');
    expect(dialogs.match(/<EmployeePicker\b/gu)).toHaveLength(2);
    expect(dialogs).not.toContain('includeExited');
  });

  it('a box that does not choose gets the hand-over population', () => {
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain('includeExited = false');
  });

  it('keeps the two answers apart in the cache', () => {
    // Typed with the same letters, the two boxes must not share one cached answer — or a
    // hand-over box would be served the search's leavers for the next thirty seconds.
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain("listKey('it', 'employeeSearch', { search, includeExited })");
    expect(picker).toContain('api.searchEmployees(search, { includeExited })');
  });

  it('marks a leaver in the results, so a search tells them apart', () => {
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain("employee.status === 'exited'");
    expect(picker).toContain("t('it.custody.pickerExited')");
  });
});
