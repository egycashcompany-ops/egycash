// «عداد الطابعة» — the two reads and the refusals the writers share, with the data layer mocked: a
// printer's readings newest first, each with the cartridge of the same item (by NAME, across
// stores) it replaced, and the newest alone with its toner; an item's cartridges with what each
// printed and the average; and the figures a refusal carries for the screen.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  timeline: vi.fn(),
  rowsOfItem: vi.fn(),
  items: vi.fn(),
  assets: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock('../shared/sequence', () => ({ reserveSequenceBlock: mocks.reserve }));
vi.mock('./consumable-movement.repository', () => ({
  itConsumableMovementRepository: {
    counterTimelineSystem: mocks.timeline,
    counterRowsOfItem: mocks.rowsOfItem,
  },
}));
vi.mock('./consumable.repository', () => ({
  itConsumableRepository: { findByIdsSystem: mocks.items },
}));
vi.mock('../assets/asset.repository', () => ({
  itAssetRepository: { findManyByIds: mocks.assets },
}));

const { counterRefused, counterRequired, itConsumableCounterService, lockAndReadTimelines } =
  await import('./consumable-counter.service');

const PRINTER = new Types.ObjectId();
const OTHER_PRINTER = new Types.ObjectId();
/** One store's «حبر HP 85A», the other store's twin of the same name, and a cyan toner. */
const BLACK = new Types.ObjectId();
const BLACK_TWIN = new Types.ObjectId();
const CYAN = new Types.ObjectId();
const scope = { scope: 'branch', userId: 'u', branchId: 'b' } as never;

let ids = 0;
const row = (
  consumableId: Types.ObjectId,
  day: number,
  counterReading: number,
  over: Record<string, unknown> = {},
) => {
  ids += 1;
  return {
    // Increasing ids, so a tie at one `at` is ordered as written.
    _id: new Types.ObjectId(`65a${String(ids).padStart(21, '0')}`),
    consumableId,
    assetId: PRINTER,
    at: new Date(Date.UTC(2026, 10, day, 9)),
    memoId: new Types.ObjectId(),
    counterReading,
    ...over,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  ids = 0;
  mocks.items.mockResolvedValue([
    { _id: BLACK, code: 'CON-00001', name: 'حبر HP 85A' },
    { _id: BLACK_TWIN, code: 'CON-00090', name: 'حبر HP 85A' },
    { _id: CYAN, code: 'CON-00002', name: 'حبر سماوي' },
  ]);
  mocks.assets.mockResolvedValue([{ _id: PRINTER, assetCode: 'AST-00050', name: 'HP M404' }]);
});

describe('a printer’s readings', () => {
  it('newest first, each with the same item’s cartridge it replaced — by name, across stores', async () => {
    const first = row(BLACK, 1, 1000);
    const cyan = row(CYAN, 2, 1500);
    const twin = row(BLACK_TWIN, 3, 4000);
    mocks.timeline.mockResolvedValue([first, cyan, twin]);

    const answer = await itConsumableCounterService.printer({ _id: PRINTER });

    expect(mocks.timeline).toHaveBeenCalledWith([PRINTER]);
    expect(answer.assetId).toBe(String(PRINTER));
    expect(answer.readings.map((r) => r.movementId)).toEqual([
      String(twin._id),
      String(cyan._id),
      String(first._id),
    ]);
    // The other store's twin replaced the first black: 4000 − 1000.
    expect(answer.readings[0]).toEqual({
      movementId: String(twin._id),
      at: twin.at.toISOString(),
      reading: 4000,
      reset: false,
      consumableId: String(BLACK_TWIN),
      consumableCode: 'CON-00090',
      consumableName: 'حبر HP 85A',
      replaced: {
        movementId: String(first._id),
        at: first.at.toISOString(),
        reading: 1000,
        pages: 3000,
      },
    });
    // The cyan is that colour's first on the printer.
    expect(answer.readings[1]?.replaced).toBeNull();
  });

  it('the latest is the newest reading with the toner it was taken with, and no pairing', async () => {
    const reset = row(CYAN, 5, 20, { counterReset: true });
    mocks.timeline.mockResolvedValue([row(BLACK, 1, 1000), reset]);
    const { latest } = await itConsumableCounterService.printer({ _id: PRINTER });
    expect(latest).toEqual({
      movementId: String(reset._id),
      at: reset.at.toISOString(),
      reading: 20,
      reset: true,
      consumableId: String(CYAN),
      consumableCode: 'CON-00002',
      consumableName: 'حبر سماوي',
    });
  });

  it('a printer with no reading answers none', async () => {
    mocks.timeline.mockResolvedValue([]);
    expect(await itConsumableCounterService.printer({ _id: PRINTER })).toEqual({
      assetId: String(PRINTER),
      latest: null,
      readings: [],
    });
  });

  it('an item that cannot be read pairs by its id alone, and names nothing', async () => {
    const ghost = new Types.ObjectId();
    mocks.timeline.mockResolvedValue([row(ghost, 1, 10), row(ghost, 2, 30)]);
    const { readings } = await itConsumableCounterService.printer({ _id: PRINTER });
    expect(readings[0]).toMatchObject({
      consumableCode: null,
      consumableName: null,
      replaced: { pages: 20 },
    });
  });
});

