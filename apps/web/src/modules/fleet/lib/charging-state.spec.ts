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

  it('«charged today» is the last 24 hours', () => {
    expect(chargedToday(CHARGED, NOW)).toBe(true);
    expect(chargedToday(PLAIN, NOW)).toBe(false);
  });
});
