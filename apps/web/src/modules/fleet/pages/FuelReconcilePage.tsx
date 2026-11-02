// «مطابقة أرصدة الكروت» (/fleet/fuel-cards/reconcile, on the Fleet rail right after «شحن الكروت»):
// the company's balance sheet against the system's cards.
//
//   1. «اختر الشركة» and «ارفع شيت الأرصدة» (.xlsx) → «مقارنة بالأرصدة» posts the file, with the
//      optional «تاريخ الشيت» (filled from the file's name when it holds a date). The server reads
//      it, stores the session and answers the comparison. NOTHING is written yet.
//   2. The answer: how the sheet was read, four counts, then the cards whose balance DIFFERS, the
//      largest difference first, each with a ✓ (the card takes the sheet's balance — an adjustment
//      in its log) and a ✗ (it stays as it is — the refusal is logged too). Ticks with «تحديد الكل»;
//      the bulk buttons ask first («تأكيد»), a single row stays one click — unless its ✓ asks about
//      a top-up the sheet does not show or a pending request the difference equals (6a). Then «ربط
//      الكروت بالسيارات» (6b, each change approved row by row), «كروت في الشيت وليست في النظام»
//      («إضافة»), and the folds: rows that never match, that need a choice, that are not cards, in
//      the sheet only, in the system only, last four digits that differ, repeated rows, equal.
//   A sheet whose names are the OTHER company's stops at the header, with one click to read it as
//   that company.
//
// The owner's safety rule: a ✓ is all or nothing, and it is refused (409, nothing written) when a
// chosen card's balance or log moved after the sheet was read. The refused cards are named in a
// red banner, tagged «تغيّر بعد القراءة», and lose their ✓; the sheet must be read again.
//
// State and layout only: the figures and the selection are pure (`lib/fuel-reconcile.ts`,
// `lib/fuel-reconcile-links.ts`), the words are i18n keys (`lib/fuel-reconcile-words.ts`), and the
// pieces are in `components/fuel-reconcile/`.
import { useReducer, useState } from 'react';
import {
  type DecideFleetFuelLinks,
  type DecideFleetFuelReconcile,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLineDto,
  type FleetFuelReconcileNewCardDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useAllFuelCards } from '../api/fleet-queries';
import {
  useDecideFuelLinks,
  useDecideFuelReconcile,
  useUploadFuelSheet,
} from '../api/fuel-reconcile-queries';
import { BOARD_FONT } from '../components/FuelCardBoard';
import { FuelCardDialog } from '../components/FuelCardDialog';
import { FuelCardHistoryDialog } from '../components/FuelCardHistoryDialog';
import { ReconcileConfirmDialog } from '../components/fuel-reconcile/ReconcileConfirmDialog';
import { ReconcileFolds } from '../components/fuel-reconcile/ReconcileFolds';
import { ReconcileHeader } from '../components/fuel-reconcile/ReconcileHeader';
import { ReconcileLinks } from '../components/fuel-reconcile/ReconcileLinks';
import { ReconcileNewCards } from '../components/fuel-reconcile/ReconcileNewCards';
import { ReconcileTable } from '../components/fuel-reconcile/ReconcileTable';
import { ReconcileUploadCard } from '../components/fuel-reconcile/ReconcileUploadCard';
import {
  NO_SELECTION,
  asksFirst,
  balanceNow,
  decideExtrasOf,
  defaultChoices,
  isOpen,
  reconcileSelection,
  sheetDateOfName,
  tickedLines,
  wrongCompanyOf,
  type LineChoices,
  type ReconcileSelection,
  type ReconcileSelectionAction,
  type RequestChoice,
} from '../lib/fuel-reconcile';
import { fromSheetOf, linkRefusalOf, type FromSheet } from '../lib/fuel-reconcile-links';
import {
  cancelRefusalKey,
  decideRefusalOf,
  linkRefusalWords,
  sheetRefusalOf,
  useReconcileCount,
} from '../lib/fuel-reconcile-words';

