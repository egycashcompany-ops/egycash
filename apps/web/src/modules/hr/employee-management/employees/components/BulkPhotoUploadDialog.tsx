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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type EmployeeCodeMatchDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { markActivity } from '../../../../../platform/auth/idle-session';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Select } from '../../../../../shared/ui/form';
import { CloseIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { cn } from '../../../../../shared/lib/cn';
import { errorMessage } from '../../../../../shared/lib/errors';
import { formatDateTime } from '../../../../../shared/lib/format';
import {
  EMPLOYEE_PHOTO_ACCEPT,
  lookupEmployeeCodes,
  uploadEmployeePhotoFile,
} from '../api/employee-photo';
import {
  codesToLookUp,
  countByStatus,
  markDuplicates,
  pickOnePerEmployee,
  planFiles,
  type PhotoFileInput,
  type PhotoRow,
  type PhotoRowStatus,
} from '../lib/photo-batch';
import {
  FaceSearchError,
  prepareBatchPhoto,
  readyFaceSearch,
  UnreadablePhotoError,
} from '../lib/photo-prepare';
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

/**
 * One key per file however it was reached — a drop, the photos picker or the folder picker give it
 * different paths (or none), so the path is no part of it.
 */
const keyOf = (file: File): string =>
  `${file.name}:${String(file.size)}:${String(file.lastModified)}`;

/** A hidden file — a Mac's «._» companion of each photo, or `.DS_Store` — is no photo. */
const isHidden = (file: File): boolean => file.name.startsWith('.');

/**
 * The files of a drop, folders opened (as the folder picker does). An entry the browser cannot
 * read is skipped, not the whole drop: `skipped` counts them so the person is told.
 */
const filesOfDrop = async (
  items: DataTransferItemList,
): Promise<{ files: File[]; skipped: number }> => {
  const out: File[] = [];
  let skipped = 0;
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      try {
        out.push(await new Promise<File>((ok, fail) => fileEntry.file(ok, fail)));
      } catch {
        skipped += 1;
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // A folder's entries come in pages: read until an empty one.
      for (;;) {
        let page: FileSystemEntry[];
        try {
          page = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
        } catch {
          skipped += 1;
          break;
        }
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
  return { files: out, skipped };
};

/** The states in which a file is never sent: it can only be renamed and picked again, or removed. */
const NEVER_SENT: ReadonlySet<PhotoRowStatus> = new Set([
  'noCode',
  'unknownCode',
  'unsupported',
  'ambiguous',
  'unconfirmed',
]);

/** How far back a photo already uploaded is left alone. */
const SKIP_CHOICES = ['today', 'week', 'month', 'none'] as const;
type SkipChoice = (typeof SKIP_CHOICES)[number];

/** The cut-off for a choice: the start of this computer's day, 7 or 30 days back; or none. */
const skipSinceOf = (choice: SkipChoice, now: number): number | null => {
  if (choice === 'none') return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (choice === 'week') start.setDate(start.getDate() - 6);
  if (choice === 'month') start.setDate(start.getDate() - 29);
  return start.getTime();
};

/** A file's own identity apart from its name: a renamed file keeps its size and modified time. */
const contentOf = (file: File): string => `${String(file.size)}:${String(file.lastModified)}`;

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
  onRemove,
  auto,
}: {
  row: PhotoRow;
  run: Progress | undefined;
  running: boolean;
  locale: Locale;
  onToggle: (key: string) => void;
  onRemove: (key: string) => void;
  /** Chosen (or left out) by «one photo per employee», not by the person's own tick. */
  auto: 'kept' | 'left' | null;
}): JSX.Element {
  const t = useT();
  const status = ((): { text: string; tone: keyof typeof TONE } => {
    if (run?.state === 'done')
      return run.cropped
        ? { text: t('employees.photoBatch.doneCropped'), tone: 'ok' }
        : {
            text: t(
              run.shrunk ? 'employees.photoBatch.doneShrunk' : 'employees.photoBatch.doneNoFace',
            ),
            tone: 'warn',
          };
    // A failure is shown while the row is still to be sent; once it is left out or one of two, the
    // row says that instead — what the person has to act on now.
    if (run?.state === 'failed' && row.status === 'ready')
      return { text: run.message, tone: 'bad' };
    if (run?.state === 'preparing')
      return { text: t('employees.photoBatch.preparing'), tone: 'muted' };
    if (run?.state === 'uploading')
      return { text: t('employees.photoBatch.uploading'), tone: 'muted' };
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
        return {
          text: t(
            auto === 'left' ? 'employees.photoBatch.autoLeft' : 'employees.photoBatch.excluded',
          ),
          tone: 'muted',
        };
      case 'recent':
        return {
          text: t('employees.photoBatch.recent', {
            when: formatDateTime(row.employee?.photoUploadedAt ?? null, locale),
          }),
          tone: 'muted',
        };
      case 'ambiguous':
        return {
          text: t('employees.photoBatch.ambiguous', { codes: row.rivalCodes.join('، ') }),
          tone: 'bad',
        };
      case 'unconfirmed':
        return { text: t('employees.photoBatch.unconfirmed'), tone: 'bad' };
    }
  })();
  return (
    <tr data-photo-row={row.status}>
      <td className="px-2 py-1.5">
        {/* Only a photo that names an employee can be left out or put back; the rest never go. */}
        {NEVER_SENT.has(row.status) && !running && (
          <button
            type="button"
            aria-label={t('employees.photoBatch.remove', { name: row.name })}
            title={t('employees.photoBatch.remove', { name: row.name })}
            onClick={() => onRemove(row.key)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {(row.status === 'ready' || row.status === 'duplicate' || row.status === 'excluded') && (
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
      <td className={cn('px-2 py-1.5 text-xs', TONE[status.tone])}>
        {status.text}
        {auto === 'kept' && row.status === 'ready' && run?.state !== 'done' && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('employees.photoBatch.autoKept')}
          </div>
        )}
      </td>
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
  const [view, setView] = useState<'all' | 'attention' | 'several'>('all');
  // «مش عايز أرفع اللى اترفعوا»: by default the people whose photo went up in the last 7 days are
  // skipped, so picking the same folder again — after a reload, the next day — sends nothing twice.
  // Counted from when the dialog opened, in this computer's own days.
  const [skip, setSkip] = useState<SkipChoice>('week');
  const [openedAt] = useState(() => Date.now());
  const skipSince = useMemo(() => skipSinceOf(skip, openedAt), [skip, openedAt]);
  /** What «one photo per employee» chose, so its rows can say so. */
  const [autoKept, setAutoKept] = useState<Set<string>>(new Set());
  const [autoLeft, setAutoLeft] = useState<Set<string>>(new Set());
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

  // Planned in two steps: each file on its own (only when the picks, answers or ticks change), then
  // duplicates — where a photo already uploaded competes with nothing, so a corrected one picked
  // after it can still go. The second step re-runs only when another photo is done.
  const planned = useMemo(
    () => planFiles(picked, matches, excluded, { skipSince }),
    [picked, matches, excluded, skipSince],
  );
  const doneKeys = [...progress]
    .filter(([, p]) => p.state === 'done')
    .map(([key]) => key)
    .join('\n');
  const settled = useMemo(() => new Set(doneKeys === '' ? [] : doneKeys.split('\n')), [doneKeys]);
  const rows = useMemo(() => markDuplicates(planned, settled), [planned, settled]);
  const counts = countByStatus(rows);
  const duplicatePeople = new Set(
    rows.filter((row) => row.status === 'duplicate').map((row) => row.employee?.id),
  ).size;
  const byKey = useMemo(() => new Map(picked.map((p) => [p.key, p])), [picked]);
  const done = settled.size;
  // What the upload button sends: every included, matched photo not yet up — a failed one again
  // with the rest. A failed photo the person unticked, or that is now one of two, is not sent.
  const pending = rows.filter((row) => row.status === 'ready' && !settled.has(row.key));
  const failedCount = pending.filter((row) => progress.get(row.key)?.state === 'failed').length;
  const differing = rows.filter((row) => row.status === 'ready' && row.nameDiffers).length;
  // The summary counts what is still to send: after a run, photos already up are no longer «ready».
  const replacing = pending.filter((row) => row.employee?.photoFileId !== null).length;

  /**
   * Take a pick (or a drop): photos only, each once. The new files join the table only once the
   * server has said who holds their codes — so no row ever reads «no employee» for a code nobody
   * was asked about, and a pick whose question failed can simply be picked again. The answer is
   * ADDED to what is known, so an earlier pick answered late never undoes a later one.
   */
  const take = async (files: readonly File[]): Promise<void> => {
    const seen = new Set(picked.map((p) => p.key));
    // One entry per key within the pick too: two copies of one photo in two subfolders are one file.
    const fresh = [
      ...new Map(
        files
          .filter((file) => !isHidden(file))
          .filter(
            (file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/iu.test(file.name),
          )
          .map(
            (file) =>
              [keyOf(file), { key: keyOf(file), name: file.name, type: file.type, file }] as const,
          ),
      ).values(),
    ].filter((p) => !seen.has(p.key));
    if (fresh.length === 0) return;
    // A held row whose file comes back under a new name was renamed as its row asked: the new row
    // takes its place. Only a row that is never sent is dropped this way, so nothing goes astray.
    const held = new Set(rows.filter((row) => NEVER_SENT.has(row.status)).map((row) => row.key));
    const renamed = new Set(fresh.map((p) => contentOf(p.file)));
    lookups.current += 1;
    setLooking(true);
    setNotice(null);
    try {
      const found = await lookupEmployeeCodes(codesToLookUp(fresh));
      setMatches((now) => new Map([...now, ...found.map((m) => [m.code, m] as const)]));
      setPicked((now) => {
        const kept = now.filter((p) => !(held.has(p.key) && renamed.has(contentOf(p.file))));
        const have = new Set(kept.map((p) => p.key));
        return [...kept, ...fresh.filter((p) => !have.has(p.key))];
      });
    } catch (error) {
      setNotice(errorMessage(error, locale));
    } finally {
      lookups.current -= 1;
      if (lookups.current === 0) setLooking(false);
    }
  };

  // Leaving with the dialog open — the browser's Back, another page — is a stop: the photos under
  // way finish and no new one starts, as «Stop and close» does. And while it is open, a file let go
  // anywhere but the drop zone does nothing (the browser would open it in place of the app).
  useEffect(() => {
    const ignore = (e: DragEvent): void => e.preventDefault();
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      stop.current = true;
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

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

  /** Take a file that will never be sent out of the table. */
  const remove = useCallback(
    (key: string): void => setPicked((now) => now.filter((p) => p.key !== key)),
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
      setConfirmClose(false);
      return;
    }
    for (const row of list) mark(row.key, { state: 'waiting' });
    const leave = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Older browsers show the prompt only when `returnValue` is set.
      e.returnValue = '';
    };
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
            mark(row.key, {
              state: 'failed',
              message:
                error instanceof UnreadablePhotoError
                  ? t('employees.photoBatch.unreadable')
                  : error instanceof FaceSearchError
                    ? t('employees.photoBatch.faceSearchFailed')
                    : errorMessage(error, locale),
            });
          }
        },
        { concurrency: 2, shouldStop: () => stop.current },
      );
    } finally {
      window.removeEventListener('beforeunload', leave);
      setRunning(false);
      // The run is over: a «stop and close?» still open would describe a run that has ended.
      setConfirmClose(false);
      // Refreshed when the last photo has landed — also after «Stop and close», whose photos under
      // way land after the dialog has gone.
      if (uploadedAny.current) {
        void qc.invalidateQueries({ queryKey: ['hr', 'employees'] });
        void qc.invalidateQueries({ queryKey: ['hr', 'employeePhotos'] });
      }
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
      (row.status !== 'ready' && row.status !== 'excluded' && row.status !== 'recent') ||
      row.nameDiffers
    );
  };
  // «خلينى أقدر أحدد المكرر»: every row of an employee with more than one file — the ones still
  // to choose between, and the ones already chosen, so the choice can be seen and changed.
  const severalOf = useMemo(() => {
    const perEmployee = new Map<string, number>();
    for (const row of rows) {
      if (row.employee !== null)
        perEmployee.set(row.employee.id, (perEmployee.get(row.employee.id) ?? 0) + 1);
    }
    return new Set([...perEmployee].filter(([, n]) => n > 1).map(([id]) => id));
  }, [rows]);
  const shown =
    view === 'attention'
      ? rows.filter(needsAttention)
      : view === 'several'
        ? rows.filter((row) => row.employee !== null && severalOf.has(row.employee.id))
        : rows;

  /** «المكرر تختار منه أنت تلقائي واحده»: keep one photo of each employee, leave the rest out. */
  const pickOneEach = (): void => {
    const { keep, leave } = pickOnePerEmployee(
      rows,
      (key) => {
        const source = byKey.get(key)?.file;
        return source === undefined
          ? undefined
          : { size: source.size, lastModified: source.lastModified };
      },
      // A file that already failed here goes last: picking it again would only fail again.
      (key) => progress.get(key)?.state === 'failed',
    );
    if (leave.size === 0) return;
    setExcluded((now) => new Set([...now, ...leave]));
    setAutoLeft((now) => new Set([...now, ...leave]));
    setAutoKept((now) => new Set([...now, ...keep]));
  };

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
              // Reading a dropped folder is part of finding the photos: «Upload» waits for it.
              lookups.current += 1;
              setLooking(true);
              setNotice(null);
              void filesOfDrop(e.dataTransfer.items)
                .then(async ({ files, skipped }) => {
                  await take(files.length > 0 ? files : plain);
                  // Added to what the lookup said, never in its place.
                  if (skipped > 0) {
                    const note = t('employees.photoBatch.dropSkipped', { n: skipped });
                    setNotice((now) => (now === null ? note : `${now} ${note}`));
                  }
                })
                .catch((error: unknown) => setNotice(errorMessage(error, locale)))
                .finally(() => {
                  lookups.current -= 1;
                  if (lookups.current === 0) setLooking(false);
                });
            }}
          >
            <p className="text-slate-600 dark:text-slate-300">{t('employees.photoBatch.drop')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={running}
                onClick={() => filesInput.current?.click()}
              >
                {t('employees.photoBatch.pickFiles')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={running}
                onClick={() => folderInput.current?.click()}
              >
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

          {looking && rows.length === 0 && (
            <p className="text-sm text-slate-500">{t('employees.photoBatch.looking')}</p>
          )}

          {notice !== null && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {notice}
            </p>
          )}

          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {t('employees.photoBatch.countReady', { n: pending.length })}
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
                {counts.ambiguous + counts.unconfirmed > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countRename', {
                      n: counts.ambiguous + counts.unconfirmed,
                    })}
                  </span>
                )}
                {counts.unknownCode + counts.noCode > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countUnmatched', {
                      n: counts.unknownCode + counts.noCode,
                    })}
                  </span>
                )}
                {counts.duplicate > 0 && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {t('employees.photoBatch.countDuplicate', { n: counts.duplicate })}
                  </span>
                )}
                {failedCount > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countFailed', { n: failedCount })}
                  </span>
                )}
                {counts.recent > 0 && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('employees.photoBatch.countRecent', { n: counts.recent })}
                  </span>
                )}
                {counts.unsupported > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {t('employees.photoBatch.countUnsupported', { n: counts.unsupported })}
                  </span>
                )}
                {looking && (
                  <span className="text-slate-500">{t('employees.photoBatch.looking')}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {counts.duplicate > 0 && !running && (
                  <Button size="sm" variant="secondary" onClick={pickOneEach}>
                    {t('employees.photoBatch.pickOneEach', { n: duplicatePeople })}
                  </Button>
                )}
                <label className="ms-auto flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  {t('employees.photoBatch.skipLabel')}
                  <Select
                    density="tight"
                    value={skip}
                    disabled={running}
                    onChange={(e) => setSkip(e.target.value as SkipChoice)}
                    aria-label={t('employees.photoBatch.skipLabel')}
                  >
                    {SKIP_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {t(`employees.photoBatch.skip.${choice}`)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  {t('employees.photoBatch.viewLabel')}
                  <Select
                    density="tight"
                    value={view}
                    onChange={(e) => setView(e.target.value as typeof view)}
                    aria-label={t('employees.photoBatch.viewLabel')}
                  >
                    <option value="all">{t('employees.photoBatch.view.all')}</option>
                    <option value="attention">{t('employees.photoBatch.view.attention')}</option>
                    <option value="several">{t('employees.photoBatch.view.several')}</option>
                  </Select>
                </label>
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
                      <th className="px-2 py-2 text-start font-medium">
                        {t('employees.photoBatch.colFile')}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t('employees.photoBatch.colCode')}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t('employees.photoBatch.colEmployee')}
                      </th>
                      <th className="px-2 py-2 text-start font-medium">
                        {t('employees.photoBatch.colStatus')}
                      </th>
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
                        onRemove={remove}
                        auto={
                          autoLeft.has(row.key) ? 'left' : autoKept.has(row.key) ? 'kept' : null
                        }
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
