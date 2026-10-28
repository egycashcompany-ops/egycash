// ATM settings — declared at module load, before boot resolves any value.
import { z } from 'zod';
import {
  ATM_DEFAULT_BANK_LABELS_SETTING,
  AtmBranchLinksSettingSchema,
  AtmRegisterBankLabelsSettingSchema,
  AtmBankCodeSchema,
  AtmRegisterBranchCodesSettingSchema,
  AtmSettingKeys,
  objectId,
} from '@ecms/contracts';
import { declareSetting } from '../../platform/settings';

export const registerAtmSettings = (): void => {
  declareSetting({
    key: AtmSettingKeys.MaintenanceLeaderDepartmentIds,
    description:
      'HR department ids whose employees populate the maintenance close-modal assignee list. ' +
      'The legacy hardcoded the department NAME "الصراف الالى" (contad_app.js:1110-1112); the ' +
      'org chart owns names here, so the constant became configuration. Empty means the modal ' +
      'offers nobody and maintenance cannot be closed until it is set.',
    schema: z.array(objectId()).max(50),
    defaultValue: [],
    // Organization only: who staffs the ATM department is one fact about the company, not a
    // per-branch opinion (the operations CrewDepartmentIds precedent).
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: AtmSettingKeys.MailBranchCategories,
    description:
      "branchId → the mailbox category that marks a maintenance mail as that branch's. The " +
      'legacy reader tagged everything with one hard-coded "Green Category" ' +
      '(Automation/src/index.js:224), which worked while each branch had its own reader; one ' +
      'central reader needs the tag to say which branch. Empty means nothing is tagged — the ' +
      'message is still marked read, because the ticket is the record and the tag a convenience.',
    schema: z
      .array(z.object({ branchId: objectId(), category: z.string().min(1).max(64) }).strict())
      .max(100),
    defaultValue: [],
    // Organization only: which colour means which branch is one fact about one shared mailbox.
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: AtmSettingKeys.RegisterBranchCodes,
    description:
      "The register workbook's `EGYCASH-n` branch codes (column A of the ATMs sheet) → the ECMS " +
      'branch each one is (D4). Empty means no register receipt is possible (DEC-10) and the ' +
      'workbook import is blocked (`branchUnmapped`); nothing is guessed — which branch EGYCASH-7 ' +
      'is, is the administrator’s answer (EG-18).',
    schema: AtmRegisterBranchCodesSettingSchema,
    defaultValue: [],
    // Organization only: what a code on the owner's sheet means is one fact about the company.
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: AtmSettingKeys.RegisterBankLabels,
    description:
      'RETIRED — read once by the bank catalog seed (DEC-35). It mapped a register bank code → ' +
      'the bank label written on the Operations machine (`atm_machines.bankName`, D5); each ' +
      "catalog bank's own `opsLabel` does that now, edited on the register's banks dialog. Still " +
      'declared so a stored value keeps validating; changing it changes nothing.',
    schema: AtmRegisterBankLabelsSettingSchema,
    defaultValue: ATM_DEFAULT_BANK_LABELS_SETTING,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: AtmSettingKeys.SettlementBanks,
    description:
      'The banks the Settlements, Preparation and Control pages offer. Al Baraka first (S-10); a ' +
      'bank is added once its import profile exists (docs/12-planning/atm-settlements-phase1.md ' +
      '§7.4, DS-24). Codes of the bank catalog (DEC-35): a bank added there is plannable once it ' +
      'is listed here; a code the catalog does not know is ignored, an archived one still counts.',
    // The catalog's codes, not the six: a seventh bank is enabled exactly as the five non-BRK
    // banks are today. 50 is a ceiling on a hand-kept list, not a business rule.
    schema: z.array(AtmBankCodeSchema).max(50),
    defaultValue: ['BRK'],
    // Organization only: which banks the settlement pages offer is one fact about the company.
    allowedScopes: ['organization'],
  });
  // The owner (2026-10-28), for ATM only: «فرع أكتوبر شغال هو والمهندسين مع بعض بكل بياناتهم
  // والبيانات دي متسجله إنها المهندسين». Read on every ATM request (branch-links/link-context.ts).
  declareSetting({
    key: AtmSettingKeys.BranchLinks,
    description:
      'Branches that work as one in ATM: on an ATM request a user placed in `branchId` is ' +
      'answered as if placed in `actsAsBranchId` — they see its ATM data and what they write is ' +
      'filed under it; nothing outside ATM changes. Empty means no branch acts as another. ' +
      'Edited on /atm/settings, which also checks that both branches exist and are active.',
    schema: AtmBranchLinksSettingSchema,
    defaultValue: [],
    // Organization only: which branch works as which is one fact about the company.
    allowedScopes: ['organization'],
  });
};
