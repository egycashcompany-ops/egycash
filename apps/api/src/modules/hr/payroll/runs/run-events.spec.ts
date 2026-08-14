// What the run's lifecycle publishes, and what it must never publish (P-HR-16).
//
// This phase adds no rule and no state — it makes three existing transitions audible. So almost
// everything worth asserting is a CONSTRAINT on what the notices may contain and on which
// transitions may speak at all, and every one of those is invisible at runtime:
//
//   * three events, not six. Creating a draft, closing a finished month and cancelling a run are
//     deliberately silent, and the reasons are P-HR-07's rather than new ones.
//   * the recipient is a PERMISSION — whoever may perform the NEXT act — never a manager, never a
//     named person, and never every employee.
//   * no body carries money. A run has no total of its own; the payslips' figures live behind
//     `employee.viewCompensation` and a notice is a pointer, not a second copy.
//   * the emit sits AFTER the write, because that write is what makes it happen once.
//
// Read from the SOURCE, because "this never happens" is a property of the file rather than of any
// request a test happens to make.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Code only — this phase explains itself at length in prose, and prose must not satisfy a guard. */
const code = (file: string): string =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const SERVICE = code('./payroll-run.service.ts');
const SEED = code('../../hr.seed.ts');
const CONTRACT = code('../../../../../../../packages/contracts/src/modules/hr-payroll.ts');

describe('three transitions speak, and three stay silent', () => {
  /**
   * THE assertion of this phase, stated as a set rather than as a count.
   *
   * A fourth event appearing here would mean somebody decided there was a new audience, which is
   * exactly the decision P-HR-07 said must come with a phase behind it.
   */
  it('publishes exactly the three run events, from the run service', () => {
    const emitted = [...SERVICE.matchAll(/HrPayrollEvents\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(emitted)].sort()).toEqual(['RunApproved', 'RunFrozen', 'RunPaid']);
  });

  /**
   * The absences, by name.
   *
   * `create` is a private working note — P-HR-07's exact reasoning for a draft adjustment. `close`
   * is terminal, so nobody is waiting on it. `cancel` is an act by somebody already looking at the
   * row, which is why P-HR-07 declined `Cancelled` for loans too.
   */
  it('and stays silent on create, close and cancel', () => {
    for (const absent of ['RunCreated', 'RunClosed', 'RunCancelled', 'RunReviewed']) {
      expect(SERVICE, absent).not.toContain(`HrPayrollEvents.${absent}`);
      expect(CONTRACT, absent).not.toContain(`${absent}:`);
    }
  });

  /** Each transition emits its own event — no two share one, and none is emitted twice. */
  it('binds one event to each transition', () => {
    for (const [transition, event] of [
      ['freeze', 'RunFrozen'],
      ['approve', 'RunApproved'],
      ['pay', 'RunPaid'],
    ] as const) {
      const occurrences = SERVICE.split(`HrPayrollEvents.${event}`).length - 1;
      expect(occurrences, `${transition} → ${event}`).toBe(1);
    }
  });

  /**
   * Idempotency is the STATE MACHINE, not the notifier — asserted structurally.
   *
   * Every emit sits after the write that owns the transition, so the status guard has already
   * refused a repeat and `updateById` has already 409'd a stale version before this line is
   * reached. If an emit ever moved above its write, a retry could publish a fact that did not
   * happen — so the order is pinned rather than trusted.
   */
  it('emits after the write, never before it', () => {
    for (const event of ['RunFrozen', 'RunApproved', 'RunPaid']) {
      const emitAt = SERVICE.indexOf(`HrPayrollEvents.${event}`);
      expect(emitAt, event).toBeGreaterThan(-1);
      const writeAt = SERVICE.lastIndexOf('payrollRunRepository.updateById', emitAt);
      expect(writeAt, `${event}: no write before the emit`).toBeGreaterThan(-1);
      expect(writeAt, event).toBeLessThan(emitAt);
    }
    // …and nothing de-duplicates in the notifier, because nothing needs to.
    for (const word of ['ProcessedEvent', 'dedup', 'alreadyEmitted']) {
      expect(SERVICE, word).not.toContain(word);
    }
  });
});

