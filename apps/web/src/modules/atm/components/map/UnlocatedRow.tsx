// One machine without a usable location (docs/12-planning/atm-map-zones.md §8.8 `UnlocatedRow`,
// `Unlocated.dc.html:96-127`). Closed: «code · name», then the bank, the area, the branch and why.
// Open: it reads the machine's location detail, then offers what can be done about it.
//
//   · «الموقع في السجل: …» only when the server says the reader may see the register's text
//     (`sourceVisible`: `atmRegister.view` over every source entry, §6.5 Detail);
//   · «فتح الرابط الأصلي» only for an http(s) link — the cell is free text;
//   · a pin under review says why («رمز Plus Code مختصر…», a map centre, two points…) and offers
//     «اعتماد الموقع» / «تصحيح»;
//   · the paste box sends the text to the server's parser (DM-14) and shows its answer; a readable
//     point becomes the temporary pin, confirmed through `MovePinBar` on the page;
//   · «وضع على الخريطة»: the next click on the map places the pin.
//
// A row exists only for a branch where the reader can locate (§8.3), so its actions always apply.
import { memo, useId, useState } from 'react';
import {
  ATM_BANK_NAMES,
  ErrorCodes,
  type AtmMachineLocationDetailDto,
  type AtmMapLatLng,
  type AtmMapPointDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { ApiError } from '../../../../shared/lib/api-client';
import { cn } from '../../../../shared/lib/cn';
import { errorMessage } from '../../../../shared/lib/errors';
import { Button } from '../../../../shared/ui/Button';
import { Spinner } from '../../../../shared/ui/Spinner';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { useApproveLocation, useMachineLocation, useParseLocation } from '../../api/map-queries';
import { bankColor } from '../../lib/map-colors';
import { approveFailureKey } from '../../lib/map-errors';
import { originalLinkHref } from '../../lib/map-links';
import { locatedToast } from '../../lib/map-toasts';
import {
  chipLabelKey,
  chipOf,
  linkFailureKey,
  parseFeedback,
  type FeedbackTone,
} from '../../lib/unlocated-view';
import { chipTone } from './ReasonChips';
import { CONFIRM_BUTTON } from './map-buttons';

const TONE: Record<FeedbackTone, string> = {
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  error: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
};

/**
 * Why a pin is under review, one note per reason the server gave (§8.8) — and, under review or
 * not, a pin outside Egypt (DM-35's warning, which never asks for review on its own).
 */
export const reviewNotes = (detail: AtmMachineLocationDetailDto): string[] => {
  const outside = detail.warnings.includes('outsideEgypt') ? ['atm.map.location.outsideEgypt'] : [];
  if (!detail.needsReview) return outside;
  const notes: string[] = [...outside];
  if (detail.source === 'registerShortCode') notes.push('atm.map.unlocated.reviewNote');
  if (detail.warnings.includes('weakReference')) notes.push('atm.map.unlocated.weakNote');
  if (detail.warnings.includes('viewportOnly')) notes.push('atm.map.unlocated.viewportNote');
  if (detail.warnings.includes('ambiguousUrl')) notes.push('atm.map.unlocated.ambiguousNote');
  if (detail.warnings.includes('sourcesDisagree')) notes.push('atm.map.unlocated.disagreeNote');
  return notes;
};

export interface UnlocatedRowActions {
  /** «تصحيح»: the suggested pin becomes draggable (MovePinBar, mode `pin`). */
  onCorrect: (point: AtmMapPointDto) => void;
  /** «قراءة» read a point: it becomes the temporary pin, confirmed as text while untouched. */
  onPreview: (point: AtmMapPointDto, at: AtmMapLatLng, text: string) => void;
  /** «وضع على الخريطة»: the next map click places the pin. */
  onPlace: (point: AtmMapPointDto) => void;
  /** «القطاع: …» of a point of a branch, for the approve toast. */
  zoneNameAt: (branchId: string, at: AtmMapLatLng | null) => string;
}

export const UnlocatedRow = memo(function UnlocatedRow({
  point,
  branchName,
  open,
  locale,
  actions,
  onToggle,
}: {
  point: AtmMapPointDto;
  branchName: string;
  open: boolean;
  locale: Locale;
  actions: UnlocatedRowActions;
  onToggle: (machineId: string) => void;
}): JSX.Element {
  const t = useT();
  const chip = chipOf(point);
  const bank =
    point.bankCode === null
      ? t('atm.map.filters.bankNone')
      : ATM_BANK_NAMES[point.bankCode][locale];

  return (
    <div
      data-unlocated-row={point.machineId}
      className={cn(
        'border-b border-slate-100 last:border-b-0 dark:border-slate-800',
        open ? 'bg-slate-50/70 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(point.machineId)}
        className="flex min-h-16 w-full flex-col gap-1 px-3 py-2.5 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <span className="flex items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
          <span dir="ltr" className="font-mono text-[13px] font-bold">
            {point.code}
          </span>
          · <span className="truncate">{point.name}</span>
        </span>
        <span className="flex w-full flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shadow-[inset_0_0_0_1px_rgba(15,23,42,0.3)]"
              style={{ backgroundColor: bankColor(point.bankCode) }}
            />
            {bank}
          </span>
          · {point.area} · {branchName}
          {chip !== null && (
            <span className={cn('ms-auto rounded-full border px-2 py-px', chipTone(chip))}>
              {t(chipLabelKey(chip))}
            </span>
          )}
        </span>
      </button>
      {open && <UnlocatedRowBody point={point} locale={locale} actions={actions} />}
    </div>
  );
});

/**
 * The open row: its detail read, the approval, the paste box. Mounted only while the row is open,
 * so a list of 1,700 closed rows holds no queries, mutations or state of its own (UX-8).
 */
const UnlocatedRowBody = ({
  point,
  locale,
  actions,
}: {
  point: AtmMapPointDto;
  locale: Locale;
  actions: UnlocatedRowActions;
}): JSX.Element => {
  const t = useT();
  const pasteId = useId();
  const detail = useMachineLocation(point.machineId);
  const approve = useApproveLocation();
  const parse = useParseLocation();
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ key: string; tone: FeedbackTone } | null>(null);
  const read = (): void => {
    const value = text.trim();
    if (value === '') return;
    parse.mutate(
      { machineId: point.machineId, text: value },
      {
        onSuccess: (result) => {
          setFeedback(parseFeedback(result));
          if (result.ok) actions.onPreview(point, { lat: result.lat, lng: result.lng }, value);
        },
        onError: (error) => toast.error(errorMessage(error, locale)),
      },
    );
  };

  const doApprove = (): void => {
    const loaded = detail.data;
    if (loaded === undefined || loaded.version === null) return;
    approve.mutate(
      { machineId: point.machineId, body: { version: loaded.version } },
      {
        onSuccess: (saved) => {
          const zone = actions.zoneNameAt(
            point.branchId,
            saved.lat === null || saved.lng === null ? null : { lat: saved.lat, lng: saved.lng },
          );
          const words = locatedToast(point.code, zone, t);
          toast.success(words.title, words.description);
        },
        onError: (error) => {
          const key = approveFailureKey(error);
          if (key !== null) {
            toast.warning(t(key));
            return;
          }
          if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {
            void detail.refetch();
          }
          toast.error(errorMessage(error, locale));
        },
      },
    );
  };

  const loaded = detail.data;
  const source = loaded?.sourceVisible === true ? loaded.sourceText : null;
  const sourceLine =
    source === null ? null : [source.plusCode, source.url].filter((s) => s !== null).join(' · ');
  const original = originalLinkHref(source?.url ?? null);
  const failure =
    point.reason === 'shortLinkFailed' && loaded?.shortLink?.failure !== undefined
      ? loaded.shortLink.failure
      : null;

  return (
    <div className="flex flex-col gap-2.5 px-3 pb-3.5">
      {detail.isLoading && <Spinner className="h-4 w-4 text-slate-400" />}
      {sourceLine !== null && sourceLine !== '' && (
        <div data-source-line="true" className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.map.unlocated.sourceLabel')}{' '}
          <span dir="ltr" className="break-all font-mono text-slate-900 dark:text-slate-100">
            {sourceLine}
          </span>
        </div>
      )}
      {failure !== null && (
        <p className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-200">
          {t(linkFailureKey(failure))}
        </p>
      )}
      {loaded !== undefined &&
        reviewNotes(loaded).map((key) => (
          <p
            key={key}
            className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-[1.7] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            {t(key)}
          </p>
        ))}
      {point.state === 'review' && (
        <div className="flex gap-2">
          <button
            type="button"
            className={CONFIRM_BUTTON}
            disabled={loaded === undefined || approve.isPending}
            onClick={doApprove}
          >
            {approve.isPending && <Spinner className="h-4 w-4" />}
            {t('atm.map.unlocated.approve')}
          </button>
          <Button size="sm" variant="secondary" onClick={() => actions.onCorrect(point)}>
            {t('atm.map.unlocated.correct')}
          </Button>
        </div>
      )}
      <label htmlFor={pasteId} className="text-xs text-slate-500 dark:text-slate-400">
        {t('atm.map.unlocated.paste')}
      </label>
      <div className="flex gap-1.5">
        <input
          id={pasteId}
          type="text"
          dir="ltr"
          value={text}
          maxLength={2048}
          placeholder="30.0444, 31.2357"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              read();
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-9"
          loading={parse.isPending}
          disabled={text.trim() === ''}
          onClick={read}
        >
          {t('atm.map.unlocated.read')}
        </Button>
      </div>
      {feedback !== null && (
        <p role="status" className={cn('rounded-lg px-2.5 py-2 text-xs', TONE[feedback.tone])}>
          {t(feedback.key)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => actions.onPlace(point)}>
          {t('atm.map.unlocated.place')}
        </Button>
        {original !== null && (
          <a
            href={original}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-brand-600 underline-offset-2 hover:underline"
          >
            {t('atm.map.unlocated.openOriginal')}
          </a>
        )}
      </div>
    </div>
  );
};
