// The run lifecycle, and the paths it does NOT have (P-HR-10).
//
// A lifecycle is only as strong as its narrowest hole, and every hole here is a hole in a MONTH'S
// PAY. So this file states the shape by reading the source rather than by exercising it: which
// transitions exist, what each one demands of the state before it, and — the half that matters —
// that no second writer of `status` exists anywhere to route around them.
//
// The order is forced by the domain, not chosen: a payslip is issued FROM a frozen run, so before
// the freeze there are no figures to review and nothing to approve. That is why `approved` follows
// `frozen` here rather than preceding it as the brief's example sketched.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANCELLABLE_PAYROLL_RUN_STATUSES, PAYROLL_RUN_STATUSES } from '@ecms/contracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYROLL = resolve(HERE, '..');

/** Code only — this service explains its ordering in prose, and prose must not prove it. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

const SERVICE = code(resolve(HERE, 'payroll-run.service.ts'));
const ROUTES = readFileSync(resolve(HERE, 'payroll-run.routes.ts'), 'utf8');
const MODEL = code(resolve(HERE, 'payroll-run.model.ts'));

describe('the lifecycle a run may travel', () => {
  it('is six states, in the order the domain forces', () => {
    expect([...PAYROLL_RUN_STATUSES]).toEqual([
      'draft',
      'frozen',
      'approved',
      'paid',
      'closed',
      'cancelled',
    ]);
  });

  /**
   * Money that has left cannot be called back by a status flip.
   *
   * `paid` and `closed` are absent from the cancellable set for the same reason the freeze is
   * irreversible: pretending a fact did not happen is the failure both rules exist to prevent. A
   * payment recorded in error is corrected forward, in a later period.
   */
  it('and cancelling stops the moment money has been recorded as paid', () => {
    expect([...CANCELLABLE_PAYROLL_RUN_STATUSES]).toEqual(['draft', 'frozen', 'approved']);
    for (const terminal of ['paid', 'closed']) {
      expect([...CANCELLABLE_PAYROLL_RUN_STATUSES], terminal).not.toContain(terminal);
    }
  });

  /**
   * EACH TRANSITION DEMANDS EXACTLY ONE PREDECESSOR, checked before the write.
   *
   * This is what makes "no payment before approval" and "no close before payment" structural rather
   * than conventional: there is no state from which `pay` succeeds except `approved`, and none from
   * which `close` succeeds except `paid`.
   */
  it('each transition names the one state it may follow', () => {
    expect(SERVICE).toContain("if (run.status !== 'frozen')");
    expect(SERVICE).toContain("if (run.status !== 'approved')");
    expect(SERVICE).toContain("if (run.status !== 'paid')");
  });

  // The second person, the shape every money decision in this system already uses.
  it('and an approval is refused to whoever froze the run', () => {
    expect(SERVICE).toContain('String(run.frozenBy) === by');
    expect(SERVICE).toContain('ForbiddenError');
  });

  /**
   * NO SIDE PATH. The transitions are the only writers of `status`, so nothing can skip a step by
   * setting it directly — including from another feature that happens to hold the model.
   */
  it('nothing outside these transitions writes a run status', () => {
    // Scoped to files that actually hold the RUN — `status: 'approved'` is also an adjustment's
    // word, and a guard that cannot tell two entities apart proves nothing about either.
    const writers = sources(PAYROLL).filter((file) => {
      const source = code(file);
      if (!source.includes('PayrollRunModel') && !source.includes('payrollRunRepository')) {
        return false;
      }
      return /status: '(approved|paid|closed)'/.test(source);
    });
    expect(writers.map((file) => file.slice(PAYROLL.length + 1))).toEqual([
      'runs/payroll-run.service.ts',
    ]);
  });

  // Optimistic locking on every one — a caller acting on a stale read is refused, not merged.
  it('and every transition is version-checked', () => {
    const calls = [...SERVICE.matchAll(/updateById\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(SERVICE).not.toMatch(/updateById\([^)]*\)\s*;/);
  });
});