const PAGE = cn(BOARD_FONT, 'space-y-5 text-slate-900 antialiased dark:text-slate-100');

/** 6a's body additions — `cancelCharges` / `approveRequests`, only with a ✓ that names some. */
export type DecideExtras = Pick<DecideFleetFuelReconcile, 'cancelCharges' | 'approveRequests'>;

/** 6b's state on this screen: the link answers, the cards refused, «إضافة»'s new cards. */
export interface ReconcileSheetState {
  linkResults: Readonly<Record<string, FleetFuelLinkResultDto>>;
  linkRefused: ReadonlySet<string>;
  linkBusy: boolean;
  /** Sheet rows added on this screen → the new card's id. */
  added: Readonly<Record<number, string>>;
}
export const NO_SHEET_STATE: ReconcileSheetState = {
  linkResults: {},
  linkRefused: new Set(),
  linkBusy: false,
  added: {},
};

/**
 * The answer, drawn: the sheet strip and its alerts, the counts, the table, the links, the new
 * cards, the folds, and the confirmation. Every change goes back to the page through `dispatch`
 * and the callbacks.
 */
export const ReconcileResult = ({
  result,
  selection,
  dispatch,
  mayDecide,
  deciding,
  confirming,
  onConfirming: openDialog,
  onDecide,
  onAnother,
  onHistory,
  onSwitch,
  onUpdateNumber,
  sheet,
  onDecideLinks,
  onAdd,
}: {
  result: FleetFuelReconcileDto;
  selection: ReconcileSelection;
  dispatch: (action: ReconcileSelectionAction) => void;
  mayDecide: boolean;
  deciding: boolean;
  /** The bulk decision being asked about; `null` = the dialog is closed. */
  confirming: FleetFuelReconcileDecision | null;
  onConfirming: (decision: FleetFuelReconcileDecision | null) => void;
  onDecide: (
    ids: readonly string[],
    decision: FleetFuelReconcileDecision,
    extras?: DecideExtras,
  ) => void;
  onAnother: () => void;
  onHistory: (card: FleetFuelCardDto) => void;
  /** The wrong-company stop's one click: read the same file as the sheet's company. */
  onSwitch: (company: FleetFuelCardCompany) => void;
  /** «تحديث رقم الكارت» — the card's own edit dialog. */
  onUpdateNumber: (card: FleetFuelCardDto) => void;
  sheet: ReconcileSheetState;
  onDecideLinks: (body: DecideFleetFuelLinks) => void;
  /** «إضافة» a sheet-only card. */
  onAdd: (row: FleetFuelReconcileNewCardDto) => void;
}): JSX.Element => {
  const can = useCan();
  const lines = result.differs;
  const ticked = tickedLines(lines, selection);
  // 6a: a row whose ✓ asks first opens the confirm for that row alone.
  const [single, setSingle] = useState<string | null>(null);
  // The confirm's choices — a card not touched yet takes its defaults (the pre-ticked charges,
  // «اعتماد طلب الرصيد» suggested).
  const [choices, setChoices] = useState<Record<string, LineChoices>>({});
  const asked =
    single === null ? ticked : lines.filter((line) => line.card.id.toLowerCase() === single);
  const choiceOf = (line: FleetFuelReconcileLineDto): LineChoices =>
    choices[line.card.id.toLowerCase()] ?? defaultChoices(line);
  /** Opens the confirmation for the ticked cards — afresh, with each card's defaults. */
  const onConfirming = (decision: FleetFuelReconcileDecision | null): void => {
    setSingle(null);
    setChoices({});
    openDialog(decision);
  };
  const movedLines = lines.filter(
    (line) =>
      selection.moved.has(line.card.id.toLowerCase()) &&
      selection.decided[line.card.id.toLowerCase()] === undefined,
  );
  const cardNow = (card: FleetFuelCardDto): FleetFuelCardDto => ({
    ...card,
    balance: balanceNow(selection, card),
  });
  const header = (
    <ReconcileHeader
      result={result}
      decided={selection.decided}
      movedLines={movedLines}
      onAnother={onAnother}
      onSwitch={onSwitch}
    />
  );
  // The wrong company stops here: the strip, how the sheet was read, and the switch.
  if (wrongCompanyOf(result) !== null) {
    return (
      <div className={PAGE} data-recon-page="wrong-company">
        {header}
      </div>
    );
  }
  return (
    <div className={PAGE} data-recon-page="result">
      {header}
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
          // 6a: a ✓ that asks about a charge or a request opens the confirm for this row.
          const line = lines.find((one) => one.card.id.toLowerCase() === id);
          if (decision === 'apply' && line !== undefined && asksFirst(line)) {
            setChoices({});
            setSingle(id);
            openDialog('apply');
            return;
          }
          onDecide([id], decision);
        }}
        onBulk={onConfirming}
        onHistory={(card) => onHistory(cardNow(card))}
        onUpdateNumber={onUpdateNumber}
      />
      <ReconcileLinks
        result={result}
        results={sheet.linkResults}
        refused={sheet.linkRefused}
        mayDecide={can('fleetFuelCard.edit')}
        busy={sheet.linkBusy}
        onDecide={onDecideLinks}
        onHistory={onHistory}
      />
      <ReconcileNewCards
        rows={result.newCards}
        company={result.company}
        added={sheet.added}
        mayAdd={can('fleetFuelCard.create')}
        onAdd={onAdd}
      />
      <ReconcileFolds
        result={result}
        cardNow={cardNow}
        onHistory={onHistory}
        onUpdateNumber={onUpdateNumber}
      />
      <ReconcileConfirmDialog
        decision={confirming}
        lines={asked}
        company={result.company}
        fileName={result.fileName}
        busy={deciding}
        sheetDate={result.sheetDate}
        choiceOf={choiceOf}
        onToggleCharge={(cardId, chargeId, on) => {
          const line = lines.find((one) => one.card.id.toLowerCase() === cardId);
          if (line === undefined) return;
          const was = choiceOf(line);
          const cancel = new Set(was.cancel);
          if (on) cancel.add(chargeId);
          else cancel.delete(chargeId);
          setChoices((all) => ({ ...all, [cardId]: { ...was, cancel } }));
        }}
        onRequest={(cardId, request: RequestChoice) => {
          const line = lines.find((one) => one.card.id.toLowerCase() === cardId);
          if (line === undefined) return;
          setChoices((all) => ({ ...all, [cardId]: { ...choiceOf(line), request } }));
        }}
        onClose={() => {
          setSingle(null);
          openDialog(null);
        }}
        onConfirm={() => {
          if (confirming !== null && asked.length > 0) {
            onDecide(
              asked.map((line) => line.card.id.toLowerCase()),
              confirming,
              confirming === 'apply' ? decideExtrasOf(asked, choiceOf) : undefined,
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
  const [sheetDate, setSheetDate] = useState('');
  const [result, setResult] = useState<FleetFuelReconcileDto | null>(null);
  const [selection, dispatch] = useReducer(reconcileSelection, NO_SELECTION);
  const [confirming, setConfirming] = useState<FleetFuelReconcileDecision | null>(null);
  const [historyOf, setHistoryOf] = useState<FleetFuelCardDto | null>(null);
  const [numberOf, setNumberOf] = useState<FleetFuelCardDto | null>(null);
  const [addFrom, setAddFrom] = useState<FromSheet | null>(null);
  const [sheet, setSheet] = useState<ReconcileSheetState>(NO_SHEET_STATE);
  const upload = useUploadFuelSheet();
  const decision = useDecideFuelReconcile();
  const links = useDecideFuelLinks();
  // Every card — «سجل الكارت» names a transfer's other card by its car, as on «شحن الكروت».
  const allCards = useAllFuelCards({}, result !== null);

  const compare = (picked: FleetFuelCardCompany | null = company): void => {
    if (picked === null || file === null) return;
    upload.mutate(
      { company: picked, file, sheetDate },
      {
        onSuccess: (answer) => {
          setResult(answer);
          setConfirming(null);
          setSheet(NO_SHEET_STATE);
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

  const decide = (
    ids: readonly string[],
    chosen: FleetFuelReconcileDecision,
    extras?: DecideExtras,
  ): void => {
    if (result === null || ids.length === 0) return;
    decision.mutate(
      { id: result.id, body: { decision: chosen, cardIds: [...ids], ...extras } },
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
          else if (refusal.kind === 'cancel') toast.error(t(cancelRefusalKey(refusal.code)));
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

  /** 6b: ✓ «تحديث» / ✗ «إبقاء» on one unit of «ربط الكروت بالسيارات». */
  const decideLinks = (body: DecideFleetFuelLinks): void => {
    if (result === null) return;
    setSheet((now) => ({ ...now, linkBusy: true }));
    links.mutate(
      { id: result.id, body },
      {
        onSuccess: (answer) => {
          setSheet((now) => ({
            ...now,
            linkBusy: false,
            linkResults: {
              ...now.linkResults,
              ...Object.fromEntries(answer.map((one) => [one.cardId.toLowerCase(), one])),
            },
          }));
          if (body.decision === 'apply') {
            toast.success(
              t('fleet.fuelCards.reconcile.links.toastApplied', {
                cards: count.cardsOf(answer.length),
              }),
              t('fleet.fuelCards.reconcile.links.toastAppliedNote'),
            );
          } else {
            toast.success(
              t('fleet.fuelCards.reconcile.links.toastKept', {
                cards: count.cardsOf(answer.length),
              }),
            );
          }
        },
        // Nothing was written. A card whose car changed after the read loses its ✓ here.
        onError: (failure) => {
          const refusal = linkRefusalOf(failure);
          setSheet((now) => ({
            ...now,
            linkBusy: false,
            linkRefused:
              refusal?.kind === 'changed'
                ? new Set([...now.linkRefused, ...refusal.cardIds])
                : now.linkRefused,
          }));
          const said = linkRefusalWords(failure);
          if (said !== null) toast.error(t(said.key, said.values));
        },
      },
    );
  };

  const another = (): void => {
    setResult(null);
    setFile(null);
    setSheetDate('');
    setConfirming(null);
    setSheet(NO_SHEET_STATE);
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
            onFile={(picked) => {
              setFile(picked);
              // M23: the statement's day, from its file name when it holds one.
              setSheetDate(picked === null ? '' : (sheetDateOfName(picked.name)?.day ?? ''));
            }}
            onCompare={() => compare()}
            sheetDate={sheetDate}
            onSheetDate={setSheetDate}
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
        onSwitch={(picked) => {
          setCompany(picked);
          compare(picked);
        }}
        onUpdateNumber={setNumberOf}
        sheet={sheet}
        onDecideLinks={decideLinks}
        onAdd={(row) => setAddFrom(fromSheetOf(row, result))}
      />
      {/* «إضافة» from the sheet, and «تحديث رقم الكارت» — the cards' own dialog. */}
      <FuelCardDialog
        open={addFrom !== null}
        onClose={() => setAddFrom(null)}
        card={null}
        fromSheet={addFrom}
        onAdded={(created) => {
          if (addFrom === null) return;
          const row = addFrom.row;
          setSheet((now) => ({ ...now, added: { ...now.added, [row]: created.id } }));
        }}
      />
      <FuelCardDialog open={numberOf !== null} onClose={() => setNumberOf(null)} card={numberOf} />
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
