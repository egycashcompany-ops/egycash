// «عداد الطابعة» (FR-20, 2026-11-19) — what the two writers of a reading share, and the two reads.
//
// The writers — the issue (`consumable-issue.service`) and «تعديل الجهاز»
// (`consumable-installed-on.service`) — judge a reading against the printer's timeline read INSIDE
// their transaction, under the printer's lock: a row in `it_sequences` (`printerCounter:<assetId>`,
// beside the module's counters) that each of them writes before it reads. Two writes on one
// printer then conflict, and the one retried reads the other's committed row — so «strictly above
// the last reading» is judged against the reading another clerk wrote a moment ago. The issues
// alone were already serialized by the memo number; the device change writes no shared row of its
// own, and this is what makes it wait for an issue on the same printer, and the reverse.
//
// The reads answer one object over a whole timeline, never a page: the pairing needs every row, and
// a printer has dozens a year. A printer's readings are read system-wide (a fact of the printer,
// whichever store fed it); an item's cartridges are that item's rows, paired against every store's
// readings on the printers they went into.
import { Types, type ClientSession } from 'mongoose';
import {
  ErrorCodes,
  type ApiErrorDetail,
  type ItConsumableCartridgeDto,
  type ItConsumableCartridgesDto,
  type ItPrinterCounterDto,
  type ItPrinterCounterReadingDto,
} from '@ecms/contracts';
import { AppError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { itAssetRepository } from '../assets/asset.repository';
import { reserveSequenceBlock } from '../shared/sequence';
import {
  averagePages,
  pairCounterReadings,
  type CounterPair,
  type CounterPlacement,
  type CounterRow,
} from './consumable-counter';
import { itConsumableRepository } from './consumable.repository';
import {
  itConsumableMovementRepository,
  type ItCounterTimelineRow,
} from './consumable-movement.repository';
import { type ItConsumableDoc } from './consumable.model';

/** A timeline row as the rules read it, with the two ids the reads name. */
export interface CounterTimelineEntry extends CounterRow {
  consumableId: string;
  assetId: string;
}

export const counterEntryOf = (doc: ItCounterTimelineRow): CounterTimelineEntry => ({
  id: String(doc._id),
  at: doc.at,
  reading: doc.counterReading,
  reset: doc.counterReset === true,
  memoId: doc.memoId == null ? null : String(doc.memoId),
  consumableId: String(doc.consumableId),
  assetId: String(doc.assetId),
});

/** The printer's lock key in `it_sequences`. */
export const printerCounterLockKey = (assetId: string): string => `printerCounter:${assetId}`;

/**
 * Take each printer's lock inside `session`, then read its timeline in the same transaction. The
 * locks are taken one by one in id order; MongoDB aborts a write conflict rather than waiting on
 * it, so the order is for the reader of a trace, not against a deadlock.
 */
export const lockAndReadTimelines = async (
  assetIds: readonly string[],
  session: ClientSession,
): Promise<Map<string, CounterTimelineEntry[]>> => {
  const printers = [...new Set(assetIds)].sort();
  for (const assetId of printers) {
    await reserveSequenceBlock(printerCounterLockKey(assetId), 1, session);
  }
  const rows = await itConsumableMovementRepository.counterTimelineSystem(
    printers.map((id) => new Types.ObjectId(id)),
    session,
  );
  const byPrinter = new Map<string, CounterTimelineEntry[]>(printers.map((id) => [id, []]));
  for (const row of rows.map(counterEntryOf)) byPrinter.get(row.assetId)?.push(row);
  return byPrinter;
};

/** One gap of a counted line — a detail of `IT_CONSUMABLE_COUNTER_REQUIRED`. */
export interface CounterGap {
  field: string;
  code: 'REQUIRED' | 'ONE_CARTRIDGE';
  message: string;
}

/** 422 `IT_CONSUMABLE_COUNTER_REQUIRED` — every gap a detail, the first one the message. */
export const counterRequired = (gaps: readonly [CounterGap, ...CounterGap[]]): AppError =>
  new AppError(ErrorCodes.IT_CONSUMABLE_COUNTER_REQUIRED, 422, gaps[0].message, {
    details: gaps.map((gap) => ({ field: gap.field, code: gap.code, message: gap.message })),
  });

/**
 * 422 for a reading the printer's timeline refuses — the reading it is held against, as figures
 * the screen shows («القراءة يجب أن تكون أكبر من آخر قراءة مسجّلة لهذه الطابعة (…)»), on the field
 * the reading was typed in.
 */
export const counterRefused = (
  placement: Extract<CounterPlacement<CounterRow>, { ok: false }>,
  context: { field: string; reading: number; assetCode: string },
): AppError => {
  const { field, reading, assetCode } = context;
  const figures = (row: CounterRow, prefix: 'PREVIOUS' | 'NEXT'): ApiErrorDetail[] => [
    { field, code: `${prefix}_READING`, message: String(row.reading) },
    { field, code: `${prefix}_AT`, message: row.at.toISOString() },
  ];
  if (placement.kind === 'belowPrevious') {
    const previous = placement.previous;
    return new AppError(
      ErrorCodes.IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS,
      422,
      `the counter reading ${String(reading)} is not above ${assetCode}'s last reading ${String(previous.reading)} of ${previous.at.toISOString()}; tick «تم تصفير عداد الطابعة» if its counter was reset`,
      { details: figures(previous, 'PREVIOUS') },
    );
  }
  const next = placement.next;
  return new AppError(
    ErrorCodes.IT_CONSUMABLE_COUNTER_ABOVE_NEXT,
    422,
    `the counter reading ${String(reading)} is not below ${assetCode}'s later reading ${String(next.reading)} of ${next.at.toISOString()}`,
    { details: figures(next, 'NEXT') },
  );
};

type ItemLabel = Pick<ItConsumableDoc, 'code' | 'name'>;

/**
 * «The same item» — its current NAME, compared exactly: how the store's own unique index and the
 * transfer define «the other store's item of the same name». A printer fed from two stores, or from
 * a transferred twin, still pairs; an item that cannot be read pairs by its id alone.
 */
const itemKeyOf =
  (items: ReadonlyMap<string, ItemLabel>) =>
  (row: CounterTimelineEntry): string => {
    const item = items.get(row.consumableId);
    return item === undefined ? `id:${row.consumableId}` : `name:${item.name}`;
  };

/** Every item a set of readings names — any state, any store: a reading names its toner. */
const itemsOf = async (rows: readonly CounterTimelineEntry[]): Promise<Map<string, ItemLabel>> =>
  new Map(
    (await itConsumableRepository.findByIdsSystem(rows.map((row) => row.consumableId))).map(
      (item) => [String(item._id), { code: item.code, name: item.name }],
    ),
  );

const readingOf = (
  pair: CounterPair<CounterTimelineEntry>,
  items: ReadonlyMap<string, ItemLabel>,
): ItPrinterCounterReadingDto => {
  const { row, replaced } = pair;
  const item = items.get(row.consumableId);
  return {
    movementId: row.id,
    at: row.at.toISOString(),
    reading: row.reading,
    reset: row.reset,
    consumableId: row.consumableId,
    consumableCode: item?.code ?? null,
    consumableName: item?.name ?? null,
    replaced:
      replaced === null
        ? null
        : {
            movementId: replaced.row.id,
            at: replaced.row.at.toISOString(),
            reading: replaced.row.reading,
            pages: replaced.pages,
          },
  };
};

class ItConsumableCounterService {
  /**
   * `GET /it/assets/:id/counter-readings` — the printer's readings, newest first, each with the
   * cartridge of the same item it replaced and what that one printed; and the newest one alone, the
   * floor «صرف» shows under the reading field. The asset was read under the caller's `itAsset.view`;
   * the readings are the printer's, whichever store's toner they were taken with.
   */
  async printer(asset: { _id: Types.ObjectId }): Promise<ItPrinterCounterDto> {
    const rows = (await itConsumableMovementRepository.counterTimelineSystem([asset._id])).map(
      counterEntryOf,
    );
    const items = await itemsOf(rows);
    const readings = pairCounterReadings(rows, itemKeyOf(items))
      .map((pair) => readingOf(pair, items))
      .reverse();
    const [newest] = readings;
    return {
      assetId: String(asset._id),
      latest:
        newest === undefined
          ? null
          : {
              movementId: newest.movementId,
              at: newest.at,
              reading: newest.reading,
              reset: newest.reset,
              consumableId: newest.consumableId,
              consumableCode: newest.consumableCode,
              consumableName: newest.consumableName,
            },
      readings,
    };
  }

  /**
   * `GET /it/consumables/:id/cartridges` — every cartridge of this item, newest first, on the
   * printer it went into: the reading it went in at, the next cartridge of the same item there
   * (from any store) and what this one printed; and the mean over the cartridges whose pages are
   * known. The item was read under the caller's `itConsumable.view`; the printers are named under
   * that same scope, as the ledger names them.
   */
  async cartridges(
    item: ItConsumableDoc,
    scope: ScopeSelector,
  ): Promise<ItConsumableCartridgesDto> {
    const own = (await itConsumableMovementRepository.counterRowsOfItem(item._id))
      .filter((row) => row.assetId != null)
      .map(counterEntryOf);
    const printers = [...new Set(own.map((row) => row.assetId))];
    const [timeline, assets] = await Promise.all([
      itConsumableMovementRepository.counterTimelineSystem(
        printers.map((id) => new Types.ObjectId(id)),
      ),
      printers.length === 0 ? [] : itAssetRepository.findManyByIds(printers, scope),
    ]);
    const rows = timeline.map(counterEntryOf);
    const items = await itemsOf(rows);
    const keyOf = itemKeyOf(items);

    // Each cartridge's successor: the reading of the same item, on the same printer, that
    // replaced it.
    const successor = new Map<string, CounterPair<CounterTimelineEntry>>();
    for (const printer of printers) {
      const pairs = pairCounterReadings(
        rows.filter((row) => row.assetId === printer),
        keyOf,
      );
      for (const pair of pairs) {
        if (pair.replaced !== null) successor.set(pair.replaced.row.id, pair);
      }
    }
    const labels = new Map(assets.map((asset) => [String(asset._id), asset]));

    const cartridges: ItConsumableCartridgeDto[] = own
      .map((row) => {
        const next = successor.get(row.id);
        const asset = labels.get(row.assetId);
        return {
          movementId: row.id,
          at: row.at.toISOString(),
          assetId: row.assetId,
          assetCode: asset?.assetCode ?? null,
          assetName: asset?.name ?? null,
          installReading: row.reading,
          removedAt: next === undefined ? null : next.row.at.toISOString(),
          removedReading: next === undefined ? null : next.row.reading,
          pages: next?.replaced?.pages ?? null,
        };
      })
      .reverse();
    const pages = cartridges.map((cartridge) => cartridge.pages);
    return {
      consumableId: String(item._id),
      averagePages: averagePages(pages),
      counted: pages.filter((value) => value !== null).length,
      cartridges,
    };
  }
}

export const itConsumableCounterService = new ItConsumableCounterService();
