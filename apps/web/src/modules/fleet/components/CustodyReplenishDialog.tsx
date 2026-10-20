// «استعاضة العهدة» — the memos not replenished yet, picked with «علامة صح»: what they add up to
// comes back into the fund, and his «استعاضه عهدة» letter asks for it.
//
// Every memo is ticked when the dialog opens. «بيانات الخطاب»: the letter's date (today) and the
// period it covers — the whole months of the ticked memos (his «من 01/09 إلى 30/09») until a box
// is typed in. Under the list, the replenishment per kind in his letter's order (كاوتش · وقود ·
// صيانة · غسيل): a kind with no ticked memo is «—», with the receipts of that kind that are in no
// memo yet when there are any. Then the fund now, plus the total, is the fund after.
//
// Receipts in no memo cannot be replenished — each kind that has some says so in amber, with the
// way to make its memo. The eye opens a memo's own paper; while it is open, the dialog under it
// stays put (one Escape closes the paper, not both).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type FleetCustodyMemoRowDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EyeIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import {
  useCustodyFundSummary,
  useReplenishCandidates,
  useReplenishCustody,
} from '../api/fleet-queries';
import {
  byKindInLetterOrder,
  freshLetterHead,
  fundAfter,
  LETTER_KIND_ORDER,
  letterPeriod,
  periodInOrder,
  replenishBody,
  sumMoney,
  toggled,
  type LetterHead,
} from '../lib/custody-fund-forms';
import { useCustodyCount } from '../lib/custody-words';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { MONO, Stroke } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { CUSTODY_KIND } from './CustodyKinds';
import { CUSTODY_OPS } from './CustodyFundActions';
import { ACTION_GROUP, actionTone } from './row-actions-look';
import { useSeparator } from './custody-dashboard-parts';
import {
  CountChip,
  Dates,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  KindPill,
  LEFT_ROW,
  MEMO_ICON,
  MemoName,
  Money,
  PICKED_ROW,
  PrintButton,
  SectionHead,
  Tick,
} from './custody-memo-parts';
import {
  DialogButtons,
  FundResult,
  LetterFields,
  ListNote,
  useFigure,
  useFigureLine,
  useFundOperation,
} from './custody-fund-form-parts';
import { CustodyMemoPaperView } from './CustodyMemoPaperView';

const TILE =
  'flex flex-col rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80';
const TILE_NOTE = 'mt-0.5 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400';

