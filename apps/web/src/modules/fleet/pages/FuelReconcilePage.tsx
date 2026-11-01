// «مطابقة أرصدة الكروت» (/fleet/fuel-cards/reconcile, on the Fleet rail right after «شحن الكروت»):
// the company's balance sheet against the system's cards.
//
//   1. «اختر الشركة» and «ارفع شيت الأرصدة» (.xlsx) → «مقارنة بالأرصدة» posts the file. The server
//      reads it, stores the session and answers the comparison. NOTHING is written yet.
//   2. The answer: four counts, then the cards whose balance DIFFERS, the largest difference first,
//      each with a ✓ (the card takes the sheet's balance — an adjustment in its log) and a ✗ (it
//      stays as it is — the refusal is logged too). Ticks with «تحديد الكل»; the bulk buttons ask
//      first («تأكيد»), a single row stays one click. Under the table, folded: rows that never match,
//      in the sheet only, in the system only, last four digits that differ, repeated rows, equal.
//
// The owner's safety rule: a ✓ is all or nothing, and it is refused (409, nothing written) when a
// chosen card's balance or log moved after the sheet was read. The refused cards are named in a
// red banner, tagged «تغيّر بعد القراءة», and lose their ✓; the sheet must be read again.
//
// State and layout only: the figures and the selection are pure (`lib/fuel-reconcile.ts`), the
// words are i18n keys (`lib/fuel-reconcile-words.ts`), and the pieces are in
// `components/fuel-reconcile/`.
import { useReducer, useState } from 'react';
import {
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useAllFuelCards } from '../api/fleet-queries';
import { useDecideFuelReconcile, useUploadFuelSheet } from '../api/fuel-reconcile-queries';
import { BOARD_FONT } from '../components/FuelCardBoard';
import { FuelCardHistoryDialog } from '../components/FuelCardHistoryDialog';
import { ReconcileConfirmDialog } from '../components/fuel-reconcile/ReconcileConfirmDialog';
import { ReconcileFolds } from '../components/fuel-reconcile/ReconcileFolds';
import { ReconcileHeader } from '../components/fuel-reconcile/ReconcileHeader';
import { ReconcileTable } from '../components/fuel-reconcile/ReconcileTable';
import { ReconcileUploadCard } from '../components/fuel-reconcile/ReconcileUploadCard';
import {
  NO_SELECTION,
  balanceNow,
  isOpen,
  reconcileSelection,
  tickedLines,
  type ReconcileSelection,
  type ReconcileSelectionAction,
} from '../lib/fuel-reconcile';
import { decideRefusalOf, sheetRefusalOf, useReconcileCount } from '../lib/fuel-reconcile-words';

const PAGE = cn(BOARD_FONT, 'space-y-5 text-slate-900 antialiased dark:text-slate-100');

/**
 * The answer, drawn: the sheet strip and its alerts, the counts, the table, the folds, and the
 * bulk confirmation. Every change goes back to the page through `dispatch` and the callbacks.
 */
export const ReconcileResult = ({
  result,
  selection,
  dispatch,
  mayDecide,
  deciding,
  confirming,
  onConfirming,
  onDecide,
  onAnother,
  onHistory,
}: {
  result: FleetFuelReconcileDto;
  selection: ReconcileSelection;
  dispatch: (action: ReconcileSelectionAction) => void;
  mayDecide: boolean;
  deciding: boolean;
  /** The bulk decision being asked about; `null` = the dialog is closed. */
  confirming: FleetFuelReconcileDecision | null;
  onConfirming: (decision: FleetFuelReconcileDecision | null) => void;
  onDecide: (ids: readonly string[], decision: FleetFuelReconcileDecision) => void;
  onAnother: () => void;
  onHistory: (card: FleetFuelCardDto) => void;
}): JSX.Element => {
  const lines = result.differs;
  const ticked = tickedLines(lines, selection);
  const movedLines = lines.filter(
    (line) =>
      selection.moved.has(line.card.id.toLowerCase()) &&
      selection.decided[line.card.id.toLowerCase()] === undefined,
  );
  const cardNow = (card: FleetFuelCardDto): FleetFuelCardDto => ({
    ...card,
    balance: balanceNow(selection, card),
  });
  return (
    <div className={PAGE} data-recon-page="result">
      <ReconcileHeader
        result={result}
        decided={selection.decided}
        movedLines={movedLines}
        onAnother={onAnother}
      />
      <ReconcileTable
        lines={lines}
        selection={selection}
        mayDecide={mayDecide}
        deciding={deciding}
        onToggle={(id, on) => dispatch({ type: 'toggle', id, on })}
        onTickAll={(on) => dispatch({ type: 'tickAll', lines, on })}
        onClear={() => dispatch({ type: 'clear' })}
        onDecide={(id, decision) => {
          // A moved card's ✓ is off: the sheet must be read again. Its ✗ stays (nothing moves).
          if (decision === 'apply' && !isOpen(selection, id)) return;
          onDecide([id], decision);
        }}
        onBulk={onConfirming}
        onHistory={(card) => onHistory(cardNow(card))}
      />
      <ReconcileFolds result={result} cardNow={cardNow} onHistory={onHistory} />
      <ReconcileConfirmDialog
        decision={confirming}
        lines={ticked}
        company={result.company}
        fileName={result.fileName}
        busy={deciding}
        onClose={() => onConfirming(null)}
        onConfirm={() => {
          if (confirming !== null && ticked.length > 0) {
            onDecide(
              ticked.map((line) => line.card.id.toLowerCase()),
              confirming,
            );
          }
        }}
      />
    </div>
  );
};

