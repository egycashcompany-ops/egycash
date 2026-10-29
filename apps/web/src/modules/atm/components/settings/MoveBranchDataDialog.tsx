// «نقل البيانات» — a linked source branch's ATM data re-filed under the branch it works as. The
// owner (2026-10-28): «أنا عايز كل ماكينه تظهر فى الفرع بتاعها طبقاً للفرع المتسجله فيه». A link
// answers October's people as Mohandessin from the moment it is saved, but it moves no row: what
// was filed under October before — the workbook rows of the code mapped to it, their machines,
// their mail — shows only under «كل الشركة» until it is moved.
//
// The dialog IS the confirmation: it opens on the server's PREVIEW (GET …/move) — the rows filed
// under the source per collection (the non-zero ones), what the move merges, what refuses it — and
// «نقل» stays held back while anything refuses it or nothing is left to move. The server checks the
// same again on the POST (409 `ATM_BRANCH_MOVE_BLOCKED`), and each step again as the run goes (409
// `ATM_BRANCH_MOVE_STOPPED`: stopped part-way, what moved stays moved), so a blocker that appeared
// since the preview is said here in the reader's words and the preview read again to show it.
//
// Only the SOURCE is named to the server; the pair is the stored link's (contracts
// atm-settings.ts), so the two names below are for the reader, never sent.
import {
  ATM_BRANCH_MOVE_COLLECTIONS,
  ATM_BRANCH_MOVE_MERGES,
  ATM_MAP_ZONES_PER_BRANCH_MAX,
  ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX,
  ErrorCodes,
  atmBranchMoveTotal,
  type AtmBankCode,
  type AtmBranchMoveBlockerDto,
  type AtmBranchMoveCollection,
  type AtmBranchMoveCountsDto,
  type AtmBranchMoveMerge,
  type AtmBranchMoveMergesDto,
  type AtmBranchMovePreviewDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { errorMessage } from '../../../../shared/lib/errors';
import { formatNumber } from '../../../../shared/lib/format';
import { useAtmBankLookup } from '../../api/atm-queries';
import { useAtmBranchMovePreview, useMoveAtmBranchData } from '../../api/settings-queries';
import { listSeparator } from '../../lib/register-import-view';
import { formatPaperDate } from '../../lib/settlement-dates';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The link being moved, as the card names it. */
export interface BranchMoveSubject {
  /** The stored link's source — the only id the move names. */
  sourceBranchId: string;
  /** The two branches' names as the card reads them (the server's ECMS names). */
  source: string;
  target: string;
}

/** Codes and banks a refusal lists before «و… أخرى» — the server's own message stops at ten too. */
const LISTED = 10;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The collections holding rows, in the contract's order — a zero says nothing to the reader. */
export const movedCollections = (counts: AtmBranchMoveCountsDto): AtmBranchMoveCollection[] =>
  ATM_BRANCH_MOVE_COLLECTIONS.filter((collection) => counts[collection] > 0);

/** The merges the move makes, in the contract's order — the non-zero ones. */
export const madeMerges = (merges: AtmBranchMoveMergesDto): AtmBranchMoveMerge[] =>
  ATM_BRANCH_MOVE_MERGES.filter((merge) => merges[merge] > 0);

/** What a run re-filed, collection by collection — the success toast's summary under its total. */
export const movedSummary = (moved: AtmBranchMoveCountsDto, t: Translate, locale: Locale): string =>
  movedCollections(moved)
    .map((collection) => {
      const label = t(`atm.settings.move.collection.${collection}`);
      return `${label}: ${formatNumber(moved[collection], locale)}`;
    })
    .join(listSeparator(locale));

/** «نقل» runs only on the server's go, with no refusal listed and something left to move. */
export const moveAllowed = (preview: AtmBranchMovePreviewDto): boolean =>
  preview.canMove && preview.blockers.length === 0 && preview.total > 0;

/**
 * One refusal in the reader's words, with what it names — banks by name, days as the papers print
 * them.
 */
export const blockerText = (
  blocker: AtmBranchMoveBlockerDto,
  names: { source: string; target: string },
  bankName: (code: AtmBankCode) => string,
  t: Translate,
  locale: Locale,
): string => {
  const n = (value: number): string => formatNumber(value, locale);
  const listed = (items: readonly string[]): string => {
    const shown = items.slice(0, LISTED).join(listSeparator(locale));
    return items.length <= LISTED
      ? shown
      : `${shown} ${t('atm.settings.move.more', { count: n(items.length - LISTED) })}`;
  };
  const day = (value: string): string => (DAY.test(value) ? formatPaperDate(value) : value);
  const key = `atm.settings.move.blocker.${blocker.kind}`;
  switch (blocker.kind) {
    case 'machineActiveInBoth':
    case 'machineTwinOpen':
      return t(key, { codes: listed(blocker.codes) });
    case 'planSerialCollision':
      return t(key, { banks: listed(blocker.bankCodes.map(bankName)) });
    case 'planSameDay':
      return t(key, {
        items: listed(
          blocker.items.map((item) => `${bankName(item.bankCode)} ${day(item.replenishDate)}`),
        ),
      });
    case 'zoneCaps':
      return t(key, {
        target: names.target,
        zones: n(blocker.zones),
        maxZones: n(ATM_MAP_ZONES_PER_BRANCH_MAX),
        points: n(blocker.points),
        maxPoints: n(ATM_MAP_ZONE_POINTS_PER_BRANCH_MAX),
      });
    case 'layoutImportRunning':
      return t(key, { source: names.source, banks: listed(blocker.bankCodes.map(bankName)) });
    case 'moveRunning':
      return t(key);
  }
};

/**
 * A 409: something refuses the move since the preview — nothing moved — or a step met it only
 * part-way through the run (`ATM_BRANCH_MOVE_STOPPED`), and what the earlier steps moved stays
 * moved: told as the refusal, the reader would think the move never ran while half the source's
 * data already sits under the target. Anything else, in the reader's words.
 */
export const moveErrorText = (
  error: unknown,
  names: { source: string },
  t: Translate,
  locale: Locale,
): string => {
  if (error instanceof ApiError && error.code === ErrorCodes.ATM_BRANCH_MOVE_BLOCKED) {
    return t('atm.settings.move.blocked');
  }
  if (error instanceof ApiError && error.code === ErrorCodes.ATM_BRANCH_MOVE_STOPPED) {
    return t('atm.settings.move.stopped', { source: names.source });
  }
  if (error instanceof ApiError && error.code === ErrorCodes.ATM_BRANCH_MOVE_TARGET_CHANGED) {
    return t('atm.settings.move.targetChanged');
  }
  return errorMessage(error, locale);
};

/**
 * What refuses the move, in red. A component of its own so that the bank catalog — three refusals
 * name banks — is asked only when there is a refusal to word.
 */
const Blockers = ({
  blockers,
  names,
}: {
  blockers: readonly AtmBranchMoveBlockerDto[];
  names: { source: string; target: string };
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const banks = useAtmBankLookup();
  return (
    <section
      role="alert"
      className="space-y-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200"
      data-branch-move-blockers="true"
    >
      <h4 className="font-semibold">{t('atm.settings.move.blockers')}</h4>
      <ul className="list-disc space-y-1 ps-5">
        {blockers.map((blocker, index) => (
          <li key={`${blocker.kind}-${String(index)}`} data-branch-move-blocker={blocker.kind}>
            {blockerText(blocker, names, (code) => banks.name(code, locale), t, locale)}
          </li>
        ))}
      </ul>
      <p className="text-xs">{t('atm.settings.move.blockersHint')}</p>
    </section>
  );
};

/** What the preview says: the rows, their total, the merges, and in red what refuses the move. */
const PreviewBody = ({
  preview,
  names,
}: {
  preview: AtmBranchMovePreviewDto;
  names: { source: string; target: string };
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const n = (value: number): string => formatNumber(value, locale);

  if (preview.total === 0) {
    return (
      <p
        className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        data-branch-move-nothing="true"
      >
        {t('atm.settings.move.nothing', { source: names.source })}
      </p>
    );
  }

  const { counts, merges } = preview;
  const made = madeMerges(merges);
  const cell = 'px-2.5 py-1.5';
  return (
    <>
      <section className="space-y-1.5">
        <h4 className="font-semibold text-slate-700 dark:text-slate-200">
          {t('atm.settings.move.counts', { source: names.source })}
        </h4>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {movedCollections(counts).map((collection) => (
              <tr
                key={collection}
                className="border-t border-slate-100 first:border-t-0 dark:border-slate-800"
                data-branch-move-count={collection}
              >
                <td className={`${cell} text-start`}>
                  {t(`atm.settings.move.collection.${collection}`)}
                </td>
                <td className={`${cell} text-end font-semibold`}>{n(counts[collection])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-semibold" data-branch-move-total="true">
          {t('atm.settings.move.total', { count: n(preview.total) })}
        </p>
      </section>

      {made.length > 0 && (
        <section className="space-y-1" data-branch-move-merges="true">
          <h4 className="font-semibold text-slate-700 dark:text-slate-200">
            {t('atm.settings.move.merges')}
          </h4>
          <ul className="list-disc space-y-0.5 ps-5 text-[13px]">
            {made.map((merge) => (
              <li key={merge} data-branch-move-merge={merge}>
                {t(`atm.settings.move.merge.${merge}`, { count: n(merges[merge]), ...names })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.blockers.length > 0 && <Blockers blockers={preview.blockers} names={names} />}
    </>
  );
};

/** Open while `subject` names a link; closed (and asking nothing) while it is null. */
export const MoveBranchDataDialog = ({
  subject,
  onClose,
}: {
  subject: BranchMoveSubject | null;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const preview = useAtmBranchMovePreview(subject?.sourceBranchId ?? null, subject !== null);
  const move = useMoveAtmBranchData();
  // The server's own names once its preview answers (review finding): the card's link list may
  // be stale — another administrator re-pointed the link — and the reader confirms what the
  // server will do, not what the card last read. The card's names only until then.
  const names = {
    source: preview.data?.sourceBranchName?.[locale] ?? subject?.source ?? '',
    target: preview.data?.targetBranchName?.[locale] ?? subject?.target ?? '',
  };
  // Judged on a preview the server has just given: while one is re-read (after a 409, after a run
  // that left rows behind), or could not be read again, «نقل» waits rather than act on the old one.
  const allowed =
    preview.data !== undefined &&
    !preview.isFetching &&
    !preview.isError &&
    moveAllowed(preview.data);

  const confirm = async (): Promise<void> => {
    if (subject === null || !allowed) return;
    try {
      // The target the reader read in the preview: refused 409 if the link moved since.
      const result = await move.mutateAsync({
        sourceBranchId: subject.sourceBranchId,
        expectedTargetBranchId: preview.data?.targetBranchId,
      });
      const done = t('atm.settings.move.done', {
        count: formatNumber(result.total, locale),
        target: result.targetBranchName?.[locale] ?? names.target,
      });
      const left = atmBranchMoveTotal(result.remaining);
      if (left === 0) {
        const summary = movedSummary(result.moved, t, locale);
        toast.success(done, summary === '' ? undefined : summary);
        onClose();
        return;
      }
      // Rows filed under the source while the run went stay for the next run: the dialog stays
      // open on the re-read preview, so «نقل» is one click away.
      toast.warning(
        done,
        t('atm.settings.move.remaining', {
          count: formatNumber(left, locale),
          source: names.source,
        }),
      );
    } catch (error) {
      // The hook declares `onError` (it re-reads the preview with the rest of the ATM tree), so
      // the global toast stays out and this is the one message.
      toast.error(moveErrorText(error, names, t, locale));
    }
  };

  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      size="lg"
      title={t('atm.settings.move.title', names)}
      // A run can take minutes; a stray click must not hide it. The × and Escape still close.
      dismissOnOutsideClick={false}
      footer={
        <>
          <Button variant="secondary" disabled={move.isPending} onClick={onClose}>
            {t('atm.common.cancel')}
          </Button>
          <Button
            loading={move.isPending}
            disabled={!allowed}
            data-branch-move-action="confirm"
            onClick={() => void confirm()}
          >
            {t('atm.settings.move.confirm')}
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-3.5 text-sm text-slate-700 dark:text-slate-200"
        data-branch-move-dialog={subject?.sourceBranchId}
      >
        <p>{t('atm.settings.move.intro', names)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('atm.settings.move.pausesWrites')}
        </p>
        {preview.isLoading ? (
          <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : preview.isError ? (
          <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
        ) : preview.data !== undefined ? (
          <PreviewBody preview={preview.data} names={names} />
        ) : null}
      </div>
    </Dialog>
  );
};
