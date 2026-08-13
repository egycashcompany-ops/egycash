// The freeze guard, and the proof that it has no way around it (PY-9).
//
// Two halves. The first is arithmetic over period keys and needs no database. The second reads
// this module's own sources: a rule enforced in one service is only a rule if that service is the
// only way in, and that is a property of the FILES, not of any single test case.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blockingFrozenPeriod, periodKeyOf } from './frozen-period-guard';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('naming the period a date falls in', () => {
  it('pads the month so the keys sort chronologically', () => {
    expect(periodKeyOf(d('2026-03-15'))).toBe('2026-03');
    expect(periodKeyOf(d('2026-09-01'))).toBe('2026-09');
    expect(periodKeyOf(d('2026-12-31'))).toBe('2026-12');
  });

  // The property the whole comparison rests on: lexicographic order IS chronological order.
  it('orders as string exactly as it orders in time', () => {
    const keys = ['2026-01', '2025-12', '2026-10', '2026-02'];
    expect([...keys].sort()).toEqual(['2025-12', '2026-01', '2026-02', '2026-10']);
  });
});

describe('which interval reaches into a frozen month', () => {
  const frozen = ['2026-03', '2026-04'];

  it('lets an interval entirely after the frozen months through', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-05-01'), null)).toBeNull();
  });

  it('lets an interval entirely before them through', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-01-01'), d('2026-02-28'))).toBeNull();
  });

  it('blocks one that starts inside a frozen month', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-03-15'), null)).toBe('2026-03');
  });

  it('blocks one that ends inside a frozen month', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-01-01'), d('2026-04-10'))).toBe('2026-03');
  });

  it('blocks one that spans straight over them', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-01-01'), d('2026-12-31'))).toBe('2026-03');
  });

  // An open-ended row runs forward forever, so it cannot reach BACKWARDS past its own start.
  it('lets an open-ended interval starting after the frozen months through', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-05-01'), null)).toBeNull();
    expect(blockingFrozenPeriod(frozen, d('2026-04-01'), null)).toBe('2026-04');
  });

  it('reports the EARLIEST frozen month an interval touches', () => {
    expect(blockingFrozenPeriod(['2026-08', '2026-03', '2026-05'], d('2026-01-01'), null)).toBe(
      '2026-03',
    );
  });

  it('blocks nothing when no run is frozen at all', () => {
    expect(blockingFrozenPeriod([], d('2020-01-01'), null)).toBeNull();
  });

  it('treats a single-day interval inside a frozen month as blocked', () => {
    expect(blockingFrozenPeriod(frozen, d('2026-03-15'), d('2026-03-15'))).toBe('2026-03');
  });
});

// ── The no-bypass property ──────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — this module explains the rule in prose, and prose must not satisfy an assertion. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

describe('there is one way to create an assignment, and it is guarded', () => {
  const payrollFiles = sources(PAYROLL);

  it('creates a row in exactly one file', () => {
    const writers = payrollFiles.filter((file) =>
      /employeePayItemRepository\.create\(|EmployeePayItemModel\.(create|insertMany|updateOne|findOneAndUpdate)\(/.test(
        code(file),
      ),
    );
    expect(writers.map((f) => f.slice(PAYROLL.length + 1))).toEqual([
      'employee-pay-items/employee-pay-item.service.ts',
    ]);
  });

  it('and that file asks the guard before it writes', () => {
    const service = code(
      resolve(PAYROLL, 'employee-pay-items/employee-pay-item.service.ts'),
    );
    expect(service).toContain('blockingFrozenPeriod');
    // Asked BEFORE the write, not after it.
    expect(service.indexOf('blockingFrozenPeriod')).toBeLessThan(
      service.indexOf('employeePayItemRepository.create('),
    );
  });

  /**
   * The other half of the scope claim: ending an assignment cannot reach backwards.
   *
   * `remove` closes an in-force row as of TODAY and deletes a not-yet-started one outright, so
   * neither can change a month that has already ended — which is why the guard is on creation
   * alone. If that ever stops being true this assertion is what says so.
   */
  it('ends a row as of today, never at a date somebody chose', () => {
    const service = code(resolve(PAYROLL, 'employee-pay-items/employee-pay-item.service.ts'));
    expect(service).toContain('{ effectiveTo: today }');
    expect(service).toContain('const today = cairoToday()');
  });

  it('has no update endpoint that could move a row into a frozen month', () => {
    const routes = code(resolve(PAYROLL, 'employee-pay-items/employee-pay-item.routes.ts'));
    expect(routes).not.toMatch(/router\.(patch|put)\(/);
  });
});
