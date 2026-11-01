// DEC-23 — a master row written by `npm run atm:import` (raw driver, no Mongoose) has no `__v`,
// `createdAt` or `updatedAt` until the boot backfill runs. The two master mappers must answer for
// it instead of throwing, or `/atm/machines` and the label lists 500 on a legacy database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toAtmBankDto, toAtmMachineDto, toAtmRefLabelDto } from './atm.mappers';
import { type AtmMachineDoc } from './machines/machine.model';
import { type AtmRefLabelDoc } from './catalogs/ref-label.model';
import { type AtmBankDoc } from './catalogs/bank.model';

const minted = new Types.ObjectId();

describe('legacy master rows (DEC-23)', () => {
  it('maps a machine without __v / createdAt / updatedAt: version 0, the id’s own timestamp', () => {
    const legacy = {
      _id: minted,
      branchId: new Types.ObjectId(),
      bankName: 'NBE',
      machineCode: '101',
      name: 'Legacy ATM',
      zone: '',
      area: 'Smouha',
      isActive: true,
      isDeleted: false,
      schemaVersion: 1,
    } as unknown as AtmMachineDoc;
    const dto = toAtmMachineDto(legacy);
    expect(dto.version).toBe(0);
    expect(dto.createdAt).toBe(minted.getTimestamp().toISOString());
    expect(dto.updatedAt).toBe(minted.getTimestamp().toISOString());
  });

  it('maps a label the same way', () => {
    const legacy = {
      _id: minted,
      branchId: new Types.ObjectId(),
      kind: 'bank',
      name: 'NBE',
      isActive: true,
    } as unknown as AtmRefLabelDoc;
    const dto = toAtmRefLabelDto(legacy);
    expect(dto.version).toBe(0);
    expect(dto.createdAt).toBe(minted.getTimestamp().toISOString());
  });

  it('keeps the stored stamps when they exist', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-02-01T00:00:00.000Z');
    const dto = toAtmMachineDto({
      _id: minted,
      branchId: new Types.ObjectId(),
      bankName: 'NBE',
      machineCode: '101',
      name: 'ATM',
      zone: '',
      area: 'Smouha',
      isActive: true,
      __v: 4,
      createdAt,
      updatedAt,
    } as unknown as AtmMachineDoc);
    expect(dto).toMatchObject({
      version: 4,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  });
});

// DEC-35 / DEC-38: a label row written before the catalog has none of the new fields — it reads as
// what it always meant: no display names, no former names, not mapped to a bank, typed by hand.
describe('labels and banks of the catalog (DEC-35)', () => {
  it('reads a label without the catalog-era fields as unmapped, manual, no display names', () => {
    const dto = toAtmRefLabelDto({
      _id: minted,
      branchId: new Types.ObjectId(),
      kind: 'bank',
      name: 'NBE FOREX',
      isActive: true,
    } as unknown as AtmRefLabelDoc);
    expect(dto).toMatchObject({
      kind: 'bank',
      name: 'NBE FOREX',
      nameAr: null,
      nameEn: null,
      formerNames: [],
      bankCode: null,
      origin: 'manual',
    });
  });

  it('maps a bank, with an ID format for a workbook seed only', () => {
    const at = new Date('2026-10-27T09:00:00.000Z');
    const bank = (code: string): AtmBankDoc =>
      ({
        _id: minted,
        code,
        name: { ar: 'بنك', en: 'Bank' },
        opsLabel: code,
        formerOpsLabels: [`${code} OLD`],
        opsLabelKeys: [code, `${code} OLD`],
        color: '#7030A0',
        sortOrder: 70,
        isActive: true,
        isSeed: code === 'NBE',
        __v: 3,
        createdAt: at,
        updatedAt: at,
      }) as unknown as AtmBankDoc;
    const qnb = toAtmBankDto(bank('QNB'));
    expect(qnb).toEqual({
      id: String(minted),
      code: 'QNB',
      name: { ar: 'بنك', en: 'Bank' },
      opsLabel: 'QNB',
      formerOpsLabels: ['QNB OLD'],
      color: '#7030A0',
      sortOrder: 70,
      isActive: true,
      isSeed: false,
      hasIdFormat: false,
      version: 3,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
    // The keys are the system's index, never part of the DTO.
    expect(Object.keys(qnb)).not.toContain('opsLabelKeys');
    expect(toAtmBankDto(bank('NBE')).hasIdFormat).toBe(true);
  });
});
