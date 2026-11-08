// The vehicle check's form rules (docs/12-planning/it-vehicle-checks-design.md §2, §6.3): the
// counts, the payload, a second tap clearing an answer, the default day, the two required fields,
// and the outcome table — what each refused send does to the form and to its request id.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateItVehicleCheckSchema, IT_VEHICLE_CHECK_ITEMS } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  VEHICLE_CHECK_TOTAL,
  answerTapped,
  applySendFailure,
  checkCounts,
  dayShown,
  defaultCheckDate,
  emptyVehicleCheck,
  isClientId,
  newClientId,
  vehicleCheckPayload,
  vehicleCheckRequired,
  vehicleCheckSendFailure,
  type VehicleCheckFormState,
} from './vehicle-check-form';

const CAR = '65a000000000000000000001';
const ID = '3f0c6a52-6a4e-4b8e-9d7a-1f2b3c4d5e6f';

const form = (over: Partial<VehicleCheckFormState> = {}): VehicleCheckFormState => ({
  vehicleId: CAR,
  checkDate: '2026-11-08',
  items: {},
  notes: '',
  clientRequestId: ID,
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the eleven devices', () => {
  it('counts eleven, in the owner’s order', () => {
    expect(VEHICLE_CHECK_TOTAL).toBe(11);
    expect(IT_VEHICLE_CHECK_ITEMS[0]).toBe('screen');
    expect(IT_VEHICLE_CHECK_ITEMS.at(-1)).toBe('radio');
  });
});

describe('answerTapped — a tap on «يعمل» or «لا يعمل»', () => {
  it('chooses the answer tapped', () => {
    expect(answerTapped({}, 'screen', 'works')).toEqual({ screen: 'works' });
  });

  it('moves to the other answer', () => {
    expect(answerTapped({ screen: 'works' }, 'screen', 'notWorking')).toEqual({
      screen: 'notWorking',
    });
  });

  it('clears the answer when the chosen one is tapped again', () => {
    const cleared = answerTapped({ screen: 'works', dvr: 'notWorking' }, 'screen', 'works');
    expect(cleared).toEqual({ dvr: 'notWorking' });
    expect('screen' in cleared, 'unanswered, not a stored null').toBe(false);
  });

  it('leaves the other devices alone', () => {
    expect(answerTapped({ camera1: 'works' }, 'camera8', 'notWorking')).toEqual({
      camera1: 'works',
      camera8: 'notWorking',
    });
  });
});

describe('checkCounts — the bar and the sent view', () => {
  it('counts nothing on an empty form', () => {
    expect(checkCounts({})).toEqual({ total: 11, done: 0, works: 0, notWorking: 0, unanswered: 11 });
  });

  it('counts each answer, and the unanswered rest', () => {
    expect(
      checkCounts({ screen: 'works', camera1: 'works', camera8: 'notWorking', radio: 'notWorking' }),
    ).toEqual({ total: 11, done: 4, works: 2, notWorking: 2, unanswered: 7 });
  });
});

