// The done pages' from/to day filter — legacy mohDate00/mohDate1000 (contad_app.js:936), default
// today. URL-synced so a shared link shows the same day. Whatever the page puts in `trailing` — its
// Excel and PDF — sits at the far end of the same row. No margin of its own: each page using it
// stands it in the board frame (`shared/ui/board-scroll.ts`), whose gap spaces it.
//
// The boxes hold a DRAFT: what is typed reaches `onChange` (the URL, and so the read) only as a
// complete day from the year 2000, once the box has held still for half a second or is left
// (`lib/done-range-commit.ts`) — typing a year no longer starts a read for each of its digits.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAX_PAGE_SIZE, type PageMeta } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { formatNumber } from '../../../shared/lib/format';
import { Field, Input } from '../../../shared/ui/form';
import { MAX_BOARD_PAGES, isBoardCutShort } from '../lib/whole-board';
import {
  committableRange,
  createRangeCommitter,
  type DayRange,
  type RangeCommitter,
} from '../lib/done-range-commit';

/**
 * The boxes' draft over the page's range. The page's `from`/`to` (its URL) stay the truth: when
 * they change — a commit landing, the back button, a link — the boxes show them again. Only
 * effects and handlers touch the timer, so the bar renders on the server as before.
 */
const useRangeDraft = (
  from: string,
  to: string,
  onChange: (next: DayRange) => void,
): {
  draft: DayRange;
  edit: (next: DayRange) => void;
  leave: () => void;
} => {
  const [draft, setDraft] = useState<DayRange>({ from, to });
  // The page's newest `onChange`: a commit lands up to half a second after the keystroke, and must
  // write the URL as it is THEN — not as it was when the timer started.
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);
  const committer = useRef<RangeCommitter | null>(null);
  committer.current ??= createRangeCommitter((range) => latest.current(range), { from, to });

  useEffect(() => {
    committer.current?.sync({ from, to });
    setDraft((current) => (current.from === from && current.to === to ? current : { from, to }));
  }, [from, to]);
  useEffect(() => () => committer.current?.cancel(), []);

  return {
    draft,
    edit: (next) => {
      setDraft(next);
      committer.current?.edit(next);
    },
    leave: () => {
      committer.current?.flush();
      // A box left holding no day to commit goes back to the day the page reads.
      setDraft((current) => committableRange(current, { from, to }));
    },
  };
};

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
  const { draft, edit, leave } = useRangeDraft(from, to, onChange);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t('atm.done.from')}>
        <Input
          type="date"
          value={draft.from}
          onChange={(e) => edit({ from: e.target.value, to: draft.to })}
          onBlur={leave}
        />
      </Field>
      <Field label={t('atm.done.to')}>
        <Input
          type="date"
          value={draft.to}
          onChange={(e) => edit({ from: draft.from, to: e.target.value })}
          onBlur={leave}
        />
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
