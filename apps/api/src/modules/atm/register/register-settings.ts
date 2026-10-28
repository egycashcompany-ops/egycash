// What the register resolves once per request (spec §5.3): the organization settings and the bank
// catalog.
//
//   atm.register.branchCodes — the workbook's `EGYCASH-n` → the ECMS branch (D4). Admin-set; empty
//                              by default, because no branch is guessed (EG-18).
//   atm.branchLinks          — which branch works as which (branch-links/link-context.ts). The code
//                              mapping is READ through it, one lookup (`links.get(id) ?? id`):
//                              a code mapped to a linked source is its target's, so its rows are
//                              filed, shown and counted under the target. The owner (2026-10-28):
//                              «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم والبيانات دي
//                              متسجله إنها المهندسين» — and his report: a Mohandessin machine
//                              shown only under «كل الشركة», because the code its workbook rows
//                              carry was mapped to the linked October and the refiner moves the
//                              caller, never the mapping. The setting stays RAW (the card saves
//                              what it read); a link-aware refinement on its schema would read
//                              today's stored value as the default `[]`.
//   the bank catalog         — `atm_banks` (DEC-35): which codes exist, their names, and the label
//                              written on `atm_machines.bankName` (`opsLabel`). It replaced the
//                              `atm.register.bankLabels` setting, which is no longer read here (the
//                              boot seed read it once, so a curated label carried over).
//
// The setting is read through the settings service with the organization subject, exactly as the
// mail poll reads its branch categories (mail-tickets/mail-poll.service.ts): these are facts about
// the company, not per-branch opinions.
//
// Two codes may resolve to ONE branch (EGYCASH-1 → المهندسين, EGYCASH-5 → أكتوبر working as
// المهندسين), so a branch has codes, not a code: wherever one code must stand for a branch — the
// Data Report's columns, an entry's `branchCode` — it is the CANONICAL one, the code mapped
// directly to that branch, else the first in sheet order. Naming a branch is never a code's job
// any more: the screens name it as the top bar does, by its ECMS name.
import {
  ATM_REGISTER_BRANCH_CODES,
  AtmSettingKeys,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterBranchCodesSetting,
} from '@ecms/contracts';
import { type ClientSession } from 'mongoose';
import { settingsService } from '../../../platform/settings';
import { loadAtmBankCatalog, type AtmBankCatalog } from '../catalogs/bank-catalog';
import { branchesFiledAs, linkedBranchOf, loadAtmBranchLinks } from '../shared/atm-context';

const ORG_SUBJECT = { userId: null, branchId: null };

/** A branch id as stored or sent: an ObjectId, its hex, or nothing. */
type BranchRef = { toString(): string } | null | undefined;

/** The code mapping as ATM reads it: the setting, through the links. */
export interface RegisterBranchMapping {
  /** The setting as stored — what the settings card saved and edits; never where rows go. */
  rawBranchIdByCode: ReadonlyMap<AtmRegisterBranchCode, string>;
  /** Code → the branch its rows are filed and shown under: the raw branch through the links. */
  branchIdByCode: ReadonlyMap<AtmRegisterBranchCode, string>;
  /** Resolved branch → every code that resolves to it, in sheet order. */
  codesByBranchId: ReadonlyMap<string, readonly AtmRegisterBranchCode[]>;
  /** A branch as ATM files it: a linked source is its target (one lookup). */
  resolveBranch: (branchId: string) => string;
  /**
   * Every linked source working as the branch's resolved branch — whether or not a code names it:
   * once «نقل البيانات» re-points a source's code to its target, the source is still read as the
   * target (the list filter's `branchesFiledAs`), and a top bar or a filter remembered on it must
   * still find the target's option (`AtmRegisterMetaBranchOptionDto.sourceBranchIds`).
   */
  sourcesOf: (branchId: string) => string[];
  /** The canonical code of the branch's RESOLVED branch; null for none, or no branch. */
  canonicalCodeOf: (branchId: BranchRef) => AtmRegisterBranchCode | null;
  /** DEC-10: some code resolves to the branch's resolved branch — receipts may be filed there. */
  isMapped: (branchId: BranchRef) => boolean;
}

export interface RegisterSettings extends RegisterBranchMapping {
  catalog: AtmBankCatalog;
  /** The Operations label for a bank: the catalog's `opsLabel`, else the seed's, else the code. */
  opsLabel: (bank: AtmBankCode) => string;
}

/**
 * Pure: the mapping from the stored setting and the links (`links`: source → target). Ids are
 * compared lower-cased, as `String(ObjectId)` writes them; the links are stored that way.
 */
export const registerBranchMapping = (
  rows: AtmRegisterBranchCodesSetting,
  links: ReadonlyMap<string, string>,
): RegisterBranchMapping => {
  const resolveBranch = (branchId: string): string => linkedBranchOf(links, branchId);
  const rawBranchIdByCode = new Map<AtmRegisterBranchCode, string>();
  for (const row of rows) rawBranchIdByCode.set(row.code, row.branchId.toLowerCase());

  const branchIdByCode = new Map<AtmRegisterBranchCode, string>();
  const codesByBranchId = new Map<string, AtmRegisterBranchCode[]>();
  for (const code of ATM_REGISTER_BRANCH_CODES) {
    const raw = rawBranchIdByCode.get(code);
    if (raw === undefined) continue;
    const resolved = resolveBranch(raw);
    branchIdByCode.set(code, resolved);
    codesByBranchId.set(resolved, [...(codesByBranchId.get(resolved) ?? []), code]);
  }
  // Mapped directly wins: EGYCASH-1 → المهندسين stays Mohandessin's column when EGYCASH-5 comes in
  // through أكتوبر — otherwise «المهندسين» would read 0 under its own name (map-register §4).
  const canonical = new Map<string, AtmRegisterBranchCode>();
  for (const [branchId, codes] of codesByBranchId) {
    const direct = codes.find((code) => rawBranchIdByCode.get(code) === branchId) ?? codes[0];
    if (direct !== undefined) canonical.set(branchId, direct);
  }
  const resolvedOf = (branchId: BranchRef): string | null =>
    branchId === null || branchId === undefined ? null : resolveBranch(String(branchId));

  return {
    rawBranchIdByCode,
    branchIdByCode,
    codesByBranchId,
    resolveBranch,
    sourcesOf: (branchId) => branchesFiledAs(links, branchId).slice(1),
    canonicalCodeOf: (branchId) => {
      const resolved = resolvedOf(branchId);
      return resolved === null ? null : (canonical.get(resolved) ?? null);
    },
    isMapped: (branchId) => {
      const resolved = resolvedOf(branchId);
      return resolved !== null && codesByBranchId.has(resolved);
    },
  };
};

export const resolveRegisterSettings = async (
  session?: ClientSession,
): Promise<RegisterSettings> => {
  const [branchCodes, links, catalog] = await Promise.all([
    settingsService.resolve<AtmRegisterBranchCodesSetting>(
      AtmSettingKeys.RegisterBranchCodes,
      ORG_SUBJECT,
    ),
    loadAtmBranchLinks(),
    loadAtmBankCatalog(session),
  ]);
  return { ...registerBranchMapping(branchCodes, links), catalog, opsLabel: catalog.opsLabel };
};

/** The label a coupled master carries for this entry: its override, else the catalog's (D5). */
export const effectiveOpsLabel = (
  entry: { opsBankLabel: string | null; bankCode: AtmBankCode | null },
  settings: Pick<RegisterSettings, 'opsLabel'>,
): string | null =>
  entry.opsBankLabel ?? (entry.bankCode === null ? null : settings.opsLabel(entry.bankCode));
