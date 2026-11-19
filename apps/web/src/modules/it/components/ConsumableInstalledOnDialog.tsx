// «تعديل الجهاز» — «وضيف إمكانية تعديل الجهاز اللى عليه المستهلك بعد التسليم» (owner, 2026-11-17): the
// device an issued unit sits in, corrected from the ledger after the issue. Opened from an issued
// row wherever the ledger is read (`ConsumableMovements.tsx`): the movements screen, one item's
// movements, a person's card and an asset's card.
//
// What was issued is shown above and stays as it is — the item, how many, to whom, and the device
// the row names now. Below it, the box the issue's «مركّب على» uses (`AssetPicker`): the RECIPIENT's
// devices at once, «جهاز آخر» under them for any other device of the register (a shared printer, a
// device in stock), and «بدون جهاز» to say it went into none. Nothing is chosen for the user.
//
// The owner's answer for the paper, «تتحدّث بالجهاز الجديد», is said before the save: a reprint of
// the memo prints the new device, the signed copy already filed stays as it is, and the change is
// recorded — who, when, from which device to which. The save sends the row's `version`: a change
// somebody made first is refused (409), said in the dialog's own words, and the ledger is read again
// under it (`useSetItConsumableInstalledOn`), so the device shown above is the one that now stands.
// The dialog is the ledger's, not a row's (`useConsumableMovementLedger`): when that re-read takes
// the row off the list it was opened from — on an asset's card, a 409 means the unit now sits in
// another device — the dialog stays, says the row has left the list (`left`), and points to the
// movements screen instead of at a device it can no longer show.
//
// Every decision is `lib/consumable-installed-on.ts`; this file wires it.
//
// A toner issued with the printer's counter (2026-11-19) shows its reading above, and asks for one
// below: required when another device is picked (it moves with the reading taken there), optional
// with none picked (typed, it corrects the reading on the current printer), and gone with «بدون
// جهاز», which takes it off the printer's record. The target printer's last reading is shown under
// the box, as «صرف» shows it; the server judges the reading against the printer's timeline.
import { useEffect, useReducer, useRef } from 'react';
import {
  formatConsumableMemoNumber,
  type ItConsumableMovementDto,
  type Locale,
} from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Checkbox, Field, Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatNumber } from '../../../shared/lib/format';
import { useItPrinterCounter, useSetItConsumableInstalledOn } from '../api/it-queries';
import {
  backdatedAgainst,
  counterProblemWords,
  type LatestReading,
} from '../lib/consumable-counter';
import {
  installedOnCounted,
  installedOnFailure,
  installedOnReadingProblem,
  installedOnReducer,
  installedOnRequest,
  installedOnStale,
  installedOnStart,
  installedOnTarget,
  installedOnUnchanged,
  pickedHeldByOther,
} from '../lib/consumable-installed-on';
import { holderName } from '../lib/consumable-issue-holder';
import { movementAsset, movementEmployee } from '../lib/consumable-movement-register-export';
import { AssetPicker } from './AssetPicker';
import { CounterReadingCell } from './ConsumableMovements';
import { LastReadingNote } from './PrinterCounterCard';

/** One fact of what was issued, read-only above the choice. */
const Fact = ({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
}): JSX.Element => (
  <div className="min-w-0" data-installed-on-fact={name}>
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="text-sm text-slate-800 dark:text-slate-100">{children}</dd>
  </div>
);

