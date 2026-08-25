// The HR sidebar's information architecture, checked against the navigation catalog itself.
//
// The two files have to agree and nothing makes them: the navigation seed decides which HR pages
// EXIST as rows, and this file decides which group each one lands in. A route that drifts out of
// step does not break a build or fail a request — it produces a page that renders directly under
// the module while its siblings sit in groups, or a section that quietly names a row nobody has.
//
// So both are read as SOURCE and compared. Parsing is asserted before it is trusted (the counts
// below): a regex that silently matched nothing would otherwise make every assertion here pass on
// an empty set and prove the opposite of what it claims.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

/** The HR block of the navigation catalog — from its category name to the next category's. */
const hrCatalog = (): string => {
  const source = read('./seed-navigation.ts');
  const start = source.indexOf("en: 'HR',");
  const end = source.indexOf("en: 'Fleet',", start);
  expect(start, 'HR category').toBeGreaterThan(-1);
  expect(end, 'Fleet category (the HR block ends there)').toBeGreaterThan(start);
  return source.slice(start, end);
};

/** Every route the HR module publishes as a navigation row. */
const NAV_ROUTES = [...hrCatalog().matchAll(/route: '([^']+)'/g)].map((m) => m[1] as string);

interface ParsedSection {
  en: string;
  ar: string;
  routes: string[];
  regroupFrom: string[];
}

/** The HR section definitions, one parsed block per section. */
const sections = (): ParsedSection[] => {
  const source = read('./seed-application-sections.ts');
  const start = source.indexOf('HR: [');
  expect(start, 'the HR defaults').toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf('\n};', start));
  // Each section is `{ en: … ar: … routes: [ … ] }` — split on the `en:` that opens one.
  return [...block.matchAll(/en: '([^']+)',\s*\n\s*ar: '([^']+)',([\s\S]*?)(?=\n {4}\{|\n {2}\],)/g)].map(
    (m) => {
      const body = m[3] as string;
      const routesBlock = body.slice(body.indexOf('routes: ['));
      const regroupAt = body.indexOf('regroupFrom: [');
      return {
        en: m[1] as string,
        ar: m[2] as string,
        routes: [...routesBlock.matchAll(/'(\/[^']*)'/g)].map((r) => r[1] as string),
        regroupFrom:
          regroupAt === -1
            ? []
            : [...body.slice(regroupAt).matchAll(/'([^'/][^']*)'/g)].map((r) => r[1] as string),
      };
    },
  );
};

const HR_SECTIONS = sections();
const GROUPED = HR_SECTIONS.flatMap((s) => s.routes);

describe('the parse itself', () => {
  // Guards every assertion below: an empty set satisfies "no duplicates" and "all covered".
  it('found the navigation rows and the sections', () => {
    expect(NAV_ROUTES.length).toBeGreaterThan(15);
    expect(HR_SECTIONS.length).toBe(6);
    expect(HR_SECTIONS.map((s) => s.en)).toEqual([
      'Communication',
      'Recruitment',
      'Employees',
      'Employee File',
      'Attendance & Leave',
      'Payroll',
    ]);
  });
});

describe('every HR page has exactly one home', () => {
  it('no navigation row is left out of a group', () => {
    expect(NAV_ROUTES.filter((route) => !GROUPED.includes(route))).toEqual([]);
  });

  // The failure this prevents is a page appearing twice in one sidebar — which is what the split
  // of "Employee Management" could most easily have caused.
  it('and none is in two groups at once', () => {
    const seen = new Set<string>();
    const twice = GROUPED.filter((route) => (seen.has(route) ? true : (seen.add(route), false)));
    expect(twice).toEqual([]);
  });

  // A section naming a route that has no row is a heading waiting for a page that never comes.
  it('and no group names a page that does not exist', () => {
    expect(GROUPED.filter((route) => !NAV_ROUTES.includes(route))).toEqual([]);
  });
});

describe('the groups themselves', () => {
  it('are distinct, and named in both locales', () => {
    expect(new Set(HR_SECTIONS.map((s) => s.en)).size).toBe(HR_SECTIONS.length);
    expect(new Set(HR_SECTIONS.map((s) => s.ar)).size).toBe(HR_SECTIONS.length);
    for (const section of HR_SECTIONS) {
      expect(section.ar.trim(), section.en).not.toBe('');
      expect(section.routes.length, section.en).toBeGreaterThan(0);
    }
  });

  /**
   * `regroupFrom` may only name a group that no longer exists.
   *
   * It is the one place this file is allowed to move a row that is already grouped, so its source
   * must be historical. Naming a LIVE section would let two defaults fight over the same rows,
   * with the winner decided by array order.
   */
  it('only reclaim rows from a group this file no longer defines', () => {
    const live = new Set(HR_SECTIONS.map((s) => s.en));
    for (const section of HR_SECTIONS) {
      for (const source of section.regroupFrom) {
        expect(live.has(source), `${section.en} ← ${source}`).toBe(false);
      }
    }
  });

  // The split this phase performs: the two halves of the old group name it as their source, so an
  // install that already has "Employee Management" is actually reorganized rather than left with
  // two empty headings.
  it('the split of Employee Management names it on both halves', () => {
    for (const name of ['Employees', 'Employee File']) {
      const section = HR_SECTIONS.find((s) => s.en === name);
      expect(section?.regroupFrom, name).toEqual(['Employee Management']);
    }
  });
});

/**
 * The lifecycle boundary the grouping exists to draw: a candidate is not an employee.
 *
 * These are the placements that were argued from the code rather than from the shape of the words
 * — so they are the ones worth pinning, because the argument lives in a comment and a comment
 * cannot fail.
 */
describe('candidate and employee do not mix', () => {
  const routesOf = (en: string): string[] => HR_SECTIONS.find((s) => s.en === en)?.routes ?? [];

  it('recruitment holds the candidate pipeline, and only that', () => {
    expect(routesOf('Recruitment')).toEqual([
      '/applicants',
      '/screening',
      '/interviews',
      '/interviews/stages',
      '/evaluations',
      '/evaluations/phases',
      '/job-offers',
      '/applicant-sources',
      '/recruitment-form',
    ]);
  });

  // `hiring-documents.service.ts`: the set is collected "after an employee is created (Stage 5)".
  // Its subject is an employee, so it is filed with the employee.
  it('hiring documents belong to the employee, not the candidate', () => {
    expect(routesOf('Employees')).toContain('/hiring-documents');
    expect(routesOf('Recruitment')).not.toContain('/hiring-documents');
  });

  it('the record that follows the employee is its own group', () => {
    expect(routesOf('Employee File')).toEqual(['/employee-files', '/contracts']);
  });
});
