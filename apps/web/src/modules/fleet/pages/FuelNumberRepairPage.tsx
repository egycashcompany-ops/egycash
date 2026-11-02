// «تصحيح أرقام الكروت» (/fleet/fuel-cards/reconcile/numbers, 6d) — the one-time, reviewed repair,
// reached from «مطابقة أرصدة الكروت» while it is pending. The go-live sheet put 15 Wataniya card
// NUMBERS on the wrong records, in three closed cycles, and swapped the NAME and opening balance of
// the 0849 pair. The owner's answer decides the repair: the physical card IS the number — its PIN,
// photo and expiry travel with it; the name, car, balance and log stay. The pair keeps number, car,
// photo, expiry and PIN, and swaps the name and the go-live opening.
//
// The page is a DRY RUN read live from the server (`GET /fleet/fuel-cards/number-repair`): one row
// per record, each checked against the «before» the owner reviewed. A record changed by hand since
// («تغيّر — لن يُلمس») is never touched and holds its whole unit — a cycle is fixed whole or not at
// all. Nothing runs by itself: «تنفيذ التصحيح» (edit + approve) opens the confirmation, which sends
// only after «راجعتُ الصفوف» is ticked; the server re-checks every unit at execution, runs each in
// one transaction, writes a line in each card's log, and answers with the fresh dry run. Balances of
// the fifteen do not change; the newest company statement, approved afterwards on «مطابقة أرصدة
// الكروت», gives each card the company's balance for its own physical card.
//
// State and layout only: the rules are pure (`lib/fuel-number-repair.ts`), the words are i18n keys,
// and the pieces are in `components/number-repair/`. No number appears here but its printed start
// and last four, and no PIN appears at all — the dry run carries only whether one is stored.
import { useState } from 'react';
import {
  type FleetFuelNumberRepairDto,
  type FleetFuelNumberRepairResultDto,
  type FleetFuelNumberRepairUnit,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAllFuelCards } from '../api/fleet-queries';
import { useExecuteNumberRepair, useNumberRepair } from '../api/fuel-number-repair-queries';
import { FuelCardHistoryDialog } from '../components/FuelCardHistoryDialog';
import { RepairActionBar, RepairDoneBlock } from '../components/number-repair/RepairActionBar';
import { RepairConfirmDialog } from '../components/number-repair/RepairConfirmDialog';
import { RepairCycleSection } from '../components/number-repair/RepairCycleSection';
import {
  RepairChangedAlert,
  RepairHeader,
  RepairKpis,
  RepairRuleBox,
  useUnitName,
} from '../components/number-repair/RepairHeader';
import { RepairPairSection } from '../components/number-repair/RepairPairSection';
import { PAGE } from '../components/number-repair/repair-looks';
import { executeBodyOf, executedRecordsOf } from '../lib/fuel-number-repair';
import { N } from '../lib/fuel-number-repair-words';
import { useReconcileCount } from '../lib/fuel-reconcile-words';

/** The dry run, drawn — every piece of state comes from the page. */
export const NumberRepairView = ({
  repair,
  refreshing,
  onRefresh,
  confirming,
  reviewed,
  busy,
  onRun,
  onReviewed,
  onCloseConfirm,
  onConfirm,
  onLog,
}: {
  repair: FleetFuelNumberRepairDto;
  refreshing: boolean;
  onRefresh: () => void;
  confirming: boolean;
  reviewed: boolean;
  busy: boolean;
  onRun: () => void;
  onReviewed: (on: boolean) => void;
  onCloseConfirm: () => void;
  onConfirm: () => void;
  /** «سجل الكارت» of a corrected record. */
  onLog: (cardId: string) => void;
}): JSX.Element => {
  const done = repair.state === 'done';
  return (
    <div className={PAGE} data-repair-page={repair.state}>
      <RepairHeader repair={repair} refreshing={refreshing} onRefresh={onRefresh} />
      {done ? <RepairDoneBlock repair={repair} /> : <RepairRuleBox repair={repair} />}
      <RepairKpis repair={repair} />
      {!done && <RepairChangedAlert repair={repair} />}
      {repair.cycles.map((cycle) => (
        <RepairCycleSection key={cycle.unit} cycle={cycle} onLog={onLog} />
      ))}
      <RepairPairSection pair={repair.pair} onLog={onLog} />
      {!done && <RepairActionBar repair={repair} onRun={onRun} />}
      {!done && (
        <RepairConfirmDialog
          open={confirming}
          repair={repair}
          reviewed={reviewed}
          busy={busy}
          onReviewed={onReviewed}
          onClose={onCloseConfirm}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
};

/** While the dry run is read: the page's blocks, as grey shapes. */
const RepairSkeleton = (): JSX.Element => (
  <div className={PAGE} data-repair-page="loading">
    <Skeleton className="h-20 rounded-2xl" />
    <Skeleton className="h-36 rounded-2xl" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-96 rounded-2xl" />
  </div>
);

export const FuelNumberRepairPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const count = useReconcileCount();
  const unitName = useUnitName();
  const query = useNumberRepair();
  const execute = useExecuteNumberRepair();
  const [confirming, setConfirming] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [logOf, setLogOf] = useState<string | null>(null);
  // «سجل الكارت» names a transfer's other card by its car — every card, read when a log opens.
  const allCards = useAllFuelCards({}, logOf !== null);
  const repair = query.data;

  /** What the execution did, in a toast: the cards corrected, and any unit held at execution. */
  const report = (result: FleetFuelNumberRepairResultDto): void => {
    const executed = executedRecordsOf(result);
    const nameOf = (unit: FleetFuelNumberRepairUnit): string =>
      unitName({ n: result.repair.cycles.find((cycle) => cycle.unit === unit)?.n ?? null });
    if (executed > 0) {
      toast.success(t(`${N}toast.done`, { cards: count.cards(executed) }), t(`${N}toast.doneNote`));
    } else if (result.held.length === 0) {
      toast.success(t(`${N}toast.nothing`));
    }
    if (result.held.length > 0) {
      toast.error(t(`${N}toast.held`, { units: result.held.map(nameOf).join(t(`${N}and`)) }));
    }
  };

  const confirm = (): void => {
    if (repair === undefined) return;
    const body = executeBodyOf(repair, reviewed);
    if (body === null) return;
    execute.mutate(body, {
      onSuccess: (result) => {
        setConfirming(false);
        setReviewed(false);
        report(result);
      },
      onError: (failure) => toast.error(errorMessage(failure, locale)),
    });
  };

  const logCard = allCards.data?.items.find((card) => card.id === logOf) ?? null;
  return (
    <PageContainer>
      {repair === undefined ? (
        query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <RepairSkeleton />
        )
      ) : (
        <NumberRepairView
          repair={repair}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
          confirming={confirming}
          reviewed={reviewed}
          busy={execute.isPending}
          onRun={() => {
            setReviewed(false);
            setConfirming(true);
          }}
          onReviewed={setReviewed}
          onCloseConfirm={() => {
            if (!execute.isPending) setConfirming(false);
          }}
          onConfirm={confirm}
          onLog={setLogOf}
        />
      )}
      <FuelCardHistoryDialog
        card={logCard}
        cards={allCards.data?.items ?? []}
        onClose={() => setLogOf(null)}
      />
    </PageContainer>
  );
};
