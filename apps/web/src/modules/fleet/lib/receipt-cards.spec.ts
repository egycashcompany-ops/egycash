import { describe, expect, it } from 'vitest';
import { type FleetFuelCardDto, type FleetReceiptDto } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  cardPlace,
  otherReceiptCards,
  paidByOtherCard,
  receiptCardOwner,
  receiptCardsState,
  settleReceiptCard,
  settleReceiptCardId,
} from './receipt-cards';

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

// «لما اختار عربيه اعملى ان هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت».
describe('«كارت آخر» — any other card in the system', () => {
  const ready = (cards: FleetFuelCardDto[]) => ({ kind: 'ready' as const, cards });
  const full = (over: Partial<FleetFuelCardDto>): FleetFuelCardDto =>
    ({
      id: 'c-1',
      vehicleId: 'v-1',
      vehicleCode: '160',
      label: null,
      company: 'wataniya',
      name: 'كارت وطنية 160',
      number: '7045 1120 0098 4410',
      balance: 100,
      ...over,
    }) as FleetFuelCardDto;
  const every = [
    full({}),
    full({
      id: 'c-2',
      vehicleId: 'v-2',
      vehicleCode: '204',
      company: 'chillout',
      name: 'شيل اوت 204',
      number: '5522 8810 3340 1177',
    }),
    full({
      id: 'c-3',
      vehicleId: null,
      vehicleCode: null,
      label: 'سفر 1',
      name: 'كارت السفر',
      number: '7045 0000 1111 2222',
    }),
  ];
  const company = (key: string): string => (key === 'wataniya' ? 'وطنية' : 'شيل اوت');

  it('is never dropped for not being this car’s — that is the point of it', () => {
    const pick = { other: true, cardId: 'c-2' };
    expect(settleReceiptCard(ready([full({})]), pick)).toEqual(pick);
    expect(settleReceiptCard(ready([]), pick)).toEqual(pick);
    expect(settleReceiptCard({ kind: 'loading' }, pick)).toEqual(pick);
  });

  it('becomes one of the car’s own when the car picked since carries it', () => {
    const pick = { other: true, cardId: 'c-2' };
    expect(settleReceiptCard(ready([every[1] as FleetFuelCardDto]), pick)).toEqual({
      other: false,
      cardId: 'c-2',
    });
  });

  it('the car’s own cards settle exactly as before', () => {
    expect(settleReceiptCard(ready([full({})]), { other: false, cardId: '' })).toEqual({
      other: false,
      cardId: 'c-1',
    });
    expect(settleReceiptCard(ready([]), { other: false, cardId: 'c-2' })).toEqual({
      other: false,
      cardId: '',
    });
  });

  it('lists every card that is not on the receipt’s car — another car’s and one on no car', () => {
    expect(otherReceiptCards(every, 'v-1', '', company).map((c) => c.id)).toEqual(['c-2', 'c-3']);
    // No car picked yet: every card.
    expect(otherReceiptCards(every, '', '', company)).toHaveLength(3);
  });

  it('searches by the car’s code, the card’s name or label, its number and the company', () => {
    const ids = (query: string): string[] =>
      otherReceiptCards(every, 'v-0', query, company).map((c) => c.id);
    expect(ids('204')).toEqual(['c-2']);
    expect(ids('سفر')).toEqual(['c-3']);
    expect(ids('كارت السفر')).toEqual(['c-3']);
    // The number with its spaces, without them, or a part of it.
    expect(ids('5522 8810')).toEqual(['c-2']);
    expect(ids('55228810')).toEqual(['c-2']);
    expect(ids('2222')).toEqual(['c-3']);
    // The company in either language.
    expect(ids('شيل')).toEqual(['c-2']);
    expect(ids('Chillout')).toEqual(['c-2']);
    expect(ids('وطنية')).toEqual(['c-1', 'c-3']);
    // Every word must match; Arabic-Indic digits read as Latin ones.
    expect(ids('وطنية 160')).toEqual(['c-1']);
    expect(ids('٢٠٤')).toEqual(['c-2']);
    expect(ids('nothing-like-it')).toEqual([]);
  });

  it('folds Arabic as every search box does — «وطنيه», «شل اوت» and «اسبير» find their cards', () => {
    // The companies as the screen names them, and labels written with their hamza and ta marbuta.
    const named = (key: string): string => translate('ar', `fleet.fuelCards.company.${key}`);
    const cards = [
      full({ id: 'c-1', vehicleId: null, vehicleCode: null, label: 'سفر 1', name: 'كارت السفر' }),
      full({
        id: 'c-2',
        vehicleId: null,
        vehicleCode: null,
        label: 'إسبير',
        company: 'chillout',
        name: 'كارت احتياطي',
        number: '5522 8810 3340 1177',
      }),
    ];
    const ids = (query: string): string[] =>
      otherReceiptCards(cards, 'v-0', query, named).map((c) => c.id);
    // As written on the card…
    expect(ids('وطنية')).toEqual(['c-1']);
    expect(ids('شل أوت')).toEqual(['c-2']);
    expect(ids('إسبير')).toEqual(['c-2']);
    // …and as the owner types it: ه for ة, bare alef for أ / إ, no diacritics.
    expect(ids('وطنيه')).toEqual(['c-1']);
    expect(ids('شل اوت')).toEqual(['c-2']);
    expect(ids('اسبير')).toEqual(['c-2']);
    expect(ids('وَطَنِيَّة')).toEqual(['c-1']);
    // Arabic-Indic digits still read as Latin ones, every word still has to match.
    expect(ids('شل اوت ١١٧٧')).toEqual(['c-2']);
    expect(ids('وطنيه ١١٧٧')).toEqual([]);
  });

  it('names where a card sits — its car’s code, or its label on no car', () => {
    expect(cardPlace(full({}))).toBe('160');
    expect(cardPlace(full({ vehicleCode: null, label: 'اسبير' }))).toBe('اسبير');
    expect(cardPlace(full({ vehicleCode: null, label: null }))).toBe('—');
  });
});

