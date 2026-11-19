// «رفع صور الموظفين» — every employee's photo in one go, matched by the code in each file's name.
//
// «عندى صور الموظفين كلهم عايز أرفعهم دفع واحده متسمى كل صورة بالكود + أسم الموظف (الكود صحيح أكيد لكن
// الأسماء ممكن يبقي فيها حروف متلغبطه أو مسافات)» and «غير كله باللى هبعته جديد». The rules are in
// `lib/photo-batch.ts` (who each file is for) and `lib/photo-prepare.ts` (the crop the card prints);
// this is the screen:
//
// 1. Pick the photos, or a whole folder, or drop them here.
// 2. Each is matched by its code; the table says, before anything is sent, which are ready (and
//    whose current photo they replace), which code nobody holds, which two files name one employee,
//    and which file's name does not look like the employee it matched.
// 3. «رفع» sends the ready ones, two at a time, each cut around its face first, exactly as the
//    profile's own photo is. A failure is said on its row and can be tried again; «إيقاف» stops
//    after the ones under way.
//
// The dialog does not close on a stray click, and asks before closing while photos are going up.
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type EmployeeCodeMatchDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { markActivity } from '../../../../../platform/auth/idle-session';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Checkbox } from '../../../../../shared/ui/form';
import { UploadIcon } from '../../../../../shared/ui/icons';
import { cn } from '../../../../../shared/lib/cn';
import { errorMessage } from '../../../../../shared/lib/errors';
import { EMPLOYEE_PHOTO_ACCEPT, lookupEmployeeCodes, uploadEmployeePhotoFile } from '../api/employee-photo';
import {
  codesToLookUp,
  countByStatus,
  planPhotoBatch,
  type PhotoFileInput,
  type PhotoRow,
} from '../lib/photo-batch';
import { prepareBatchPhoto, readyFaceSearch } from '../lib/photo-prepare';
import { runQueue } from '../lib/photo-batch-run';

interface PickedFile extends PhotoFileInput {
  file: File;
}

type Progress =
  | { state: 'waiting' }
  | { state: 'preparing' }
  | { state: 'uploading' }
  | { state: 'done'; cropped: boolean; shrunk: boolean }
  | { state: 'failed'; message: string };

const keyOf = (file: File): string =>
  `${(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}:${String(file.size)}`;

/** The files of a drop, folders opened (as the folder picker does). */
const filesOfDrop = async (items: DataTransferItemList): Promise<File[]> => {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      out.push(await new Promise<File>((ok, fail) => fileEntry.file(ok, fail)));
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // A folder's entries come in pages: read until an empty one.
      for (;;) {
        const page = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (page.length === 0) break;
        for (const child of page) await walk(child);
      }
    }
  };
  // Taken synchronously: the list empties once the drop event returns.
  const entries = [...items]
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  for (const entry of entries) await walk(entry);
  return out;
};

const TONE = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  muted: 'text-slate-500 dark:text-slate-400',
} as const;

/**
 * One file's row. Memoized: a run of 2,700 photos changes one row at a time, and only that row
 * is drawn again — the table is not rebuilt for every photo that moves on.
 */
