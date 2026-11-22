// «ساعات العمل» reaches the people who manage the working day by DEPLOYING — what is guarded here
// is the caller: the api starts it and the worker does not, the mapping is exactly the owner's
// decision and names only keys the module registers, the run row names roles and no person, and
// the after-commit step follows the commit. The copy itself is proved against a real mongo in
// `tests/integration/hr-go-live-working-hours-grants.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hrPermissions } from '../hr.module';
import {
  HR_WORKING_HOURS_GRANTS_MARK,
  HR_WORKING_HOURS_GRANT_PAIRS,
  workingHoursGrantsOutcome,
} from './working-hours-grants';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the working-hours grant is copied by the deploy', () => {
  it('the api starts it', () => {
    expect(code('src/server.ts')).toContain('startHrWorkingHoursGrantsGoLive();');
  });

  // Not the worker: it boots the new build minutes before the new api serves, and every role made
  // in the old roles screen meanwhile would miss the copy for good (see the file's header).
  it('the worker does not', () => {
    expect(code('src/worker.ts')).not.toContain('startHrWorkingHoursGrantsGoLive');
  });

  it('runs once per version of the mapping', () => {
    expect(HR_WORKING_HOURS_GRANTS_MARK).toBe('go-live:hr-working-hours-grants:v1');
    expect(HR_WORKING_HOURS_GRANTS_MARK).toMatch(/:v\d+$/u);
  });

  it('copies the shift grant onto the working-hours grant, and nothing else', () => {
    // The owner's ruling of 22 November: «ساعات العمل» replaces what HR already manages through the
    // shift catalog, so it must not disappear for them after the update.
    expect(HR_WORKING_HOURS_GRANT_PAIRS).toEqual([
      { from: 'attendance.manageShifts', add: ['attendance.manageWorkingHours'] },
    ]);
  });

  it('copies from nothing else — assigning, reading and the settings screen are other powers', () => {
    for (const forbidden of ['attendance.assign', 'attendance.view', 'setting.edit']) {
      expect(
        HR_WORKING_HOURS_GRANT_PAIRS.some((pair) => pair.from === forbidden),
        forbidden,
      ).toBe(false);
    }
  });

  it('names only keys the HR module registers — a grant never holds an unknown key', () => {
    const registered = new Set(hrPermissions.map((permission) => permission.key));
    for (const pair of HR_WORKING_HOURS_GRANT_PAIRS) {
      expect(registered.has(pair.from), pair.from).toBe(true);
      for (const key of pair.add) expect(registered.has(key), key).toBe(true);
    }
  });

  it('copies inside the transaction, records the run there, and audits after the commit', () => {
    const source = code('src/modules/hr/go-live/working-hours-grants.ts');
    const transaction = source.indexOf('unitOfWork(');
    const copy = source.indexOf('rbacService.grantAlongside(HR_WORKING_HOURS_GRANT_PAIRS, session)');
    const record = source.indexOf(
      'recordHrGoLiveRun(HR_WORKING_HOURS_GRANTS_MARK, outcome, session)',
    );
    const after = source.indexOf('rbacService.afterGrantsAlongside(run.result)');
    expect(transaction).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(transaction);
    expect(record).toBeGreaterThan(copy);
    expect(after).toBeGreaterThan(record);
    expect(source).toContain('if (isTest) return;');
  });

  it('declares its collection on the module manifest', () => {
    // ADR-025 — the manifest is the module's honest inventory of what it writes, and
    // `sync-indexes` builds the unique index from it before any step runs in production.
    expect(code('src/modules/hr/hr.module.ts')).toContain("'hr_go_live_runs'");
  });
});

describe('the run row', () => {
  it('counts what changed, names the roles and what each gained, and names no person', () => {
    const outcome = workingHoursGrantsOutcome({
      roles: [
        {
          roleId: 'r1',
          name: { ar: 'شؤون العاملين', en: 'Personnel' },
          before: ['attendance.manageShifts', 'attendance.view'],
          after: ['attendance.manageShifts', 'attendance.view', 'attendance.manageWorkingHours'],
        },
      ],
      delegatedGrants: [
        {
          grantId: 'g1',
          userId: 'u-person',
          branchId: 'b1',
          departmentId: null,
          departmentCatalogId: null,
          before: ['attendance.manageShifts'],
          after: ['attendance.manageShifts', 'attendance.manageWorkingHours'],
        },
      ],
    });
    expect(outcome).toEqual({
      rolesChanged: 1,
      delegatedGrantsChanged: 1,
      roles: [
        {
          id: 'r1',
          name: { ar: 'شؤون العاملين', en: 'Personnel' },
          added: ['attendance.manageWorkingHours'],
        },
      ],
      delegatedGrants: [{ id: 'g1', added: ['attendance.manageWorkingHours'] }],
    });
    expect(JSON.stringify(outcome)).not.toContain('u-person');
  });
});
