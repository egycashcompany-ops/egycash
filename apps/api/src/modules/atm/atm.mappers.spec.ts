// DEC-23 — a master row written by `npm run atm:import` (raw driver, no Mongoose) has no `__v`,
// `createdAt` or `updatedAt` until the boot backfill runs. The two master mappers must answer for
// it instead of throwing, or `/atm/machines` and the label lists 500 on a legacy database.
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { toAtmMachineDto, toAtmRefLabelDto } from './atm.mappers';
import { type AtmMachineDoc } from './machines/machine.model';
import { type AtmRefLabelDoc } from './catalogs/ref-label.model';

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