describe('vehicleCheckPayload — what is sent', () => {
  it('names every device, an unanswered one as null', () => {
    const payload = vehicleCheckPayload(form({ items: { screen: 'works', dvr: 'notWorking' } }));
    expect(Object.keys(payload.items)).toEqual([...IT_VEHICLE_CHECK_ITEMS]);
    expect(payload.items.screen).toBe('works');
    expect(payload.items.dvr).toBe('notWorking');
    expect(payload.items.camera3).toBeNull();
  });

  it('trims the note, and leaves out a note of spaces', () => {
    expect(vehicleCheckPayload(form({ notes: '  الكاميرا 8 لا تعرض صورة.  ' })).notes).toBe(
      'الكاميرا 8 لا تعرض صورة.',
    );
    expect('notes' in vehicleCheckPayload(form({ notes: '   ' }))).toBe(false);
  });

  it('carries the car, the day and the request id as they are', () => {
    const payload = vehicleCheckPayload(form());
    expect(payload.vehicleId).toBe(CAR);
    expect(payload.checkDate).toBe('2026-11-08');
    expect(payload.clientRequestId).toBe(ID);
  });

  it('is a body the contract takes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T10:00:00Z'));
    const parsed = CreateItVehicleCheckSchema.safeParse(
      vehicleCheckPayload(form({ items: { camera5: 'works' }, notes: 'ملاحظة' })),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('the default day', () => {
  it('is today in Cairo, not the phone’s UTC day', () => {
    // 00:30 in Cairo on the 8th is still the 7th in UTC.
    expect(defaultCheckDate(new Date('2026-11-07T22:30:00Z'))).toBe('2026-11-08');
    expect(defaultCheckDate(new Date('2026-11-08T21:59:00Z'))).toBe('2026-11-08');
  });

  it('is what an empty form opens on, with a fresh request id', () => {
    const empty = emptyVehicleCheck('2026-11-08');
    expect(empty).toMatchObject({ vehicleId: '', checkDate: '2026-11-08', items: {}, notes: '' });
    expect(isClientId(empty.clientRequestId)).toBe(true);
  });

  it('reads back day first, as the date box shows it', () => {
    expect(dayShown('2026-11-08')).toBe('08/11/2026');
  });
});

describe('newClientId', () => {
  it('makes a UUID the contract takes, a different one each time', () => {
    const a = newClientId();
    const b = newClientId();
    expect(isClientId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('builds one by hand where `randomUUID` is missing (a page served over plain http)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    try {
      const id = newClientId();
      expect(isClientId(id)).toBe(true);
      expect(id[14], 'version 4').toBe('4');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('vehicleCheckRequired — the car and the day', () => {
  const labels = { vehicle: 'كود السيارة', date: 'التاريخ' };

  it('names the car when none is chosen', () => {
    const missing = vehicleCheckRequired(form({ vehicleId: '' }), labels).filter((f) => !f.ok);
    expect(missing.map((f) => f.label)).toEqual(['كود السيارة']);
  });

  it('names the day when the box was emptied', () => {
    const missing = vehicleCheckRequired(form({ checkDate: '' }), labels).filter((f) => !f.ok);
    expect(missing.map((f) => f.key)).toEqual(['date']);
  });

  it('asks for nothing else — every device, the note and the photos are optional', () => {
    expect(vehicleCheckRequired(form(), labels).every((f) => f.ok)).toBe(true);
    expect(vehicleCheckRequired(form(), labels).map((f) => f.key)).toEqual(['vehicle', 'date']);
  });
});

describe('the outcome table — a send that did not file', () => {
  const api = (status: number, code: string, field?: string): ApiError =>
    new ApiError(
      code,
      code,
      status,
      field === undefined ? undefined : [{ field, code: 'CUSTOM', message: 'x' }],
    );

  it('no answer or a network error: the generic toast, the form kept, the id KEPT', () => {
    const failure = vehicleCheckSendFailure(new TypeError('Failed to fetch'));
    expect(failure).toEqual({
      toast: 'failed',
      clearCar: false,
      refetchCars: false,
      resetDay: false,
      newRequestId: false,
    });
  });

  it('a 5xx: the same — the server may have filed it, so a resend must be the same report', () => {
    expect(vehicleCheckSendFailure(api(503, 'SERVICE_UNAVAILABLE')).newRequestId).toBe(false);
    expect(vehicleCheckSendFailure(api(500, 'INTERNAL')).toast).toBe('failed');
  });

  it('404: the car is gone — cleared, the list asked again, a new id', () => {
    expect(vehicleCheckSendFailure(api(404, 'NOT_FOUND'))).toEqual({
      toast: 'carGone',
      clearCar: true,
      refetchCars: true,
      resetDay: false,
      newRequestId: true,
    });
  });

  it('422 IT_VEHICLE_NOT_ACTIVE: the car is not active — cleared, refetched, a new id', () => {
    expect(vehicleCheckSendFailure(api(422, 'IT_VEHICLE_NOT_ACTIVE'))).toEqual({
      toast: 'carInactive',
      clearCar: true,
      refetchCars: true,
      resetDay: false,
      newRequestId: true,
    });
  });

  it('400 on checkDate: the day back to today, a new id', () => {
    expect(vehicleCheckSendFailure(api(400, 'VALIDATION_FAILED', 'body.checkDate'))).toEqual({
      toast: 'futureDay',
      clearCar: false,
      refetchCars: false,
      resetDay: true,
      newRequestId: true,
    });
  });

  it('409 IT_VEHICLE_CHECK_REQUEST_REUSED: the generic toast, the form kept, a new id', () => {
    expect(vehicleCheckSendFailure(api(409, 'IT_VEHICLE_CHECK_REQUEST_REUSED'))).toEqual({
      toast: 'failed',
      clearCar: false,
      refetchCars: false,
      resetDay: false,
      newRequestId: true,
    });
  });

  it('any other refusal: the generic toast, the form kept, a new id (nothing was filed)', () => {
    const failure = vehicleCheckSendFailure(api(400, 'VALIDATION_FAILED', 'body.notes'));
    expect(failure.toast).toBe('failed');
    expect(failure.resetDay).toBe(false);
    expect(failure.newRequestId).toBe(true);
    expect(vehicleCheckSendFailure(api(403, 'FORBIDDEN')).toast).toBe('failed');
  });

  it('applies a row to the form, never touching the answers or the note', () => {
    const before = form({ items: { screen: 'works' }, notes: 'ملاحظة', checkDate: '2026-11-09' });
    const ids = ['new-1'];
    const newId = (): string => ids.shift() ?? 'none';
    const carGone = applySendFailure(before, vehicleCheckSendFailure(api(404, 'NOT_FOUND')), {
      today: '2026-11-08',
      newId,
    });
    expect(carGone).toEqual({ ...before, vehicleId: '', clientRequestId: 'new-1' });
    const futureDay = applySendFailure(
      before,
      vehicleCheckSendFailure(api(400, 'VALIDATION_FAILED', 'body.checkDate')),
      { today: '2026-11-08', newId: () => 'new-2' },
    );
    expect(futureDay).toEqual({ ...before, checkDate: '2026-11-08', clientRequestId: 'new-2' });
    const lost = applySendFailure(before, vehicleCheckSendFailure(new TypeError('offline')), {
      today: '2026-11-08',
      newId: () => 'never',
    });
    expect(lost).toEqual(before);
  });
});