describe('a permission per transition', () => {
  it('gives approve and pay their own keys, and leaves close on manage', () => {
    expect(ROUTES).toContain("authorize('payrollRun.approve')");
    expect(ROUTES).toContain("authorize('payrollRun.pay')");
    // Four `manage` routes: create, freeze, close, cancel — the acts on a PERIOD rather than money.
    expect([...ROUTES.matchAll(/authorize\('payrollRun\.manage'\)/g)]).toHaveLength(4);
  });

  it('and mounts exactly the transitions this phase declared, beside the reads that existed', () => {
    const paths = [...ROUTES.matchAll(/'(\/:id\/[a-z]+)'/g)].map((m) => m[1]).sort();
    // `/:id/leave` is PY-6's snapshot READ and predates this phase; the other five are the writes.
    expect(paths).toEqual([
      '/:id/approve',
      '/:id/cancel',
      '/:id/close',
      '/:id/freeze',
      '/:id/leave',
      '/:id/pay',
    ]);
  });
});

describe('what P-HR-10 deliberately did not bring', () => {
  /**
   * `Pay` means RECORDED AS PAID, inside this system, and nothing else (design §1).
   *
   * A bank file is a different scope with different failure modes, and the cheapest way for it to
   * arrive is one field at a time on a payload that already says "pay". So the absence is asserted
   * across the whole payroll module rather than trusted to the reviewer of one diff.
   */
  it('no bank, WPS or transfer-file concept anywhere in payroll', () => {
    const offenders: string[] = [];
    for (const file of sources(PAYROLL)) {
      const source = code(file).toLowerCase();
      // Word boundaries, because `sepa` lives inside `separate` and a guard that cries wolf on
      // ordinary prose gets deleted by the next person who hits it.
      for (const word of ['wps', 'iban', 'swift', 'bank file', 'bankfile', 'sepa']) {
        if (new RegExp(`\\b${word}\\b`).test(source)) {
          offenders.push(`${file.slice(PAYROLL.length + 1)}: ${word}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // PY-12 is closed by decision. Recording a payment produces no document and needs none.
  it('and nothing here reopens the payslip export', () => {
    // Named shapes, not the bare word `export` — every module file starts a hundred lines with it.
    for (const shape of ['pdf', 'renderPayslip', 'payslipExport', 'downloadPayslip']) {
      expect(SERVICE.toLowerCase(), shape).not.toContain(shape.toLowerCase());
      expect(ROUTES.toLowerCase(), shape).not.toContain(shape.toLowerCase());
    }
  });

  /**
   * The lifecycle is governance, not calculation. A figure appearing on one of these transitions
   * would mean the run had started to disagree with the payslips it already issued.
   */
  it('and no transition carries an amount, a tax or a contribution', () => {
    for (const word of ['amount', 'netPay', 'tax', 'insurance', 'contribution', 'glAccount']) {
      expect(SERVICE, word).not.toContain(word);
    }
  });

  /**
   * The stamps live on the RUN, never on the payslip.
   *
   * `payslip.model.ts` refused a payment status for a reason that still holds: it is a deliberate
   * copy of what somebody was paid, and a mutable field on an immutable document weakens it. A
   * payroll is also approved and paid as a BATCH, so the run is where the fact belongs.
   */
  it('and the payslip is still immutable — no payment state was added to it', () => {
    const payslip = code(resolve(PAYROLL, 'payslips/payslip.model.ts'));
    for (const word of ['paidAt', 'paidOn', 'paymentReference', 'approvedAt']) {
      expect(payslip, word).not.toContain(word);
    }
  });

  /**
   * One live run per period, and the index had to grow with the lifecycle.
   *
   * Left at `draft`/`frozen` it would have let a SECOND run be created for a month whose first run
   * was merely approved — a hole that opens the instant a state is added past `frozen`, which is
   * exactly what this phase did.
   */
  it('and a period still cannot have two live runs', () => {
    expect(MODEL).toContain("status: { $in: ['draft', 'frozen', 'approved', 'paid', 'closed'] }");
  });
});
