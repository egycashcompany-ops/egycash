// «مرفقات العقد» — the contract's pages (several images and/or PDF files), as the owner's approved
// forms sample draws them (`zz-contracts-forms-parts`): each attachment a tile with its order, its
// actions on hover, its name and size; a tile on its way up shows its percentage and can be
// cancelled. The drop box and the editor's tray are in `VehicleContractFilesSection.tsx`.
//
// The bytes are guarded, so a saved file is fetched with the session and shown as an object URL
// (as every Fleet image is), revoked when done; a file still waiting for Save is shown from the
// file in hand. A file the virus scanner has not cleared yet answers 422 — the tile says
// «جارٍ فحص الملف» and asks again a few times.
import { useEffect, useState, type DragEvent } from 'react';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ChevronEndIcon, ChevronStartIcon, EyeIcon } from '../../../shared/ui/icons';
import { FLEET_VEHICLE_CONTRACT_FILE_MAX_MB } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { fetchVehicleContractFile } from '../api/vehicle-contract-api';
import { acceptsContractFile, isPdfMime, splitFileName } from '../lib/vehicle-contract-figures';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { IMAGE_GROUP, actionTone } from './row-actions-look';
import { Trash2Icon } from './row-action-icons';
import { BoardIcon, NUM, PATH } from './FuelCardBoard';
import { CLOSE_PATH, Stroke } from './FuelCardDialog';

/** A file as a tile shows it — saved on the server, or in hand and waiting for Save. */
export interface ShownFile {
  key: string;
  fileName: string;
  mime: string;
  size: number;
  /** Where its bytes are fetched from, once saved. */
  saved: { contractId: string; fileId: string } | null;
  /** The file in hand, before Save. */
  local: File | null;
  /** 0–100 while it goes up. */
  progress: number | null;
}

export type FileView =
  | { state: 'loading'; url: null }
  | { state: 'scanning'; url: null }
  | { state: 'failed'; url: null }
  | { state: 'ready'; url: string };

/** How often, and how many times, a file the scanner still holds is asked for again. */
const SCAN_RETRY_MS = 3_000;
const SCAN_RETRIES = 10;

/** The file's bytes as an object URL (revoked when done); `enabled: false` fetches nothing. */
export const useContractFileUrl = (file: ShownFile | null, enabled = true): FileView => {
  const [view, setView] = useState<FileView>({ state: 'loading', url: null });
  const contractId = file?.saved?.contractId ?? null;
  const fileId = file?.saved?.fileId ?? null;
  const local = file?.local ?? null;
  useEffect(() => {
    if (!enabled || (local === null && fileId === null)) return undefined;
    let made: string | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (local !== null) {
      made = URL.createObjectURL(local);
      setView({ state: 'ready', url: made });
    } else if (contractId !== null && fileId !== null) {
      setView({ state: 'loading', url: null });
      const ask = (tries: number): void => {
        fetchVehicleContractFile(contractId, fileId)
          .then((blob) => {
            if (cancelled) return;
            made = URL.createObjectURL(blob);
            setView({ state: 'ready', url: made });
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            const scanning = error instanceof ApiError && error.status === 422;
            if (scanning && tries < SCAN_RETRIES) {
              setView({ state: 'scanning', url: null });
              timer = setTimeout(() => ask(tries + 1), SCAN_RETRY_MS);
            } else setView({ state: 'failed', url: null });
          });
      };
      ask(0);
    }
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [contractId, fileId, local, enabled]);
  return view;
};

/** Files dropped or picked: those the contract may take, and a toast naming each one it may not. */
export const useFilePicker = (): ((files: readonly File[]) => File[]) => {
  const t = useT();
  return (files) =>
    files.filter((file) => {
      if (acceptsContractFile(file)) return true;
      toast.error(
        t('fleet.vehicleContracts.files.refused', {
          name: file.name,
          mb: FLEET_VEHICLE_CONTRACT_FILE_MAX_MB,
        }),
      );
      return false;
    });
};

/** What a file can show of itself while its bytes are not there: a spinner, or why not. */
export const FileWait = ({ view }: { view: FileView }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center text-slate-400">
      {view.state === 'failed' ? (
        <BoardIcon d={PATH.image} className="h-6 w-6" />
      ) : (
        <Spinner className="h-5 w-5" />
      )}
      {view.state !== 'loading' && (
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {view.state === 'scanning'
            ? `${t('fleet.vehicleContracts.files.scanPending')}…`
            : t('fleet.vehicleContracts.files.unavailable')}
        </span>
      )}
    </div>
  );
};

