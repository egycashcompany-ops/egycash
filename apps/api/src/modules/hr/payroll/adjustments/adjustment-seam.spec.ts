// Only an APPROVED decision may reach a payroll figure (P-HR-04).
//
// That is the whole of D1, and it is one filter wide. A draft is a proposal; a rejected entry went
// back to draft. If either could be read by the calculation, the approval step would be a screen
// rather than a rule — and nothing about the resulting payslip would say which it had been.
//
// So the filter lives at the PORT rather than in the engine or in a caller: the engine is pure and
// takes what it is given, and a future caller who forgets is exactly the failure this prevents.
// These assertions read the sources, because "one door, and this is it" is a property of the
// FILES, not of any single case.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');

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

const payrollFiles = sources(PAYROLL);
const rel = (file: string): string => file.slice(PAYROLL.length + 1);

describe('one door into the adjustments collection', () => {
  it('the model is reached from the adjustments feature alone', () => {
    const readers = payrollFiles.filter((file) => code(file).includes('PayrollAdjustmentModel'));
    expect(readers.map(rel).sort()).toEqual(
      [
        'adjustments/payroll-adjustment.model.ts',
        'adjustments/payroll-adjustment.repository.ts',
        'adjustments/payroll-adjustment.service.ts',
      ].sort(),
    );
  });

  // The compensation side reaches the data through the port and nothing else — the same shape
  // PY-4's attendance feed and PY-5's leave snapshot already have.
  it('and compensation reaches it only through the port', () => {
    const compensation = payrollFiles.filter((f) => rel(f).startsWith('compensation/'));
    const readers = compensation.filter((file) =>
      code(file).includes('payrollAdjustmentRepository'),
    );
    expect(readers.map(rel)).toEqual(['compensation/adjustment.port.ts']);
  });
});

describe('the approval filter', () => {
  const port = code(resolve(PAYROLL, 'compensation/adjustment.port.ts'));
  const repository = code(resolve(PAYROLL, 'adjustments/payroll-adjustment.repository.ts'));

  it('is applied where the data is read, not where it is used', () => {
    expect(repository).toContain("status: 'approved'");
    expect(port).toContain('approvedFor');
  });

  /**
   * The engine must not be able to tell an approved figure from an unapproved one, because it
   * must never be handed the second. Naming a status there would mean it had been.
   */
  it('and the pure engine knows nothing about statuses at all', () => {
    const rules = code(resolve(PAYROLL, 'compensation/compensation-rules.ts'));
    for (const status of ['pendingApproval', "'approved'", "'draft'", "'cancelled'"]) {
      expect(rules, status).not.toContain(status);
    }
  });
});

describe('what the phase did not touch', () => {
  // PY-10's rule, restated for the file this phase adds: the legacy list pays nobody, here either.
  it('adjustments never read employment.allowances', () => {
    const feature = payrollFiles.filter((f) => rel(f).startsWith('adjustments/'));
    expect(feature.length).toBeGreaterThan(4);
    for (const file of feature) {
      expect(code(file), rel(file)).not.toContain('employment.allowances');
    }
  });

  // D5 — one-off. No instalment, no recurrence, no schedule: those are P-HR-05, and a field here
  // hinting at them would be a promise this phase did not make.
  it('and carry no instalment or recurrence vocabulary', () => {
    const feature = payrollFiles.filter((f) => rel(f).startsWith('adjustments/'));
    for (const file of feature) {
      for (const word of ['installment', 'instalment', 'recurring', 'schedule', 'remaining']) {
        expect(code(file).toLowerCase(), `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  // D2 — no cap. Not a constant, not a setting, not a percentage anybody invented.
  it('and impose no cap on a penalty', () => {
    const feature = payrollFiles.filter((f) => rel(f).startsWith('adjustments/'));
    for (const file of feature) {
      const source = code(file);
      expect(source, rel(file)).not.toContain('maxAmount');
      expect(source, rel(file)).not.toContain('MAX_PENALTY');
      expect(source, rel(file)).not.toContain('SettingKeys');
    }
  });
});

/**
 * The employee's own read (P-HR-19) — and the three things that make it safe.
 *
 * It is the only route in this feature with no permission, which is correct ONLY because the
 * employee is resolved server-side from the caller's login link. None of these properties is
 * visible at runtime, so each is pinned here.
 */
describe('the own-scope read is own-scope by construction (P-HR-19)', () => {
  const service = code(resolve(HERE, 'payroll-adjustment.service.ts'));
  const controller = code(resolve(HERE, 'payroll-adjustment.controller.ts'));
  const routes = code(resolve(HERE, 'payroll-adjustment.routes.ts'));

  it('resolves the employee from the login, never from the request', () => {
    expect(service).toContain('async listMine(');
    expect(service).toContain('employeeRepository.findByUserIdSystem(userId)');
    // A login with no employee behind it is 404, not an empty list — an empty list would read as
    // "nothing has been recorded about you", which is a different and misleading statement.
    expect(service).toContain("throw new NotFoundError('no employee is linked to this login')");
  });

  /**
   * THE assertion. `/me` shares its query schema with the admin queue, and that schema carries an
   * `employeeId`. The controller must drop it — otherwise any logged-in caller could read what was
   * recorded about somebody else by adding one parameter.
   */
  it('and drops any employeeId the caller sends', () => {
    const handler = controller.slice(
      controller.indexOf('export const listMyAdjustments'),
      controller.indexOf('export const listAdjustments'),
    );
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toContain('listMine(String(ctx.userId)');
    expect(handler).not.toContain('employeeId');
  });

  /**
   * DRAFTS ARE EXCLUDED, and it is the service that excludes them rather than the screen.
   *
   * A draft is the recorder's private working note — P-HR-07 declined to announce one for exactly
   * that reason — so showing somebody a penalty nobody has decided to apply would be telling them
   * about a decision that has not been taken. Enforced on the server, because a filter that lives
   * only in a screen is a filter the API does not have.
   */
  it('and never hands the employee a draft', () => {
    const method = service.slice(service.indexOf('async listMine('), service.indexOf('async list('));
    expect(method).toContain("doc.status !== 'draft'");
  });

  it('and carries no permission, because there is no wider reach to gate', () => {
    const block = routes.slice(routes.indexOf('buildPayrollAdjustmentsRouter'));
    const meAt = block.indexOf("'/me'");
    const listAt = block.indexOf("'/'");
    expect(meAt).toBeGreaterThan(-1);
    expect(meAt).toBeLessThan(listAt);
    expect(block.slice(meAt, listAt)).not.toContain('authorize(');
  });

  /** A read, and only a read: an employee cannot record or contest an adjustment from here. */
  it('and adds no write of any kind', () => {
    const block = routes.slice(routes.indexOf('buildPayrollAdjustmentsRouter'));
    const verbs = [...block.matchAll(/router\.(get|post|patch|put|delete)\(/g)].map((m) => m[1]);
    expect([...new Set(verbs)]).toEqual(['get']);
  });
});
