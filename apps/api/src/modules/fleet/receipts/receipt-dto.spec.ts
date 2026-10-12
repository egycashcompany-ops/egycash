// «لما اختار عربيه اعملى ان هل تريد تسجيل كارت اخر حتى لو العربيه عليها كروت» and «ادخال كم
// (اختيارى عند كتابه مبلغ التفويل)» — what a receipt row and a card's log line say about them.
//
// The money itself (another car's card and a stock card paying, and getting it back on an edit or
// a delete) is proved against a real mongo in `tests/integration/fleet.spec.ts`. This file pins
// the two mappings the screens read, and that the rule «the card must be this car's» is gone from
// the checks while every other one stayed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toReceiptDto, type ReceiptWithJoins } from './receipt.service';
import { toFuelMovementDto } from '../fuel-cards/fuel-card.service';
import { type FleetReceiptDoc } from './receipt.model';
import { type FleetFuelCardMovementDoc } from '../fuel-cards/fuel-card.model';

const at = new Date('2026-10-01T00:00:00.000Z');
const car204 = new Types.ObjectId();
const car160 = new Types.ObjectId();

const receiptDoc = (over: Partial<FleetReceiptDoc> = {}): FleetReceiptDoc =>
  ({
    _id: new Types.ObjectId(),
    date: at,
    vehicleId: car204,
    driverEmployeeId: null,
    driverName: null,
    kind: 'fuel',
    source: 'card',
    cardId: new Types.ObjectId(),
    fuelType: 'diesel',
    pricePerLitre: 15.5,
    litres: 20,
    amount: 310,
    image: null,
    __v: 0,
    createdAt: at,
    updatedAt: at,
    ...over,
  }) as FleetReceiptDoc;

const joins = (over: Partial<ReceiptWithJoins> = {}): ReceiptWithJoins => ({
  doc: receiptDoc(),
  vehicleCode: '204',
  card: { company: 'wataniya', number: '7045 1120 0098 2231', vehicleId: car204, label: null },
  cardVehicleCode: '204',
  ...over,
});

describe('a receipt row names the card that paid, wherever it sits', () => {
  it('the car’s own card: its car is the receipt’s car', () => {
    const dto = toReceiptDto(joins());
    expect(dto).toMatchObject({
      source: 'card',
      cardCompany: 'wataniya',
      cardVehicleId: String(car204),
      cardVehicleCode: '204',
      cardLabel: null,
    });
    expect(dto.cardVehicleId).toBe(dto.vehicleId);
  });

  it('another car’s card: its OWN car and code, not the receipt’s', () => {
    const dto = toReceiptDto(
      joins({
        card: { company: 'chillout', number: '5522 8810', vehicleId: car160, label: null },
        cardVehicleCode: '160',
      }),
    );
    expect(dto).toMatchObject({
      vehicleCode: '204',
      cardVehicleId: String(car160),
      cardVehicleCode: '160',
      cardLabel: null,
    });
  });

  it('a card on no car («سفر 1»): no car, its label', () => {
    const dto = toReceiptDto(
      joins({
        card: { company: 'wataniya', number: '7045 0000', vehicleId: null, label: 'سفر 1' },
        cardVehicleCode: null,
      }),
    );
    expect(dto).toMatchObject({ cardVehicleId: null, cardVehicleCode: null, cardLabel: 'سفر 1' });
  });

  it('the fund: no card at all', () => {
    const dto = toReceiptDto(
      joins({
        doc: receiptDoc({ source: 'custody', cardId: null }),
        card: null,
        cardVehicleCode: null,
      }),
    );
    expect(dto).toMatchObject({
      cardId: null,
      cardCompany: null,
      cardVehicleId: null,
      cardVehicleCode: null,
      cardLabel: null,
    });
  });

  it('carries «كم» as written, and none on a row written before it was asked', () => {
    expect(toReceiptDto(joins({ doc: receiptDoc({ odometer: 154320 }) })).odometer).toBe(154320);
    expect(toReceiptDto(joins({ doc: receiptDoc({ odometer: 0 }) })).odometer).toBe(0);
    expect(toReceiptDto(joins({ doc: receiptDoc({ odometer: null }) })).odometer).toBeNull();
    // An older row has no field at all.
    const older = receiptDoc();
    delete (older as { odometer?: unknown }).odometer;
    expect(toReceiptDto(joins({ doc: older })).odometer).toBeNull();
  });
});

describe('a card’s log names the car a receipt line paid for', () => {
  const line = (kind: FleetFuelCardMovementDoc['kind']): FleetFuelCardMovementDoc =>
    ({
      _id: new Types.ObjectId(),
      cardId: new Types.ObjectId(),
      kind,
      amount: -310,
      balanceAfter: 690,
      counterpartCardId: null,
      receiptId: kind === 'receipt' ? new Types.ObjectId() : null,
      at,
      createdAt: at,
    }) as FleetFuelCardMovementDoc;

  it('a receipt line: the receipt’s car', () => {
    const dto = toFuelMovementDto(line('receipt'), null, {
      vehicleId: String(car204),
      vehicleCode: '204',
    });
    expect(dto).toMatchObject({ receiptVehicleId: String(car204), receiptVehicleCode: '204' });
  });

  it('every other line, or a receipt not found: nothing', () => {
    const car = { vehicleId: String(car204), vehicleCode: '204' };
    for (const kind of ['charge', 'transferIn', 'transferOut'] as const) {
      expect(toFuelMovementDto(line(kind), null, car)).toMatchObject({
        receiptVehicleId: null,
        receiptVehicleCode: null,
      });
    }
    expect(toFuelMovementDto(line('receipt'), null)).toMatchObject({
      receiptVehicleId: null,
      receiptVehicleCode: null,
    });
  });
});

describe('the checks a receipt’s card goes through', () => {
  const source = readFileSync(join(__dirname, 'receipt.service.ts'), 'utf8');
  const prepare = source.slice(
    source.indexOf('  private async prepare('),
    source.indexOf('  async create('),
  );

  it('no longer asks that the card be on the receipt’s car', () => {
    expect(prepare).not.toContain('belongs to another car');
    expect(prepare).not.toMatch(/card\.vehicleId\)?\s*!==/u);
  });

  it('still refuses a card that does not exist or was deleted, and the car must exist', () => {
    // `findById` reads through the base filter — a soft-deleted card is not found.
    expect(prepare).toContain('fleetFuelCardRepository.findById(facts.cardId)');
    expect(prepare).toContain("throw invalid('cardId', 'unknown fuel card')");
    expect(prepare).toContain('fleetVehicleRepository.getById(facts.vehicleId)');
  });

  it('keeps «كم» on fuel only', () => {
    expect(prepare).toContain("odometer: facts.kind === 'fuel' ? facts.odometer : null");
  });
});
