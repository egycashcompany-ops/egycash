// A `dataFix` line («تصحيح أرقام الكروت», 6d) as the card log answers it — last fours only; every
// other line answers `repair: null`.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { type FleetFuelCardMovementDoc } from './fuel-card.model';
import { toFuelMovementDto } from './fuel-card.service';

const line = (over: Partial<FleetFuelCardMovementDoc>): FleetFuelCardMovementDoc =>
  ({
    _id: new Types.ObjectId(),
    cardId: new Types.ObjectId(),
    kind: 'charge',
    amount: 0,
    balanceAfter: 3049.73,
    counterpartCardId: null,
    receiptId: null,
    at: new Date('2026-11-02T10:00:00.000Z'),
    createdAt: new Date('2026-11-02T10:00:00.000Z'),
    ...over,
  }) as FleetFuelCardMovementDoc;

describe('the repair on a log line', () => {
  it('a number moved: last fours, PIN and photo yes/no, the expiry days', () => {
    const dto = toFuelMovementDto(
      line({
        kind: 'dataFix',
        repair: {
          key: '6d:2026-10-04',
          unit: 'C4',
          kind: 'number',
          numberBefore: '5485640006602813',
          numberAfter: '5485640005010935',
          pinMoved: true,
          photoMoved: true,
          expiryBefore: new Date('2027-03-31T00:00:00.000Z'),
          expiryAfter: new Date('2027-03-31T00:00:00.000Z'),
          nameBefore: null,
          nameAfter: null,
          openingBefore: null,
          openingAfter: null,
        },
      }),
      null,
    );
    expect(dto.repair).toEqual({
      key: '6d:2026-10-04',
      unit: 'C4',
      kind: 'number',
      numberBeforeLast4: '2813',
      numberAfterLast4: '0935',
      pinMoved: true,
      photoMoved: true,
      expiryBefore: '2027-03-31',
      expiryAfter: '2027-03-31',
      nameBefore: null,
      nameAfter: null,
      openingBefore: null,
      openingAfter: null,
    });
    expect(JSON.stringify(dto)).not.toContain('5485640006602813');
  });

  it('the pair: the names and the openings', () => {
    const dto = toFuelMovementDto(
      line({
        kind: 'dataFix',
        amount: -11_872.62,
        repair: {
          key: '6d:2026-10-04',
          unit: 'pair',
          kind: 'nameSwap',
          numberBefore: null,
          numberAfter: null,
          pinMoved: null,
          photoMoved: null,
          expiryBefore: null,
          expiryAfter: null,
          nameBefore: 'EGYCASH-8616-783211',
          nameAfter: 'EGYCASH-1137-401485',
          openingBefore: 13_130.62,
          openingAfter: 1258,
        },
      }),
      null,
    );
    expect(dto.repair).toMatchObject({
      kind: 'nameSwap',
      numberBeforeLast4: null,
      nameAfter: 'EGYCASH-1137-401485',
      openingAfter: 1258,
    });
  });

  it('every other line: none', () => {
    expect(toFuelMovementDto(line({}), null).repair).toBeNull();
  });
});