describe('an item’s cartridges', () => {
  const item = { _id: BLACK } as never;

  it('each cartridge with its successor of the same name (any store), what it printed, and the average', async () => {
    const first = row(BLACK, 1, 1000);
    const second = row(BLACK, 3, 4000);
    const third = row(BLACK, 6, 6500);
    const twin = row(BLACK_TWIN, 8, 9500);
    mocks.rowsOfItem.mockResolvedValue([first, second, third]);
    mocks.timeline.mockResolvedValue([first, row(CYAN, 2, 2000), second, third, twin]);

    const answer = await itConsumableCounterService.cartridges(item, scope);

    expect(mocks.rowsOfItem).toHaveBeenCalledWith(BLACK);
    expect(mocks.timeline).toHaveBeenCalledWith([PRINTER]);
    // The printers named under the caller's scope, as the ledger names them.
    expect(mocks.assets).toHaveBeenCalledWith([String(PRINTER)], scope);
    expect(answer.consumableId).toBe(String(BLACK));
    expect(answer.cartridges.map((c) => [c.installReading, c.removedReading, c.pages])).toEqual([
      [6500, 9500, 3000],
      [4000, 6500, 2500],
      [1000, 4000, 3000],
    ]);
    expect(answer.cartridges[0]).toMatchObject({
      movementId: String(third._id),
      assetId: String(PRINTER),
      assetCode: 'AST-00050',
      assetName: 'HP M404',
      removedAt: twin.at.toISOString(),
    });
    expect(answer).toMatchObject({ averagePages: 2833, counted: 3 });
  });

  it('the latest of its item on a printer is not replaced yet: no end, no pages', async () => {
    const only = row(BLACK, 1, 1000);
    mocks.rowsOfItem.mockResolvedValue([only]);
    mocks.timeline.mockResolvedValue([only]);
    const answer = await itConsumableCounterService.cartridges(item, scope);
    expect(answer.cartridges[0]).toMatchObject({
      removedAt: null,
      removedReading: null,
      pages: null,
    });
    expect(answer).toMatchObject({ averagePages: null, counted: 0 });
  });

  it('a reset between a cartridge and its successor makes its pages unknown — kept out of the average', async () => {
    const first = row(BLACK, 1, 9000);
    const second = row(BLACK, 3, 200, { counterReset: true });
    mocks.rowsOfItem.mockResolvedValue([first, second]);
    mocks.timeline.mockResolvedValue([first, second]);
    const answer = await itConsumableCounterService.cartridges(item, scope);
    expect(answer.cartridges[1]).toMatchObject({ removedReading: 200, pages: null });
    expect(answer).toMatchObject({ averagePages: null, counted: 0 });
  });

  it('pairs on each printer apart', async () => {
    const onFirst = row(BLACK, 1, 1000);
    const onOther = row(BLACK, 2, 50000, { assetId: OTHER_PRINTER });
    const nextOnFirst = row(BLACK, 3, 1800);
    mocks.rowsOfItem.mockResolvedValue([onFirst, onOther, nextOnFirst]);
    mocks.timeline.mockResolvedValue([onFirst, onOther, nextOnFirst]);
    const answer = await itConsumableCounterService.cartridges(item, scope);
    const byId = new Map(answer.cartridges.map((c) => [c.movementId, c]));
    expect(byId.get(String(onFirst._id))?.pages).toBe(800);
    expect(byId.get(String(onOther._id))?.pages).toBeNull();
  });

  it('an item never counted answers no cartridge, and asks no printer', async () => {
    mocks.rowsOfItem.mockResolvedValue([]);
    mocks.timeline.mockResolvedValue([]);
    expect(await itConsumableCounterService.cartridges(item, scope)).toEqual({
      consumableId: String(BLACK),
      averagePages: null,
      counted: 0,
      cartridges: [],
    });
    expect(mocks.assets).not.toHaveBeenCalled();
  });
});

