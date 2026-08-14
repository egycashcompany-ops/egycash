// What P-HR-11 promised NOT to contain (design §6, "What it will NOT add").
//
// This phase's design is unusual in that most of it is a list of absences. The last salary already
// works, the loan balance already works, and the three amounts a settlement would still need —
// end-of-service gratuity, leave encashment, notice period — have no rule anywhere in this
// repository. The owner's instruction was explicit: do not invent one, record it as a policy
// decision instead.
//
// An absence nobody can see is an absence that lasts until somebody is in a hurry. So each promise
// is asserted here, over the SOURCES, because "this feature computes nothing" is a property of the
// files rather than of any single request.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const HR_MODULE = resolve(HERE, '../hr.module.ts');
const CONTRACT = resolve(HERE, '../../../../../../packages/contracts/src/modules/hr-employee.ts');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.ts') && !entry.name.includes('.spec.') ? [full] : [];
  });

/** Code only — this feature explains itself at length in prose, and prose must not satisfy a guard. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const featureFiles = sources(HERE);
const rel = (file: string): string => file.slice(HERE.length + 1);

describe('the feature is a read, and there is no second half coming', () => {
  it('ships four files and no model, repository or mapper', () => {
    expect(featureFiles.map(rel).sort()).toEqual([
      'index.ts',
      'settlement.controller.ts',
      'settlement.routes.ts',
      'settlement.service.ts',
    ]);
  });

  /**
   * ONE route, and it is a GET.
   *
   * Stated over the router source rather than over a naming convention: a POST added here later
   * would be a settlement lifecycle, which §5.4 declined on purpose — an amount reaches a leaver as
   * a payroll adjustment on the exit month, and that already carries a two-person rule and a
   * frozen-period guard. A second approval over the same money is not an improvement.
   */
  it('exposes exactly one GET and no mutating verb', () => {
    const routes = code(resolve(HERE, 'settlement.routes.ts'));
    const verbs = [...routes.matchAll(/router\.(get|post|patch|put|delete)\(/g)].map((m) => m[1]);
    expect(verbs).toEqual(['get']);
    expect(routes).toContain("'/:id/settlement'");
  });

  /** …and nothing behind the route writes either, whatever verb ever reaches it. */
  it('and calls nothing that writes', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const call of [
        '.create(',
        '.updateById(',
        '.deleteById(',
        '.save(',
        '.insertMany(',
        '.freezePeriod(',
        'recordTransition',
        'auditService',
      ]) {
        expect(source, `${rel(file)}: ${call}`).not.toContain(call);
      }
    }
  });

  /**
   * No event and no notification.
   *
   * Reading a summary is not a decision, and the standing rule in this repository is that an event
   * without a consumer is a promise nobody asked for. P-HR-07 published the decisions that had an
   * audience; a screen being opened is not one of them.
   */
  it('and publishes nothing', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const call of ['emit(', 'notificationsService', 'HrPayrollEvents', 'HrEmployeeLoanEvents']) {
        expect(source, `${rel(file)}: ${call}`).not.toContain(call);
      }
    }
  });
});

describe('it quotes; it does not compute', () => {
  /**
   * THE assertion of this phase.
   *
   * Every figure in the summary is produced by the service that owns it — the exit month's pay by
   * the compensation engine, the balance by the loans feature, the lost days by the leave ledger.
   * If arithmetic appeared here, this file would have become a second answer to a question that is
   * already answered, and two answers about somebody's last salary is strictly worse than one.
   *
   * Multiplication and division are the operators a rate or a proration is written with, so their
   * absence is the property worth pinning. `+` is not banned: it is string and array building here,
   * and banning it would assert something the code never claimed.
   */
  it('performs no multiplication, division or rounding anywhere', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const operator of [' * ', ' / ', ' % ', 'Math.']) {
        expect(source, `${rel(file)}: ${operator}`).not.toContain(operator);
      }
    }
  });

  /** …and imports no money helper, since converting an amount is already touching it. */
  it('and imports no money arithmetic', () => {
    for (const file of featureFiles) {
      const source = code(file);
      for (const helper of ['toMinorUnits', 'fromMinorUnits', 'scaleMinorUnits']) {
        expect(source, `${rel(file)}: ${helper}`).not.toContain(helper);
      }
    }
  });

  /** The four sources are reached through their own public surfaces, not through their collections. */
  it('reads the owning services and opens no collection itself', () => {
    const service = code(resolve(HERE, 'settlement.service.ts'));
    for (const owner of [
      'compensationService',
      'employeeLoanService',
      'leaveBalanceService',
      'payrollRunService',
    ]) {
      expect(service, owner).toContain(owner);
    }
    for (const file of featureFiles) {
      const source = code(file);
      for (const model of [
        'EmployeeLoanModel',
        'LoanInstallmentModel',
        'LoanRepaymentModel',
        'PayslipModel',
        'PayrollRunModel',
        'PayrollAdjustmentModel',
        'LeaveBalanceModel',
      ]) {
        expect(source, `${rel(file)}: ${model}`).not.toContain(model);
      }
    }
  });
});