/** A PDF has no picture of its own here (no PDF renderer in the app): its mark, in red. */
export const PdfFace = ({ big = false }: { big?: boolean }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
      <BoardIcon d={PATH.pdf} className={big ? 'h-12 w-12' : 'h-10 w-10'} />
      <span className="rounded-md bg-rose-600 px-2 py-0.5 text-[11px] font-black tracking-wider text-white dark:bg-rose-500">
        PDF
      </span>
      <span className="text-[11px] font-bold">{t('fleet.vehicleContracts.files.pdf')}</span>
    </div>
  );
};

/** The handlers that let a tile be dragged to another place — native drag and drop. */
export interface TileDrag {
  draggable: true;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/**
 * The step arrows are for the keyboard: out of the way (and out of the pill's width) until one has
 * the focus — the pointer drags the tile instead, and the approved tile shows only its two actions.
 */
const STEP_ONLY_ON_FOCUS = 'sr-only focus:not-sr-only';

/** One attachment: its picture (or the PDF's mark), its order, its actions, its name and size. */
export const AttachmentTile = ({
  file,
  index,
  onView,
  onRemove,
  onMove,
  active = false,
  compact = false,
  drag,
  target = false,
}: {
  file: ShownFile;
  index: number;
  onView?: () => void;
  onRemove?: () => void;
  /** The keyboard's way to reorder: one place earlier (-1) or later (+1); `null` at that end. */
  onMove?: { earlier: (() => void) | null; later: (() => void) | null };
  active?: boolean;
  /** The viewer's strip: no actions, no caption row. */
  compact?: boolean;
  drag?: TileDrag;
  /** A tile being dragged over. */
  target?: boolean;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const pdf = isPdfMime(file.mime);
  const view = useContractFileUrl(file, !pdf);
  const uploading = file.progress !== null;
  return (
    <div
      data-contract-file={file.key}
      {...drag}
      className={cn(
        'relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition dark:bg-[#121c3f]',
        active
          ? 'border-[#6c63ff] shadow-[0_0_0_1px_#6c63ff,0_0_18px_-4px_rgba(108,99,255,0.6)]'
          : target
            ? 'border-indigo-400 outline outline-2 outline-indigo-400'
            : 'border-slate-200 dark:border-[#2b3b6b]',
        drag !== undefined && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="group relative aspect-[1/1.414] overflow-hidden bg-white">
        {pdf ? (
          <PdfFace />
        ) : view.url === null ? (
          <FileWait view={view} />
        ) : (
          <img
            src={view.url}
            alt={file.fileName}
            draggable={false}
            className={cn(
              'h-full w-full object-cover object-top',
              uploading && 'opacity-40 blur-[1px]',
            )}
          />
        )}
        <span
          className={cn(
            'absolute start-1.5 top-1.5 inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-slate-900/80 px-1.5 text-xs font-bold text-white shadow',
            NUM,
          )}
        >
          {latin(index + 1)}
        </span>
        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-indigo-600 shadow-md dark:bg-[#0a1233]/95 dark:text-indigo-300">
              <Spinner className="h-5 w-5" />
            </span>
            <span
              className={cn(
                'rounded-md bg-white/95 px-2 py-0.5 text-sm font-black text-indigo-700 shadow dark:bg-[#0a1233]/95 dark:text-indigo-200',
                NUM,
              )}
              data-contract-file-progress={file.progress}
            >
              {file.progress}%
            </span>
          </div>
        )}
        {!compact && !uploading && (onView !== undefined || onRemove !== undefined) && (
          <span
            className={cn(
              IMAGE_GROUP,
              'absolute bottom-1.5 left-1/2 -translate-x-1/2 shadow-md !bg-white/95 dark:!bg-[#0a1233]/95',
            )}
          >
            {onMove !== undefined && onMove.earlier !== null && (
              <button
                type="button"
                className={cn(actionTone('move'), STEP_ONLY_ON_FOCUS)}
                aria-label={t('fleet.vehicleContracts.files.moveStart')}
                title={t('fleet.vehicleContracts.files.moveStart')}
                onClick={onMove.earlier}
              >
                <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
              </button>
            )}
            {onView !== undefined && (
              <button
                type="button"
                className={actionTone('view')}
                aria-label={t('fleet.vehicleContracts.files.view')}
                title={t('fleet.vehicleContracts.files.view')}
                onClick={onView}
                data-contract-file-view={file.key}
              >
                <EyeIcon className="h-4 w-4" />
              </button>
            )}
            {onRemove !== undefined && (
              <button
                type="button"
                className={actionTone('delete')}
                aria-label={t('fleet.vehicleContracts.files.remove')}
                title={t('fleet.vehicleContracts.files.remove')}
                onClick={onRemove}
                data-contract-file-remove={file.key}
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            )}
            {onMove !== undefined && onMove.later !== null && (
              <button
                type="button"
                className={cn(actionTone('move'), STEP_ONLY_ON_FOCUS)}
                aria-label={t('fleet.vehicleContracts.files.moveEnd')}
                title={t('fleet.vehicleContracts.files.moveEnd')}
                onClick={onMove.later}
              >
                <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
              </button>
            )}
          </span>
        )}
        {uploading && onRemove !== undefined && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t('fleet.vehicleContracts.files.cancelUpload')}
            title={t('fleet.vehicleContracts.files.cancelUpload')}
            className="absolute end-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-slate-500 shadow hover:text-rose-500 dark:bg-[#0a1233]/95 dark:text-slate-300"
          >
            <Stroke d={CLOSE_PATH} className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!compact && (
        <div className="space-y-0.5 border-t border-slate-200 px-2 py-1.5 dark:border-[#2b3b6b]">
          <p
            dir="auto"
            className="truncate text-start text-[11px] font-bold leading-4 text-slate-700 dark:text-slate-200"
            title={file.fileName}
          >
            {splitFileName(file.fileName).base}
          </p>
          <p
            className={cn(
              'text-[11px] font-semibold leading-4',
              uploading
                ? 'text-indigo-600 dark:text-indigo-300'
                : 'text-slate-500 dark:text-slate-400',
            )}
          >
            {uploading ? (
              `${t('fleet.vehicleContracts.files.uploading')}…`
            ) : (
              <bdi>{words.fileSize(file.size)}</bdi>
            )}
          </p>
        </div>
      )}
      {uploading && (
        <div className="h-1.5 bg-slate-100 dark:bg-[#162135]">
          <div
            className="h-full rounded-e-full bg-gradient-to-l from-[#4f3dff] to-[#6a5cff]"
            style={{ width: `${file.progress ?? 0}%` }}
          />
        </div>
      )}
    </div>
  );
};

/** Drag one tile onto another to move it there — the vehicle types' rows, as tiles. */
export const useTileDrag = (
  onMove: (from: number, to: number) => void,
): { dragOf: (index: number) => TileDrag; over: number | null } => {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    over: dragging === null ? null : over,
    dragOf: (index) => ({
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData('text/plain', String(index));
        event.dataTransfer.effectAllowed = 'move';
        setDragging(index);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDragOver: (event) => {
        event.preventDefault();
        setOver(index);
      },
      onDrop: (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer.getData('text/plain'));
        setDragging(null);
        setOver(null);
        if (Number.isInteger(from)) onMove(from, index);
      },
    }),
  };
};
