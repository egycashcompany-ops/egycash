// What every settlements, preparation and control service asks first: which branch the page works
// in, whether the bank is one the pages offer, and the shared answers when they are not
// (docs/12-planning/atm-settlements-phase1.md §6.2, DS-22, DS-24).
//
// THE WORK BRANCH. `resolveWorkBranch` (`shared/branch-scope.ts`) with the page's own key pair; a
// blocked resolution is ONE answer everywhere but `GET /context`: 422 `ATM_WORK_BRANCH_REQUIRED`
// with `{ field: 'branch', code: 'CHOOSE_BRANCH' | 'NO_BRANCH' }`. A branch the browser sends may
// only narrow inside the view key's reach (`narrowToBranch`, 400 `OUT_OF_REACH`).
//
// THE BANKS. `atm.settlements.banks` (organization, default `['BRK']`, S-10), read through the
// settings service with the organization subject, as `register/register-settings.ts` reads its own.
// Since the bank catalog (DEC-35) the setting holds catalog codes; a code the catalog does not know
// is dropped, so a typo in the setting offers no phantom bank. An ARCHIVED bank is kept: archiving
// must not silently break a plan day that is running — an administrator takes it out of the
// setting.
import {
  AtmSettingKeys,
  ErrorCodes,
  type AtmBankCode,
  type LocalizedString,
} from '@ecms/contracts';
import { branchRepository } from '../../../../platform/organization';
import { settingsService } from '../../../../platform/settings';
import { AtmBankModel } from '../../catalogs/bank.model';
import { AppError, ValidationError } from '../../../../shared/errors';
import { scopeSelector, type AuthContext } from '../../../../shared/types';
import { narrowToBranch, resolveWorkBranch } from '../../shared/branch-scope';

const ORG_SUBJECT = { userId: null, branchId: null };

/** DS-24: the banks the Settlements, Preparation and Control pages offer — catalog codes only. */
export const enabledSettlementBanks = async (): Promise<AtmBankCode[]> => {
  const [enabled, known] = await Promise.all([
    settingsService.resolve<AtmBankCode[]>(AtmSettingKeys.SettlementBanks, ORG_SUBJECT),
    AtmBankModel.distinct('code', { isDeleted: false }).exec() as Promise<unknown[]>,
  ]);
  const catalog = new Set(known);
  return enabled.filter((code) => catalog.has(code));
};

/** 422 `ATM_SETTLEMENT_BANK_NOT_ENABLED` unless the bank is in the setting. */
export const requireEnabledBank = async (bankCode: AtmBankCode): Promise<void> => {
  if ((await enabledSettlementBanks()).includes(bankCode)) return;
  throw new AppError(
    ErrorCodes.ATM_SETTLEMENT_BANK_NOT_ENABLED,
    422,
    'this bank is not enabled for settlements',
    { details: [{ field: 'bankCode', code: 'NOT_ENABLED', message: bankCode }] },
  );
};

export const workBranchRequired = (blocked: 'chooseBranch' | 'noBranch'): AppError =>
  new AppError(
    ErrorCodes.ATM_WORK_BRANCH_REQUIRED,
    422,
    blocked === 'chooseBranch'
      ? 'choose one branch in the top bar first'
      : 'your account reaches no branch for this page',
    {
      details: [
        {
          field: 'branch',
          code: blocked === 'chooseBranch' ? 'CHOOSE_BRANCH' : 'NO_BRANCH',
          message: blocked,
        },
      ],
    },
  );

/** The work branch of a page's key pair, or the one 422. */
export const requireWorkBranch = async (
  ctx: AuthContext,
  viewKey: string,
  writeKey: string,
): Promise<{ branchId: string; canWrite: boolean }> => {
  const work = await resolveWorkBranch(ctx, viewKey, writeKey);
  if (work.branchId === null) throw workBranchRequired(work.blocked);
  return work;
};

/**
 * A read's branch: the browser's, when it sends one inside the view key's reach (400 otherwise),
 * else the page's work branch (422 when blocked).
 */
export const readBranch = async (
  ctx: AuthContext,
  viewKey: string,
  writeKey: string,
  branchId: string | undefined,
): Promise<string> => {
  if (branchId !== undefined) {
    narrowToBranch(scopeSelector(ctx, viewKey), branchId);
    return branchId;
  }
  return (await requireWorkBranch(ctx, viewKey, writeKey)).branchId;
};

/** 400 `BRANCH_MISMATCH`: the body names another branch than the one the page works in. */
export const branchMismatch = (field = 'body.branchId'): ValidationError =>
  new ValidationError([
    {
      field,
      code: 'BRANCH_MISMATCH',
      message: 'the request belongs to another branch than the one being worked in — reload',
    },
  ]);

export const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The branch's display name; an id that names no branch reads as its id. */
export const branchNameOf = async (branchId: string): Promise<LocalizedString> => {
  const [branch] = await branchRepository.findByIdsSystem([branchId]);
  return branch?.name ?? { ar: branchId, en: branchId };
};

/** 'YYYY-MM-DD' + n days (a pure calendar step). */
export const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
