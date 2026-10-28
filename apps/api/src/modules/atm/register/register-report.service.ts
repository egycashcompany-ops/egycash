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
//
// Banks (DEC-40): the report folds the CATALOG's banks, not a fixed six. The workbook's six are
// always shown, at their sheet positions, so the page still reads like the sheet it replaced; every
// other ACTIVE bank follows (after BRK in section 1, after NXT in section 3) in catalog order; an
// ARCHIVED one only while it still has machines in operation — it is still counted, never hidden
// while it holds a number. Any code an active entry carries is folded, so the section-1 and
// section-2 totals can never disagree. The import's 57-cell check folds the six alone (the workbook
// knows no other bank) and is untouched by any of this.
import {
  ATM_REGISTER_BRANCH_CODES,
  atmBankSeedOf,
  atmReportBankOrders,
  foldAtmRegisterReport,
  isAtmSeedBankCode,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterReportBankDto,
  type AtmRegisterReportDto,
  type AtmRegisterReportGroup,
} from '@ecms/contracts';
import { scopeSelector, type AuthContext } from '../../../shared/types';
import { type AtmBankCatalog } from '../catalogs/bank-catalog';
import {
  atmRegisterEntryRepository,
  registerScopeBranches,
  registerScopeMatch,
  type AtmRegisterActiveGroup,
} from './register.repository';
import { resolveRegisterSettings } from './register-settings';

/** Writes are validated against the catalog, so any stored code is a bank — counted as it is. */
const isBankCode = (value: string | null | undefined): value is AtmBankCode =>
  typeof value === 'string' && value !== '';

/** A code the catalog does not know (never written by a validated path) is drawn neutral grey. */
const UNKNOWN_BANK_COLOR = '#A6A6A6';

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

export interface AtmReportBanks {
  banks: AtmRegisterReportBankDto[];
  section1Banks: AtmBankCode[];
  section3Banks: AtmBankCode[];
}

/**
 * Pure (DEC-40): the banks the report folds, in the sheet's orders. The six always; then each
 * non-seed catalog bank that is active, or archived but still counted, in catalog order (`sortOrder`,
 * then code); then any counted code the catalog does not know, sorted.
 */
export const reportBanks = (
  catalog: Pick<AtmBankCatalog, 'all' | 'byCode'>,
  groups: readonly AtmRegisterReportGroup[],
): AtmReportBanks => {
  const counted = new Set<AtmBankCode>();
  for (const group of groups) {
    if (group.bankCode !== null && group.count > 0) counted.add(group.bankCode);
  }
  const extras = catalog.all
    .filter((bank) => !isAtmSeedBankCode(bank.code) && (bank.isActive || counted.has(bank.code)))
    .map((bank) => bank.code);
  const unknown = [...counted]
    .filter((code) => !isAtmSeedBankCode(code) && !catalog.byCode.has(code))
    .sort();
  const orders = atmReportBankOrders([...extras, ...unknown]);
  return {
    banks: orders.section1.map((code): AtmRegisterReportBankDto => {
      const bank = catalog.byCode.get(code);
      const seed = atmBankSeedOf(code);
      const name = bank?.name ?? seed?.name ?? { ar: code, en: code };
      return {
        code,
        name: { ar: name.ar, en: name.en },
        color: bank?.color ?? seed?.color ?? UNKNOWN_BANK_COLOR,
        isActive: bank?.isActive ?? seed !== undefined,
        isSeed: bank?.isSeed ?? seed !== undefined,
      };
    }),
    section1Banks: orders.section1,
    section3Banks: orders.section3,
  };
};

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
    const reportGroups = toReportGroups(groups, settings.codeByBranchId);
    const banks = reportBanks(settings.catalog, reportGroups);
    return {
      generatedAt: new Date().toISOString(),
      branchesShown,
      counts: foldAtmRegisterReport(reportGroups, branchesShown, banks.section1Banks),
      ...banks,
    };
  }
}

export const atmRegisterReportService = new AtmRegisterReportService();
