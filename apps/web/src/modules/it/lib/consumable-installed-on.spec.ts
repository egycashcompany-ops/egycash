// «تعديل الجهاز» (2026-11-17) — the rules of the ledger's device change, without a browser: who is
// offered it, what the choice is, what is sent (only a change, with the row's version), whose device
// a «جهاز آخر» pick is, and how a refusal reads. The dialog that wires them is proven in
// `components/installed-on-dialog.spec.tsx`.
import { describe, expect, it } from 'vitest';
import {
  IT_CONSUMABLE_MOVEMENT_KINDS,
  type ItAssetDto,
  type ItConsumableMovementDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
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
  mayChangeDevices,
  mayChangeInstalledOn,
  pickedHeldByOther,
  recipientKey,
  type InstalledOnState,
} from './consumable-installed-on';
import { departmentHolder } from '../custody-holder-fixtures';

const WALEED = '64b000000000000000000001';
const HANY = '64b000000000000000000003';

const grants =
  (...held: string[]) =>
  (permission: string): boolean =>
    held.includes(permission);

const row = (
  over: Partial<ItConsumableMovementDto> = {},
): Pick<
  ItConsumableMovementDto,
  'kind' | 'assetId' | 'version' | 'employeeId' | 'counterReading' | 'counterReset'
> => ({
  kind: 'issued',
  assetId: 'a-1',
  version: 3,
  employeeId: WALEED,
  counterReading: null,
  counterReset: false,
  ...over,
});

const device = (id: string, holder: string | null): ItAssetDto =>
  ({
    id,
    assetCode: `AST-${id}`,
    name: 'HP LaserJet Pro M404',
    status: holder === null ? 'inStock' : 'assigned',
    serialNumber: 'PHBQ7K21',
    holder:
      holder === null
        ? null
        : {
            employeeId: holder,
            employeeCode: '0100091',
            employeeName: 'هاني رأفت سليم',
            assignedAt: '2026-09-01T08:00:00.000Z',
          },
  }) as ItAssetDto;

const state = (over: Partial<InstalledOnState> = {}): InstalledOnState => ({
  ...installedOnStart(),
  ...over,
});

describe('who is offered «تعديل الجهاز»', () => {
  it('a reader holding the issue’s grant AND the register of devices — and nobody else', () => {
    expect(mayChangeDevices(grants('itConsumable.assign', 'itAsset.view'))).toBe(true);
    expect(mayChangeDevices(grants('itConsumable.assign'))).toBe(false);
    expect(mayChangeDevices(grants('itAsset.view', 'itConsumable.view'))).toBe(false);
    expect(mayChangeDevices(grants())).toBe(false);
  });

  it('on an issued row only: no other kind sits in a device', () => {
    const both = grants('itConsumable.assign', 'itAsset.view');
    for (const kind of IT_CONSUMABLE_MOVEMENT_KINDS) {
      expect(mayChangeInstalledOn({ kind }, both), kind).toBe(kind === 'issued');
    }
    expect(mayChangeInstalledOn({ kind: 'issued' }, grants('itConsumable.assign'))).toBe(false);
  });
});

