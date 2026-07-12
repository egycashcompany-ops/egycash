// Drag-and-drop / click file picker. Client-side size guard (the server remains authoritative);
// shows selected files with a remove affordance. Emits the current File[] on every change.
// RTL-safe. Wire to the platform Files service in a feature's api/ layer.
import { useRef, useState, type DragEvent } from 'react';
import { useAppSelector } from '../../store';
import { useT } from '../../platform/localization/useT';
import { toast } from './toast/toast-store';
import { cn } from '../lib/cn';
import { UploadIcon, CloseIcon, FileIcon } from './icons';

const formatSize = (bytes: number, locale: string): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }).format(value)} ${units[unit] ?? 'B'}`;
};

export const FileUpload = ({
  accept,
  multiple = false,
  maxSizeMb,
  onFiles,
  disabled = false,
}: {
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const ingest = (list: FileList | null): void => {
    if (list === null) return;
    const valid: File[] = [];
    for (const file of Array.from(list)) {
      if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
        toast.error(t('common.upload.tooLarge', { name: file.name, size: maxSizeMb }));
        continue;
      }
      valid.push(file);
    }
    const next = multiple ? [...files, ...valid] : valid.slice(0, 1);
    setFiles(next);
    onFiles(next);
  };

  const remove = (index: number): void => {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    onFiles(next);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (!disabled) ingest(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragOver
            ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/40'
            : 'border-slate-300 hover:border-brand-400 dark:border-slate-700',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <UploadIcon className="h-7 w-7 text-slate-400" />
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('common.upload.prompt')}</p>
        {maxSizeMb !== undefined && (
          <p className="text-xs text-slate-400">{t('common.upload.max', { size: maxSizeMb })}</p>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          {...(accept === undefined ? {} : { accept })}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            ingest(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{file.name}</span>
              <span className="shrink-0 text-xs text-slate-400">{formatSize(file.size, locale)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500"
                aria-label={t('common.remove')}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
