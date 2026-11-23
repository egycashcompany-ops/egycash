// One photo on the public apply page — an ID card side or a paper.
//
// Two ways in, side by side: TAKE A PHOTO (a live camera view where the browser allows it, else the
// phone's own camera app) or UPLOAD one already on the device. The photo uploads the moment it is
// chosen, so the submission only has to name it.
//
// Two layouts: `tile` for the ID card's two sides (a framed card-shaped tile that shows the photo),
// and `row` for the papers (a list row: thumbnail, name and status, actions at the end).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { AlertIcon, CameraIcon, CheckIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { CameraCapture, canUseLiveCamera } from './CameraCapture';

export interface CardPhoto {
  fileId: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

export type Art = 'idFront' | 'idBack' | 'paper' | 'cv';

/** A line drawing of what goes in the box — the card's front, its back, or a paper. */
export const Outline = ({ art, className }: { art: Art; className?: string }): JSX.Element => {
  const stroke = 'stroke-slate-300 dark:stroke-slate-600';
  const accent = 'stroke-brand-400 dark:stroke-brand-500';
  if (art === 'cv') {
    return (
      <svg viewBox="0 0 48 60" aria-hidden className={cn('w-auto', className)} fill="none" strokeWidth={2.5} strokeLinecap="round">
        <path className={stroke} d="M8 3h22l10 10v41a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
        <path className={stroke} d="M30 3v10h10" />
        <circle className={accent} cx="17" cy="22" r="5" />
        <path className={accent} d="M10 34c1.5-4 4-5.5 7-5.5s5.5 1.5 7 5.5" />
        <path className={stroke} d="M28 21h7M28 27h7M11 42h24M11 49h17" />
      </svg>
    );
  }
  if (art === 'paper') {
    return (
      <svg viewBox="0 0 48 60" aria-hidden className={cn('w-auto', className)} fill="none" strokeWidth={2.5} strokeLinecap="round">
        <path className={stroke} d="M8 3h22l10 10v41a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
        <path className={stroke} d="M30 3v10h10M13 24h22M13 31h22M13 38h14" />
        <circle className={accent} cx="33" cy="47" r="5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 50" aria-hidden className={cn('w-auto', className)} fill="none" strokeWidth={2} strokeLinecap="round">
      <rect className={stroke} x="2" y="2" width="76" height="46" rx="5" />
      {art === 'idFront' ? (
        <>
          <rect className={accent} x="9" y="10" width="17" height="21" rx="2" />
          <path className={stroke} d="M34 13h36M40 20h30M46 27h24M9 39h61" />
        </>
      ) : (
        <>
          <path className={stroke} d="M10 11h40M10 18h28M58 10v12" />
          <path className={accent} d="M10 32v9M14 32v9M17 32v9M22 32v9M25 32v9M30 32v9M34 32v9M37 32v9M42 32v9M46 32v9M49 32v9M54 32v9M58 32v9M62 32v9M66 32v9M70 32v9" />
        </>
      )}
    </svg>
  );
};

export const ACTION =
  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-slate-900';
export const PRIMARY = 'bg-brand-600 text-white hover:bg-brand-700';
export const SECONDARY =
  'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

export const CardPhotoBox = ({
  label,
  hint,
  upload,
  onChange,
  invalid,
  required = true,
  layout = 'tile',
  art = 'idFront',
  errorText,
}: {
  label: string;
  /** Shown under the name in a row; tiles leave the shared hint to the section. */
  hint?: string | undefined;
  /** Uploads the picked image; resolves to its file id. */
  upload: (file: File) => Promise<string>;
  onChange: (photo: CardPhoto | null) => void;
  /** Mark it red — the submission was refused because of this photo. */
  invalid: boolean;
  /** Optional papers say so instead of carrying the red star. */
  required?: boolean;
  layout?: 'tile' | 'row';
  art?: Art;
  /** The server's or the page's reason this photo was refused, shown in red. */
  errorText?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const labelId = useId();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  // A blob URL holds the image in memory until it is revoked.
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pick = (file: File | undefined): void => {
    if (file === undefined) return;
    if (!file.type.startsWith('image/')) {
      setError(t('apply.idCard.notImage'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('apply.idCard.tooLarge'));
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    setUploaded(false);
    onChange(null);
    void upload(file)
      .then((fileId) => {
        setUploaded(true);
        onChange({ fileId });
      })
      .catch(() => {
        setError(t('apply.idCard.uploadFailed'));
        setPreview(null);
      })
      .finally(() => setBusy(false));
  };

  // A live camera view where the page may open the camera; otherwise the phone's camera app.
  const takePhoto = (): void => {
    if (canUseLiveCamera()) setCameraOpen(true);
    else cameraInput.current?.click();
  };

  const bad = invalid || error !== null;
  const has = preview !== null;

  const actions = (
    // Tiles: two equal buttons filling the width (easy to hit on a phone). Rows: side by side.
    <div className={cn('flex flex-wrap items-center gap-2', layout === 'tile' && 'w-full [&>*]:flex-1')}>
      <button type="button" onClick={takePhoto} disabled={busy} className={cn(ACTION, has ? SECONDARY : PRIMARY)}>
        <CameraIcon className="h-4 w-4" />
        {has ? t('apply.photo.retakeShort') : t('apply.photo.take')}
      </button>
      <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={cn(ACTION, SECONDARY)}>
        <UploadIcon className="h-4 w-4" />
        {has ? t('apply.photo.replaceShort') : t('apply.photo.upload')}
      </button>
    </div>
  );

  const status = busy ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
      <Spinner className="h-3.5 w-3.5" /> {t('apply.idCard.uploading')}
    </span>
  ) : error !== null || errorText !== undefined ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
      <AlertIcon className="h-3.5 w-3.5 shrink-0" /> {error ?? errorText}
    </span>
  ) : uploaded ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <CheckIcon className="h-3.5 w-3.5" /> {t('apply.photo.done')}
    </span>
  ) : null;

  const badge = required ? (
    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-950/50 dark:text-red-400">
      {t('apply.required')}
    </span>
  ) : (
    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      {t('apply.optional')}
    </span>
  );

  const inputs = (
    <>
      {/* The phone's camera app — used when the page cannot open the camera itself. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {/* A photo already on the device — no `capture`, so the gallery and files open. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {cameraOpen && (
        <CameraCapture
          title={label}
          onCapture={pick}
          onClose={() => setCameraOpen(false)}
          onFallback={() => cameraInput.current?.click()}
        />
      )}
    </>
  );

  if (layout === 'row') {
    return (
      <PaperRow
        labelId={labelId}
        state={bad ? 'bad' : uploaded ? 'done' : 'idle'}
        thumb={has ? <img src={preview} alt={label} className="h-full w-full object-cover" /> : <Outline art="paper" className="h-8" />}
        title={label}
        badge={badge}
        status={status ?? hint}
        actions={actions}
      >
        {inputs}
      </PaperRow>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'overflow-hidden rounded-lg border bg-white transition-colors dark:bg-slate-900',
        bad ? 'border-red-300 dark:border-red-800' : uploaded ? 'border-emerald-200 dark:border-emerald-900' : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <p id={labelId} className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          {label} {badge}
        </p>
        <span aria-live="polite">{status}</span>
      </div>
      <div className="p-3">
        <div className="grid aspect-[1.586] w-full place-items-center overflow-hidden rounded-md bg-slate-50 ring-1 ring-inset ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
          {has ? (
            <img src={preview} alt={label} className="h-full w-full object-contain" />
          ) : (
            <Outline art={art} className="h-14 opacity-90" />
          )}
        </div>
      </div>
      <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/30">
        {actions}
      </div>
      {inputs}
    </div>
  );
};

/** One row in the papers list — the frame the CV row uses too, so every row matches. */
export const PaperRow = ({
  labelId,
  state,
  thumb,
  title,
  badge,
  status,
  actions,
  children,
}: {
  labelId: string;
  state: 'idle' | 'done' | 'bad';
  thumb: ReactNode;
  title: string;
  badge: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}): JSX.Element => (
  <div
    role="group"
    aria-labelledby={labelId}
    className={cn(
      'rounded-lg border bg-white p-3 transition-colors dark:bg-slate-900',
      state === 'bad' ? 'border-red-300 dark:border-red-800' : state === 'done' ? 'border-emerald-200 dark:border-emerald-900' : 'border-slate-200 dark:border-slate-800',
    )}
  >
    <div className="flex items-center gap-3">
      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-50 ring-1 ring-inset ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
        {thumb}
      </span>
      <div className="min-w-0 flex-1">
        <p id={labelId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-100">
          {title} {badge}
        </p>
        <div className="mt-1 min-h-4 min-w-0 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          {status}
        </div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    {children}
  </div>
);
