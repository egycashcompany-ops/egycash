// Every notification this module SENDS has a template behind it (P-HR-07).
//
// THE FAILURE THIS PREVENTS IS INVISIBLE, which is why it needs a test rather than care.
// `notificationsService.notify()` looks the template up by key and throws `NotFoundError` when
// there is no row — and every caller in this repository deliberately swallows that, because a
// notification must never undo a decision that was correctly recorded:
//
//     await notificationsService.notify({ … }).catch(() => undefined);
//
// So a send whose key was never seeded is a silent no-op. No error, no log anybody reads, no
// failing test: the approver simply never hears that a bonus is waiting, and nobody finds out
// until somebody asks why the queue is always stale. The two halves — the send site and the seed
// — live in different files and nothing but this connects them.
//
// It is source-scanning on purpose. A runtime check would only see the templates a test happens to
// trigger, and the ones that go quiet are exactly the ones no test triggers.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as contracts from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = readFileSync(resolve(HERE, 'hr.seed.ts'), 'utf8');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — prose naming a template must not be what satisfies "this template is sent". */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

/** Every `Hr…Templates` constant the contracts declare, as `Group.Member` → key. */
const TEMPLATE_GROUPS = Object.entries(contracts as Record<string, unknown>).filter(
  ([name, value]) =>
    name.startsWith('Hr') &&
    name.endsWith('Templates') &&
    typeof value === 'object' &&
    value !== null,
) as [string, Record<string, string>][];

const seeded = code(SEED);

/** `template: HrXTemplates.Y` at any send site under `modules/hr`. */
const sentReferences = (): string[] => {
  const found = new Set<string>();
  for (const file of sources(HERE)) {
    for (const match of code(readFileSync(file, 'utf8')).matchAll(
      /template:\s*(Hr[A-Za-z]*Templates)\.([A-Za-z0-9_]+)/g,
    )) {
      found.add(`${match[1] ?? ''}.${match[2] ?? ''}`);
    }
  }
  return [...found].sort();
};

describe('the notification templates this module sends', () => {
  const sent = sentReferences();

  it('finds send sites at all — a scanner that matches nothing proves nothing', () => {
    expect(sent.length).toBeGreaterThan(10);
    expect(TEMPLATE_GROUPS.length).toBeGreaterThan(5);
  });

  /**
   * ONE-DIRECTIONAL ON PURPOSE, in both senses.
   *
   * The scanner only sees the literal `template: HrXTemplates.Y` form, so a send routed through a
   * variable or a lookup table is invisible to it — which is why this asserts "everything I can SEE
   * being sent is seeded" and never the reverse. A key it cannot see is not evidence of anything,
   * and a declared key that nothing sends is harmless anyway: it costs a row and misleads nobody.
   *
   * The direction kept is the one where the failure is silent. A seeded template nobody sends does
   * nothing; a SENT template nobody seeded goes quiet forever.
   */
  it('are every one of them seeded', () => {
    const unseeded = sent.filter((reference) => !seeded.includes(reference));
    expect(unseeded).toEqual([]);
  });
});

describe('the payroll decision notices (P-HR-07)', () => {
  /**
   * P-HR-04 built a two-person decision and P-HR-06-A put a queue in front of it, and neither told
   * anybody anything: an approver learned that a bonus was waiting by opening the screen and
   * looking. These five keys are what closed that, and they are stated by name because "the queue
   * is announced" is the whole of what this phase promises.
   */
  it('ship the five keys, all seeded and all sent', () => {
    const keys = [
      'HrPayrollTemplates.AdjustmentSubmitted',
      'HrPayrollTemplates.AdjustmentDecided',
      'HrEmployeeLoanTemplates.Submitted',
      'HrEmployeeLoanTemplates.Decided',
      'HrEmployeeLoanTemplates.Disbursed',
    ];
    const sent = sentReferences();
    for (const key of keys) {
      expect(seeded, `${key} is not seeded`).toContain(key);
      expect(sent, `${key} is never sent`).toContain(key);
    }
  });

  /**
   * WHO HEARS WHAT, asserted because getting it backwards is a privacy failure rather than a bug.
   *
   * The two "awaiting a decision" notices go to a PERMISSION — the set of people who can act — and
   * never to a named manager: lending and granting a bonus are HR decisions, not line-management
   * ones, so a manager step would address somebody with no authority to end the wait. Everything
   * addressed to the employee goes to their own user id and nowhere else.
   */
  it('address the waiting party by permission and the employee by their own login', () => {
    const adjustments = code(
      readFileSync(resolve(HERE, 'payroll/adjustments/payroll-adjustment.service.ts'), 'utf8'),
    );
    const loans = code(
      readFileSync(resolve(HERE, 'employee-loans/employee-loan.service.ts'), 'utf8'),
    );
    expect(adjustments).toContain("permission: 'payrollAdjustment.approve', scope: 'organization'");
    expect(loans).toContain("permission: 'employeeLoan.approve', scope: 'organization'");
    for (const source of [adjustments, loans]) {
      expect(source).toContain('to: { userIds: [String(employee.userId)] }');
      // An employee with no login has nowhere to receive it — and that is a return, not a throw.
      expect(source).toMatch(/if \(employee\.userId === null/);
    }
  });

  /**
   * A notice is a pointer to a decision, never a second copy of the figure.
   *
   * The amount is on the screen, behind the permission that governs reading pay; an inbox is not,
   * and an email least of all. So no template body interpolates money — the loan notice states a
   * COUNT and a MONTH, which is what an employee needs in order to know what to expect and when.
   */
  it('and no body of theirs interpolates an amount', () => {
    const block = seeded.slice(seeded.indexOf('HrPayrollTemplates.AdjustmentSubmitted'));
    for (const forbidden of ['{{amount}}', '{{principal}}', '{{currency}}', '{{remaining}}']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});
