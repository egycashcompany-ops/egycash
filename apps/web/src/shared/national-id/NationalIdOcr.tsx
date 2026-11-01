// Reusable Egyptian National-ID OCR capture → review flow, laid out like the company's Readers page:
// a header with a progress track of the three steps, two card-shaped photo tiles (front + back) that preview the
// chosen photos, and one clear action. Both sides are read together in one extraction pass (the
// extractor is injected by the consuming module, which owns the upload + OCR endpoint), then a
// DEDICATED review dialog opens with the card as read beside every extracted field, editable. Only on
// Confirm is the reviewed data handed back via `onConfirm` — the flow is independent of any host
// form, so Applicants, Employees, KYC, etc. can all reuse it. Degrades gracefully when no provider is
// wired (OQ-30): the review still opens for manual entry.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { CheckIcon } from '../ui/icons';
import { CardCamera, type CardSide } from './CardCamera';
import { CardPhotoPicker } from './CardPhotoPicker';
import { NationalIdReviewDialog } from './NationalIdReviewDialog';
import { ocrToMeta, ocrToReview } from './mapping';
import {
  type NationalIdExtractor,
  type NationalIdReviewData,
  type NationalIdReviewMeta,
} from './types';

/** An ID card inside scan corners — what this panel does, at a glance. */
const CardScanIcon = ({ className }: { className?: string }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="6.5" y="7.5" width="11" height="9" rx="1.5" />
    <circle cx="10" cy="11" r="1.4" />
    <path d="M8.3 14.3c.4-.9 1-1.3 1.7-1.3s1.3.4 1.7 1.3M13.5 10.5h2.2M13.5 13h2.2" />
  </svg>
);

type StepState = 'done' | 'current' | 'next';

/** One step of the progress track: done (green tick), the one to do now (brand), or still ahead. */
const Step = ({ n, label, state }: { n: number; label: string; state: StepState }): JSX.Element => (
  <li
    className="flex items-center gap-2.5 lg:shrink-0"
    aria-current={state === 'current' ? 'step' : undefined}
  >
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all',
        state === 'done' && 'bg-emerald-500 text-white',
        state === 'current' &&
          'bg-brand-600 text-white shadow-md shadow-brand-600/30 ring-4 ring-brand-500/15',
        state === 'next' && 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
      )}
    >
      {state === 'done' ? <CheckIcon className="h-4 w-4" /> : n}
    </span>
    <span
      className={cn(
        'whitespace-nowrap text-sm font-semibold',
        state === 'done' && 'text-emerald-700 dark:text-emerald-300',
        state === 'current' && 'text-slate-900 dark:text-white',
        state === 'next' && 'text-slate-500 dark:text-slate-400',
      )}
    >
      {label}
    </span>
  </li>
);

/** The line between two steps, filled once the step before it is done. */
const Link = ({ filled }: { filled: boolean }): JSX.Element => (
  <li
    aria-hidden="true"
    className="hidden h-0.5 min-w-[24px] flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 lg:block"
  >
    <span
      className={cn(
        'block h-full bg-emerald-500 transition-all duration-500',
        filled ? 'w-full' : 'w-0',
      )}
    />
  </li>
);