describe('a saved receipt and the card that paid it', () => {
  type Row = Pick<
    FleetReceiptDto,
    | 'source'
    | 'cardId'
    | 'vehicleId'
    | 'cardCompany'
    | 'cardVehicleId'
    | 'cardVehicleCode'
    | 'cardLabel'
  >;
  const row = (over: Partial<Row>): Row => ({
    source: 'card',
    cardId: 'c-1',
    vehicleId: 'v-204',
    cardCompany: 'wataniya',
    cardVehicleId: 'v-204',
    cardVehicleCode: '204',
    cardLabel: null,
    ...over,
  });
  const cardOf = (code: string): string => `كارت ${code}`;

  it('opens on «كارت آخر» only when the card is not on the receipt’s car', () => {
    expect(paidByOtherCard(row({}))).toBe(false);
    expect(paidByOtherCard(row({ cardVehicleId: 'v-160' }))).toBe(true);
    expect(paidByOtherCard(row({ cardVehicleId: null, cardLabel: 'سفر 1' }))).toBe(true);
    expect(paidByOtherCard(row({ source: 'custody', cardId: null, cardVehicleId: null }))).toBe(
      false,
    );
  });

  it('names the owner of another car’s card or a card on no car — never the car’s own', () => {
    expect(receiptCardOwner(row({}), cardOf)).toBeNull();
    expect(receiptCardOwner(row({ cardVehicleId: 'v-160', cardVehicleCode: '160' }), cardOf)).toBe(
      'كارت 160',
    );
    expect(
      receiptCardOwner(
        row({ cardVehicleId: null, cardVehicleCode: null, cardLabel: 'سفر 1' }),
        cardOf,
      ),
    ).toBe('سفر 1');
    // The fund, or a card no longer known: nothing to name.
    expect(receiptCardOwner(row({ source: 'custody', cardId: null }), cardOf)).toBeNull();
    expect(receiptCardOwner(row({ cardCompany: null, cardVehicleId: null }), cardOf)).toBeNull();
  });
});