describe('the three unruled amounts are named, and left empty (design §5)', () => {
  /**
   * The list is a closed vocabulary in contracts, so an amount cannot quietly leave it.
   *
   * Each of these is blocked for the same reason — the rule that would produce it does not exist in
   * this repository. `termination` and `resignation` are not the same case under Egyptian law, and
   * `death` is a third; the notice period's LENGTH is not stored anywhere at all. None of that is
   * guessable, so none of it is guessed.
   */
  it('contracts declare exactly the three, and nothing beside them', () => {
    const contract = code(CONTRACT);
    expect(contract).toMatch(
      /SETTLEMENT_UNRESOLVED_ITEMS = \[\s*'endOfServiceGratuity',\s*'leaveEncashment',\s*'noticePeriod',\s*\] as const;/,
    );
  });

  /**
   * And the DTO carries no amount of its own for them.
   *
   * A field would be the beginning of a value: somewhere it would have to be filled, and the only
   * way to fill it is a formula nobody has given. The summary reports them as UNRESOLVED and the
   * screen names them, so an incomplete settlement cannot be mistaken for a complete one.
   */
  it('and the settlement DTOs carry no severance, notice or encashment figure', () => {
    const contract = code(CONTRACT);
    const start = contract.indexOf('export interface EmployeeSettlementDto');
    expect(start).toBeGreaterThan(-1);
    const block = contract.slice(start, contract.indexOf('}', start));
    // The slice really is the interface body — otherwise every absence below would be vacuous.
    expect(block).toContain('unresolved: SettlementUnresolvedItem[];');
    for (const field of ['gratuityAmount', 'severance', 'encashment', 'noticePay', 'totalDue', 'netDue']) {
      expect(block, field).not.toContain(field);
    }
  });

  /** No rule arrived through the back door either: no band, no rate, no service-length threshold. */
  it('and the feature declares no rate, band or duration constant', () => {
    for (const file of featureFiles) {
      const source = code(file).toLowerCase();
      for (const word of ['gratuity =', 'severance', 'halfmonth', 'perYear', 'daysPerYear', 'entitlementRate']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word.toLowerCase());
      }
    }
  });
});

describe('the boundaries this phase was told not to cross', () => {
  /** C — the owner ruled Bank/WPS out, and said not to reopen it. P-HR-10 settled what `Pay` means. */
  it('names no bank, IBAN or WPS anything', () => {
    for (const file of featureFiles) {
      const source = code(file).toLowerCase();
      for (const word of ['iban', 'wps', 'swift', 'bankaccount', 'bankfile']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  /** D — PY-12 is closed by decision. A settlement summary is a screen, not a document. */
  it('and produces no export, PDF or printable document', () => {
    for (const file of featureFiles) {
      const source = code(file).toLowerCase();
      for (const word of ['pdf', 'puppeteer', 'csv', 'attachment;', 'content-disposition']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });

  /** P-HR-12/13 are later phases and not started: no tax, no insurance, no profit share here. */
  it('and computes no statutory deduction or profit share', () => {
    for (const file of featureFiles) {
      const source = code(file).toLowerCase();
      for (const word of ['tax', 'socialinsurance', 'profitshar']) {
        expect(source, `${rel(file)}: ${word}`).not.toContain(word);
      }
    }
  });
});

describe('nothing was added to the registry for it', () => {
  const manifest = code(HR_MODULE);

  /**
   * NO NEW PERMISSION. Reading a leaver's money is reading pay, and `employee.viewCompensation`
   * already governs that — the same call PY-3's compensation read made, for the same reason.
   */
  it('declares no settlement permission and gates on the compensation key', () => {
    expect(manifest).not.toMatch(/declarePermissions\(\s*'hr',\s*'settlement'/);
    const routes = code(resolve(HERE, 'settlement.routes.ts'));
    const gates = [...routes.matchAll(/authorize\('([^']+)'\)/g)].map((m) => m[1]);
    expect(gates).toEqual(['employee.viewCompensation']);
  });

  it('and no collection, because it stores nothing', () => {
    expect(manifest).not.toContain('hr_settlements');
    expect(manifest).not.toContain('hr_final_settlements');
    expect(manifest).toContain('buildSettlementRouter()');
  });
});