export const NationalIdOcr = ({
  extract,
  onConfirm,
}: {
  /** Runs the OCR for the two images (owns upload + endpoint) — injected by the host module. */
  extract: NationalIdExtractor;
  /** Called with the reviewed, confirmed fields — the host maps them into its own form/record. */
  onConfirm: (data: NationalIdReviewData) => void;
}): JSX.Element => {
  const t = useT();
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // The side the live camera is photographing, or null while it is closed.
  const [cameraSide, setCameraSide] = useState<CardSide | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewData, setReviewData] = useState<NationalIdReviewData | null>(null);
  const [reviewMeta, setReviewMeta] = useState<NationalIdReviewMeta | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // Object URLs of the uploaded photos, shown in the review when the reader returned no image.
  const urls = useRef<string[]>([]);

  const releaseUrls = (): void => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  };
  useEffect(() => releaseUrls, []);

  // Seconds since the read started, shown while it runs: a read takes several seconds (18 on a
  // two-sided card here) and a button that sits silent that long looks broken.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return undefined;
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      500,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const run = async (): Promise<void> => {
    if (front === null && back === null) return;
    setBusy(true);
    try {
      const result = await extract({ frontFile: front, backFile: back });
      releaseUrls();
      const uploadedFront = front === null ? undefined : URL.createObjectURL(front);
      const uploadedBack = back === null ? undefined : URL.createObjectURL(back);
      urls.current = [uploadedFront, uploadedBack].filter((u): u is string => u !== undefined);
      setUnavailable(!result.available);
      setReviewData(ocrToReview(result));
      setReviewMeta(ocrToMeta(result, { front: uploadedFront, back: uploadedBack }));
      setReviewOpen(true);
    } catch {
      // surfaced by the global error handler
    } finally {
      setBusy(false);
    }
  };

  const confirm = (data: NationalIdReviewData): void => {
    setReviewOpen(false);
    setConfirmed(true);
    onConfirm(data);
  };

  const clear = (): void => {
    setFront(null);
    setBack(null);
    setConfirmed(false);
  };

  const count = (front === null ? 0 : 1) + (back === null ? 0 : 1);
  const status =
    count === 0
      ? t('nationalIdOcr.status.none')
      : count === 1
        ? t('nationalIdOcr.status.one')
        : t('nationalIdOcr.status.both');
  // The first step not yet done is the one to do now; the rest wait.
  const doneFlags = [front !== null, back !== null, confirmed];
  const firstOpen = doneFlags.indexOf(false);
  const stateOf = (i: number): StepState =>
    doneFlags[i] === true ? 'done' : i === firstOpen ? 'current' : 'next';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      <header className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-l from-brand-50/70 via-white to-white px-5 pb-4 pt-5 dark:border-slate-800 dark:from-brand-950/30 dark:via-slate-900 dark:to-slate-900 sm:px-6">
        {/* A soft brand glow behind the icon, so the panel reads as its own tool. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 start-[-40px] h-44 w-44 rounded-full bg-brand-500/10 blur-3xl dark:bg-brand-500/15"
        />
        <div className="relative flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/25">
            <CardScanIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h3 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">
              {t('nationalIdOcr.title')}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t('nationalIdOcr.subtitle')}
            </p>
          </div>
        </div>
        <ol className="relative mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-700/70 dark:bg-slate-800/40 lg:flex-row lg:items-center lg:gap-3">
          <Step n={1} label={t('nationalIdOcr.step.front')} state={stateOf(0)} />
          <Link filled={doneFlags[0] === true} />
          <Step n={2} label={t('nationalIdOcr.step.back')} state={stateOf(1)} />
          <Link filled={doneFlags[1] === true} />
          <Step n={3} label={t('nationalIdOcr.step.review')} state={stateOf(2)} />
        </ol>
      </header>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <CardPhotoPicker
            step={1}
            label={t('nationalIdOcr.step.front')}
            file={front}
            onChange={setFront}
            disabled={busy}
            reading={busy}
            onCamera={() => setCameraSide('front')}
          />
          <CardPhotoPicker
            step={2}
            label={t('nationalIdOcr.step.back')}
            file={back}
            onChange={setBack}
            disabled={busy}
            reading={busy}
            onCamera={() => setCameraSide('back')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
          <Button
            className="min-h-[44px] px-6 text-[15px]"
            disabled={count === 0}
            loading={busy}
            onClick={() => void run()}
          >
            {t('nationalIdOcr.extract')}
          </Button>
          {count > 0 && (
            <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={clear}>
              {t('nationalIdOcr.clear')}
            </Button>
          )}
          {busy ? (
            <p
              className="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300"
              role="status"
              aria-live="polite"
            >
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
              </span>
              {t('nationalIdOcr.status.reading')}
              <span className="tabular-nums text-slate-500 dark:text-slate-400">
                {t('nationalIdOcr.status.seconds', { n: elapsed })}
              </span>
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{status}</p>
          )}
        </div>
      </div>

      <CardCamera
        side={cameraSide}
        continueToBack={back === null}
        onPhoto={(taken, photo) => {
          setConfirmed(false);
          if (taken === 'front') setFront(photo);
          else setBack(photo);
        }}
        onClose={() => setCameraSide(null)}
      />

      {reviewData !== null && reviewMeta !== null && (
        <NationalIdReviewDialog
          open={reviewOpen}
          initial={reviewData}
          meta={reviewMeta}
          notice={unavailable ? t('nationalIdOcr.unavailable') : undefined}
          onCancel={() => setReviewOpen(false)}
          onConfirm={confirm}
        />
      )}
    </section>
  );
};
