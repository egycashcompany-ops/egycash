// «مرفقات العقد» — the viewer, as the owner's approved sample draws it: one file large, every file of
// the contract in its order beside it (the one shown ringed), the previous and the next at the
// stage's sides and in the footer, «فتح في تبويب جديد», «تحميل» and «إغلاق». An image sits on the
// app's own `ZoomableImage`; a PDF in the browser's viewer in an iframe (the CSP's
// `frame-src 'self' blob:` lets it), with no toolbar — the browser's would title the file by its
// technical id. Right to left: the left arrow goes on, the right arrow goes back; Escape closes.
//
// Files still waiting for Save open from the file in hand, so the editor can show them too.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { saveBlob } from '../../../shared/lib/api-client';
import { Spinner } from '../../../shared/ui/Spinner';
import {
  ChevronEndIcon,
  ChevronStartIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from '../../../shared/ui/icons';
import { isPdfMime, splitFileName } from '../lib/vehicle-contract-figures';
import { useVehicleContractWords } from '../lib/vehicle-contract-words';
import { ZoomableImage } from './ZoomableImage';
import { PATH } from './FuelCardBoard';
import { CLOSE_PATH, LOOK, SANS, Stroke } from './FuelCardDialog';
import { DesignCancel } from './DesignDialog';
import {
  AttachmentTile,
  FileWait,
  useContractFileUrl,
  type ShownFile,
} from './VehicleContractAttachments';

const STAGE_ARROW =
  'absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg transition hover:bg-indigo-50 hover:text-indigo-600 dark:border-[#2b3b6b] dark:bg-[#0f1838]/95 dark:text-slate-200 dark:hover:bg-[#1a2550] ' +
  // At either end the arrow stays where it is, faded — the same look in light as in dark.
  'disabled:pointer-events-none disabled:border-slate-300/50 disabled:bg-transparent disabled:text-slate-400/60 disabled:shadow-none dark:disabled:border-[#2b3b6b]/60 dark:disabled:bg-transparent dark:disabled:text-slate-500/70';
const FOOT_BUTTON =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[15px] font-bold text-slate-800 transition-all hover:bg-slate-100 active:scale-[0.98] dark:border-[#2b3b6b] dark:bg-[#1a2550] dark:text-slate-100 dark:hover:bg-slate-700/80 ' +
  'disabled:pointer-events-none disabled:border-slate-200/70 disabled:bg-slate-50 disabled:text-slate-300 disabled:shadow-none dark:disabled:border-[#2b3b6b]/50 dark:disabled:bg-[#1a2550]/40 dark:disabled:text-slate-600';

/**
 * «العقد كاملًا» + «PDF»: the name without its extension, the type in a small tag — an Arabic
 * name followed by «.pdf» is reordered by the browser's bidi rules and reads wrong in a pill.
 */
const FileName = ({ name }: { name: string }): JSX.Element => {
  const { base, ext } = splitFileName(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <bdi className="min-w-0 truncate">{base}</bdi>
      {ext !== '' && (
        <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-black uppercase leading-4 tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-200">
          {ext}
        </span>
      )}
    </span>
  );
};

/** The file in the stage: a PDF in the browser's viewer, an image on the zoomable surface. */
const Stage = ({ file, url }: { file: ShownFile; url: string }): JSX.Element =>
  isPdfMime(file.mime) ? (
    <iframe
      key={url}
      src={`${url}#toolbar=0&navpanes=0&view=Fit`}
      title={file.fileName}
      data-contract-pdf="true"
      className="h-full w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700"
    />
  ) : (
    <div className="h-full [&>div]:h-full" data-contract-image="true">
      <ZoomableImage src={url} alt={file.fileName} className="min-h-0 flex-1" />
    </div>
  );

export const VehicleContractViewer = ({
  open,
  onClose,
  files,
  index,
  onIndex,
  subtitle,
}: {
  open: boolean;
  onClose: () => void;
  files: readonly ShownFile[];
  index: number;
  onIndex: (next: number) => void;
  subtitle: string;
}): JSX.Element | null => {
  const t = useT();
  const words = useVehicleContractWords();
  const file = open ? (files[index] ?? null) : null;
  const view = useContractFileUrl(file, file !== null);
  useEffect(() => {
    if (!open) return undefined;
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && index < files.length - 1) onIndex(index + 1);
      if (event.key === 'ArrowRight' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose, index, files.length, onIndex]);
  if (file === null) return null;
  const last = files.length - 1;
  const download = async (): Promise<void> => {
    if (view.url === null) return;
    saveBlob(await (await fetch(view.url)).blob(), file.fileName);
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4"
      data-contract-viewer="true"
    >
      <div
        className="fixed inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-md dark:bg-[#03060c]/80"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('fleet.vehicleContracts.viewer.title')}
        className={cn(
          SANS,
          'relative flex h-[calc(100vh-2rem)] w-full max-w-[1400px] animate-dialog-in flex-col overflow-hidden rounded-2xl border text-slate-900 antialiased dark:text-slate-100',
          LOOK.add.panel,
          '!max-w-[1400px]',
        )}
      >
        <header
          className={cn(
            'flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-4 sm:px-6',
            LOOK.add.header,
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex shrink-0 items-center justify-center rounded-xl border',
                LOOK.add.icon,
              )}
            >
              <Stroke d={[...PATH.image]} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold tracking-wide text-slate-900 dark:text-white">
                {t('fleet.vehicleContracts.viewer.title')}
              </h2>
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                {subtitle}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-bold text-slate-700 sm:flex dark:border-[#2b3b6b] dark:bg-[#0a1233] dark:text-slate-200">
              <span className="flex min-w-0 max-w-[18rem]">
                <FileName name={file.fileName} />
              </span>
              <span className="text-slate-400">·</span>
              <bdi>{words.fileSize(file.size)}</bdi>
            </span>
            <span
              data-contract-viewer-at={index + 1}
              className="whitespace-nowrap rounded-full bg-indigo-600 px-3 py-1 text-[13px] font-bold text-white shadow-md shadow-indigo-700/30"
            >
              {t('fleet.vehicleContracts.viewer.of', { n: index + 1, total: files.length })}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className={cn(
                'flex items-center text-slate-400 transition-all hover:text-slate-900 dark:hover:text-white',
                LOOK.add.close,
              )}
            >
              <Stroke d={CLOSE_PATH} className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 gap-4 p-4">
          {/* Every file of the contract, in its order — the one shown ringed. */}
          <nav
            aria-label={t('fleet.vehicleContracts.viewer.title')}
            className="hidden w-[7.5rem] shrink-0 flex-col gap-2.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 sm:flex dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
          >
            {files.map((each, at) => (
              <button
                key={each.key}
                type="button"
                onClick={() => onIndex(at)}
                data-contract-viewer-thumb={at + 1}
                className="block w-full text-start"
              >
                <AttachmentTile file={each} index={at} active={at === index} compact />
              </button>
            ))}
          </nav>
          <div className="relative min-h-0 flex-1 rounded-xl bg-slate-100 p-3 dark:bg-[#0a1233]/60">
            {view.url === null ? (
              view.state === 'loading' ? (
                <div className="flex h-full items-center justify-center text-slate-400">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : (
                <FileWait view={view} />
              )
            ) : (
              <Stage file={file} url={view.url} />
            )}
            <button
              type="button"
              onClick={() => onIndex(index - 1)}
              disabled={index === 0}
              aria-label={t('fleet.vehicleContracts.viewer.prev')}
              title={t('fleet.vehicleContracts.viewer.prev')}
              data-contract-viewer-prev="true"
              className={cn(STAGE_ARROW, 'start-5')}
            >
              <ChevronStartIcon className="h-6 w-6 rtl:-scale-x-100" />
            </button>
            <button
              type="button"
              onClick={() => onIndex(index + 1)}
              disabled={index === last}
              aria-label={t('fleet.vehicleContracts.viewer.next')}
              title={t('fleet.vehicleContracts.viewer.next')}
              data-contract-viewer-next="true"
              className={cn(STAGE_ARROW, 'end-5')}
            >
              <ChevronEndIcon className="h-6 w-6 rtl:-scale-x-100" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 pb-4 sm:px-6',
            LOOK.add.footer,
          )}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={FOOT_BUTTON}
              onClick={() => onIndex(index - 1)}
              disabled={index === 0}
            >
              <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
              {t('fleet.vehicleContracts.viewer.prev')}
            </button>
            <button
              type="button"
              className={FOOT_BUTTON}
              onClick={() => onIndex(index + 1)}
              disabled={index === last}
              data-contract-viewer-foot-next="true"
            >
              {t('fleet.vehicleContracts.viewer.next')}
              <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={FOOT_BUTTON}
              disabled={view.url === null}
              onClick={() => {
                if (view.url !== null) window.open(view.url, '_blank', 'noopener');
              }}
            >
              <ExternalLinkIcon className="h-4 w-4" />
              {t('fleet.vehicleContracts.viewer.newTab')}
            </button>
            <button
              type="button"
              className={FOOT_BUTTON}
              disabled={view.url === null}
              onClick={() => void download()}
            >
              <DownloadIcon className="h-4 w-4" />
              {t('fleet.vehicleContracts.viewer.download')}
            </button>
            <DesignCancel onClick={onClose} label={t('common.close')} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
