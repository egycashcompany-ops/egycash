// The vehicle check's draft (docs/12-planning/it-vehicle-checks-design.md §2 item 8, §6.3): write,
// read, clear, the key — and every rule that drops a field rather than restoring something the
// server would refuse.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IT_VEHICLE_CHECK_NOTES_MAX } from '@ecms/contracts';
import { type VehicleCheckFormState } from '../lib/vehicle-check-form';
import {
  VEHICLE_CHECK_DRAFT_KEY,
  clearVehicleCheckDraft,
  draftWorthKeeping,
  readVehicleCheckDraft,
  reconcileDraftCar,
  writeVehicleCheckDraft,
} from './vehicle-check-draft';

/** The web suite runs in node, so `sessionStorage` is stood up here rather than assumed. */
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
vi.stubGlobal('window', { sessionStorage: storage });

const TODAY = '2026-11-08';
const CAR = '65a000000000000000000001';
const ID = '3f0c6a52-6a4e-4b8e-9d7a-1f2b3c4d5e6f';
const NEW_ID = '9b2d7c1e-5a3f-4e8b-a6c0-0d1e2f3a4b5c';
const read = (): ReturnType<typeof readVehicleCheckDraft> =>
  readVehicleCheckDraft({ today: TODAY, newId: () => NEW_ID });

const filled: VehicleCheckFormState = {
  vehicleId: CAR,
  checkDate: '2026-11-07',
  items: { screen: 'works', camera8: 'notWorking' },
  notes: 'الكاميرا 8 لا تعرض صورة.',
  clientRequestId: ID,
};

/** Put a raw value under the key, as an older build or a hand edit might have. */
const plant = (value: unknown): void => {
  store.set(VEHICLE_CHECK_DRAFT_KEY, JSON.stringify(value));
};

beforeEach(() => store.clear());

describe('a draft comes back after the tab is unloaded', () => {
  it('lives under its own versioned key', () => {
    expect(VEHICLE_CHECK_DRAFT_KEY).toBe('ecms.it.vehicleCheck.draft.v1');
  });

  it('restores the car, the day, the answers, the note and the request id', () => {
    writeVehicleCheckDraft(filled, 'كورولا 1');
    expect(read()).toEqual({ v: 1, ...filled, vehicleCode: 'كورولا 1' });
  });

  it('keeps no photo', () => {
    writeVehicleCheckDraft(filled, '150');
    expect(Object.keys(JSON.parse(store.get(VEHICLE_CHECK_DRAFT_KEY) ?? '{}') as object)).toEqual([
      'v',
      'vehicleId',
      'vehicleCode',
      'checkDate',
      'items',
      'notes',
      'clientRequestId',
    ]);
  });

  it('is gone once cleared', () => {
    writeVehicleCheckDraft(filled, '150');
    clearVehicleCheckDraft();
    expect(store.has(VEHICLE_CHECK_DRAFT_KEY)).toBe(false);
    expect(read()).toBeNull();
  });

  it('is nothing when nothing was written', () => {
    expect(read()).toBeNull();
  });
});

describe('what is dropped rather than restored', () => {
  it('the whole draft, when it is not JSON', () => {
    store.set(VEHICLE_CHECK_DRAFT_KEY, '{not json');
    expect(read()).toBeNull();
  });

  it('the whole draft, when it is not an object, or its `v` is not 1', () => {
    plant([filled]);
    expect(read()).toBeNull();
    plant('text');
    expect(read()).toBeNull();
    plant({ ...filled, v: 2 });
    expect(read()).toBeNull();
    plant({ ...filled });
    expect(read(), 'no `v` at all').toBeNull();
  });

  it('an item outside the eleven, or an answer outside the two — unanswered', () => {
    plant({
      v: 1,
      ...filled,
      items: { screen: 'works', camera9: 'works', dvr: 'broken', radio: null, camera1: 1 },
    });
    expect(read()?.items).toEqual({ screen: 'works' });
    plant({ v: 1, ...filled, items: ['works'] });
    expect(read()?.items).toEqual({});
  });

  it('a day that is not a calendar day — today', () => {
    plant({ v: 1, ...filled, checkDate: '2026-02-30' });
    expect(read()?.checkDate).toBe(TODAY);
    plant({ v: 1, ...filled, checkDate: 'yesterday' });
    expect(read()?.checkDate).toBe(TODAY);
    plant({ v: 1, ...filled, checkDate: 20261107 });
    expect(read()?.checkDate).toBe(TODAY);
  });

  it('a day after today — today; an earlier day is kept', () => {
    plant({ v: 1, ...filled, checkDate: '2026-11-09' });
    expect(read()?.checkDate).toBe(TODAY);
    plant({ v: 1, ...filled, checkDate: '2026-10-01' });
    expect(read()?.checkDate).toBe('2026-10-01');
  });

  it('a note over 1000 characters — cut to 1000; a note that is not text — none', () => {
    plant({ v: 1, ...filled, notes: 'م'.repeat(1500) });
    expect(read()?.notes).toHaveLength(IT_VEHICLE_CHECK_NOTES_MAX);
    plant({ v: 1, ...filled, notes: { text: 'x' } });
    expect(read()?.notes).toBe('');
  });

  it('a request id that is not a UUID — a new one', () => {
    plant({ v: 1, ...filled, clientRequestId: 'abc' });
    expect(read()?.clientRequestId).toBe(NEW_ID);
    plant({ v: 1, ...filled, clientRequestId: undefined });
    expect(read()?.clientRequestId).toBe(NEW_ID);
  });

  it('a car id that is not an id — no car, and no code with it', () => {
    plant({ v: 1, ...filled, vehicleId: 'undefined', vehicleCode: '150' });
    expect(read()).toMatchObject({ vehicleId: '', vehicleCode: '' });
  });

  it('never throws when storage itself does', () => {
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
      },
    });
    try {
      expect(read()).toBeNull();
    } finally {
      vi.stubGlobal('window', { sessionStorage: storage });
    }
  });
});

describe('a restored car the active list no longer carries', () => {
  const state = { ...filled };

  it('is cleared, and the report gets a new request id', () => {
    expect(reconcileDraftCar(state, new Set(['65a000000000000000000002']), () => NEW_ID)).toEqual({
      ...state,
      vehicleId: '',
      clientRequestId: NEW_ID,
    });
  });

  it('is kept, with its request id, while it is on the list', () => {
    expect(reconcileDraftCar(state, new Set([CAR]), () => NEW_ID)).toBe(state);
  });

  it('changes nothing on a form with no car', () => {
    const none = { ...state, vehicleId: '' };
    expect(reconcileDraftCar(none, new Set(), () => NEW_ID)).toBe(none);
  });
});

describe('draftWorthKeeping', () => {
  const blank: VehicleCheckFormState = {
    vehicleId: '',
    checkDate: TODAY,
    items: {},
    notes: '',
    clientRequestId: ID,
  };

  it('writes nothing for the form the page opens on anyway', () => {
    expect(draftWorthKeeping(blank, TODAY)).toBe(false);
  });

  it('writes a form with a car, an answer, a note or another day', () => {
    expect(draftWorthKeeping({ ...blank, vehicleId: CAR }, TODAY)).toBe(true);
    expect(draftWorthKeeping({ ...blank, items: { dvr: 'works' } }, TODAY)).toBe(true);
    expect(draftWorthKeeping({ ...blank, notes: 'x' }, TODAY)).toBe(true);
    expect(draftWorthKeeping({ ...blank, checkDate: '2026-11-07' }, TODAY)).toBe(true);
  });
});
