// «الشحنات المسلَّمة» — Round 33 B. The owner: «وعاوز اعمل شاشة جديدة زى شاشةاليوم التشغيلى بس يظهر بس
// اللى اتسلمت سواء يومى او كانت محصنة ف الخونة واسلمت ل بنك هتظهرلى لما تكون تم التسليم بس الاجراءات
// هيكون فيه علامة صح لما ادوس عليها لازم يكون فيه رقم الايصال ويفضل الصورة تكون مرفوعه و يحدد البنك من
// او الى اللى هيتحسب عليه تكلفة نقل الشحنة». Asked about the day board's ✓: «الشاشة الجديدة حاجاتها
// لوحدها»; about the photo: «اختيارية مع تنبيه».
//
// THE SAME BOARD as «اليوم التشغيلي» (`components/ShipmentsBoard.tsx`, `kind="delivered"`) — its
// figures, its filters on one row, its table with the hover cards and the receipt photo's column —
// over the rows the SERVER chose (`GET /operations/shipments/delivered?date=`): the shipments that
// reached their bank on one Cairo day, daily ones and محصنات out of the vault, oldest delivery first.
// What this page owns is its DAY — «يوم التسليم», today by default, any day before it (a receipt
// often comes back days later) — and its one act: the ✓ with the receipt (`DeliveryConfirmDialog`)
// and its undo, for the day board's ✓ grant. The day board and its own ✓ are not touched from here.
// Round 33 critic: «today» is the SERVER's (the read says it), never the desk PC's clock; and an
// open ✓ dialog outlives Cairo midnight with what was typed into it.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type OperationsDeliveredShipmentDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useOperationsDeliveredBoard } from '../api/operations-queries';
import { ShipmentsBoard } from '../components/ShipmentsBoard';
import {
  DeliveredRowAction,
  DeliveredStatusCell,
  DeliveryConfirmDialog,
} from '../components/DeliveredShipmentParts';
import { dayText } from '../components/SecuredDistributionParts';
import {
  defaultDayLeft,
  deliveredDialogRow,
  deliveredRowTint,
  readDeliveredDay,
  type OpenedDelivery,
} from '../lib/delivered-board';
import { useCairoToday } from '../lib/use-cairo-today';

/**
 * Remembered across visits: the filters this board reads, less its one-off lookups
 * (`rememberedFilterParams('delivered')`) — not the day, which opens on today: a day looked at last
 * week is not today's question. Round 33 C critic — nor «رقم الإيصال» (`receipt`): it finds one
 * receipt, and a number remembered from last week would hide every row still awaiting its ✓ (none
 * has a number yet). The address keeps it for the visit (a reload, a shared link); the next visit
 * from the menu opens without it.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'type',
  'confirmed',
  'notes',
] as const;

export const DeliveredShipmentsPage = (): JSX.Element => {
  const t = useT();
  const search = useSearchParams();
  const [sp, setSp] = search;
  // The PC's Cairo day, kept current on a screen left open past midnight. Round 33 critic: it only
  // says WHEN to ask the server again (the default read's key) and bounds a day before the first
  // read is in — which day it is, and the latest day the box offers, are the SERVER's (`today`).
  const clock = useCairoToday();
  const [serverToday, setServerToday] = useState<string | null>(null);
  const today = serverToday ?? clock;
  // The day asked for by name — a real day before the server's today — or null: no day named, the
  // server's own today.
  const asked = readDeliveredDay(sp, today);
  const board = useOperationsDeliveredBoard(asked, clock);
  const read = board.data;
  // Every read says the server's today; the screen bounds its day by the latest one (React's
  // «state from the previous render» pattern — no frame drawn on the PC's bound once it is known).
  if (read !== undefined && read.today !== serverToday) setServerToday(read.today);
  // The day «يوم التسليم» shows: the one the server answered, else the one asked (its read loading),
  // else today.
  const day = read?.date.slice(0, 10) ?? asked ?? today;
  const [confirming, setConfirming] = useState<OpenedDelivery | null>(null);

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // Round 33 critic — the default day moved on under a screen left open (Cairo midnight, on the
  // server's word): said once, with the day it left — its rows are a pick of «يوم التسليم» away.
  const answeredDefault = asked === null && read !== undefined ? read.date.slice(0, 10) : null;
  const lastDefault = useRef<string | null>(null);
  useEffect(() => {
    if (asked !== null) {
      lastDefault.current = null;
      return;
    }
    if (answeredDefault === null) return;
    const left = defaultDayLeft(lastDefault.current, answeredDefault);
    lastDefault.current = answeredDefault;
    if (left !== null) {
      toast.info(
        t('operations.delivered.dayMoved.title'),
        t('operations.delivered.dayMoved', { day: dayText(left) }),
      );
    }
    // Once per day the default moves to — not on every render (`t` is not the news).
  }, [asked, answeredDefault]);

  const setDay = (value: string): void => {
    const next = new URLSearchParams(sp);
    // Emptied, today itself or later: the default — the server's today — so the address says
    // nothing it does not need to.
    if (value === '' || value >= today) next.delete('date');
    else next.set('date', value);
    setSp(next);
  };

  // The dialog follows its row on its own day's read; while the screen reads another day (midnight
  // passed on the default) it stays on the row it was opened on, the work typed into it kept
  // (`deliveredDialogRow`). A row a colleague confirmed meanwhile stays open until «تأكيد» — the
  // server's 409 then says so and the dialog closes onto the fresh row; the dialog's own
  // confirmation does not shut it under its photo's upload.
  const shipments = read?.shipments ?? [];
  const open = deliveredDialogRow(confirming, read);
  const openOn = (row: OperationsDeliveredShipmentDto): void => setConfirming({ row, day });

  return (
    <PageContainer fullHeight>
      <ShipmentsBoard
        search={search}
        kind="delivered"
        shipments={shipments}
        crews={board.data?.crews ?? []}
        loaded={board.data !== undefined}
        loading={board.isLoading}
        error={board.error}
        onRetry={() => void board.refetch()}
        datePickers={[
          {
            param: 'date',
            // Its name is the box's title and its screen-reader name: «يوم التسليم» written beside
            // the day did not fit the box with the date (the history's «من» / «إلى» are two letters).
            label: t('operations.delivered.day'),
            // The server's today once a read has said it (Round 33 critic).
            max: today,
            value: day,
            onChange: setDay,
          },
        ]}
        periodActive={sp.get('date') !== null}
        periodParams={['date']}
        // Its own act only («الشاشة الجديدة حاجاتها لوحدها»): no «إضافة شحنة», no day board ✓,
        // no edit or delete — the photo as on the day board.
        canCreate={false}
        canToggleReceived={false}
        canEditRows={false}
        canManageReceipts
        statusCell={(row) => <DeliveredStatusCell row={row} />}
        tintOf={deliveredRowTint}
        rowAction={(row) => <DeliveredRowAction row={row} onConfirm={openOn} />}
        empty={t('operations.delivered.empty')}
      />
      <DeliveryConfirmDialog row={open} onClose={() => setConfirming(null)} />
    </PageContainer>
  );
};
