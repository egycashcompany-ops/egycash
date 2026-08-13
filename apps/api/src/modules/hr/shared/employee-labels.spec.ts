// One implementation of "whose row is this?", and it is never stored (P-HR-06 / D7).
//
// The helper arrived with AT-6 inside `attendance/`. When the adjustments queue needed the same
// two fields, copying it would have been the path of least resistance — and eslint's §15.1 seam
// makes the copy almost inevitable, since payroll may not import attendance at all. Two copies of
// a display rule drift the moment one of them learns about a preferred name or a locale.
//
// So the file moved to `shared/` and BOTH sides reach the same one. These assertions read the
// sources, because "there is one of these" is a property of the files rather than of any case:
//
//   • exactly one definition, in this directory;
//   • no row stores the labels — not a schema field, not a mapper, not a migration;
//   • the ORGANIZATION-WIDE reads enrich, and the employee-scoped reads do not (they already know
//     whose profile they are on, and asking again would be a query per page for nothing).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR = resolve(HERE, '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — these files explain the rule in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const hrFiles = sources(HR);
const rel = (file: string): string => file.slice(HR.length + 1);

describe('the employee label helper', () => {
  it('is defined once, in shared', () => {
    const definers = hrFiles.filter((file) => code(file).includes('export const employeeLabelMap'));
    expect(definers.map(rel)).toEqual(['shared/employee-labels.ts']);
  });

  /**
   * Everybody imports it from the same place.
   *
   * Attendance reaches `../../shared/`, payroll reaches `../../shared/`, and loans reach
   * `../shared/` — three different relative paths to ONE file, which is the point: the seam that
   * separates those features must not be a reason for any of them to grow its own copy.
   */
  it('and every reader imports that file rather than re-deriving it', () => {
    const readers = hrFiles.filter(
      (file) => code(file).includes('employeeLabelMap') && rel(file) !== 'shared/employee-labels.ts',
    );
    expect(readers.length).toBeGreaterThan(2);
    for (const file of readers) {
      expect(code(file), rel(file)).toMatch(/from '(\.\.\/)+shared\/employee-labels'/);
    }
  });
});

describe('a label is looked up, never kept', () => {
  /**
   * A day row is derived, a regularization is a request, an adjustment is a decision about
   * somebody, and a loan is a debt they still owe: all four are about a person who still exists.
   * Copying the name onto the row would mean a correction tomorrow leaves yesterday's spelling on
   * a document somebody is asked to approve.
   *
   * SCOPED TO THOSE FOUR ON PURPOSE. Elsewhere in HR the opposite is right and deliberate: a
   * contract, a personnel action, an employee-file entry and a hiring document all DO store the
   * name, because each is a record of what was written at a moment — reprinting a signed contract
   * with today's spelling would be a different document. This guard is not a claim that
   * denormalizing is wrong; it is a claim about which side of that line these four sit on.
   */
  it('no model or mapper writes the two fields onto a row', () => {
    const enriched = ['attendance/', 'payroll/', 'employee-loans/'];
    const writers = hrFiles.filter((file) => {
      const name = rel(file);
      if (!enriched.some((prefix) => name.startsWith(prefix))) return false;
      return (
        (name.includes('.model.ts') || name.includes('.mapper.ts')) &&
        /employeeName|employeeCode/.test(code(file))
      );
    });
    expect(writers.map(rel)).toEqual([]);
  });

  /**
   * The enrichment goes on the org-wide reads and nowhere else.
   *
   * Both are the same shape for the same reason: a list crossing everybody has no profile to take
   * a name from, so it costs ONE batch fetch per page. The employee-scoped reads beside them are
   * already on somebody's file — a second fetch there would buy nothing.
   */
  it('the two organization-wide list controllers enrich, and only they', () => {
    const controllers = hrFiles.filter(
      (file) => code(file).includes('labelFields') && rel(file) !== 'shared/employee-labels.ts',
    );
    expect(controllers.map(rel).sort()).toEqual(
      [
        'attendance/day-records/day-record.controller.ts',
        'attendance/regularizations/regularization.controller.ts',
        'employee-loans/employee-loan.controller.ts',
        'payroll/adjustments/payroll-adjustment.controller.ts',
      ].sort(),
    );

    for (const name of [
      'payroll/adjustments/payroll-adjustment.controller.ts',
      'employee-loans/employee-loan.controller.ts',
    ]) {
      const source = code(resolve(HR, name));
      // One `employeeLabelMap` call, in the org-wide handler — never in the employee-scoped one.
      expect([...source.matchAll(/employeeLabelMap\(/g)], name).toHaveLength(1);
    }
  });
});