export const ConsumableInstalledOnDialog = ({
  open,
  onClose,
  movement,
  left = false,
}: {
  open: boolean;
  onClose: () => void;
  /** The issued row, as the ledger shows it — read again after a refusal, so always the latest. */
  movement: ItConsumableMovementDto;
  /** The list it was opened from no longer has the row: `movement` is the last copy it showed. */
  left?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const save = useSetItConsumableInstalledOn();
  const [state, dispatch] = useReducer(installedOnReducer, undefined, installedOnStart);

  useEffect(() => {
    if (open) dispatch({ type: 'reset' });
  }, [open]);
  // A save still on its way when the dialog was closed: its refusal has no dialog left to be said
  // in, and the hook keeps the global toast quiet — so it is said as a toast here instead.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const recipient = movementEmployee(movement);
  const current = movement.assetId === null ? null : (movementAsset(movement) ?? '—');
  const body = installedOnRequest(movement, state);
  const target = installedOnTarget(state, movement);
  const unchanged = target !== undefined && installedOnUnchanged(movement, state);
  const otherHolder = pickedHeldByOther(movement, state);
  // «عداد الطابعة» — a toner issued with the printer's counter moves with a reading.
  const counted = installedOnCounted(movement);
  const printer = counted && typeof target === 'string' ? target : '';
  const printerCounter = useItPrinterCounter(printer, printer !== '');
  // The printer's newest reading other than this row's own — what a correction or a move is
  // typed against.
  const others = printerCounter.data?.readings.filter((r) => r.movementId !== movement.id);
  const latest: LatestReading | undefined =
    others === undefined
      ? undefined
      : others[0] === undefined
        ? null
        : (({ replaced: _replaced, ...reading }) => reading)(others[0]);
  const readingProblem =
    installedOnReadingProblem(movement, state) ??
    (state.failure?.kind === 'counter' ? state.failure.problem : null);
  // The row as shown is at a version a 409 already refused (the re-read could not show it: it left
  // the list) — whatever is chosen now, another save is certain to be refused, so none is offered,
  // and the refusal stays said.
  const stale = installedOnStale(movement, state);
  const conflict = stale || state.failure?.kind === 'conflict';

  const submit = async (): Promise<void> => {
    if (body === null) return;
    try {
      await save.mutateAsync({ id: movement.id, body });
      toast.success(t('it.consumables.installedOn.saved'));
      onClose();
    } catch (err) {
      const failure = installedOnFailure(err, locale);
      if (mounted.current) {
        dispatch({ type: 'failed', failure, version: body.version });
      } else {
        toast.error(
          failure.kind === 'conflict'
            ? t('it.consumables.installedOn.conflictLeft')
            : failure.kind === 'counter'
              ? counterProblemWords(t, failure.problem, locale)
              : failure.message,
        );
      }
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      // A choice being made: only the × and Escape close it.
      dismissOnOutsideClick={false}
      title={t('it.consumables.installedOn.title')}
      description={[movement.consumableName, movement.consumableCode]
        .filter((part): part is string => part !== null && part !== '')
        .join(' — ')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-installed-on-save=""
            loading={save.isPending}
            disabled={body === null || stale}
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* A counter refusal is said on the reading's box instead. */}
        {(conflict || state.failure?.kind === 'refused') && (
          <p
            role="alert"
            data-installed-on-failure={conflict ? 'conflict' : state.failure?.kind}
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {conflict
              ? t(
                  left
                    ? 'it.consumables.installedOn.conflictLeft'
                    : 'it.consumables.installedOn.conflict',
                )
              : state.failure?.kind === 'refused'
                ? state.failure.message
                : null}
          </p>
        )}
        {left && !conflict && (
          <p
            role="note"
            data-installed-on-left=""
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {t('it.consumables.installedOn.left')}
          </p>
        )}

        {/* What was issued — as the row says it, and not changed here. */}
        <dl className="grid gap-3 rounded-lg bg-slate-50 px-3 py-2 sm:grid-cols-2 dark:bg-slate-900">
          <Fact label={t('it.consumables.movements.columns.item')} name="item">
            {movement.consumableName ?? t('it.custody.assetUnknown')}
            {movement.consumableCode === null ? null : (
              <>
                {' '}
                <bdi dir="ltr" className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {movement.consumableCode}
                </bdi>
              </>
            )}
          </Fact>
          <Fact label={t('it.consumables.movements.columns.qty')} name="qty">
            <span className="tabular-nums">{formatNumber(movement.qty, locale)}</span>
          </Fact>
          <Fact label={t('it.consumables.issue.employee')} name="recipient">
            {recipient ?? '—'}
          </Fact>
          <Fact label={t('it.consumables.installedOn.current')} name="current">
            <span data-installed-on-current={movement.assetId ?? ''}>
              {current ?? t('it.consumables.installedOn.none')}
            </span>
          </Fact>
          {counted && (
            <Fact label={t('it.consumables.movements.columns.counter')} name="counter">
              <CounterReadingCell reading={movement.counterReading} reset={movement.counterReset} />
            </Fact>
          )}
          {movement.memoNumber !== null && (
            <Fact label={t('it.consumables.movements.columns.memo')} name="memo">
              <span dir="ltr" className="font-mono text-xs">
                {formatConsumableMemoNumber(movement.memoNumber)}
              </span>
            </Fact>
          )}
        </dl>

        <Field label={t('it.consumables.installedOn.next')}>
          {/* The recipient's devices at once, «جهاز آخر» under them — the issue's own box. */}
          {!state.none && (
            <AssetPicker
              value={state.assetId}
              withoutStatus="disposed"
              holderEmployeeId={movement.employeeId ?? ''}
              holderLabel={recipient ?? ''}
              showHolder
              allowOther
              onChange={(assetId, asset) =>
                dispatch({ type: 'device', assetId, asset: asset ?? null })
              }
              ariaLabel={t('it.consumables.installedOn.next')}
            />
          )}
          <div aria-live="polite">
            {otherHolder !== null && (
              <p
                role="note"
                data-installed-on-holder={otherHolder.employeeId}
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                {t('it.consumables.issue.deviceHeldByOther', { name: holderName(otherHolder) })}
              </p>
            )}
            {unchanged && (
              <p
                role="note"
                data-installed-on-unchanged=""
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                {t('it.consumables.installedOn.unchanged')}
              </p>
            )}
          </div>
          {/* «بدون جهاز» — offered while the row names a device to take off, and kept while it is
              ticked: a re-read that finds the device already taken off must not hide both the
              box and the tick, leaving nothing to choose with. */}
          {(movement.assetId !== null || state.none) && (
            <Checkbox
              data-installed-on-none=""
              label={t('it.consumables.installedOn.none')}
              checked={state.none}
              onChange={(e) => dispatch({ type: 'none', none: e.target.checked })}
            />
          )}
        </Field>

        {/* «عداد الطابعة» — the reading on the device named, on a toner issued with one. */}
        {counted && state.none && (
          <p
            role="note"
            data-installed-on-counter-dropped=""
            className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {t('it.consumables.installedOn.counterDropped')}
          </p>
        )}
        {counted && !state.none && (
          <div data-installed-on-counter="" className="space-y-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('it.consumables.counter.reading')}
                required={state.assetId !== '' && state.assetId !== movement.assetId}
                hint={t('it.consumables.installedOn.counterHint')}
                {...(readingProblem === null
                  ? {}
                  : { error: counterProblemWords(t, readingProblem, locale) })}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  dir="ltr"
                  inputMode="numeric"
                  data-installed-on-reading=""
                  value={state.counterReading}
                  onChange={(e) =>
                    dispatch({
                      type: 'counter',
                      counterReading: e.target.value,
                      counterReset: state.counterReset,
                    })
                  }
                  error={readingProblem !== null}
                />
              </Field>
              <div className="sm:pt-7">
                <Checkbox
                  data-installed-on-reset=""
                  label={t('it.consumables.counter.reset')}
                  checked={state.counterReset}
                  onChange={(e) =>
                    dispatch({
                      type: 'counter',
                      counterReading: state.counterReading,
                      counterReset: e.target.checked,
                    })
                  }
                />
              </div>
            </div>
            {printer !== '' && (
              <LastReadingNote
                latest={latest}
                unavailable={printerCounter.isError}
                backdated={backdatedAgainst(latest, new Date(movement.at))}
              />
            )}
          </div>
        )}

        {/* «تتحدّث بالجهاز الجديد» — what the paper does, said before the save. */}
        <p
          role="note"
          data-installed-on-paper={
            movement.memoId === null ? 'none' : movement.memoSigned === true ? 'signed' : 'unsigned'
          }
          className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          {movement.memoId !== null && (
            <>
              {movement.memoNumber === null
                ? t('it.consumables.installedOn.reprintAnon')
                : t('it.consumables.installedOn.reprint', {
                    memo: formatConsumableMemoNumber(movement.memoNumber),
                  })}{' '}
              {movement.memoSigned === true
                ? t('it.consumables.installedOn.signedStays')
                : t('it.consumables.installedOn.unsigned')}{' '}
            </>
          )}
          {t('it.consumables.installedOn.recorded')}
        </p>
      </div>
    </Dialog>
  );
};
