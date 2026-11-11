// The vault's receive queue, asserted directly — «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى
// الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات».
import { describe, expect, it } from 'vitest';
import { type OperationsSecuredStage, type OperationsShipmentStatus } from '@ecms/contracts';
import { rowTint } from './day-board';
import {
  mayReceive,
  readVaultQueueAll,
  vaultQueueCounts,
  vaultQueueStages,
  vaultQueueState,
  vaultQueueTint,
  vaultRowTint,
} from './vault-queue';

const row = (status: OperationsShipmentStatus, securedStage: OperationsSecuredStage | null) => ({
  status,
  securedStage,
});

describe('vaultQueueState — yellow with the captain, green once the vault has it', () => {
  it('is withCaptain once the captain pressed ✓ on collecting it from the bank', () => {
    expect(vaultQueueState(row('draft', 'withCaptain'))).toBe('withCaptain');
  });

  it('is awaiting while no captain has collected it — the «الكل» rows', () => {
    expect(vaultQueueState(row('draft', 'awaitingPickup'))).toBe('awaiting');
  });

  it('is received for anything past draft — received this morning and dispatched since, too', () => {
    expect(vaultQueueState(row('inVault', 'inVault'))).toBe('received');
    expect(vaultQueueState(row('dispatched', 'dispatched'))).toBe('received');
    expect(vaultQueueState(row('completed', 'completed'))).toBe('received');
  });
});

describe('vaultQueueTint — the Operations boards’ own two tints', () => {
  it('paints a row with the captain the boards’ yellow, a received one their green', () => {
    expect(vaultQueueTint('withCaptain')).toBe(rowTint('captain'));
    expect(vaultQueueTint('received')).toBe(rowTint('desk'));
    expect(vaultQueueTint('withCaptain')).toContain('amber');
    expect(vaultQueueTint('received')).toContain('emerald');
  });

  it('leaves a row nobody has collected white', () => {
    expect(vaultQueueTint('awaiting')).toBeUndefined();
  });
});

describe('mayReceive — the vault’s ✓ only while it is outside the vault', () => {
  it('offers the receive form on a draft row, yellow or white', () => {
    expect(mayReceive(row('draft', 'withCaptain'))).toBe(true);
    // A captain without the app never presses ✓: his shipment is still receivable.
    expect(mayReceive(row('draft', 'awaitingPickup'))).toBe(true);
  });

  it('offers nothing on a green row — the server would refuse a second receipt', () => {
    expect(mayReceive(row('inVault', 'inVault'))).toBe(false);
    expect(mayReceive(row('dispatched', 'dispatched'))).toBe(false);
  });
});

describe('vaultQueueCounts — the legend’s figures', () => {
  it('counts the rows of each colour', () => {
    expect(
      vaultQueueCounts([
        row('draft', 'withCaptain'),
        row('draft', 'withCaptain'),
        row('inVault', 'inVault'),
        row('draft', 'awaitingPickup'),
      ]),
    ).toEqual({ withCaptain: 2, received: 1, awaiting: 1 });
    expect(vaultQueueCounts([])).toEqual({ withCaptain: 0, received: 0, awaiting: 0 });
  });
});

describe('readVaultQueueAll — «الكل» in the URL', () => {
  it('is on only for ?all=1', () => {
    expect(readVaultQueueAll(new URLSearchParams('all=1'))).toBe(true);
    expect(readVaultQueueAll(new URLSearchParams(''))).toBe(false);
    expect(readVaultQueueAll(new URLSearchParams('all=yes'))).toBe(false);
  });
});

describe('vaultRowTint — the queue’s own colour, from the row', () => {
  it('keeps a row received today green once it has gone out — the boards would paint it blue', () => {
    expect(vaultRowTint(row('dispatched', 'dispatched'))).toBe(rowTint('desk'));
    expect(vaultRowTint(row('completed', 'completed'))).toBe(rowTint('desk'));
    expect(vaultRowTint(row('inVault', 'inVault'))).toBe(rowTint('desk'));
    expect(vaultRowTint(row('draft', 'withCaptain'))).toBe(rowTint('captain'));
    expect(vaultRowTint(row('draft', 'awaitingPickup'))).toBeUndefined();
  });
});

describe('vaultQueueStages — the «الحالة» filter offers the stages the list can hold', () => {
  it('offers «لم يتم التسليم» only with «الكل»', () => {
    expect(vaultQueueStages(false)).toEqual(['withCaptain', 'inVault', 'dispatched', 'completed']);
    expect(vaultQueueStages(true)).toEqual([
      'awaitingPickup',
      'withCaptain',
      'inVault',
      'dispatched',
      'completed',
    ]);
  });
});
