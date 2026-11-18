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
  installedOnFailure,
  installedOnReducer,
  installedOnRequest,
  installedOnStale,
  installedOnStart,
  installedOnTarget,
  installedOnUnchanged,
  mayChangeDevices,
  mayChangeInstalledOn,
  pickedHeldByOther,
  type InstalledOnState,
} from './consumable-installed-on';

const WALEED = '64b000000000000000000001';
const HANY = '64b000000000000000000003';

const grants =
  (...held: string[]) =>
  (permission: string): boolean =>
    held.includes(permission);

const row = (
  over: Partial<ItConsumableMovementDto> = {},
): Pick<ItConsumableMovementDto, 'kind' | 'assetId' | 'version' | 'employeeId'> => ({
  kind: 'issued',
  assetId: 'a-1',
  version: 3,
  employeeId: WALEED,
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