describe('the choice', () => {
  it('opens with nothing chosen and nothing refused', () => {
    expect(installedOnStart()).toEqual({
      assetId: '',
      asset: null,
      none: false,
      counterReading: '',
      counterReset: false,
      failure: null,
      refusedVersion: null,
    });
    expect(installedOnTarget(installedOnStart())).toBeUndefined();
  });

  it('a device picked is chosen, «بدون جهاز» goes, and an old refusal with it', () => {
    const printer = device('a-5', HANY);
    const next = installedOnReducer(state({ none: true, failure: { kind: 'conflict' } }), {
      type: 'device',
      assetId: 'a-5',
      asset: printer,
    });
    expect(next).toEqual({
      assetId: 'a-5',
      asset: printer,
      none: false,
      counterReading: '',
      counterReset: false,
      failure: null,
      refusedVersion: null,
    });
    expect(installedOnTarget(next)).toBe('a-5');
  });

  it('«بدون جهاز» empties the box; unticked, the box is empty and nothing is chosen', () => {
    const ticked = installedOnReducer(state({ assetId: 'a-5', asset: device('a-5', HANY) }), {
      type: 'none',
      none: true,
    });
    expect(ticked).toEqual({
      assetId: '',
      asset: null,
      none: true,
      counterReading: '',
      counterReset: false,
      failure: null,
      refusedVersion: null,
    });
    expect(installedOnTarget(ticked)).toBeNull();
    const unticked = installedOnReducer(ticked, { type: 'none', none: false });
    expect(unticked.none).toBe(false);
    expect(installedOnTarget(unticked)).toBeUndefined();
  });

  it('clearing the box’s chip leaves «بدون جهاز» as it was', () => {
    const cleared = installedOnReducer(state({ assetId: 'a-5', asset: device('a-5', HANY) }), {
      type: 'device',
      assetId: '',
      asset: null,
    });
    expect(cleared).toEqual(installedOnStart());
  });

  it('a refusal is kept until the choice changes; reopening forgets everything', () => {
    const failed = installedOnReducer(state({ assetId: 'a-5' }), {
      type: 'failed',
      failure: { kind: 'conflict' },
      version: 3,
    });
    expect(failed).toEqual(
      state({ assetId: 'a-5', failure: { kind: 'conflict' }, refusedVersion: 3 }),
    );
    expect(installedOnReducer(failed, { type: 'reset' })).toEqual(installedOnStart());
  });

  it('the version a 409 refused outlives a change of choice — the words go, the stale row stays', () => {
    const failed = installedOnReducer(state({ assetId: 'a-5' }), {
      type: 'failed',
      failure: { kind: 'conflict' },
      version: 3,
    });
    const picked = installedOnReducer(failed, { type: 'device', assetId: 'a-6', asset: null });
    const ticked = installedOnReducer(picked, { type: 'none', none: true });
    const unticked = installedOnReducer(ticked, { type: 'none', none: false });
    for (const after of [picked, ticked, unticked]) {
      expect(after.failure).toBeNull();
      expect(after.refusedVersion).toBe(3);
      // The row still at the refused version: no save is offered. Re-read at 4: it is again.
      expect(installedOnStale(row(), after)).toBe(true);
      expect(installedOnStale(row({ version: 4 }), after)).toBe(false);
    }
  });

  it('any other refusal is no proof the version is stale', () => {
    const refused = installedOnReducer(state({ assetId: 'a-5' }), {
      type: 'failed',
      failure: { kind: 'refused', message: 'لا' },
      version: 3,
    });
    expect(refused.refusedVersion).toBeNull();
    expect(installedOnStale(row(), refused)).toBe(false);
    expect(installedOnStale(row(), installedOnStart())).toBe(false);
  });
});

describe('what is sent — only a change, with the row’s version', () => {
  it('nothing chosen sends nothing', () => {
    expect(installedOnRequest(row(), state())).toBeNull();
  });

  it('another device: its id and the version the row was read at', () => {
    expect(installedOnRequest(row(), state({ assetId: 'a-5' }))).toEqual({
      assetId: 'a-5',
      version: 3,
    });
    // A row with no device yet takes one the same way.
    expect(
      installedOnRequest(row({ assetId: null, version: 0 }), state({ assetId: 'a-5' })),
    ).toEqual({ assetId: 'a-5', version: 0 });
  });

  it('«بدون جهاز» on a row with a device: null, which the server reads as none', () => {
    expect(installedOnRequest(row(), state({ none: true }))).toEqual({ assetId: null, version: 3 });
  });

  it('the device the row already names is not a change — in either form', () => {
    expect(installedOnRequest(row(), state({ assetId: 'a-1' }))).toBeNull();
    expect(installedOnUnchanged(row(), state({ assetId: 'a-1' }))).toBe(true);
    expect(installedOnRequest(row({ assetId: null }), state({ none: true }))).toBeNull();
    expect(installedOnUnchanged(row({ assetId: null }), state({ none: true }))).toBe(true);
    expect(installedOnUnchanged(row(), state({ assetId: 'a-5' }))).toBe(false);
    // Nothing chosen is not «the same device» either: the box is simply empty.
    expect(installedOnUnchanged(row(), state())).toBe(false);
  });
});