export const FuelReconcilePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const count = useReconcileCount();
  const mayDecide = can('fleetFuelCharge.approve');
  const [company, setCompany] = useState<FleetFuelCardCompany | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<FleetFuelReconcileDto | null>(null);
  const [selection, dispatch] = useReducer(reconcileSelection, NO_SELECTION);
  const [confirming, setConfirming] = useState<FleetFuelReconcileDecision | null>(null);
  const [historyOf, setHistoryOf] = useState<FleetFuelCardDto | null>(null);
  const upload = useUploadFuelSheet();
  const decision = useDecideFuelReconcile();
  // Every card — «سجل الكارت» names a transfer's other card by its car, as on «شحن الكروت».
  const allCards = useAllFuelCards({}, result !== null);

  const compare = (): void => {
    if (company === null || file === null) return;
    upload.mutate(
      { company, file },
      {
        onSuccess: (answer) => {
          setResult(answer);
          setConfirming(null);
          dispatch({ type: 'reset' });
        },
        // The refusals the screen words itself; the hook raises the global toast for the rest.
        onError: (failure) => {
          const said = sheetRefusalOf(failure);
          if (said !== null) toast.error(t(said.key, said.values));
        },
      },
    );
  };

  const decide = (ids: readonly string[], chosen: FleetFuelReconcileDecision): void => {
    if (result === null || ids.length === 0) return;
    decision.mutate(
      { id: result.id, body: { decision: chosen, cardIds: [...ids] } },
      {
        onSuccess: (answer) => {
          dispatch({ type: 'decided', results: answer });
          setConfirming(null);
          toast.success(
            t(
              chosen === 'apply'
                ? 'fleet.fuelCards.reconcile.toastApplied'
                : 'fleet.fuelCards.reconcile.toastRejected',
              { count: count.cardsOf(answer.length) },
            ),
            t(
              chosen === 'apply'
                ? 'fleet.fuelCards.reconcile.toastAppliedNote'
                : 'fleet.fuelCards.reconcile.toastRejectedNote',
            ),
          );
        },
        // All or nothing: a card that moved after the read refuses the whole ✓. Nothing was
        // written; the moved cards are named, lose their tick, and the banner asks for a re-read.
        onError: (failure) => {
          const refusal = decideRefusalOf(failure);
          if (refusal === null) return;
          setConfirming(null);
          if (refusal.kind === 'moved') dispatch({ type: 'refused', error: failure });
          else {
            toast.error(
              t('fleet.fuelCards.reconcile.decidedBefore', {
                cards: count.cardsOf(refusal.cardIds.length),
              }),
            );
          }
        },
      },
    );
  };

  const another = (): void => {
    setResult(null);
    setFile(null);
    setConfirming(null);
    dispatch({ type: 'reset' });
  };

  if (result === null) {
    return (
      <PageContainer>
        <div className={PAGE} data-recon-page="upload">
          <ReconcileUploadCard
            company={company}
            file={file}
            reading={upload.isPending}
            onCompany={setCompany}
            onFile={setFile}
            onCompare={compare}
          />
        </div>
      </PageContainer>
    );
  }

  const withNow = (card: FleetFuelCardDto): FleetFuelCardDto => ({
    ...card,
    balance: balanceNow(selection, card),
  });
  return (
    <PageContainer>
      <ReconcileResult
        result={result}
        selection={selection}
        dispatch={dispatch}
        mayDecide={mayDecide}
        deciding={decision.isPending}
        confirming={confirming}
        onConfirming={setConfirming}
        onDecide={decide}
        onAnother={another}
        onHistory={setHistoryOf}
      />
      <FuelCardHistoryDialog
        card={historyOf}
        cards={(
          allCards.data?.items ?? [...result.differs.map((line) => line.card), ...result.systemOnly]
        ).map(withNow)}
        onClose={() => setHistoryOf(null)}
      />
    </PageContainer>
  );
};