describe('who is told, and who is never told', () => {
  /**
   * A PERMISSION, and it is the key governing the next act in each case.
   *
   * frozen → whoever may approve · approved → whoever may pay · paid → whoever may close it
   * (`manage`). Stated as an exact set so a recipient cannot quietly widen.
   */
  it('addresses the permission that holds the next act', () => {
    const gates = [...SERVICE.matchAll(/permission: '([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(gates)].sort()).toEqual([
      'payrollRun.approve',
      'payrollRun.manage',
      'payrollRun.pay',
    ]);
    // The PAIRING, not just the set — matched whitespace-insensitively, because where a formatter
    // puts the line breaks is its business rather than this guard's.
    for (const [template, permission] of [
      ['RunFrozen', 'payrollRun.approve'],
      ['RunApproved', 'payrollRun.pay'],
      ['RunPaid', 'payrollRun.manage'],
    ] as const) {
      expect(SERVICE, `${template} → ${permission}`).toMatch(
        new RegExp(`HrPayrollTemplates\\.${template}[\\s\\S]{0,120}?permission: '${permission}'`),
      );
    }
  });

  /**
   * NO BROADCAST. Nobody is told "you have been paid".
   *
   * It would be a message to every employee in the organization, it has no precedent anywhere in
   * this repository, and `paid` is recorded on the RUN rather than on any payslip (P-HR-10 §5) —
   * so there is no per-employee fact to point them at.
   */
  it('and never addresses employees, individually or at large', () => {
    expect(SERVICE).not.toContain('userIds');
    expect(SERVICE).not.toContain('employeeRepository');
    expect(SERVICE).not.toContain('managerId');
  });

  /** A failed notice must never undo a transition that was correctly recorded. */
  it('sends best-effort, so a notice cannot undo a decision', () => {
    expect(SERVICE).toContain('.catch(() => undefined)');
  });
});

describe('no money travels with any of it', () => {
  /**
   * The payload names a month and a state, and that is all.
   *
   * P-HR-07's adjustment payloads DO carry an amount, deliberately — an adjustment is one figure
   * about one person. A run is not: its figures are its payslips', each behind the compensation
   * key. Copying money into an event that fans out to every approver would move it out from behind
   * the permission that governs reading it.
   */
  it('the payload carries the month, the state and the actor — nothing else', () => {
    const start = CONTRACT.indexOf('export const PayrollRunLifecyclePayloadV1');
    expect(start).toBeGreaterThan(-1);
    const block = CONTRACT.slice(start, CONTRACT.indexOf('});', start));
    expect(block).toContain('runId:');
    expect(block).toContain('period:');
    expect(block).toContain('status:');
    expect(block).toContain('by:');
    for (const field of ['amount', 'Money', 'total', 'net', 'currency']) {
      expect(block, field).not.toContain(field);
    }
  });

  /** …and no template body interpolates a figure either. */
  it('and no run notice body carries an amount', () => {
    for (const key of ['RunFrozen', 'RunApproved', 'RunPaid']) {
      const at = SEED.indexOf(`HrPayrollTemplates.${key}`);
      expect(at, key).toBeGreaterThan(-1);
      const block = SEED.slice(at, SEED.indexOf('});', at));
      expect(block, key).toContain("variables: ['period']");
      for (const word of ['amount', 'total', 'net', 'currency', 'EGP']) {
        expect(block, `${key}: ${word}`).not.toContain(word);
      }
    }
  });
});

describe('the boundaries this phase does not cross', () => {
  /** No new state, and `reviewed` stays the flagged decision P-HR-10 recorded rather than a fact. */
  it('adds no run state and does not reopen `reviewed`', () => {
    expect(CONTRACT).toMatch(
      /PAYROLL_RUN_STATUSES = \[\s*'draft',\s*'frozen',\s*'approved',\s*'paid',\s*'closed',\s*'cancelled',\s*\] as const;/,
    );
    expect(SERVICE).not.toContain('reviewed');
  });

  /** `Pay` still means recorded-as-paid inside this system, and PY-12 stays closed. */
  it('and names no bank, export or document', () => {
    const lower = SERVICE.toLowerCase();
    for (const word of ['iban', 'wps', 'swift', 'bankfile', 'pdf', 'csv', 'export(']) {
      expect(lower, word).not.toContain(word);
    }
  });
});
