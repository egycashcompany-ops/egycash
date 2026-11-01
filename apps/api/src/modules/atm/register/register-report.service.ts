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
// Branches (2026-10-28) are judged as ATM files them (`atm.branchLinks`, register-settings.ts): a
// group still filed under a linked source counts in its target's column, and ONE column stands for
// one resolved branch — its canonical code — so two codes resolving to one branch never show it
// twice, once with zeros (EGYCASH-1 → المهندسين with EGYCASH-5 → أكتوبر working as المهندسين read
// «المهندسين 0» beside «أكتوبر 14»). Each column is named by its branch's ECMS name
// (`branchNames`), as the top bar names it; the sheet's own per-code labels are the screen's
// fallback.
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
  type LocalizedString,
} from '@ecms/contracts';
import { branchRepository } from '../../../platform/organization';
import { scopeSelector, type AuthContext } from '../../../shared/types';
import { type AtmBankCatalog } from '../catalogs/bank-catalog';
import {
  atmRegisterEntryRepository,
  registerScopeBranches,
  registerScopeMatch,
  type AtmRegisterActiveGroup,
} from './register.repository';
import { resolveRegisterSettings, type RegisterBranchMapping } from './register-settings';

/** Writes are validated against the catalog, so any stored code is a bank — counted as it is. */
const isBankCode = (value: string | null | undefined): value is AtmBankCode =>
  typeof value === 'string' && value !== '';

/** A code the catalog does not know (never written by a validated path) is drawn neutral grey. */
const UNKNOWN_BANK_COLOR = '#A6A6A6';

/**
 * Pure: `$group` rows → fold groups, each under the canonical code of its RESOLVED branch. A branch
 * no code resolves to keeps its count with `branchCode:null`.
 */
export const toReportGroups = (
  groups: readonly AtmRegisterActiveGroup[],
  mapping: Pick<RegisterBranchMapping, 'canonicalCodeOf'>,
): AtmRegisterReportGroup[] =>
  groups.map((group) => ({
    branchCode: mapping.canonicalCodeOf(group._id.branchId),
    bankCode: isBankCode(group._id.bankCode) ? group._id.bankCode : null,
    count: group.count,
  }));

/**
 * Pure: the canonical codes, in sheet order, whose RESOLVED branch the scope covers — one per
 * branch, judged as `toReportGroups` files the groups, so every counted group's code is shown.
 */
export const reportBranchesShown = (
  covered: 'all' | readonly string[],
  mapping: Pick<RegisterBranchMapping, 'codesByBranchId' | 'canonicalCodeOf' | 'resolveBranch'>,
): AtmRegisterBranchCode[] => {
  const coveredBranches = covered === 'all' ? null : new Set(covered.map(mapping.resolveBranch));
  const shown = new Set<AtmRegisterBranchCode>();
  for (const branchId of mapping.codesByBranchId.keys()) {
    if (coveredBranches !== null && !coveredBranches.has(branchId)) continue;
    const code = mapping.canonicalCodeOf(branchId);
    if (code !== null) shown.add(code);
  }
  return ATM_REGISTER_BRANCH_CODES.filter((code) => shown.has(code));
};

/** Pure: each shown code → the ECMS name of its resolved branch (a branch gone: left out). */
export const reportBranchNames = (
  shown: readonly AtmRegisterBranchCode[],
  mapping: Pick<RegisterBranchMapping, 'branchIdByCode'>,
  names: ReadonlyMap<string, LocalizedString>,
): Partial<Record<AtmRegisterBranchCode, LocalizedString>> => {
  const out: Partial<Record<AtmRegisterBranchCode, LocalizedString>> = {};
  for (const code of shown) {
    const branchId = mapping.branchIdByCode.get(code);
    const name = branchId === undefined ? undefined : names.get(branchId);
    if (name !== undefined) out[code] = name;
  }
  return out;
};

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
    const branchesShown = reportBranchesShown(registerScopeBranches(scope), settings);
    const shownBranchIds = branchesShown.flatMap((code) => {
      const branchId = settings.branchIdByCode.get(code);
      return branchId === undefined ? [] : [branchId];
    });
    const names = new Map<string, LocalizedString>(
      (await branchRepository.findByIdsSystem(shownBranchIds)).map((branch) => [
        String(branch._id),
        { ar: branch.name.ar, en: branch.name.en },
      ]),
    );
    const reportGroups = toReportGroups(groups, settings);
    const banks = reportBanks(settings.catalog, reportGroups);
    return {
      generatedAt: new Date().toISOString(),
      branchesShown,
      branchNames: reportBranchNames(branchesShown, settings, names),
      counts: foldAtmRegisterReport(reportGroups, branchesShown, banks.section1Banks),
      ...banks,
    };
  }
}

export const atmRegisterReportService = new AtmRegisterReportService();
