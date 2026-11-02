// «ربط الكروت بالسيارات» and «كروت في الشيت وليست في النظام» — the pure half: the groups (a pair
// together, in the group of the card the sheet lists first), what the chassis says, what ✓ / ✗
// send, how «إضافة» is filled from a row, and the refusals the screen words itself.
import { describe, expect, it } from 'vitest';
import {
  ErrorCodes,
  type FleetFuelCardDto,
  type FleetFuelLinkPlaceDto,
  type FleetFuelReconcileLinkDto,
  type FleetFuelReconcileNewCardDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  addCardRefusalOf,
  cardAfterLink,
  chassisOfName,
  chassisToneOf,
  fromSheetOf,
  isSwap,
  linkBodyOf,
  linkDecisionOf,
  linkGroupsOf,
  linkRefusalOf,
  numberFitsSheet,
  unitInRepair,
  unitPicked,
} from './fuel-reconcile-links';

const card = (
  id: string,
  name: string,
  over: Partial<FleetFuelCardDto> = {},
): FleetFuelCardDto => ({
  id,
  vehicleId: null,
  vehicleCode: null,
  label: null,
  company: 'wataniya',
  name,
  number: '5485640068870683',
  expiresAt: '2029-05-31T00:00:00.000Z',
  hasPassword: true,
  balance: 260.96,
  requestedAmount: null,
  requestedAt: null,
  lastChargedAt: null,
  image: null,
  version: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const car = (code: string): FleetFuelLinkPlaceDto => ({
  vehicleId: `v-${code}`,
  vehicleCode: code,
  label: null,
});
const label = (text: string): FleetFuelLinkPlaceDto => ({
  vehicleId: null,
  vehicleCode: null,
  label: text,
});
const link = (
  over: Partial<FleetFuelReconcileLinkDto> & Pick<FleetFuelReconcileLinkDto, 'card' | 'kind'>,
): FleetFuelReconcileLinkDto => ({
  sheetRow: 2,
  sheetCode: null,
  to: null,
  resolvedBy: 'code',
  chassisCar: null,
  slotHeldBy: null,
  pairWith: null,
  inRepair: false,
  decision: null,
  ...over,
});
const on = (code: string): Partial<FleetFuelCardDto> => ({
  vehicleId: `v-${code}`,
  vehicleCode: code,
});

// His rows (sample F1/07): «سفر 1» onto 285 while 285's card goes to «سفر 1»; the 0849 pair
// 283↔530 (waiting for the repair); MG 2↔172 (the chassis says the system is right); 231's card to
// «اسبير»; an unknown «جيلى» on the كولراى card.
const A = link({
  card: card('a', 'EGYCASH-8598-S783212', { label: 'سفر 1' }),
  kind: 'attach',
  sheetRow: 10,
  sheetCode: '285',
  to: car('285'),
  chassisCar: '285',
  pairWith: 'b',
});
const B = link({
  card: card('b', 'EGYCASH-8598-783212', on('285')),
  kind: 'detach',
  sheetRow: 11,
  sheetCode: 'سفر 1',
  to: label('سفر 1'),
  resolvedBy: 'label',
  chassisCar: '285',
  pairWith: 'a',
});
const P1 = link({
  card: card('p1', 'EGYCASH-1137-401485', on('283')),
  kind: 'move',
  sheetRow: 20,
  sheetCode: '530',
  to: car('530'),
  chassisCar: '530',
  pairWith: 'p2',
  inRepair: true,
});
const P2 = link({
  card: card('p2', 'EGYCASH-8616-783211', on('530')),
  kind: 'move',
  sheetRow: 21,
  sheetCode: '283',
  to: car('283'),
  chassisCar: '283',
  pairWith: 'p1',
  inRepair: true,
});
const M1 = link({
  card: card('m1', 'EGYCASH-4489-MB060216', on('MG 2')),
  kind: 'move',
  sheetRow: 30,
  sheetCode: '172',
  to: car('172'),
  chassisCar: 'MG 2',
  pairWith: 'm2',
});
const M2 = link({
  card: card('m2', 'EGYCASH-3675-B253813', on('172')),
  kind: 'move',
  sheetRow: 31,
  sheetCode: 'm g 2',
  to: car('MG 2'),
  resolvedBy: 'alias',
  chassisCar: '172',
  pairWith: 'm1',
});
const D = link({
  card: card('d', 'EGYCASH-7576-312521', on('231')),
  kind: 'detach',
  sheetRow: 40,
  sheetCode: 'اسبير',
  to: label('اسبير'),
  resolvedBy: 'label',
  chassisCar: '231',
});
const U = link({
  card: card('u', 'EGYCASH-4857-501205', { label: 'كولراى' }),
  kind: 'unknownCode',
  sheetRow: 50,
  sheetCode: 'جيلى',
  to: null,
  resolvedBy: null,
  chassisCar: 'كولراى',
});
const LINKS = [U, D, M2, M1, P2, P1, B, A];

describe('the groups', () => {
  it('in the section’s order; a pair together, in the group of the card the sheet lists first', () => {
    const groups = linkGroupsOf(LINKS);
    expect(groups.map((g) => g.kind)).toEqual(['attach', 'move', 'detach', 'unknownCode']);
    const [attach, move, detach, unknown] = groups;
    // «سفر 1» ↔ 285: the attach (row 10) carries its detach partner (row 11).
    expect(attach?.units.map((u) => u.map((l) => l.card.id))).toEqual([['a', 'b']]);
    expect(attach?.cards).toBe(2);
    expect(move?.units.map((u) => u.map((l) => l.card.id))).toEqual([
      ['p1', 'p2'],
      ['m1', 'm2'],
    ]);
    expect(detach?.units.map((u) => u.map((l) => l.card.id))).toEqual([['d']]);
    expect(unknown?.units.map((u) => u.map((l) => l.card.id))).toEqual([['u']]);
  });

  it('a swap is two moves; any other pair exchanges a car and a label', () => {
    const [attach, move] = linkGroupsOf(LINKS);
    expect(isSwap(move!.units[0]!)).toBe(true);
    expect(isSwap(attach!.units[0]!)).toBe(false);
  });

  it('the 0849 pair waits for the card-number repair — its ✓ is off', () => {
    const [, move] = linkGroupsOf(LINKS);
    expect(unitInRepair(move!.units[0]!)).toBe(true);
    expect(unitInRepair(move!.units[1]!)).toBe(false);
  });
});

describe('the chassis in the card’s name — evidence only', () => {
  it('agrees with the sheet, sides with the system, or points nowhere', () => {
    expect(chassisToneOf(P1)).toBe('agrees');
    expect(chassisToneOf(M1)).toBe('differs');
    expect(chassisToneOf(M2)).toBe('differs');
    expect(chassisToneOf({ ...D, chassisCar: '999' })).toBe('other');
    expect(chassisToneOf({ ...D, chassisCar: null })).toBe('none');
    // An unknown code has no car of the sheet's to weigh it against: a pointer, never a warning.
    expect(chassisToneOf(U)).toBe('info');
    expect(chassisOfName('EGYCASH-8598-S783212')).toBe('S783212');
  });
});

describe('what ✓ / ✗ send', () => {
  it('a pair’s two cards together; a ✗ never picks', () => {
    const [, move] = linkGroupsOf(LINKS);
    expect(linkBodyOf(move!.units[1]!, 'apply', {})).toEqual({
      decision: 'apply',
      cardIds: ['m1', 'm2'],
      pick: [],
      remember: false,
    });
    expect(linkBodyOf([U], 'reject', { u: { vehicleId: 'v-9', remember: true } })).toEqual({
      decision: 'reject',
      cardIds: ['u'],
      pick: [],
      remember: false,
    });
  });

  it('an unknown code: the car picked, and «تذكّر هذا الكود»', () => {
    expect(unitPicked([U], {})).toBe(false);
    expect(unitPicked([U], { u: { vehicleId: '', remember: true } })).toBe(false);
    expect(unitPicked([U], { u: { vehicleId: 'v-77', remember: true } })).toBe(true);
    expect(unitPicked([D], {})).toBe(true);
    expect(linkBodyOf([U], 'apply', { u: { vehicleId: 'v-77', remember: true } })).toEqual({
      decision: 'apply',
      cardIds: ['u'],
      pick: [{ cardId: 'u', vehicleId: 'v-77', label: null }],
      remember: true,
    });
    expect(linkBodyOf([U], 'apply', { u: { vehicleId: 'v-77', remember: false } }).remember).toBe(
      false,
    );
  });

  it('a decision on this screen wins over the read; the card as it stands after a ✓', () => {
    const answer = {
      cardId: 'a',
      decision: 'apply' as const,
      from: label('سفر 1'),
      to: car('285'),
      at: '2026-11-01T10:24:00.000Z',
      byName: 'مدير الحركة',
    };
    expect(linkDecisionOf(A, {})).toBeNull();
    expect(linkDecisionOf(A, { a: answer })).toBe('apply');
    expect(linkDecisionOf({ ...A, decision: 'reject' }, {})).toBe('reject');
    expect(cardAfterLink(A, answer)).toMatchObject({
      vehicleId: 'v-285',
      vehicleCode: '285',
      label: null,
    });
    expect(cardAfterLink(A, undefined)).toBe(A.card);
  });
});

describe('the refusals', () => {
  const refused = (code: string, detail: string, field = 'cardIds'): ApiError =>
    new ApiError(code, 'x', 409, [{ field, code: detail, message: 'A1' }]);
  it('names the cards and why — the rest is the usual toast’s', () => {
    expect(
      linkRefusalOf(refused(ErrorCodes.FLEET_FUEL_RECONCILE_CARD_CHANGED, 'LINK_CHANGED')),
    ).toEqual({ kind: 'changed', cardIds: ['a1'] });
    expect(linkRefusalOf(refused(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'DECIDED'))?.kind).toBe(
      'decided',
    );
    expect(linkRefusalOf(refused(ErrorCodes.FLEET_FUEL_LINK_SLOT_HELD, 'SLOT_HELD'))?.kind).toBe(
      'slotHeld',
    );
    expect(linkRefusalOf(refused(ErrorCodes.FLEET_FUEL_LINK_IN_REPAIR, 'IN_REPAIR'))?.kind).toBe(
      'inRepair',
    );
    expect(
      linkRefusalOf(refused(ErrorCodes.VALIDATION_FAILED, 'REQUIRED', 'body.pick'))?.kind,
    ).toBe('pick');
    expect(linkRefusalOf(new ApiError('NOT_FOUND', 'x', 404))).toBeNull();
  });

  it('«إضافة»: the number missing or not the sheet’s, or the row already added', () => {
    const number = (code: string): ApiError =>
      new ApiError(ErrorCodes.FLEET_FUEL_SHEET_CARD_NUMBER, 'x', 422, [
        { field: 'number', code, message: 'number' },
      ]);
    expect(addCardRefusalOf(number('REQUIRED'))).toBe('numberRequired');
    expect(addCardRefusalOf(number('MISMATCH'))).toBe('numberMismatch');
    expect(addCardRefusalOf(refused(ErrorCodes.FLEET_FUEL_RECONCILE_DECIDED, 'DECIDED'))).toBe(
      'added',
    );
    // A number another card holds: the usual «already exists».
    expect(addCardRefusalOf(new ApiError(ErrorCodes.DUPLICATE, 'x', 409))).toBeNull();
  });
});

describe('«إضافة» filled from the sheet', () => {
  const row = (over: Partial<FleetFuelReconcileNewCardDto> = {}): FleetFuelReconcileNewCardDto => ({
    sheetRow: 60,
    name: 'EGYCASHTCS-1781-312986',
    number: '548**********7791',
    numberIsFull: false,
    balance: 4305.09,
    sheetCode: '209',
    to: car('209'),
    resolvedBy: 'code',
    chassisCar: '209',
    slotHeldBy: null,
    cardId: null,
    ...over,
  });
  const session = {
    id: 's-1',
    fileName: 'رصيد شل اوت 1-11-2026.xlsx',
    company: 'chillout' as const,
  };

  it('the row’s name, company, balance and car; the masked start and last four to type against', () => {
    expect(fromSheetOf(row(), session)).toEqual({
      sessionId: 's-1',
      row: 60,
      file: 'رصيد شل اوت 1-11-2026.xlsx',
      company: 'chillout',
      name: 'EGYCASHTCS-1781-312986',
      number: '548**********7791',
      numberIsFull: false,
      prefix: '548',
      last4: '7791',
      balance: 4305.09,
      vehicleId: 'v-209',
      label: null,
    });
  });

  it('a car that already holds this company’s card is not offered; a label is kept', () => {
    const held = fromSheetOf(
      row({ slotHeldBy: { id: 'h', name: 'EGYCASHTCS-1', place: '209' } }),
      session,
    );
    expect(held.vehicleId).toBeNull();
    const spare = fromSheetOf(row({ to: label('اسبير'), sheetCode: 'اسبير' }), session);
    expect(spare).toMatchObject({ vehicleId: null, label: 'اسبير' });
  });

  it('the typed number must end in the sheet’s last four and start as it does', () => {
    const from = fromSheetOf(row(), session);
    expect(numberFitsSheet('5485 6400 6883 7791', from)).toBe(true);
    expect(numberFitsSheet('5485640068837792', from)).toBe(false);
    expect(numberFitsSheet('4485640068837791', from)).toBe(false);
  });
});