const PhotoRowView = memo(function PhotoRowView({
  row,
  run,
  running,
  locale,
  onToggle,
}: {
  row: PhotoRow;
  run: Progress | undefined;
  running: boolean;
  locale: Locale;
  onToggle: (key: string) => void;
}): JSX.Element {
  const t = useT();
  const status = ((): { text: string; tone: keyof typeof TONE } => {
    if (run?.state === 'done')
      return run.cropped
        ? { text: t('employees.photoBatch.doneCropped'), tone: 'ok' }
        : {
            text: t(run.shrunk ? 'employees.photoBatch.doneShrunk' : 'employees.photoBatch.doneNoFace'),
            tone: 'warn',
          };
    if (run?.state === 'failed') return { text: run.message, tone: 'bad' };
    if (run?.state === 'preparing') return { text: t('employees.photoBatch.preparing'), tone: 'muted' };
    if (run?.state === 'uploading') return { text: t('employees.photoBatch.uploading'), tone: 'muted' };
    if (run?.state === 'waiting') return { text: t('employees.photoBatch.waiting'), tone: 'muted' };
    switch (row.status) {
      case 'ready':
        return {
          text:
            row.employee?.photoFileId !== null
              ? t('employees.photoBatch.readyReplace')
              : t('employees.photoBatch.ready'),
          tone: 'ok',
        };
      case 'noCode':
        return { text: t('employees.photoBatch.noCode'), tone: 'bad' };
      case 'unknownCode':
        return { text: t('employees.photoBatch.unknownCode'), tone: 'bad' };
      case 'duplicate':
        return { text: t('employees.photoBatch.duplicate'), tone: 'warn' };
      case 'unsupported':
        return { text: t('employees.photoBatch.unsupported'), tone: 'bad' };
      case 'excluded':
        return { text: t('employees.photoBatch.excluded'), tone: 'muted' };
    }
  })();
  return (
    <tr data-photo-row={row.status}>
      <td className="px-2 py-1.5">
        {/* Only a photo that names an employee can be left out or put back; the rest never go. */}
        {row.employee !== null && row.status !== 'unsupported' && (
          <input
            type="checkbox"
            aria-label={t('employees.photoBatch.include', { name: row.name })}
            checked={row.status !== 'excluded'}
            disabled={running || run?.state === 'done'}
            onChange={() => onToggle(row.key)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
        )}
      </td>
      <td
        className="max-w-[16rem] truncate px-2 py-1.5 text-slate-700 dark:text-slate-200"
        title={row.name}
        dir="auto"
      >
        {row.name}
      </td>
      <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">
        {row.code ?? '—'}
        {row.padded && (
          <div className="font-sans text-[11px] text-amber-700 dark:text-amber-400">
            {t('employees.photoBatch.padded')}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5">
        {row.employee === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <>
            <div className="text-slate-800 dark:text-slate-100">
              {locale === 'ar'
                ? row.employee.fullNameAr
                : (row.employee.fullNameEn ?? row.employee.fullNameAr)}
            </div>
            {row.nameDiffers && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400">
                {t('employees.photoBatch.nameDiffers', { name: row.nameInFile })}
              </div>
            )}
          </>
        )}
      </td>
      <td className={cn('px-2 py-1.5 text-xs', TONE[status.tone])}>{status.text}</td>
    </tr>
  );
});

export const BulkPhotoUploadDialog = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const qc = useQueryClient();
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [matches, setMatches] = useState<Map<string, EmployeeCodeMatchDto>>(new Map());
  const [looking, setLooking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [running, setRunning] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stop = useRef(false);
  const uploadedAny = useRef(false);
  /** Lookups still under way: a second pick may be asked about before the first is answered. */
  const lookups = useRef(0);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => planPhotoBatch(picked, matches, excluded), [picked, matches, excluded]);
  const counts = countByStatus(rows);
  const byKey = useMemo(() => new Map(picked.map((p) => [p.key, p])), [picked]);
  const done = [...progress.values()].filter((p) => p.state === 'done').length;
  const failed = rows.filter((row) => progress.get(row.key)?.state === 'failed');
  const pending = rows.filter(
    (row) => row.status === 'ready' && progress.get(row.key)?.state !== 'done',
  );
  const differing = rows.filter((row) => row.status === 'ready' && row.nameDiffers).length;
  const replacing = rows.filter((row) => row.status === 'ready' && row.employee?.photoFileId !== null).length;

  /**
   * Take a pick (or a drop): photos only, each once, then ask who holds the new files' codes. The
   * answer is ADDED to what is known, so an earlier pick answered late never undoes a later one.
   */
  const take = async (files: readonly File[]): Promise<void> => {
    const seen = new Set(picked.map((p) => p.key));
    const fresh = files
      .filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/iu.test(file.name))
      .map((file) => ({ key: keyOf(file), name: file.name, type: file.type, file }))
      .filter((p) => !seen.has(p.key));
    if (fresh.length === 0) return;
    setPicked((now) => {
      const have = new Set(now.map((p) => p.key));
      return [...now, ...fresh.filter((p) => !have.has(p.key))];
    });
    lookups.current += 1;
    setLooking(true);
    setNotice(null);
    try {
      const found = await lookupEmployeeCodes(codesToLookUp(fresh));
      setMatches((now) => new Map([...now, ...found.map((m) => [m.code, m] as const)]));
    } catch (error) {
      setNotice(errorMessage(error, locale));
    } finally {
      lookups.current -= 1;
      if (lookups.current === 0) setLooking(false);
    }
  };

  const toggle = useCallback(
    (key: string): void =>
      setExcluded((now) => {
        const next = new Set(now);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  const mark = (key: string, value: Progress): void =>
    setProgress((now) => new Map(now).set(key, value));

  /** Send the given rows, two at a time, each cut around its face first. */
  const send = async (list: readonly PhotoRow[]): Promise<void> => {
    stop.current = false;
    setRunning(true);
    setNotice(null);
    // The face search first: without it every photo would go uncropped, and replace a photo that
    // was cut well. A run that cannot cut starts nothing.
    try {
      await readyFaceSearch();
    } catch {
      setNotice(t('employees.photoBatch.faceSearchUnavailable'));
      setRunning(false);
      return;
    }
    for (const row of list) mark(row.key, { state: 'waiting' });
    const leave = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    try {
      await runQueue(
        list,
        async (row) => {
          const source = byKey.get(row.key);
          if (source === undefined || row.employee === null) return;
          try {
            mark(row.key, { state: 'preparing' });
            const photo = await prepareBatchPhoto(source.file, row.employee.code);
            mark(row.key, { state: 'uploading' });
            await uploadEmployeePhotoFile(row.employee.id, photo.file);
            uploadedAny.current = true;
            mark(row.key, { state: 'done', cropped: photo.cropped, shrunk: photo.shrunk });
            // The run is the person's own long task: while it works, their session is not idle.
            markActivity();
          } catch (error) {
            mark(row.key, { state: 'failed', message: errorMessage(error, locale) });
          }
        },
        { concurrency: 2, shouldStop: () => stop.current },
      );
    } finally {
      window.removeEventListener('beforeunload', leave);
      setRunning(false);
      setProgress((now) => {
        // Stopped before their turn: back to ready, not «waiting» for ever.
        const next = new Map(now);
        for (const [key, value] of next) if (value.state === 'waiting') next.delete(key);
        return next;
      });
    }
  };

  const close = (): void => {
    if (uploadedAny.current) {
      void qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
      void qc.invalidateQueries({ queryKey: ['hr', 'employeePhotos'] });
    }
    onClose();
  };
  const requestClose = (): void => (running ? setConfirmClose(true) : close());

  const needsAttention = (row: PhotoRow): boolean => {
    const run = progress.get(row.key)?.state;
    return (
      run === 'failed' ||
      (row.status !== 'ready' && row.status !== 'excluded') ||
      row.nameDiffers ||
      row.padded
    );
  };
  const shown = onlyAttention ? rows.filter(needsAttention) : rows;

  const total = done + pending.length;
  return (
    <>
      <Dialog
        open
        onClose={requestClose}
        size="xl"
        title={t('employees.photoBatch.title')}
        description={t('employees.photoBatch.hint')}
        dismissOnOutsideClick={false}
        footer={
          <>
            <Button variant="secondary" onClick={requestClose}>
              {done > 0 && !running ? t('common.close') : t('common.cancel')}
            </Button>
            {running ? (
              <Button variant="danger" onClick={() => (stop.current = true)}>
                {t('employees.photoBatch.stop')}
              </Button>
            ) : failed.length > 0 ? (
              <Button onClick={() => void send(failed)}>
                {t('employees.photoBatch.retry', { n: failed.length })}
              </Button>
            ) : (
              <Button
                disabled={pending.length === 0 || looking}
                leftIcon={<UploadIcon className="h-4 w-4" />}
                onClick={() => void send(pending)}
              >
                {t('employees.photoBatch.upload', { n: pending.length })}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div
            className={cn(
              'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm',
              dragging
                ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/40'
                : 'border-slate-300 dark:border-slate-700',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (running) return;
              // Read now: the drop's lists are emptied once this handler returns.
              const plain = [...e.dataTransfer.files];
              void filesOfDrop(e.dataTransfer.items).then((files) =>
                take(files.length > 0 ? files : plain),
              );
            }}
          >
            <p className="text-slate-600 dark:text-slate-300">{t('employees.photoBatch.drop')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="secondary" disabled={running} onClick={() => filesInput.current?.click()}>
                {t('employees.photoBatch.pickFiles')}
              </Button>
              <Button size="sm" variant="secondary" disabled={running} onClick={() => folderInput.current?.click()}>
                {t('employees.photoBatch.pickFolder')}
              </Button>
            </div>
            <input
              ref={filesInput}
              type="file"
              multiple
              accept={EMPLOYEE_PHOTO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void take([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              // A whole folder: the browser asks once and hands every file under it.
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                void take([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </div>

          {notice !== null && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {notice}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {t('employees.photoBatch.countReady', { n: counts.ready })}
                </span>
                {replacing > 0 && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('employees.photoBatch.countReplace', { n: replacing })}
                  </span>
                )}
                {differing > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('employees.photoBatch.countNameDiffers', { n: differing })}
                  </span>
                )}
                {counts.unknownCode + counts.noCode > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countUnmatched', { n: counts.unknownCode + counts.noCode })}
                  </span>
                )}
                {counts.duplicate > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('employees.photoBatch.countDuplicate', { n: counts.duplicate })}
                  </span>
                )}
                {counts.unsupported > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countUnsupported', { n: counts.unsupported })}
                  </span>
                )}
                {looking && <span className="text-slate-500">{t('employees.photoBatch.looking')}</span>}
                <span className="ms-auto">
                  <Checkbox
                    checked={onlyAttention}
                    onChange={() => setOnlyAttention((on) => !on)}
                    label={t('employees.photoBatch.onlyAttention')}
                  />
                </span>
              </div>

              {(running || done > 0) && total > 0 && (
                <div>
                  <div className="mb-1 text-xs text-slate-600 dark:text-slate-300">
                    {t('employees.photoBatch.progress', { done, total })}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-[width]"
                      style={{ width: `${String(Math.round((done / total) * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="w-8 px-2 py-2" />
                      <th className="px-2 py-2 text-start font-medium">{t('employees.photoBatch.colFile')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('employees.photoBatch.colCode')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('employees.photoBatch.colEmployee')}</th>
                      <th className="px-2 py-2 text-start font-medium">{t('employees.photoBatch.colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {shown.map((row) => (
                      <PhotoRowView
                        key={row.key}
                        row={row}
                        run={progress.get(row.key)}
                        running={running}
                        locale={locale}
                        onToggle={toggle}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Dialog>

      {confirmClose && (
        <Dialog
          open
          size="sm"
          onClose={() => setConfirmClose(false)}
          title={t('employees.photoBatch.closeTitle')}
          description={t('employees.photoBatch.closeBody')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmClose(false)}>
                {t('employees.photoBatch.keepGoing')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  stop.current = true;
                  setConfirmClose(false);
                  close();
                }}
              >
                {t('employees.photoBatch.stopAndClose')}
              </Button>
            </>
          }
        >
          <span />
        </Dialog>
      )}
    </>
  );
};
