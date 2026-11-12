// «الشحنات المحصنة» (B4) — the legacy `/mohsana` screen, on the day board's own board.
//
// WHAT THE LEGACY SCREEN WAS (discovery §7.1, contad_app.js:648-960): every secured shipment not
// yet completed, with NO DATE FILTER at all — an open working list, not a day's work. Shipments
// were created and edited here, and the same screen also carried a `received` toggle that flipped
// that field WITHOUT touching status (:948/:953), unlike /main_ops which moved both.
//
// PARITY: the unbounded, all-time backlog is preserved — it is what makes this a backlog rather
// than a board. NORMALIZED: the orphan `received` toggle is gone (Q23 — one lifecycle), so this
// screen offers no delivery ✓: a محصنة's delivery is confirmed on the day board, where the legacy
// system actually did it. (Its PICKUP ✓ is this screen's since Round 10 — below.)
//
// «شاشة الشحنات المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى بس هنزود التاريخ التسليم يظهر فى
// الجدول والحالة لم التسليم و تم الاستلام من القائد و بالخزينة»: the screen IS the day board —
// the figures and their «عملات أخرى», the one-row filter bar, the dark table with its hover cards,
// «السجل», the receipt image, edit and delete — drawn by the shared board
// (`components/ShipmentsBoard.tsx`), with what only this screen has:
//
//   · «تاريخ التسليم», a column beside the date, which is then named «تاريخ الاستلام»;
//   · the status of each row is its STAGE, and so is its colour — white until somebody collects
//     it, yellow once the captain has («تم الاستلام من القائد») or the desk has confirmed it («تم
//     الاستلام من العمليات»), green once the vault has it («بالخزينة»), blue on its way out («خرجت
//     للتسليم») — and the status filter offers those stages;
//   · no «النوع», column or filter: every row here is a محصنة;
//   · «إضافة محصنة» books a SECURED shipment («الفورم بتاعت الاضافى لما اضيف اتوماتيك محصنة»),
//     its delivery date the day after collection unless changed (`ShipmentFormDialog`).
//
// ROUND 10 — THE DESK'S PICKUP ✓, THE LOCK, THE CANCELLED RECEIPT. «فى شاشة المحصنات ممكن القائد اللى
// يعمل صح انه استلم او العمليات ف لو قائد تم الاستلام من القائد و لو العمليات تم الاستلام من العمليات
// وهتبقى صفر»: this screen now has a ✓ of its own after all — not the delivery ✓ (that stays the day
// board's) but the PICKUP's (`canConfirmPickup`): on a white row the desk confirms collecting it
// from the bank, «تم الاستلام من العمليات», and the row turns yellow for the vault to receive; pressed
// on a yellow row it takes the ✓ back — the desk's own, or the captain's from the app («لو القائد عمل
// صح ممكن العمليات تشيلها بس لو العمليات عملت صح القائد مينفعش يشيلها»), confirmed first — until the
// vault receives. A green row is LOCKED (no edit, delete or photo change, on every board), and for
// whoever holds the special grant it offers «إلغاء استلام الخزينة» (`canCancelReceipt`), which turns
// it yellow again. All three are the board's own acts (`ShipmentsBoard`).
//
// The rows are the SERVER's (`GET /operations/secured/board`): every open محصنة as a board row —
// its branches with their banks, its stage, and the crew of the leg it is on: the pickup crew
// while it is on its way to the vault, the delivery crew once it is in it (none until the vault
// names one). Counted before it is read: past `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` open ones the
// server refuses rather than cutting the list short, and the refusal is said in the table's place.
// The table is cut into pages; the filters and figures run over every row.
import { useSearchParams } from 'react-router-dom';
import { OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAppSelector } from '../../../store';
import { useOperationsSecuredBoard } from '../api/operations-queries';
import { ShipmentsBoard } from '../components/ShipmentsBoard';
import { isHistoryTooLarge } from '../lib/shipment-history';

/**
 * Remembered across visits: the filters — the screen has no period, it is every open محصنة. The
 * day board's list without «النوع» and with the stage in place of «التسليم»: exactly the filters
 * this board reads (`boardFilterParams('secured')`) — day-board-filters.spec holds them together.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'stage',
  'notes',
] as const;

export const SecuredBacklogPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  const board = useOperationsSecuredBoard();

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // A refusal replaces the rows AND the figures, as on the history: a refetch the server refuses
  // keeps its last answer beside the error, and figures summed from it would sit above a message
  // saying the list was refused.
  const tooLarge = isHistoryTooLarge(board.error);
  const refusal = tooLarge
    ? t('operations.secured.backlog.tooLarge', {
        max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
      })
    : null;

  return (
    <PageContainer fullHeight>
      <ShipmentsBoard
        search={search}
        shipments={tooLarge ? [] : (board.data?.shipments ?? [])}
        crews={tooLarge ? [] : (board.data?.crews ?? [])}
        loaded={!tooLarge && board.data !== undefined}
        loading={board.isLoading}
        error={tooLarge ? null : board.error}
        onRetry={() => void board.refetch()}
        // Secured shipments are booked here, as on legacy /mohsana — and only secured ones.
        canCreate
        createType="secured"
        canToggleReceived={false}
        // «لو العمليات تم الاستلام من العمليات»: the desk's pickup ✓ and its undo, until the vault.
        canConfirmPickup
        // «بس صلاحية خاصة تقدر تلغى استلام الخزينة» — on a green row, for whoever holds that grant.
        canCancelReceipt
        kind="secured"
        empty={t('operations.secured.backlog.empty')}
        refusal={refusal}
        paged
      />
    </PageContainer>
  );
};
