// The Data Report (D7, spec §5.8) — the workbook's second sheet, computed instead of stored.
//
// ONE definition of "active" everywhere: branch set ∧ start set ∧ no end, which in this collection
// is `status:'open' ∧ branchId≠null` (status is derived from exactly those dates). ONE fold —
// `foldAtmRegisterReport` from contracts — shared with the import's 57-number check, so the page
// and the cut-over check cannot disagree about a cell.
//
// Scope (DEC-27): the rows counted and the branches shown come from the SAME selector —
// `registerScopeMatch` and `registerScopeBranches` — so every active entry the match returns sits
// in a shown branch or in an unmapped one (counted in Section 1 only and flagged), and Section 1
// and Section 2 totals agree for every scope, `own` included. No polling and no as-of parameter:
// the stamp is the server's computation time, which is the data's time.
import {
  ATM_REGISTER_BRANCH_CODES,
  ATM_BANK_CODES,
  foldAtmRegisterReport,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportDto,
  type AtmRegisterReportGroup,
} from '@ecms/contracts';
import { scopeSelector, type AuthContext } from '../../../shared/types';
import {
  atmRegisterEntryRepository,
  registerScopeBranches,
  registerScopeMatch,
  type AtmRegisterActiveGroup,
} from './register.repository';
import { resolveRegisterSettings } from './register-settings';

const isBankCode = (value: string | null): value is AtmBankCode =>
  value !== null && (ATM_BANK_CODES as readonly string[]).includes(value);

/** Pure: `$group` rows → fold groups. An unmapped branch keeps its count with `branchCode:null`. */
export const toReportGroups = (
  groups: readonly AtmRegisterActiveGroup[],
  codeByBranchId: ReadonlyMap<string, AtmRegisterBranchCode>,
): AtmRegisterReportGroup[] =>
  groups.map((group) => ({
    branchCode: codeByBranchId.get(String(group._id.branchId)) ?? null,
    bankCode: isBankCode(group._id.bankCode) ? group._id.bankCode : null,
    count: group.count,
  }));

/** Pure: the mapped codes, in sheet order, whose branch the scope covers. */
export const reportBranchesShown = (
  covered: 'all' | readonly string[],
  branchIdByCode: ReadonlyMap<AtmRegisterBranchCode, string>,
): AtmRegisterBranchCode[] =>
  ATM_REGISTER_BRANCH_CODES.filter((code) => {
    const branchId = branchIdByCode.get(code);
    return branchId !== undefined && (covered === 'all' || covered.includes(branchId));
  });

class AtmRegisterReportService {
  async report(ctx: AuthContext): Promise<AtmRegisterReportDto> {
    const scope = scopeSelector(ctx, 'atmRegisterReport.view');
    const [groups, settings] = await Promise.all([
      atmRegisterEntryRepository.groupActive(registerScopeMatch(scope)),
      resolveRegisterSettings(),
    ]);
    const branchesShown = reportBranchesShown(
      registerScopeBranches(scope),
      settings.branchIdByCode,
    );
    return {
      generatedAt: new Date().toISOString(),
      branchesShown,
      counts: foldAtmRegisterReport(toReportGroups(groups, settings.codeByBranchId), branchesShown),
    };
  }
}

export const atmRegisterReportService = new AtmRegisterReportService();
