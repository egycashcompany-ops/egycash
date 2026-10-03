import { describe, expect, it } from 'vitest';
import { type FleetFuelCardDto } from '@ecms/contracts';
import { receiptCardsState, settleReceiptCardId } from './receipt-cards';

const card = (id: string, vehicleId: string): FleetFuelCardDto =>
  ({ id, vehicleId, company: 'wataniya' }) as FleetFuelCardDto;

const base = { vehicleId: 'v-1', code: '160', placeholder: false, failed: false };

describe('the picked car’s fuel cards', () => {
  it('asks for a car before one is picked', () => {
    expect(receiptCardsState({ ...base, vehicleId: '', items: [] }).kind).toBe('noCar');
  });

  it('is LOADING — never «no cards» — while the code or the list is not in yet', () => {
    expect(receiptCardsState({ ...base, code: '', items: [] }).kind).toBe('loading');
    expect(receiptCardsState({ ...base, items: undefined }).kind).toBe('loading');
    // The previous car's list held on screen while this car's loads.
    expect(
      receiptCardsState({ ...base, items: [card('c-9', 'v-9')], placeholder: true }).kind,
    ).toBe('loading');
  });

  it('says so when the cards could not be read', () => {
    expect(receiptCardsState({ ...base, items: undefined, failed: true }).kind).toBe('failed');
  });

  it('keeps only this car’s cards', () => {
    const state = receiptCardsState({
      ...base,
      items: [card('c-1', 'v-1'), card('c-2', 'v-2'), card('c-3', 'v-1')],
    });
    expect(state).toEqual({ kind: 'ready', cards: [card('c-1', 'v-1'), card('c-3', 'v-1')] });
  });
});

describe('which card the receipt points at', () => {
  const ready = (cards: FleetFuelCardDto[]) => ({ kind: 'ready' as const, cards });

  it('picks the only card on its own', () => {
    expect(settleReceiptCardId(ready([card('c-1', 'v-1')]), '')).toBe('c-1');
    expect(settleReceiptCardId(ready([card('c-1', 'v-1')]), 'c-9')).toBe('c-1');
  });

  it('leaves two cards for the clerk to pick, and keeps a pick that is still this car’s', () => {
    const two = ready([card('c-1', 'v-1'), card('c-2', 'v-1')]);
    expect(settleReceiptCardId(two, '')).toBe('');
    expect(settleReceiptCardId(two, 'c-2')).toBe('c-2');
    expect(settleReceiptCardId(two, 'c-9'), 'another car’s card is dropped').toBe('');
  });

  it('points at nothing on a car with no cards', () => {
    expect(settleReceiptCardId(ready([]), 'c-1')).toBe('');
  });

  it('keeps the pick while the cards are still loading — an edit opens with its card', () => {
    expect(settleReceiptCardId({ kind: 'loading' }, 'c-1')).toBe('c-1');
    expect(settleReceiptCardId({ kind: 'noCar' }, '')).toBe('');
  });
});
