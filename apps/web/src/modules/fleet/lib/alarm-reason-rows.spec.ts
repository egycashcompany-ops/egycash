// Which row of the odometer register says why a car has no «فارق عداد الصيانة» — once per car, on
// the row the SERVER names, and nothing before the projection has answered.
import { describe, expect, it } from 'vitest';
import { type FleetMaintenanceAlarmDto, type FleetNoAlarmReason } from '@ecms/contracts';
import { reasonRows } from './alarm-reason-rows';

const CAR = 'v295';

const alarm = (o: Partial<FleetMaintenanceAlarmDto> = {}): FleetMaintenanceAlarmDto => ({
  vehicleId: CAR,
  code: '295',
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  lastServiceAt: null,
  lastServiceVisitId: null,
  noAlarmReason: 'noService',
  daysWithoutReading: 0,
  latestReading: 25_631,
  latestReadingAt: '2026-10-26T00:00:00.000Z',
  latestReadingLogId: 'r26',
  baseline: null,
  newerUncountedVisit: null,
  rule: { vehicleType: null, intervalKm: 0, yellowKm: 1000, redKm: 300 },
  newestReading: null,
  ...o,
});

const row = (
  id: string,
  day: string,
  o: { vehicleId?: string | null; code?: string; createdAt?: string } = {},
) => ({
  id,
  vehicleId: o.vehicleId === undefined ? CAR : o.vehicleId,
  vehicleCode: o.vehicleId === null ? null : (o.code ?? '295'),
  date: `${day}T00:00:00.000Z`,
  createdAt: o.createdAt ?? `${day}T08:00:00.000Z`,
});

const byCar = (...alarms: FleetMaintenanceAlarmDto[]) =>
  new Map(alarms.map((a) => [a.vehicleId, a] as const));

describe('reasonRows', () => {
  it('says nothing at all before the projection has answered — not even «غير نشطة»', () => {
    const rows = [row('r26', '2026-10-26'), row('x1', '2026-10-26', { vehicleId: 'gone' })];
    expect(reasonRows(rows, byCar(alarm()), false).size).toBe(0);
    expect(reasonRows(rows, new Map(), false).size).toBe(0);
  });

  it('puts a refused car’s reason on exactly the row the server names, once', () => {
    // The named row is not the newest on the page — a later day was recorded without a reading
    // that tops it — and it still carries the reason; the others keep the dash.
    const rows = [row('r27', '2026-10-27'), row('r26', '2026-10-26'), row('r18', '2026-10-18')];
    const said = reasonRows(rows, byCar(alarm()), true);
    expect([...said.keys()]).toEqual(['r26']);
    expect(said.get('r26')).toMatchObject({ kind: 'alarm', reason: 'noService' });
  });

  it('says it on NO row when the page does not hold that row — never on an older reading', () => {
    const rows = [row('r18', '2026-10-18'), row('r15', '2026-10-15')];
    expect(reasonRows(rows, byCar(alarm()), true).size).toBe(0);
  });

  it('puts «لا قراءة عداد» on the car’s newest row — by day, then by entry time', () => {
    const noReading = alarm({
      noAlarmReason: 'noReading',
      latestReading: null,
      latestReadingAt: null,
      latestReadingLogId: null,
    });
    const rows = [
      row('a', '2026-10-25', { createdAt: '2026-10-25T09:00:00.000Z' }),
      row('b', '2026-10-26', { createdAt: '2026-10-26T07:00:00.000Z' }),
      row('c', '2026-10-26', { createdAt: '2026-10-26T10:00:00.000Z' }),
    ];
    expect([...reasonRows(rows, byCar(noReading), true).keys()]).toEqual(['c']);
  });

  it('passes the server’s reason through as it came, whichever it is', () => {
    const reasons: FleetNoAlarmReason[] = [
      'noInterval',
      'noReading',
      'noService',
      'readingOlderThanService',
      'baselineAboveReading',
      'baselineBelowChain',
    ];
    for (const reason of reasons) {
      const said = reasonRows(
        [row('r26', '2026-10-26')],
        byCar(alarm({ noAlarmReason: reason })),
        true,
      );
      expect(said.get('r26'), reason).toMatchObject({ kind: 'alarm', reason });
    }
  });

  it('says nothing for a car whose figure WAS computed', () => {
    const healthy = alarm({ noAlarmReason: null, sinceServiceKm: 2_841, level: 'none' });
    expect(reasonRows([row('r26', '2026-10-26')], byCar(healthy), true).size).toBe(0);
  });

  it('marks a car the projection leaves out as not active, on its newest row only', () => {
    const rows = [
      row('n24', '2026-10-24', { vehicleId: 'v274', code: '274' }),
      row('n25', '2026-10-25', { vehicleId: 'v274', code: '274' }),
      row('r26', '2026-10-26'),
    ];
    const said = reasonRows(rows, byCar(alarm({ noAlarmReason: null, sinceServiceKm: 1 })), true);
    expect([...said.keys()]).toEqual(['n25']);
    expect(said.get('n25')).toEqual({ kind: 'notActive', vehicleId: 'v274', code: '274' });
  });

  it('leaves a row the old book kept for no car alone', () => {
    const rows = [row('old', '2026-10-26', { vehicleId: null })];
    expect(reasonRows(rows, new Map(), true).size).toBe(0);
  });
});