describe('a «جهاز آخر» pick says whose it is', () => {
  it('a device somebody other than the recipient holds — and only that', () => {
    const printer = device('a-5', HANY);
    expect(pickedHeldByOther(row(), state({ assetId: 'a-5', asset: printer }))).toEqual(
      printer.holder,
    );
    expect(
      pickedHeldByOther(row(), state({ assetId: 'a-2', asset: device('a-2', WALEED) })),
    ).toBeNull();
    expect(
      pickedHeldByOther(row(), state({ assetId: 'a-4', asset: device('a-4', null) })),
    ).toBeNull();
    expect(pickedHeldByOther(row(), state())).toBeNull();
  });

  // 2026-11-19 — an issue to a department: its own devices are those it holds at its place.
  it('an issue to a department: its device at its place is its own; another place’s is not', () => {
    const issued = {
      ...row({ employeeId: null }),
      departmentId: 'd-it',
      locationId: 'l-servers',
    };
    const at = (id: string, locationId: string) =>
      ({
        id,
        status: 'assigned',
        holder: departmentHolder({ departmentId: 'd-it', locationId }),
      }) as ItAssetDto;
    expect(recipientKey(issued)).toBe('d-it@l-servers');
    expect(
      pickedHeldByOther(issued, state({ assetId: 'a-7', asset: at('a-7', 'l-servers') })),
    ).toBeNull();
    expect(
      pickedHeldByOther(issued, state({ assetId: 'a-8', asset: at('a-8', 'l-cctv') }))?.locationId,
    ).toBe('l-cctv');
    // A person's device is somebody else's to the department.
    expect(
      pickedHeldByOther(issued, state({ assetId: 'a-2', asset: device('a-2', WALEED) })),
    ).not.toBeNull();
    // And to a person, the department's device is somebody else's.
    expect(
      pickedHeldByOther(row(), state({ assetId: 'a-7', asset: at('a-7', 'l-servers') })),
    ).not.toBeNull();
  });
});

describe('a refusal, read', () => {
  it('409: somebody changed the row first', () => {
    const stale = new ApiError('STALE_DOCUMENT', 'changed', 409);
    expect(installedOnFailure(stale, 'ar')).toEqual({ kind: 'conflict' });
  });

  it('anything else: the platform’s own words for the server’s answer', () => {
    const disposed = new ApiError('BUSINESS_RULE', 'asset AST-00006 is disposed', 422);
    expect(installedOnFailure(disposed, 'ar')).toEqual({
      kind: 'refused',
      message: 'هذا الإجراء غير مسموح حاليًا.',
    });
    expect(installedOnFailure(new Error('offline'), 'en')).toEqual({
      kind: 'refused',
      message: 'offline',
    });
  });
});

