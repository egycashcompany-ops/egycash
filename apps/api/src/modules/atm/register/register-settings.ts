// The register's two organization settings, resolved once per request (spec §5.3).
//
//   atm.register.branchCodes — the workbook's `EGYCASH-n` → the ECMS branch (D4). Admin-set; empty
//                              by default, because no branch is guessed (EG-18).
//   atm.register.bankLabels  — bankCode → the label written on `atm_machines.bankName` (D5). A
//                              stored value that omits a bank falls back to that bank's default.
//
// Read through the settings service with the organization subject, exactly as the mail poll reads
// its branch categories (mail-tickets/mail-poll.service.ts): these are facts about the company,
// not per-branch opinions.
import {
  ATM_DEFAULT_OPS_BANK_LABELS,
  AtmSettingKeys,
  type AtmBankCode,
  type AtmRegisterBankLabelsSetting,
  type AtmRegisterBranchCode,
  type AtmRegisterBranchCodesSetting,
} from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';

const ORG_SUBJECT = { userId: null, branchId: null };

export interface RegisterSettings {
  codeByBranchId: Map<string, AtmRegisterBranchCode>;
  branchIdByCode: Map<AtmRegisterBranchCode, string>;
  /** The Operations label for a bank: the setting's, else the D5 default. */
  opsLabel: (bank: AtmBankCode) => string;
}

export const resolveRegisterSettings = async (): Promise<RegisterSettings> => {
  const [branchCodes, bankLabels] = await Promise.all([
    settingsService.resolve<AtmRegisterBranchCodesSetting>(
      AtmSettingKeys.RegisterBranchCodes,
      ORG_SUBJECT,
    ),
    settingsService.resolve<AtmRegisterBankLabelsSetting>(
      AtmSettingKeys.RegisterBankLabels,
      ORG_SUBJECT,
    ),
  ]);
  const codeByBranchId = new Map<string, AtmRegisterBranchCode>();
  const branchIdByCode = new Map<AtmRegisterBranchCode, string>();
  for (const row of branchCodes) {
    codeByBranchId.set(row.branchId, row.code);
    branchIdByCode.set(row.code, row.branchId);
  }
  const labels = new Map<AtmBankCode, string>(bankLabels.map((row) => [row.bankCode, row.label]));
  return {
    codeByBranchId,
    branchIdByCode,
    opsLabel: (bank) => labels.get(bank) ?? ATM_DEFAULT_OPS_BANK_LABELS[bank],
  };
};

/** The label a coupled master carries for this entry: its override, else the setting's (D5). */
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
