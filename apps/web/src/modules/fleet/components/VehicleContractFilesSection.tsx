// «مرفقات العقد» on the contract's page (`zz-contracts-list-details`): the pages in their order, each
// opened, removed or dragged to another place from its tile; the add tile and «إضافة مرفقات» upload
// at once, one file after another, each showing its percentage as it goes up. (The editor keeps its
// files in `VehicleContractTray.tsx` until Save.)
// Who may do what follows the routes: adding needs create or edit; removing and reordering, edit.
import { useEffect, useState } from 'react';
import { type FleetVehicleContractDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { EyeIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { FLEET_VEHICLE_CONTRACT_FILE_MAX_MB } from '@ecms/contracts';
import {
  useDeleteVehicleContractFile,
  useOrderVehicleContractFiles,
  useUploadVehicleContractFile,
} from '../api/vehicle-contract-queries';
import { isPdfMime, moveItem, splitFileName } from '../lib/vehicle-contract-figures';
import {
  REFUSAL_KEY,
  latin,
  useVehicleContractWords,
  vehicleContractRefusalOf,
} from '../lib/vehicle-contract-words';
import { actionTone } from './row-actions-look';
import { CloudUploadIcon, Trash2Icon } from './row-action-icons';
import { NUM } from './FuelCardBoard';
import { CountChip, SectionHead } from './custody-memo-parts';
import {
  FileWait,
  PdfFace,
  useContractFileUrl,
  useTileDrag,
  type ShownFile,
  type TileDrag,
} from './VehicleContractAttachments';
import { VehicleContractViewer } from './VehicleContractViewer';
import { PickFiles, savedFiles } from './VehicleContractTray';
import { CLIP_ICON } from './vehicle-contract-parts';

/**
 * The box a file's two actions sit in when pointed at — the image cells' box, but on a SOLID
 * surface: over a scanned page the boards' faint fill in dark leaves the icons floating.
 */
const FILE_PILL =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-md shadow-slate-900/30 dark:border-[#3a4c80] dark:bg-[#1a2550]';

/** One file on the contract's page: a page's thumbnail, or the PDF's sheet — its name and size under it. */
const ContractFileTile = ({
  file,
  index,
  onView,
  onRemove,
  drag,
  target,
}: {
  file: ShownFile;
  index: number;
  onView: () => void;
  onRemove: (() => void) | null;
  drag: TileDrag | undefined;
  target: boolean;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const pdf = isPdfMime(file.mime);
  const view = useContractFileUrl(file, !pdf && file.progress === null);
  const uploading = file.progress !== null;
  return (
    <figure
      className="group min-w-[112px] max-w-[150px] flex-1"
      data-contract-file={file.key}
      {...drag}
    >
      <div
        className={cn(
          'relative aspect-[210/297] overflow-hidden rounded-lg border shadow-sm',
          pdf
            ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/[0.08]'
            : 'border-slate-200 bg-white dark:border-[#2b3b6b]',
          target && 'outline outline-2 outline-indigo-400',
          drag !== undefined && 'cursor-grab active:cursor-grabbing',
        )}
      >
        {pdf ? (
          <PdfFace />
        ) : uploading ? (
          <span className="block h-full bg-slate-50 dark:bg-[#0a1233]" />
        ) : view.url === null ? (
          <FileWait view={view} />
        ) : (
          <img
            src={view.url}
            alt={file.fileName}
            draggable={false}
            className="h-full w-full object-cover object-top"
          />
        )}
        {!pdf && (
          <span
            dir="ltr"
            className={cn(
              NUM,
              'absolute start-1.5 top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-md bg-slate-900/75 px-1 text-[11px] font-bold text-white',
            )}
          >
            {latin(index + 1)}
          </span>
        )}
        {uploading ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/60 dark:bg-[#0a1233]/60">
            <span
              className={cn(
                'rounded-md bg-white px-2 py-0.5 text-sm font-black text-indigo-700 shadow dark:bg-[#0a1233] dark:text-indigo-200',
                NUM,
              )}
              data-contract-file-progress={file.progress}
            >
              {file.progress}%
            </span>
            {onRemove !== null && (
              <button
                type="button"
                onClick={onRemove}
                className="text-[11px] font-bold text-slate-600 hover:text-rose-600 dark:text-slate-300"
              >
                {t('fleet.vehicleContracts.files.cancelUpload')}
              </button>
            )}
          </span>
        ) : (
          // Pointing at a file shows its actions — the image cells' box.
          <span
            data-file-actions="true"
            className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-slate-900/60 to-transparent pb-2 pt-6 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
          >
            <span className={FILE_PILL}>
              <button
                type="button"
                title={t('fleet.vehicleContracts.files.view')}
                aria-label={t('fleet.vehicleContracts.files.view')}
                onClick={onView}
                data-contract-file-view={file.key}
                className={actionTone('view')}
              >
                <EyeIcon className="h-4 w-4" />
              </button>
              {onRemove !== null && (
                <button
                  type="button"
                  title={t('fleet.vehicleContracts.files.remove')}
                  aria-label={t('fleet.vehicleContracts.files.remove')}
                  onClick={onRemove}
                  data-contract-file-remove={file.key}
                  className={actionTone('delete')}
                >
                  <Trash2Icon className="h-4 w-4" />
                </button>
              )}
            </span>
          </span>
        )}
      </div>
      <figcaption className="mt-1.5 leading-tight">
        <span
          className="block truncate text-[12.5px] font-bold text-slate-800 dark:text-slate-100"
          title={file.fileName}
        >
          {splitFileName(file.fileName).base}
        </span>
        <span className="mt-0.5 block text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
          {uploading
            ? `${t('fleet.vehicleContracts.files.uploading')}…`
            : words.fileSize(file.size)}
        </span>
      </figcaption>
    </figure>
  );
};

/** «إضافة مرفقات» — the boards' purple link. */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200';

interface Upload {
  key: string;
  file: File;
  progress: number;
  controller: AbortController;
  /** Once up: its id, until the contract read again shows it. */
  fileId: string | null;
}

let uploadKey = 0;

/** «مرفقات العقد» on the contract's page. */
export const ContractFilesSection = ({
  contract,
  mayAdd,
  mayChange,
  onRefused,
  panel,
}: {
  contract: FleetVehicleContractDto;
  /** create or edit — the upload route's grants. */
  mayAdd: boolean;
  /** edit — remove and reorder. */
  mayChange: boolean;
  /** The attachments changed meanwhile — read the contract again. */
  onRefused: () => void;
  panel: string;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const upload = useUploadVehicleContractFile();
  const remove = useDeleteVehicleContractFile();
  const order = useOrderVehicleContractFiles();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ShownFile | null>(null);
  const [ordered, setOrdered] = useState<string[] | null>(null);

  const saved = savedFiles(contract);
  const shownSaved =
    ordered === null ? saved : ordered.flatMap((id) => saved.filter((file) => file.key === id));
  const savedIds = new Set(saved.map((file) => file.key));
  const going = uploads.filter((each) => each.fileId === null || !savedIds.has(each.fileId));
  // An upload is done with once the contract read again shows its file — forgotten then, so a file
  // removed later never comes back as one still going up.
  const shownKey = saved.map((file) => file.key).join(',');
  useEffect(() => {
    const live = new Set(shownKey.split(','));
    setUploads((held) =>
      held.some((each) => each.fileId !== null && live.has(each.fileId))
        ? held.filter((each) => each.fileId === null || !live.has(each.fileId))
        : held,
    );
  }, [shownKey]);
  const goingTiles: ShownFile[] = going.map((each) => ({
    key: each.key,
    fileName: each.file.name,
    mime: each.file.type,
    size: each.file.size,
    saved: null,
    local: each.file,
    progress: each.progress,
  }));

  const setUpload = (key: string, change: Partial<Upload>): void =>
    setUploads((held) => held.map((each) => (each.key === key ? { ...each, ...change } : each)));

  const addFiles = async (files: File[]): Promise<void> => {
    const queued = files.map((file): Upload => {
      uploadKey += 1;
      return {
        key: `u${uploadKey}`,
        file,
        progress: 0,
        controller: new AbortController(),
        fileId: null,
      };
    });
    setUploads((held) => [...held, ...queued]);
    // One by one, in the order they were chosen — the server keeps upload order.
    for (const each of queued) {
      if (each.controller.signal.aborted) continue;
      try {
        const done = await upload.mutateAsync({
          id: contract.id,
          file: each.file,
          options: {
            signal: each.controller.signal,
            onProgress: (progress) => setUpload(each.key, { progress }),
          },
        });
        setUpload(each.key, { progress: 100, fileId: done.fileId });
      } catch (failure) {
        setUploads((held) => held.filter((x) => x.key !== each.key));
        if (failure instanceof DOMException && failure.name === 'AbortError') continue;
        const refusal = vehicleContractRefusalOf(failure);
        toast.error(
          refusal === 'fileRefused'
            ? t(REFUSAL_KEY.fileRefused, {
                name: each.file.name,
                mb: FLEET_VEHICLE_CONTRACT_FILE_MAX_MB,
              })
            : t('fleet.vehicleContracts.files.uploadFailed', { name: each.file.name }),
        );
      }
    }
  };

  const move = (from: number, to: number): void => {
    const next = moveItem(shownSaved, from, to).map((file) => file.key);
    setOrdered(next);
    order.mutate(
      { id: contract.id, fileIds: next },
      {
        onError: (failure) => {
          const refusal = vehicleContractRefusalOf(failure);
          if (refusal !== null) {
            toast.error(t(REFUSAL_KEY[refusal]));
            onRefused();
          }
        },
        onSettled: () => setOrdered(null),
      },
    );
  };
  const { dragOf, over } = useTileDrag(move);
  const mayOrder = mayChange && going.length === 0 && shownSaved.length > 1;

  const confirmRemove = async (): Promise<void> => {
    if (removing === null || removing.saved === null) return;
    try {
      await remove.mutateAsync({ id: contract.id, fileId: removing.saved.fileId });
      toast.success(t('fleet.vehicleContracts.files.removedToast'));
      setRemoving(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };

  const all = [...shownSaved, ...goingTiles];
  const name = words.contractName(contract).text;
  return (
    <section className={panel} id="files" data-contract-section="files">
      <SectionHead
        title={t('fleet.vehicleContracts.section.files')}
        icon={CLIP_ICON}
        end={
          <span className="flex items-center gap-2">
            <CountChip>{words.count('file', contract.files.length)}</CountChip>
            {mayAdd && (
              <PickFiles
                onFiles={(files) => void addFiles(files)}
                className={BRAND_BUTTON}
                mark="button"
              >
                <CloudUploadIcon className="h-3.5 w-3.5" />
                {t('fleet.vehicleContracts.actions.addFiles')}
              </PickFiles>
            )}
          </span>
        }
      />
      <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
        {mayAdd || all.length > 0
          ? t('fleet.vehicleContracts.filesHint')
          : t('fleet.vehicleContracts.files.none')}
      </p>
      <div className="flex gap-3 overflow-x-auto pb-1" data-contract-files-strip="true">
        {all.map((file, index) => {
          const pending = file.saved === null;
          return (
            <ContractFileTile
              key={file.key}
              file={file}
              index={index}
              onView={() => setViewing(index)}
              onRemove={
                pending
                  ? () => going.find((each) => each.key === file.key)?.controller.abort()
                  : mayChange
                    ? () => setRemoving(file)
                    : null
              }
              drag={mayOrder && !pending ? dragOf(index) : undefined}
              target={mayOrder && over === index}
            />
          );
        })}
        {mayAdd && (
          <PickFiles
            onFiles={(files) => void addFiles(files)}
            mark="tile"
            className="group flex aspect-[210/297] min-w-[112px] max-w-[150px] flex-1 flex-col items-center justify-center gap-2 self-start rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-center transition hover:border-indigo-500/50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <CloudUploadIcon className="h-5 w-5" />
            </span>
            <span className="px-2 text-[12px] font-bold leading-4 text-slate-700 dark:text-slate-200">
              {t('fleet.vehicleContracts.addTile')}
            </span>
          </PickFiles>
        )}
      </div>

      <VehicleContractViewer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        files={all}
        index={viewing ?? 0}
        onIndex={setViewing}
        subtitle={`${name} · ${words.count('file', all.length)}`}
      />
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('fleet.vehicleContracts.files.remove')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmRemove()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.vehicleContracts.files.removeBody', { name: removing?.fileName ?? '' })}
        </p>
      </Dialog>
    </section>
  );
};