describe('what the writers share', () => {
  it('locks each printer once, in the transaction, before reading them all in it', async () => {
    const session = { transaction: 'the issue' } as never;
    const a = String(PRINTER);
    const b = String(OTHER_PRINTER);
    mocks.timeline.mockResolvedValue([
      row(BLACK, 1, 10),
      row(BLACK, 2, 20, { assetId: OTHER_PRINTER }),
    ]);
    const timelines = await lockAndReadTimelines([b, a, b], session);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.reserve).toHaveBeenCalledWith(`printerCounter:${a}`, 1, session);
    expect(mocks.reserve).toHaveBeenCalledWith(`printerCounter:${b}`, 1, session);
    expect(mocks.timeline).toHaveBeenCalledWith(
      expect.arrayContaining([PRINTER, OTHER_PRINTER]),
      session,
    );
    expect(timelines.get(a)?.map((r) => r.reading)).toEqual([10]);
    expect(timelines.get(b)?.map((r) => r.reading)).toEqual([20]);
  });

  it('a refusal carries the figure it is held against, on the field it was typed in', () => {
    const previous = {
      id: 'x',
      at: new Date('2026-11-01T09:00:00.000Z'),
      reading: 15000,
      reset: false,
      memoId: null,
    };
    const error = counterRefused(
      { ok: false, kind: 'belowPrevious', previous },
      { field: 'lines.2.counterReading', reading: 14000, assetCode: 'AST-00050' },
    );
    expect(error).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS',
      httpStatus: 422,
      details: [
        { field: 'lines.2.counterReading', code: 'PREVIOUS_READING', message: '15000' },
        {
          field: 'lines.2.counterReading',
          code: 'PREVIOUS_AT',
          message: '2026-11-01T09:00:00.000Z',
        },
      ],
    });
    expect(
      counterRefused(
        { ok: false, kind: 'aboveNext', next: previous },
        { field: 'counterReading', reading: 16000, assetCode: 'AST-00050' },
      ),
    ).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_ABOVE_NEXT',
      details: [
        { field: 'counterReading', code: 'NEXT_READING', message: '15000' },
        { field: 'counterReading', code: 'NEXT_AT', message: '2026-11-01T09:00:00.000Z' },
      ],
    });
  });

  it('a missing reading is one refusal of every gap, the first one its message', () => {
    const error = counterRequired([
      { field: 'lines.0.assetId', code: 'REQUIRED', message: 'name the printer' },
      { field: 'lines.0.qty', code: 'ONE_CARTRIDGE', message: 'one cartridge' },
    ]);
    expect(error).toMatchObject({
      code: 'IT_CONSUMABLE_COUNTER_REQUIRED',
      httpStatus: 422,
      message: 'name the printer',
      details: [
        { field: 'lines.0.assetId', code: 'REQUIRED', message: 'name the printer' },
        { field: 'lines.0.qty', code: 'ONE_CARTRIDGE', message: 'one cartridge' },
      ],
    });
  });
});
