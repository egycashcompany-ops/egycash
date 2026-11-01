// «مقارنة بملف» — a machines file (Bank, ID, ATM Name, Area) compared with the branch the top bar
// points at, then, on the reader's say-so, the branch made to match it (POST /atm/machines/sync).
//
// The owner (2026-11-01): «ضرورى جداً اتأكد إن الماكينات دى متضافه على السيستم لفرع المهندسين» —
// «البنك والكود والأسم والمنطقة». THE COMPARISON IS THE POINT: nothing is written until «تطبيق», and
// the dialog says first what an apply would do — machines added, archived ones brought back,
// machines whose bank, name or area changes — and what it never does: a machine working in another
// branch is not added here, a row the file cannot say is left out, a code listed twice counts once,
// and a machine on the branch the file does not list is only shown, never deleted. The SAME `File`
// is posted for the apply with the comparison's hash (the register import's rule); the answer is
// the comparison made again, so after an apply the reader sees the branch as it now is.
import { useEffect, useState } from 'react';
import {
  type AtmMachineSyncAppliedDto,
  type AtmMachineSyncDto,
  type AtmMachineSyncField,
  type AtmMachineSyncRowDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { FileUpload } from '../../../shared/ui/FileUpload';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import { useAtmRefLabelOptions, useSyncAtmMachines } from '../api/atm-queries';
import {
  SYNC_GROUPS,
  appliedCounts,
  appliedProblemLines,
  syncFileRows,
  rowsOfStatus,
  syncErrorText,
  syncWrites,
  type SyncGroup,
} from '../lib/machine-sync-view';
import { AddBranchLine, UnmappedBranchNotice, addBlocked } from './DataEditDialogs';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_MB = 10;
const TH = 'p-2 text-start text-xs font-medium text-slate-500 dark:text-slate-400';
const TD = 'p-2 align-top';

const GROUP_TONE: Record<SyncGroup, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  add: 'success',
  reactivate: 'success',
  update: 'info',
  elsewhere: 'warning',
  invalid: 'danger',
  duplicate: 'warning',
  extra: 'neutral',
};

/** One field of an edited machine: the old value struck through beside the file's. */
const Changed = ({
  row,
  field,
}: {
  row: AtmMachineSyncRowDto;
  field: AtmMachineSyncField;
}): JSX.Element => {
  const next = row.file[field];
  const before = row.current?.[field] ?? '';
  return row.changes.includes(field) ? (
    <span className="space-x-1 rtl:space-x-reverse" data-sync-changed={field}>
      <del className="text-slate-400">{before}</del>
      <span className="font-medium text-brand-700 dark:text-brand-300">{next}</span>
    </span>
  ) : (
    <span>{next}</span>
  );
};