export const CustodyReplenishDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const figure = useFigure();
  const figureLine = useFigureLine();
  const separator = useSeparator();
  const { count } = useCustodyCount();
  const fund = useCustodyFundSummary(open);
  const candidates = useReplenishCandidates(open);
  const replenish = useReplenishCustody();
  const [head, setHead] = useState<LetterHead>(() => freshLetterHead());
  // The memos taken OUT — every memo starts ticked, and one that arrives with a fresh read too.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  // The memo whose paper is open over the dialog.
  const [viewing, setViewing] = useState<string | null>(null);

  const memos: readonly FleetCustodyMemoRowDto[] = candidates.data?.memos ?? [];
  const picked = memos.filter((memo) => !unticked.has(memo.id));
  const total = sumMoney(picked.map((memo) => memo.total));
  const all = memos.length > 0 && picked.length === memos.length;
  const some = picked.length > 0 && !all;
  const before = fund.data?.fundTotal ?? candidates.data?.fundTotal ?? 0;
  const after = fundAfter(before, total);
  const period = letterPeriod(
    head,
    picked.flatMap((memo) => [memo.from, memo.to]),
  );
  const shares = byKindInLetterOrder(picked);
  // Receipts in no memo, per kind — in his letter's order, the kinds that have any.
  const outside = LETTER_KIND_ORDER.flatMap((kind) => {
    const line = candidates.data?.outside.find((entry) => entry.kind === kind);
    return line === undefined || line.count === 0 ? [] : [line];
  });

  const required = useRequiredFields(
    [
      { key: 'memos', label: t('fleet.custody.fundForm.required.memos'), ok: picked.length > 0 },
      // «إلى» before «من» is refused by the server naming no field: «إلى» says it here instead.
      {
        key: 'period',
        label: t('fleet.custody.fundForm.required.period'),
        ok: periodInOrder(period),
      },
    ],
    open,
  );
  const { run, busy } = useFundOperation({
    mutation: replenish,
    letter: 'replenish',
    done: t('fleet.custody.fundForm.replenish.done'),
    taken: t('fleet.custody.fundForm.replenish.taken'),
    onDone: onClose,
    onTaken: () => {
      void candidates.refetch();
      void fund.refetch();
    },
  });
  const send = (print: boolean): void =>
    run(replenishBody({ date: head.date, period, memoIds: picked.map((memo) => memo.id) }), print);

  const list = (): JSX.Element => {
    if (candidates.isLoading) {
      return (
        <ListNote>
          <Spinner className="mx-auto h-5 w-5" />
        </ListNote>
      );
    }
    if (candidates.isError) {
      return <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />;
    }
    if (memos.length === 0) {
      return <ListNote>{t('fleet.custody.fundForm.replenish.empty')}</ListNote>;
    }
    return (
      <div
        className={cn(
          FORM_TABLE_WRAP,
          required.isMissing('memos') &&
            'border-red-400 ring-2 ring-red-400/40 dark:border-red-500',
        )}
        {...(required.isMissing('memos') ? { 'data-field-missing': 'true' } : {})}
      >
        <table className={FORM_TABLE} data-memo-replenish-list="true">
          <thead className={FORM_THEAD}>
            <tr>
              <th className="w-12">
                <Tick
                  on={all}
                  partly={some}
                  label={
                    all
                      ? t('fleet.custody.fundForm.untickAll')
                      : t('fleet.custody.fundForm.tickAll')
                  }
                  onClick={() =>
                    setUnticked(all ? new Set(memos.map((memo) => memo.id)) : new Set())
                  }
                  data-memo-replenish-tick-all="true"
                />
              </th>
              <th>{t('fleet.custody.fundForm.replenish.memo')}</th>
              <th className="hidden sm:table-cell">{t('fleet.custody.fundForm.period')}</th>
              <th>{t('fleet.custody.fundForm.total')}</th>
              <th
                className="hidden w-14 sm:table-cell"
                aria-label={t('fleet.custody.papers.viewMemo')}
              />
            </tr>
          </thead>
          <tbody className={FORM_TBODY}>
            {memos.map((memo) => {
              const on = !unticked.has(memo.id);
              return (
                <tr
                  key={memo.id}
                  className={on ? PICKED_ROW : LEFT_ROW}
                  data-memo-replenish-row={memo.no}
                >
                  <td>
                    <Tick
                      on={on}
                      label={t('fleet.custody.fundForm.replenish.tickOne', { no: memo.no })}
                      onClick={() => setUnticked((held) => toggled(held, memo.id))}
                      data-memo-replenish-tick={String(memo.no)}
                    />
                  </td>
                  <td>
                    {/* Its name — what he typed, or «مذكرة كاوتش رقم 7» muted — over its kind
                        and running number. */}
                    <span className="mx-auto flex max-w-[15rem] flex-col items-center gap-1">
                      <span className="contents" data-memo-replenish-name={memo.no}>
                        <MemoName memo={memo} boxed />
                      </span>
                      <span className="flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        <KindPill kind={memo.kind} />
                        <span>
                          {t('fleet.custody.fundForm.no')} <span className={MONO}>{memo.no}</span>
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <Dates from={memo.from} to={memo.to} />
                  </td>
                  <td>
                    <span className="flex flex-col items-center gap-0.5">
                      <Money value={memo.total} unit="wide" />
                      <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {count('receipt', memo.receipts)}
                      </span>
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className={ACTION_GROUP}>
                      <button
                        type="button"
                        title={t('fleet.custody.papers.viewMemo')}
                        aria-label={t('fleet.custody.papers.viewMemo')}
                        className={actionTone('view')}
                        onClick={() => setViewing(memo.id)}
                        data-memo-replenish-view={memo.id}
                      >
                        <EyeIcon className="h-4 w-4" />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <DesignDialog
        open={open}
        // While a memo's paper is open over it, the dialog stays: its Escape is the paper's.
        onClose={viewing === null ? onClose : () => undefined}
        title={t('fleet.custody.actions.replenish')}
        subtitle={t('fleet.custody.fundForm.replenish.subtitle')}
        icon={CUSTODY_OPS.replenish.icon}
        width="3xl"
        panelProps={{ 'data-memo-replenish': 'true' }}
        footer={
          <DialogButtons
            save={
              <DesignSave
                label={t('fleet.custody.fundForm.replenish.save')}
                busy={busy}
                onClick={required.guard(() => send(false))}
                data-memo-replenish-save="true"
              />
            }
            print={
              <PrintButton
                label={t('fleet.custody.fundForm.savePrint')}
                busy={busy}
                onClick={required.guard(() => send(true))}
                data-memo-replenish-print="true"
              />
            }
            cancel={<DesignCancel onClick={onClose} />}
          />
        }
      >
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <DesignSection title={t('fleet.custody.fundForm.letter.section')} icon={PATH.calendar}>
          <LetterFields
            date={head.date}
            from={period.from}
            to={period.to}
            onChange={(patch) => setHead((held) => ({ ...held, ...patch }))}
            periodMissing={required.isMissing('period')}
          />
        </DesignSection>

        <section className="space-y-3">
          <SectionHead
            title={t('fleet.custody.fundForm.replenish.list')}
            icon={MEMO_ICON}
            end={
              candidates.data === undefined ? undefined : (
                <CountChip>{count('memo', memos.length)}</CountChip>
              )
            }
          />
          {list()}
        </section>

        <section className="space-y-3">
          <SectionHead title={t('fleet.custody.fundForm.replenish.byKind')} icon={PATH.box} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-memo-replenish-kinds="true">
            {shares.map((share) => {
              const none = share.nos.length === 0;
              const out = outside.find((line) => line.kind === share.kind);
              return (
                <div
                  key={share.kind}
                  data-memo-replenish-kind={share.kind}
                  className={cn(TILE, CUSTODY_KIND[share.kind].accent)}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-xs',
                      CUSTODY_KIND[share.kind].label,
                    )}
                  >
                    <Stroke d={[...CUSTODY_KIND[share.kind].icon]} className="h-3.5 w-3.5" />
                    {t(`fleet.custody.source.${share.kind}`)}
                  </span>
                  <span
                    dir="ltr"
                    className={cn(
                      MONO,
                      'mt-0.5 block text-start text-base font-bold',
                      none
                        ? 'text-slate-400 dark:text-slate-500'
                        : 'text-slate-900 dark:text-white',
                    )}
                  >
                    {none ? '—' : figure(share.total)}
                  </span>
                  <span className={TILE_NOTE} data-memo-replenish-kind-note={share.kind}>
                    {!none
                      ? t('fleet.custody.fundForm.replenish.nos', {
                          memos: count('memo', share.nos.length),
                          nos: share.nos.join(separator),
                        })
                      : out !== undefined
                        ? t('fleet.custody.fundForm.replenish.outsideMemos', {
                            receipts: count('receipt', out.count),
                            amount: figure(out.total),
                          })
                        : t('fleet.custody.fundForm.replenish.noMemos')}
                  </span>
                </div>
              );
            })}
            <div
              data-memo-replenish-kind="total"
              className="col-span-2 flex flex-col rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 sm:col-span-1 dark:border-emerald-500/30 dark:bg-emerald-500/10"
            >
              <span className="block text-xs font-bold text-emerald-800 dark:text-emerald-300">
                {t('fleet.custody.fundForm.total')}
              </span>
              <span
                dir="ltr"
                className={cn(
                  MONO,
                  'mt-0.5 block text-start text-base font-black text-emerald-800 dark:text-emerald-300',
                )}
              >
                {figure(total)}
              </span>
              <span className="mt-0.5 text-[11px] font-semibold leading-4 text-emerald-800/80 dark:text-emerald-300/80">
                {count('memo', picked.length)}
              </span>
            </div>
          </div>
        </section>

        <FundResult
          tone="sky"
          data-memo-replenish-result="true"
          line={figureLine('fleet.custody.fundForm.replenish.result', {
            amount: figure(total),
            after: figure(after),
          })}
          before={before}
          change={total}
          after={after}
          changeLabel={t('fleet.custody.fundForm.replenish.change')}
        />

        {outside.map((line) => (
          <p
            key={line.kind}
            data-memo-replenish-outside={line.kind}
            className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <Stroke d={[...PATH.warn]} className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {figureLine(
                'fleet.custody.fundForm.replenish.outsideWarn',
                { amount: figure(line.total) },
                { kind: t(`fleet.custody.source.${line.kind}`) },
              )}{' '}
              <Link
                to={`/fleet/custody/memos/new/${line.kind}`}
                data-memo-replenish-make={line.kind}
                className="font-bold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {t('fleet.custody.fundForm.replenish.makeMemo', {
                  kind: t(`fleet.custody.source.${line.kind}`),
                })}
              </Link>
            </span>
          </p>
        ))}
      </DesignDialog>
      {viewing !== null && (
        <CustodyMemoPaperView memoId={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
};
