// The done pages' from/to day filter — legacy mohDate00/mohDate1000 (contad_app.js:936), default
// today. URL-synced so a shared link shows the same day. Whatever the page puts in `trailing` — its
// Excel and PDF — sits at the far end of the same row. No margin of its own: each page using it
// stands it in the board frame (`shared/ui/board-scroll.ts`), whose gap spaces it.
import { type ReactNode } from 'react';
import { MAX_PAGE_SIZE, type PageMeta } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatNumber } from '../../../shared/lib/format';
import { Field, Input } from '../../../shared/ui/form';
import { MAX_BOARD_PAGES, isBoardCutShort } from '../lib/whole-board';

export const DoneRangeBar = ({
  from,
  to,
  onChange,
  trailing,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
  trailing?: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('atm.done.from')}>
        <Input type="date" value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
      </Field>
      <Field label={t('atm.done.to')}>
        <Input type="date" value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
      </Field>
      {trailing !== undefined && (
        <div className="ms-auto flex flex-wrap items-center gap-2">{trailing}</div>
      )}
    </div>
  );
};

/** Is this range read whole — what the table, its sort and its statement need? */
export const doneRangeWhole = (meta: PageMeta | undefined): boolean =>
  meta === undefined || !isBoardCutShort(meta);

/**
 * A range too long to read whole: the table holds its first rows only, so the page says so — and
 * offers no Excel or PDF, which would title a part «عن الفترة من … إلى …».
 */
export const DoneRangeCutShort = ({ meta }: { meta: PageMeta | undefined }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  if (meta === undefined || doneRangeWhole(meta)) return null;
  return (
    <p
      role="status"
      data-done-cut-short="true"
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {t('atm.done.rangeTooLarge', {
        total: formatNumber(meta.totalItems, locale),
        shown: formatNumber(MAX_BOARD_PAGES * MAX_PAGE_SIZE, locale),
      })}
    </p>
  );
};