export const GroupTable = ({
  dto,
  group,
}: {
  dto: AtmMachineSyncDto;
  group: SyncGroup;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const count = dto.counts[group];
  if (count === 0) return null;
  const head = (
    // The summary keeps its own display, so the ▸/▾ marker shows the group opens (review finding).
    <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
      <span className="inline-flex items-center gap-2 align-middle">
        <Badge tone={GROUP_TONE[group]}>{formatNumber(count, locale)}</Badge>
        {t(`atm.machineSync.group.${group}`)}
      </span>
    </summary>
  );
  const note = (
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
      {t(`atm.machineSync.groupHint.${group}`)}
    </p>
  );
  if (group === 'extra') {
    return (
      <details data-sync-group={group}>
        {head}
        {note}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className={TH}>{t('atm.common.machineId')}</th>
                <th className={TH}>{t('atm.common.bank')}</th>
                <th className={TH}>{t('atm.machineSync.name')}</th>
                <th className={TH}>{t('atm.common.area')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {dto.extra.map((m) => (
                <tr key={m.machineCode}>
                  <td className={`${TD} tabular-nums`} dir="ltr">
                    {m.machineCode}
                  </td>
                  <td className={TD}>{m.bank}</td>
                  <td className={TD}>{m.name}</td>
                  <td className={TD}>{m.area}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    );
  }
  const rows = rowsOfStatus(dto, group);
  const problem = group === 'invalid' || group === 'duplicate' || group === 'elsewhere';
  return (
    <details data-sync-group={group} open={group === 'update' || group === 'add'}>
      {head}
      {note}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={TH}>{t('atm.machineSync.row')}</th>
              <th className={TH}>{t('atm.common.machineId')}</th>
              <th className={TH}>{t('atm.common.bank')}</th>
              <th className={TH}>{t('atm.machineSync.name')}</th>
              <th className={TH}>{t('atm.common.area')}</th>
              {problem && <th className={TH}>{t('atm.machineSync.why')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.row}>
                <td className={`${TD} tabular-nums text-slate-500`} dir="ltr">
                  {row.row}
                </td>
                <td className={`${TD} tabular-nums`} dir="ltr">
                  {row.machineCode}
                </td>
                <td className={TD}>
                  <Changed row={row} field="bank" />
                </td>
                <td className={TD}>
                  <Changed row={row} field="name" />
                </td>
                <td className={TD}>
                  <Changed row={row} field="area" />
                </td>
                {problem && (
                  <td className={TD}>
                    {row.issue !== null
                      ? t(`atm.machineSync.issue.${row.issue}`)
                      : row.elsewhere !== null
                        ? t(`atm.machineSync.elsewhere.${row.elsewhere}`)
                        : t('atm.machineSync.firstRow', { row: row.firstRow ?? 0 })}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
};

/** What an apply could not do, one line per reason — the codes named, as the bulk add names them. */
export const AppliedProblems = ({
  applied,
}: {
  applied: AtmMachineSyncAppliedDto;
}): JSX.Element | null => {
  const t = useT();
  const lines = appliedProblemLines(applied).map(({ key, params }) => t(key, params));
  if (lines.length === 0) return null;
  return (
    <ul
      className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 py-2 pe-3 ps-7 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      data-sync-problems="true"
    >
      {lines.map((line) => (
        <li key={line} dir="auto">
          {line}
        </li>
      ))}
    </ul>
  );
};

export const MachineSyncDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const options = useAtmRefLabelOptions(null, open);
  const run = useSyncAtmMachines();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AtmMachineSyncDto | null>(null);
  const [reading, setReading] = useState(false);
  const blocked = addBlocked(options.data);
  const busy = run.isPending || reading;

  // Every opening starts clean: a comparison from before may no longer be the branch (review
  // finding). Not while a run is in flight — its answer still has to land.
  useEffect(() => {
    if (!open || run.isPending) return;
    setFile(null);
    setResult(null);
    run.reset();
  }, [open]);

  const pick = async (files: File[]): Promise<void> => {
    const picked = files[0];
    if (busy || picked === undefined) return;
    setReading(true);
    try {
      // The bytes are read once, here: the compare and the apply post the same snapshot, so a file
      // saved again in Excel meanwhile cannot fail the upload (review finding).
      setFile(new File([await picked.arrayBuffer()], picked.name, { type: picked.type }));
      setResult(null);
      run.reset();
    } finally {
      setReading(false);
    }
  };

  const changeFile = (): void => {
    if (busy) return;
    setFile(null);
    setResult(null);
    run.reset();
  };

  const compare = (): void => {
    if (file === null || blocked || busy) return;
    run.mutate({ file, apply: false }, { onSuccess: setResult });
  };

  const apply = (): void => {
    if (file === null || result === null || blocked || busy) return;
    run.mutate(
      { file, apply: true, fileSha256: result.fileSha256, planDigest: result.planDigest },
      {
        onSuccess: (applied) => {
          setResult(applied);
          const done = applied.applied === null ? [] : appliedCounts(applied.applied);
          const text =
            done.length === 0
              ? t('atm.machineSync.appliedNothing')
              : done
                  .map(({ key, count }) =>
                    t(`atm.machineSync.applied.${key}`, { count: formatNumber(count, locale) }),
                  )
                  .join(locale === 'ar' ? '، ' : ', ');
          const problems = applied.applied === null ? [] : appliedProblemLines(applied.applied);
          if (problems.length > 0) toast.warning(text);
          else toast.success(text);
        },
        onError: (error) => {
          // What is on screen is no longer the branch (a refused or cut-off apply): compare again.
          setResult(null);
          toast.error(syncErrorText(error, t, locale));
        },
      },
    );
  };

  const writes = result === null ? 0 : syncWrites(result);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('atm.machineSync.title')}
      size="xl"
      tall
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('atm.common.close')}
          </Button>
          {result !== null && (
            <Button
              disabled={writes === 0 || busy || blocked}
              loading={run.isPending && result !== null}
              onClick={apply}
              data-sync-action="apply"
            >
              {writes === 0
                ? t('atm.machineSync.nothingToApply')
                : t('atm.machineSync.apply', {
                    add: formatNumber(result.counts.add + result.counts.reactivate, locale),
                    update: formatNumber(result.counts.update, locale),
                  })}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <AddBranchLine options={options.data} />
        <UnmappedBranchNotice options={options.data} />
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('atm.machineSync.intro')}</p>
        {file === null ? (
          <FileUpload
            accept={XLSX}
            maxSizeMb={MAX_MB}
            onFiles={(files) => void pick(files)}
            disabled={busy}
          />
        ) : (
          // The chosen file, held by the dialog itself: no picker control can drop it mid-run.
          <div className="space-y-1" data-sync-file="true">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <span
                className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200"
                dir="auto"
              >
                {file.name}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={changeFile}>
                {t('atm.machineSync.changeFile')}
              </Button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('atm.machineSync.repickHint')}
            </p>
          </div>
        )}
        {run.isError && (
          <p
            role="alert"
            className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
          >
            {syncErrorText(run.error, t, locale)}
          </p>
        )}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={file === null || busy || blocked}
            loading={run.isPending && result === null}
            onClick={compare}
            data-sync-action="compare"
          >
            {t('atm.machineSync.compare')}
          </Button>
        </div>
        {result !== null && (
          <div className="space-y-3" data-sync-result="true">
            {result.applied !== null && (
              <>
                <p
                  role="status"
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                >
                  {t('atm.machineSync.appliedLine')}
                </p>
                <AppliedProblems applied={result.applied} />
              </>
            )}
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {t('atm.machineSync.summary', {
                total: formatNumber(syncFileRows(result), locale),
                same: formatNumber(result.counts.same, locale),
              })}
            </p>
            <div className="space-y-3">
              {SYNC_GROUPS.map((group) => (
                <GroupTable key={group} dto={result} group={group} />
              ))}
            </div>
            {writes === 0 && result.counts.elsewhere === 0 && result.counts.invalid === 0 && (
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                {t('atm.machineSync.allMatch')}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};
