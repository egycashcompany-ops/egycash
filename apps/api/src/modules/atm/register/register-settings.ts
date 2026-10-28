// What the register resolves once per request (spec §5.3): the organization setting and the bank
// catalog.
//
//   atm.register.branchCodes — the workbook's `EGYCASH-n` → the ECMS branch (D4). Admin-set; empty
//                              by default, because no branch is guessed (EG-18).
//   the bank catalog         — `atm_banks` (DEC-35): which codes exist, their names, and the label
//                              written on `atm_machines.bankName` (`opsLabel`). It replaced the
//                              `atm.register.bankLabels` setting, which is no longer read here (the
//                              boot seed read it once, so a curated label carried over).
//
// The setting is read through the settings service with the organization subject, exactly as the
// mail poll reads its branch categories (mail-tickets/mail-poll.service.ts): these are facts about
// the company, not per-branch opinions.
import {
  AtmSettingKeys,
  type AtmBankCode,
  type AtmRegisterBranchCode,
  type AtmRegisterBranchCodesSetting,
} from '@ecms/contracts';
import { type ClientSession } from 'mongoose';
import { settingsService } from '../../../platform/settings';
import { loadAtmBankCatalog, type AtmBankCatalog } from '../catalogs/bank-catalog';

const ORG_SUBJECT = { userId: null, branchId: null };

export interface RegisterSettings {
  codeByBranchId: Map<string, AtmRegisterBranchCode>;
  branchIdByCode: Map<AtmRegisterBranchCode, string>;
  catalog: AtmBankCatalog;
  /** The Operations label for a bank: the catalog's `opsLabel`, else the seed's, else the code. */
  opsLabel: (bank: AtmBankCode) => string;
}

export const resolveRegisterSettings = async (
  session?: ClientSession,
): Promise<RegisterSettings> => {
  const [branchCodes, catalog] = await Promise.all([
    settingsService.resolve<AtmRegisterBranchCodesSetting>(
      AtmSettingKeys.RegisterBranchCodes,
      ORG_SUBJECT,
    ),
    loadAtmBankCatalog(session),
  ]);
  const codeByBranchId = new Map<string, AtmRegisterBranchCode>();
  const branchIdByCode = new Map<AtmRegisterBranchCode, string>();
  for (const row of branchCodes) {
    codeByBranchId.set(row.branchId, row.code);
    branchIdByCode.set(row.code, row.branchId);
  }
  return { codeByBranchId, branchIdByCode, catalog, opsLabel: catalog.opsLabel };
};

/** The label a coupled master carries for this entry: its override, else the catalog's (D5). */
export const effectiveOpsLabel = (
  entry: { opsBankLabel: string | null; bankCode: AtmBankCode | null },
  settings: Pick<RegisterSettings, 'opsLabel'>,
): string | null =>
  entry.opsBankLabel ?? (entry.bankCode === null ? null : settings.opsLabel(entry.bankCode));

/** The EGYCASH code of a branch id, or null when unmapped (or no branch). */
export const branchCodeOf = (
  branchId: { toString(): string } | null,
  settings: Pick<RegisterSettings, 'codeByBranchId'>,
): AtmRegisterBranchCode | null =>
  branchId === null ? null : (settings.codeByBranchId.get(String(branchId)) ?? null);
