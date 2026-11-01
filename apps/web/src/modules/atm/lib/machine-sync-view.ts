// The machine sync dialog's pure parts: which outcome groups to show and in what order, what an
// apply will do, what it did, and a refused upload in the reader's words.
import {
  ErrorCodes,
  type AtmMachineSyncAppliedDto,
  type AtmMachineSyncDto,
  type AtmMachineSyncRowDto,
  type AtmMachineSyncStatus,
  type Locale,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The groups a comparison shows, in reading order: what an apply does first, then the rest. */
export const SYNC_GROUPS = [
  'add',
  'reactivate',
  'update',
  'elsewhere',
  'invalid',
  'duplicate',
  'extra',
] as const;
export type SyncGroup = (typeof SYNC_GROUPS)[number];

/** The rows of one outcome, in the file's order. */
export const rowsOfStatus = (
  dto: AtmMachineSyncDto,
  status: Exclude<AtmMachineSyncStatus, 'same'>,
): AtmMachineSyncRowDto[] => dto.rows.filter((row) => row.status === status);

/** How many rows an apply would write: added, brought back, edited. */
export const syncWrites = (dto: AtmMachineSyncDto): number =>
  dto.counts.add + dto.counts.reactivate + dto.counts.update;

/** What an apply did, as counts — zero ones dropped. */
export const appliedCounts = (
  applied: AtmMachineSyncAppliedDto,
): { key: 'added' | 'reactivated' | 'updated' | 'refused' | 'skipped'; count: number }[] =>
  (
    [
      ['added', applied.added.length],
      ['reactivated', applied.reactivated.length],
      ['updated', applied.updated.length],
      ['refused', applied.refused.length],
      ['skipped', applied.skipped.length],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, count }));

/** The file-level reason a refusal named, if any (`details[].field === 'file'`). */
const fileReason = (error: ApiError): string | undefined =>
  error.details?.find((d) => d.field === 'file')?.code;

/** A refused comparison or apply in the reader's words; anything else as the app says it. */
export const syncErrorText = (error: unknown, t: Translate, locale: Locale): string => {
  if (!(error instanceof ApiError)) return errorMessage(error, locale);
  if (error.code === ErrorCodes.ATM_MACHINE_SYNC_FILE_CHANGED) {
    return t('atm.machineSync.error.changed');
  }
  const reason = fileReason(error);
  if (reason === 'MISSING_HEADER') return t('atm.machineSync.error.header');
  if (reason === 'MISSING_SHEET') return t('atm.machineSync.error.sheet');
  if (reason === 'UNREADABLE') return t('atm.machineSync.error.unreadable');
  if (reason === 'TOO_LARGE') return t('atm.machineSync.error.tooLarge');
  return errorMessage(error, locale);
};
