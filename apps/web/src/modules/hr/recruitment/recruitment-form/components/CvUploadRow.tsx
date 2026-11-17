// The CV on the public apply page: one row like the papers — the file's name once chosen, and a
// button to pick it. A PDF, a Word file or a photo of it; optional. It uploads the moment it is
// chosen and is copied into the applicant's files when the application is sent.
import { useRef, useState } from 'react';
import { useT } from '../../../../../platform/localization/useT';
import { cn } from '../../../../../shared/lib/cn';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { AlertIcon, CheckIcon, UploadIcon } from '../../../../../shared/ui/icons';
import { ACTION, Outline, PaperRow, PRIMARY, SECONDARY } from './CardPhotoBox';

const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp';
const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_BYTES = 10 * 1024 * 1024;

const sizeOf = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const CvUploadRow = ({
  upload,
  onChange,
  errorText,
}: {
  upload: (file: File) => Promise<string>;
  onChange: (fileId: string | null) => void;
  errorText?: string | undefined;
}): JSX.Element => {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined): void => {
    if (file === undefined) return;
    if (!ALLOWED.has(file.type)) {
      setError(t('apply.cv.wrongType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t('apply.idCard.tooLarge'));
      return;
    }
    setError(null);
    setPicked({ name: file.name, size: file.size });
    setBusy(true);
    setDone(false);
    onChange(null);
    void upload(file)
      .then((fileId) => {
        setDone(true);
        onChange(fileId);
      })
      .catch(() => {
        setError(t('apply.idCard.uploadFailed'));
        setPicked(null);
      })
      .finally(() => setBusy(false));
  };

  const shownError = error ?? errorText ?? null;

  return (
    <PaperRow
      labelId="apply-cv-label"
      state={shownError !== null ? 'bad' : done ? 'done' : 'idle'}
      thumb={<Outline art="cv" className="h-8" />}
      title={t('apply.cv.title')}
      badge={
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {t('apply.optional')}
        </span>
      }
      status={
        busy ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner className="h-3.5 w-3.5" /> {t('apply.idCard.uploading')}
          </span>
        ) : shownError !== null ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
            <AlertIcon className="h-3.5 w-3.5 shrink-0" /> {shownError}
          </span>
        ) : picked !== null && done ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate" dir="auto">{picked.name}</span>
            <span className="shrink-0 text-slate-400">· {sizeOf(picked.size)}</span>
          </span>
        ) : (
          t('apply.cv.hint')
        )
      }
      actions={
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={cn(ACTION, done ? SECONDARY : PRIMARY)}>
          <UploadIcon className="h-4 w-4" />
          {done ? t('apply.cv.replace') : t('apply.cv.upload')}
        </button>
      }
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </PaperRow>
  );
};