describe('a toner issued with the printer’s counter («عداد الطابعة», 2026-11-19)', () => {
  const toner = row({ counterReading: 12_400, counterReset: false });

  it('is counted by its ROW — a reading on it — never by its type as the type stands now', () => {
    expect(installedOnCounted(toner)).toBe(true);
    expect(installedOnCounted(row())).toBe(false);
  });

  it('another device takes a new reading: nothing is sent without one', () => {
    expect(installedOnRequest(toner, state({ assetId: 'a-5' }))).toBeNull();
    expect(installedOnRequest(toner, state({ assetId: 'a-5', counterReading: '3200' }))).toEqual({
      assetId: 'a-5',
      counterReading: 3200,
      version: 3,
    });
    expect(
      installedOnRequest(toner, state({ assetId: 'a-5', counterReading: '0', counterReset: true })),
    ).toEqual({ assetId: 'a-5', counterReading: 0, counterReset: true, version: 3 });
  });

  it('a reading typed with no device picked corrects it on the device the row names', () => {
    expect(installedOnTarget(state({ counterReading: '12500' }), toner)).toBe('a-1');
    expect(installedOnRequest(toner, state({ counterReading: '12500' }))).toEqual({
      assetId: 'a-1',
      counterReading: 12_500,
      version: 3,
    });
    // The same device and the same reading: nothing to save, whichever way it was chosen.
    expect(installedOnUnchanged(toner, state({ assetId: 'a-1', counterReading: '12400' }))).toBe(
      true,
    );
    expect(installedOnUnchanged(toner, state({ assetId: 'a-1' }))).toBe(true);
    expect(installedOnRequest(toner, state({ counterReading: '12400' }))).toBeNull();
    // Ticking the reset on the same reading is a change.
    expect(
      installedOnRequest(toner, state({ counterReading: '12400', counterReset: true })),
    ).toEqual({ assetId: 'a-1', counterReading: 12_400, counterReset: true, version: 3 });
    // A row recorded without a reading: a reading typed names no device.
    expect(installedOnTarget(state({ counterReading: '12500' }), row())).toBeUndefined();
  });

  it('«بدون جهاز» takes the reading off with the device', () => {
    const ticked = installedOnReducer(
      state({ assetId: 'a-5', counterReading: '3200', counterReset: true }),
      { type: 'none', none: true },
    );
    expect(ticked).toEqual(state({ none: true }));
    expect(installedOnRequest(toner, ticked)).toEqual({ assetId: null, version: 3 });
  });

  it('a reading belongs to the device it was typed for: another device starts the box again', () => {
    const typed = installedOnReducer(state({ assetId: 'a-5', failure: { kind: 'conflict' } }), {
      type: 'counter',
      counterReading: '3200',
      counterReset: true,
    });
    expect(typed).toEqual(state({ assetId: 'a-5', counterReading: '3200', counterReset: true }));
    const moved = installedOnReducer(typed, { type: 'device', assetId: 'a-6', asset: null });
    expect([moved.counterReading, moved.counterReset]).toEqual(['', false]);
    const same = installedOnReducer(typed, { type: 'device', assetId: 'a-5', asset: null });
    expect([same.counterReading, same.counterReset]).toEqual(['3200', true]);
  });

  it('a row recorded without a reading sends none, whatever was typed', () => {
    expect(installedOnRequest(row(), state({ assetId: 'a-5', counterReading: '3200' }))).toEqual({
      assetId: 'a-5',
      version: 3,
    });
  });

  it('a reading that is no whole number in range is said on its box; an empty box is not', () => {
    for (const typed of ['12.5', '-3', '1000000000', 'abc']) {
      expect(
        installedOnReadingProblem(toner, state({ assetId: 'a-5', counterReading: typed })),
        typed,
      ).toEqual({ kind: 'readingInvalid' });
      expect(
        installedOnRequest(toner, state({ assetId: 'a-5', counterReading: typed })),
      ).toBeNull();
    }
    expect(installedOnReadingProblem(toner, state({ assetId: 'a-5' }))).toBeNull();
    expect(installedOnReadingProblem(row(), state({ counterReading: 'abc' }))).toBeNull();
  });

  it('the printer’s refusal is said on the reading’s box, with the reading it was held against', () => {
    const below = new ApiError('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS', 'not above', 422, [
      { field: 'counterReading', code: 'PREVIOUS_READING', message: '12400' },
      { field: 'counterReading', code: 'PREVIOUS_AT', message: '2026-11-01T09:00:00.000Z' },
    ]);
    expect(installedOnFailure(below, 'ar')).toEqual({
      kind: 'counter',
      problem: { kind: 'belowPrevious', reading: 12_400, at: '2026-11-01T09:00:00.000Z' },
    });
    const required = new ApiError('IT_CONSUMABLE_COUNTER_REQUIRED', 'required', 422, [
      { field: 'counterReading', code: 'REQUIRED', message: 'a toner moves with a reading' },
    ]);
    expect(installedOnFailure(required, 'ar')).toEqual({
      kind: 'counter',
      problem: { kind: 'readingRequired' },
    });
    // A refusal that is not the counter's keeps the platform's own words.
    const removal = new ApiError('BUSINESS_RULE', 'this reading starts the counter again', 422);
    expect(installedOnFailure(removal, 'ar').kind).toBe('refused');
  });
});
