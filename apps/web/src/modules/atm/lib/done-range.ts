// The done pages' range, read WHOLE — every operation closed in it, however many — one chunk after
// the other (`GET /atm/{kind}/done/range`). It replaced a walk that asked for every page of the
// range AT ONCE: on 2026-11-25 a branch's month was up to two hundred reads in flight together,
// each sorting the whole range on the server, and the system hung behind them. A chunk continues
// where the previous one stopped, so the server walks the range once, in its index's order; and
// the range has no cap («عايز إمكانية إنى أستخرجهم كلهم»): the table shows it in pages, and the
// Excel and PDF are the whole period.
//
// TanStack's signal stops the walk between chunks and aborts the one in flight, so a range left
// behind (a date typed past, a screen left) asks for nothing more.
import { type AtmDoneRangeChunkDto, type Paginated } from '@ecms/contracts';

/**
 * A hard stop on the chunks one read may cost — ten million rows at five thousand a chunk. Never a
 * real range; it keeps a server that answered `next` for ever from becoming an endless loop.
 */
export const MAX_DONE_RANGE_CHUNKS = 2000;

/** One chunk of the range, from `cursor` on (none: from the start). */
export type DoneRangeChunkFetch<T> = (
  cursor: string | undefined,
  signal?: AbortSignal,
) => Promise<AtmDoneRangeChunkDto<T>>;

/**
 * Every row of the range, in close order, as one `Paginated` — the shape the done pages read. It is
 * never cut short, so its single «page» is the whole answer.
 */
export const readDoneRange = async <T>(
  fetchChunk: DoneRangeChunkFetch<T>,
  signal?: AbortSignal,
): Promise<Paginated<T>> => {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let chunk = 0; chunk < MAX_DONE_RANGE_CHUNKS; chunk += 1) {
    signal?.throwIfAborted();
    const answer = await fetchChunk(cursor, signal);
    items.push(...answer.items);
    if (answer.next === null) break;
    cursor = answer.next;
  }
  return {
    items,
    meta: { page: 1, pageSize: Math.max(items.length, 1), totalItems: items.length, totalPages: 1 },
  };
};
