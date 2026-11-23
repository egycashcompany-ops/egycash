// Round 32 — «لوحة التشغيلة» on a PAST day: the day's RECORD, view only.
//
// THE OWNER: «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط». The day box takes any
// day, a past one too (as Round 20 left it), but a day before today opens as what was saved for it
// — like «توزيع المحصنات»'s record (Round 30): no drag, no list to pick from, no van given, no row
// added or emptied, no type, colour, time, direction or notes changed, no «الطاقم الثابت», no
// «تراجع», no «حفظ». The filters and the hover cards still work — reading is not changing. The
// server refuses a past day's save whatever is sent (422 `OPERATIONS_CREW_DAY_IN_PAST`).
//
// WHEN IS THE BOARD A RECORD — the distribution's rule (`isRecordScreen`): before the read is in, the
// URL's day against today on this screen's clock; once it is in, the SERVER's `past` (a PC clock
// running a day ahead never turns today's board into a record), plus midnight passing while the
// screen stays open — a board of today left open overnight is yesterday's record in the morning.
import { cairoYmd, type OperationsCrewBoardDto } from '@ecms/contracts';
import { isRecordScreen } from './secured-distribution';

/**
 * Is the board a record? `day` the board's day ('YYYY-MM-DD'), `liveToday` today in Cairo on this
 * screen's clock (`useCairoToday`), `read` the board's answer and when it arrived (the query's
 * `dataUpdatedAt`), or null while none is in.
 */
export const isCrewRecord = (
  day: string,
  liveToday: string,
  read: { board: Pick<OperationsCrewBoardDto, 'today' | 'past'>; arrivedAt: number } | null,
): boolean =>
  day !== '' &&
  isRecordScreen(
    day,
    liveToday,
    read === null
      ? null
      : {
          today: read.board.today.slice(0, 10),
          past: read.board.past,
          readOn: cairoYmd(new Date(read.arrivedAt)),
        },
  );
