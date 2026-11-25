// Who the keeper box finds (design §7.8, OD-10 A; IT's `it-employee-picker.spec.ts` shape): the
// people who work here today, through the module's OWN endpoint under its own keys — never HR's
// list under `employee.view`, never IT's — and opened by exactly the keys that endpoint admits.
//
// The first half is proven against the request that actually leaves the browser; the second is
// source-level, because that is the shape of the rule: a box that quietly starts asking another
// module's people renders perfectly well.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PeopleApiModule from './api/people-api';
import { ADMINISTRATION_PEOPLE_GRANTS, pickerLabel } from './components/EmployeePicker';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Source with comments stripped: a rule about the code must not be satisfied — or broken — by prose. */
const code = (rel: string): string =>
  readFileSync(join(HERE, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

describe('the keeper search — the module’s own endpoint, the employed only', () => {
  let api: typeof PeopleApiModule;
  const asked: URL[] = [];

  beforeEach(async () => {
    asked.length = 0;
    vi.resetModules();
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      asked.push(new URL(String(input)));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: [],
            meta: { page: 1, pageSize: 8, totalItems: 0, totalPages: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    api = await import('./api/people-api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks `/administration/people` for what was typed and a page of eight — and no status', async () => {
    await api.searchPeople('سامح');

    expect(asked).toHaveLength(1);
    // The module's endpoint under its own keys: HR's `/hr/employees` would demand `employee.view`,
    // the whole HR file, of a storekeeper who only needs a name.
    expect(asked[0]?.pathname).toMatch(/\/administration\/people$/u);
    expect(asked[0]?.searchParams.get('search')).toBe('سامح');
    expect(asked[0]?.searchParams.get('pageSize')).toBe('8');
    // The endpoint offers the employed only and takes no status: a keeper is never a leaver.
    expect([...(asked[0]?.searchParams.keys() ?? [])].sort()).toEqual(['pageSize', 'search']);
  });
});

describe('who may open the box', () => {
  it('is exactly who the endpoint admits — the warehouse write keys, as the server lists them', () => {
    const server = readFileSync(
      resolve(HERE, '../../../../api/src/modules/administration/people/people.service.ts'),
      'utf8',
    );
    const block = /ADMINISTRATION_PEOPLE_GRANTS[^=]*= \[([^\]]*)\]/u.exec(server)?.[1] ?? '';
    const keys = [...block.matchAll(/'([^']+)'/gu)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect([...ADMINISTRATION_PEOPLE_GRANTS].sort()).toEqual([...keys].sort());
  });

  it('says so to anybody else rather than searching into a 403', () => {
    const picker = code('components/EmployeePicker.tsx');
    expect(picker).toContain('if (!allowed)');
    expect(picker).toContain("t('administration.people.noAccess')");
    expect(picker).toContain('usePeopleSearch(search, allowed)');
  });

  it('labels a pick with the name and the code, as the chip and the register show it', () => {
    expect(pickerLabel({ fullNameAr: 'سامح عادل منير', code: '0100052' })).toBe(
      'سامح عادل منير (0100052)',
    );
  });
});

/** Every module source file, relative to the module. */
const sources = (dir = HERE): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/u.test(entry.name) &&
      !entry.name.includes('.spec.') &&
      !entry.name.includes('fixtures')
      ? [relative(HERE, full)]
      : [];
  });

describe('the people the module names', () => {
  it('are read through the module’s people endpoint alone — never another module’s', () => {
    for (const file of sources()) {
      const source = code(file);
      expect(source, file).not.toMatch(/\/hr\/employees|\/it\/people|modules\/(?:hr|it)\//u);
    }
    expect(code('api/people-api.ts')).toContain('/administration/people');
  });

  it('are named as a keeper in the warehouse form only — the one place Phase 1 names a person', () => {
    const users = sources().filter((file) => /<EmployeePicker\b/u.test(code(file)));
    expect(users).toEqual(['components/WarehouseFormDialog.tsx']);
  });
});
