// «شحن الكروت» — several states ticked read as ANY of them.
import { describe, expect, it } from 'vitest';
import { type FleetFuelCardDto } from '@ecms/contracts';
import { cardsInStates, chargedToday, readChargingStates } from './charging-state';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const card = (id: string, over: Partial<FleetFuelCardDto> = {}): FleetFuelCardDto =>
  ({
    id,
    balance: 1000,
    requestedAmount: null,
    lastChargedAt: null,
    ...over,
  }) as FleetFuelCardDto;

const REQUESTED = card('req', { requestedAmount: 500 });
const LOW = card('low', { balance: 120 });
const CHARGED = card('charged', { lastChargedAt: '2026-10-03T08:00:00Z' });
const PLAIN = card('plain', { lastChargedAt: '2026-09-30T08:00:00Z' });
const ALL = [REQUESTED, LOW, CHARGED, PLAIN];
const ids = (cards: FleetFuelCardDto[]): string[] => cards.map((c) => c.id);

describe('the charging screen’s state filter', () => {
  it('reads the ticked states from the link, each once, ignoring words it does not know', () => {
    expect(readChargingStates('low,requested,low,nonsense')).toEqual(['requested', 'low']);
    expect(readChargingStates(null)).toEqual([]);
    // A link saved before the filter took several still reads as its one state.
    expect(readChargingStates('charged')).toEqual(['charged']);
  });

  it('keeps every card when nothing is ticked', () => {
    expect(ids(cardsInStates(ALL, [], 300, NOW))).toEqual(['req', 'low', 'charged', 'plain']);
  });

  it('one state keeps exactly its cards', () => {
    expect(ids(cardsInStates(ALL, ['requested'], 300, NOW))).toEqual(['req']);
    expect(ids(cardsInStates(ALL, ['low'], 300, NOW))).toEqual(['low']);
    expect(ids(cardsInStates(ALL, ['charged'], 300, NOW))).toEqual(['charged']);
  });

  it('several states keep a card in ANY of them', () => {
    expect(ids(cardsInStates(ALL, ['requested', 'low'], 300, NOW))).toEqual(['req', 'low']);
    expect(ids(cardsInStates(ALL, ['requested', 'low', 'charged'], 300, NOW))).toEqual([
      'req',
      'low',
      'charged',
    ]);
  });

  // Retitled on purpose (batch 3, plan §1.7): «charged today» was the last 24 hours; it is now
  // today's Cairo date — the owner's later «الاخضر فى حالة لو اتشحن اليوم». The two facts below
  // hold under both rules; the Cairo-day block that follows pins the difference.
  it('«charged today» is a charge on today’s date, not one days before', () => {
    expect(chargedToday(CHARGED, NOW)).toBe(true);
    expect(chargedToday(PLAIN, NOW)).toBe(false);
  });
});

describe('«شُحن اليوم» is the Africa/Cairo calendar day', () => {
  // Winter (UTC+2, after the last Thursday of October): Cairo's 2 November 2026 starts at
  // 2026-11-01T22:00Z.
  const AT_0030_CAIRO = Date.parse('2026-11-01T22:30:00Z'); // 00:30, 2 November, Cairo
  const AT_0900_CAIRO = Date.parse('2026-11-02T07:00:00Z'); // 09:00, 2 November, Cairo
  const YESTERDAY_2330 = card('late', { lastChargedAt: '2026-11-01T21:30:00.000Z' });
  const TODAY_0010 = card('early', { lastChargedAt: '2026-11-01T22:10:00.000Z' });

  it('a charge at 23:30 Cairo yesterday is not «today» at 00:30 — though only an hour ago', () => {
    expect(chargedToday(YESTERDAY_2330, AT_0030_CAIRO)).toBe(false);
    expect(chargedToday(YESTERDAY_2330, AT_0900_CAIRO)).toBe(false);
  });

  it('a charge at 00:10 Cairo today is «today» — although its UTC date is the day before', () => {
    expect(chargedToday(TODAY_0010, AT_0030_CAIRO)).toBe(true);
    expect(chargedToday(TODAY_0010, AT_0900_CAIRO)).toBe(true);
    // …and stays «today» to Cairo's own midnight, then stops.
    expect(chargedToday(TODAY_0010, Date.parse('2026-11-02T21:59:59Z'))).toBe(true);
    expect(chargedToday(TODAY_0010, Date.parse('2026-11-02T22:00:00Z'))).toBe(false);
  });

  it('summer time (UTC+3) moves Cairo’s midnight to 21:00Z', () => {
    const charged = card('summer', { lastChargedAt: '2026-07-14T21:10:00.000Z' }); // 00:10, 15 July
    expect(chargedToday(charged, Date.parse('2026-07-15T08:00:00Z'))).toBe(true);
    expect(chargedToday(charged, Date.parse('2026-07-15T20:59:00Z'))).toBe(true); // 23:59
    expect(chargedToday(charged, Date.parse('2026-07-15T21:00:00Z'))).toBe(false); // 00:00, 16 July
    const before = card('summer-eve', { lastChargedAt: '2026-07-14T20:50:00.000Z' }); // 23:50
    expect(chargedToday(before, Date.parse('2026-07-14T21:30:00Z'))).toBe(false);
  });

  it('a card never charged is never «today»', () => {
    expect(chargedToday(card('never'), AT_0900_CAIRO)).toBe(false);
  });

  it('the «شُحنت اليوم» filter keeps the same cards the row paints green', () => {
    const cards = [YESTERDAY_2330, TODAY_0010, PLAIN];
    expect(ids(cardsInStates(cards, ['charged'], 300, AT_0030_CAIRO))).toEqual(['early']);
  });
});
