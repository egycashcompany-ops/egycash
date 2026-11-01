// One side of the National-ID card, laid out like the company's Readers page: a card-shaped frame
// with corner guides that turns into a preview of the chosen photo, one clear button under it, and
// the whole tile accepting a dropped photo. The user sees which picture went where before reading
// it (a front and back swapped, or the wrong photo, is visible here rather than only in a failed
// extraction). The preview is an object URL of the local file — nothing is uploaded until the read.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { BrandMark } from '../ui/BrandMark';
import { CheckIcon, TrashIcon, UploadIcon } from '../ui/icons';
import { liveCameraSupported } from './CardCamera';

const CameraIcon = ({ className }: { className?: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M4 8h3l1.6-2.4A1.5 1.5 0 0 1 9.85 5h4.3a1.5 1.5 0 0 1 1.25.6L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

const MAX_MB = 10;

/** The light that runs around the frame while the card is read. The frame is fixed at the card's
 *  1.586 proportion, so a 1586x1000 viewBox maps onto it without distortion. */
const Trace = (): JSX.Element => (
  <svg
    viewBox="0 0 1586 1000"
    preserveAspectRatio="none"
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 z-20 h-full w-full"
  >
    <rect
      x="8"
      y="8"
      width="1570"
      height="984"
      rx="70"
      fill="none"
      strokeWidth="3"
      vectorEffect="non-scaling-stroke"
      className="stroke-brand-500/20"
    />
    <rect
      x="8"
      y="8"
      width="1570"
      height="984"
      rx="70"
      fill="none"
      strokeWidth="6"
      vectorEffect="non-scaling-stroke"
      pathLength={100}
      strokeDasharray="28 72"
      strokeLinecap="round"
      className="ocr-trace stroke-brand-500 dark:stroke-brand-300"
    />
  </svg>
);

/** The four corner guides of the frame; white over a photo, brand over the empty frame. */
const Corners = ({ onPhoto }: { onPhoto: boolean }): JSX.Element => {
  const tone = onPhoto ? 'border-white/90' : 'border-brand-500 dark:border-brand-400';
  const base = cn('pointer-events-none absolute z-10 h-5 w-5 border-[2.5px]', tone);
  return (
    <>
      <span className={cn(base, 'start-2.5 top-2.5 rounded-ss-lg border-b-0 border-e-0')} />
      <span className={cn(base, 'end-2.5 top-2.5 rounded-se-lg border-b-0 border-s-0')} />
      <span className={cn(base, 'bottom-2.5 start-2.5 rounded-es-lg border-e-0 border-t-0')} />
      <span className={cn(base, 'bottom-2.5 end-2.5 rounded-ee-lg border-s-0 border-t-0')} />
    </>
  );
};

export const CardPhotoPicker = ({
  step,
  label,
  file,
  onChange,
  disabled = false,
  reading = false,
  onCamera,
}: {
  step: number;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  /** The card is being read: the frame shows a running light instead of sitting still. */
  reading?: boolean;
  /** Opens the live card camera. Where the browser has none (plain http), the phone's own camera
   *  app opens instead, through a capture input. */
  onCamera?: () => void;
}): JSX.Element => {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (file === null) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const take = (list: FileList | null): void => {
    const picked = list?.[0];
    if (picked === undefined || !picked.type.startsWith('image/')) return;
    if (picked.size > MAX_MB * 1024 * 1024) {
      setError(t('nationalIdOcr.upload.tooLarge'));
      return;
    }
    setError(null);
    onChange(picked);
  };

  const choose = (): void => {
    if (!disabled) inputRef.current?.click();
  };

  const shoot = (): void => {
    if (disabled) return;
    if (onCamera !== undefined && liveCameraSupported()) onCamera();
    else cameraInputRef.current?.click();
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    if (!disabled) take(e.dataTransfer.files);
  };

  const filled = file !== null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-white p-3.5 transition-all dark:bg-slate-900/60',
        filled
          ? 'border-emerald-300 dark:border-emerald-700/70'
          : 'border-slate-200 hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-700',
        dragOver && '-translate-y-0.5 border-brand-500 shadow-lg ring-4 ring-brand-500/15',
      )}
    >
      <div className="flex min-h-[28px] items-center gap-2.5">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white transition-colors',
            filled ? 'bg-emerald-500' : 'bg-brand-600',
          )}
        >
          {filled ? <CheckIcon className="h-4 w-4" /> : step}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-slate-800 dark:text-slate-100">
          {label}
        </span>
        {filled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckIcon className="h-3.5 w-3.5" />
            {t('nationalIdOcr.upload.added')}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={choose}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'relative mx-auto grid aspect-[1.586] w-full max-w-[340px] place-items-center overflow-hidden rounded-xl outline-none',
          'focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
          filled ? 'bg-slate-900' : 'bg-slate-100 dark:bg-[#0a0a0f]',
          disabled && !reading && 'cursor-not-allowed opacity-60',
          reading && 'cursor-progress',
        )}
      >
        <Corners onPhoto={filled} />
        {preview !== null ? (
          <img src={preview} alt={label} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <BrandMark
            size="fill"
            variant="muted"
            className={cn('h-[46%]', reading && 'animate-pulse')}
          />
        )}
        {reading && (
          <>
            <Trace />
            {filled && (
              <span className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-slate-950/25">
                <span className="ocr-scan absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-transparent via-brand-400/35 to-transparent" />
              </span>
            )}
          </>
        )}
      </button>

      {!filled && (
        <p className="text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {t('nationalIdOcr.upload.hint')}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={shoot}
          disabled={disabled}
          className={cn(
            'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-all',
            'hover:-translate-y-px active:translate-y-0 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
            filled
              ? 'border border-slate-300 bg-white text-slate-700 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
              : 'bg-brand-600 text-white shadow-md shadow-brand-600/25 hover:bg-brand-700',
          )}
        >
          <CameraIcon className="h-4 w-4 shrink-0" />
          {filled ? t('nationalIdOcr.camera.retake') : t('nationalIdOcr.camera.take')}
        </button>
        <button
          type="button"
          onClick={choose}
          disabled={disabled}
          className={cn(
            'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all',
            'hover:-translate-y-px active:translate-y-0 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
            'border-slate-300 bg-white text-slate-700 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
          )}
        >
          <UploadIcon className="h-4 w-4 shrink-0" />
          {filled ? t('nationalIdOcr.upload.replace') : t('nationalIdOcr.upload.choose')}
        </button>
        {filled && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              onChange(null);
            }}
            disabled={disabled}
            aria-label={t('nationalIdOcr.upload.remove')}
            title={t('nationalIdOcr.upload.remove')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 dark:border-slate-600 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="-mt-1 text-center text-xs text-slate-400 dark:text-slate-500">
        {filled ? <span dir="ltr">{file.name}</span> : t('nationalIdOcr.upload.orDrag')}
      </p>
      {error !== null && (
        <p className="text-center text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
};
