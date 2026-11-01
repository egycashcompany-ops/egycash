// «مرفقات العقد» in the editor — where the editors keep their paper (`zz-contracts-forms-*`): the
// dashed drop box that takes many files at once (images or PDF, 10 MB each), and the tray of tiles
// in their order. Files wait here until Save; a tile is dragged to another place, or stepped with
// its arrows from the keyboard. Also the two small pieces the contract page's section shares: the
// DTO's attachments as tiles, and a file picker that looks like anything.
import { type ReactNode } from 'react';
import { type FleetVehicleContractDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CONTRACT_FILE_ACCEPT } from '../lib/vehicle-contract-figures';
import { useVehicleContractWords } from '../lib/vehicle-contract-words';
import { PATH } from './FuelCardBoard';
import { SANS, Stroke } from './FuelCardDialog';
import { CountChip } from './custody-memo-parts';
import {
  AttachmentTile,
  useFilePicker,
  useTileDrag,
  type ShownFile,
} from './VehicleContractAttachments';

const CLOUD_PATH =
  'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12';

/** «اسحب صفحات العقد هنا…»: the fuel card's dashed drop box, taking many files, images or PDF. */
export const DropBox = ({ onFiles }: { onFiles: (files: File[]) => void }): JSX.Element => {
  const t = useT();
  const pick = useFilePicker();
  return (
    <div
      data-contract-drop="true"
      className="group relative cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white/70 p-4 text-center transition-all hover:border-indigo-500/50 dark:border-[#2b3b6b] dark:bg-[#0a1233]/60 dark:hover:bg-[#0a1233]"
    >
      <input
        type="file"
        multiple
        accept={CONTRACT_FILE_ACCEPT}
        aria-label={t('fleet.vehicleContracts.files.pick')}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => {
          const files = pick(Array.from(event.target.files ?? []));
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      <div className="pointer-events-none flex items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d={CLOUD_PATH} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="text-start">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {t('fleet.vehicleContracts.files.dropTitle')}
            </p>
            <p className="mt-0.5 text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {t('fleet.vehicleContracts.files.dropHint')}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-[#2b3b6b] dark:bg-slate-800/80 dark:text-slate-300">
          <Stroke d={['M12 4v16m8-8H4']} className="h-3.5 w-3.5" />
          {t('fleet.vehicleContracts.files.pick')}
        </span>
      </div>
    </div>
  );
};

/** The attachments' side of the editor — where the editors keep their paper preview. */
export const AttachmentsTray = ({
  files,
  onAdd,
  onView,
  onRemove,
  onMove,
  busy,
}: {
  files: readonly ShownFile[];
  onAdd: (files: File[]) => void;
  onView: (index: number) => void;
  onRemove: (key: string) => void;
  onMove: (from: number, to: number) => void;
  /** While the save sequence runs: no drop box, no reordering. */
  busy: boolean;
}): JSX.Element => {
  const t = useT();
  const words = useVehicleContractWords();
  const { dragOf, over } = useTileDrag(onMove);
  return (
    <section
      data-contract-files="true"
      className={cn(
        SANS,
        'space-y-3 self-start rounded-xl bg-slate-200 p-3 sm:p-4 lg:min-h-0 lg:flex-1 dark:bg-slate-800',
      )}
    >
      <p className="flex items-center justify-between gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
        <span className="flex items-center gap-2">
          <Stroke d={[...PATH.image]} className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
          {t('fleet.vehicleContracts.section.files')}
        </span>
        <CountChip>{words.count('file', files.length)}</CountChip>
      </p>
      {!busy && <DropBox onFiles={onAdd} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {files.map((file, index) => (
          <AttachmentTile
            key={file.key}
            file={file}
            index={index}
            onView={() => onView(index)}
            onRemove={() => onRemove(file.key)}
            {...(busy
              ? {}
              : {
                  drag: dragOf(index),
                  target: over === index,
                  onMove: {
                    earlier: index > 0 ? () => onMove(index, index - 1) : null,
                    later: index < files.length - 1 ? () => onMove(index, index + 1) : null,
                  },
                })}
          />
        ))}
      </div>
      {files.length > 1 && (
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {t('fleet.vehicleContracts.files.order')}
        </p>
      )}
    </section>
  );
};

/** The DTO's attachments as tiles. */
export const savedFiles = (contract: Pick<FleetVehicleContractDto, 'id' | 'files'>): ShownFile[] =>
  contract.files.map((file) => ({
    key: file.fileId,
    fileName: file.fileName,
    mime: file.mime,
    size: file.size,
    saved: { contractId: contract.id, fileId: file.fileId },
    local: null,
    progress: null,
  }));

/**
 * A file picker that looks like anything — the add tile, the section's button. `relative` holds its
 * hidden input: unpositioned, the input sat at the strip's scrolled-away end and widened the page.
 */
export const PickFiles = ({
  onFiles,
  className,
  children,
  mark,
}: {
  onFiles: (files: File[]) => void;
  className: string;
  children: ReactNode;
  mark: string;
}): JSX.Element => {
  const pick = useFilePicker();
  return (
    <label className={cn('relative cursor-pointer', className)} data-contract-add-files={mark}>
      <input
        type="file"
        multiple
        accept={CONTRACT_FILE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const files = pick(Array.from(event.target.files ?? []));
          event.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      {children}
    </label>
  );
};
