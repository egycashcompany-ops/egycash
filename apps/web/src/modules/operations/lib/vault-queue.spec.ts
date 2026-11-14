// The vault's receive queue, asserted directly — «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى
// الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات», and in Round
// 13: «انا عايز الجدول بتاع استلام الخزينه يكون مكان الحاله عمودين. العمود الاولاني يبقى خاص يبين ان
// اللي حصل استلام من القائد او من العمليات، والعمود التاني بتاع الحاله برضو يبين استلام من الخزينه.
// واستلام الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم
// عادي».
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SECURED_RECEIVABLE_STAGES,
  type OperationsSecuredPickedUpBy,
  type OperationsSecuredStage,
  type OperationsShipmentStatus,
} from '@ecms/contracts';
import { rowTint, vaultHoldOf, vaultPickupOf } from './day-board';
import {
  VAULT_LEGEND,
  mayReceive,
  queueStampText,
  readVaultQueueAll,
  vaultHoldCell,
  vaultPickupCell,
  vaultQueueCounts,
  vaultQueueState,
  vaultQueueTint,
  vaultRowTint,
} from './vault-queue';

const row = (status: OperationsShipmentStatus, securedStage: OperationsSecuredStage | null) => ({
  status,
  securedStage,
});

describe('vaultQueueState — yellow once collected, green once the vault has it', () => {
  it('is pickedUp once the captain pressed ✓ on collecting it from the bank', () => {
    expect(vaultQueueState(row('draft', 'withCaptain'))).toBe('pickedUp');
  });

  // Round 10: the desk's ✓ on the secured screen is the same yellow — in hand either way.
  it('is pickedUp once the Operations desk confirmed collecting it, as for the captain', () => {
    expect(vaultQueueState(row('draft', 'withOperations'))).toBe('pickedUp');
  });

  it('is awaiting while nobody has collected it and the vault has not received it — white', () => {
    expect(vaultQueueState(row('draft', 'awaitingPickup'))).toBe('awaiting');
  });

  it('is received for anything past draft — received this morning and dispatched since, too', () => {
    expect(vaultQueueState(row('inVault', 'inVault'))).toBe('received');
    expect(vaultQueueState(row('dispatched', 'dispatched'))).toBe('received');
    expect(vaultQueueState(row('completed', 'completed'))).toBe('received');
  });
});

describe('vaultQueueTint — the Operations boards’ own two tints', () => {
  it('paints a collected row the boards’ yellow, a received one their green', () => {
    expect(vaultQueueTint('pickedUp')).toBe(rowTint('captain'));
    expect(vaultQueueTint('received')).toBe(rowTint('desk'));
    expect(vaultQueueTint('pickedUp')).toContain('amber');
    expect(vaultQueueTint('received')).toContain('emerald');
  });

  it('leaves a row nobody has collected white', () => {
    expect(vaultQueueTint('awaiting')).toBeUndefined();
  });
});

// Round 13 — «واستلام الخزينه ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم
// والخزنه تستلم عادي»: Round 10's «مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح» is lifted.
describe('mayReceive — the vault’s ✓ on every row not yet received, white or yellow', () => {
  it('offers the receive form on a row somebody has collected — the captain or the desk', () => {
    expect(mayReceive(row('draft', 'withCaptain'))).toBe(true);
    expect(mayReceive(row('draft', 'withOperations'))).toBe(true);
  });

  it('offers it on a WHITE row too — nobody has to confirm the pickup first', () => {
    expect(mayReceive(row('draft', 'awaitingPickup'))).toBe(true);
    // A row sent with no stage at all (an older server) is still a draft the server takes.
    expect(mayReceive(row('draft', null))).toBe(true);
  });

  it('offers it exactly where the server receives — every draft stage', () => {
    expect([...OPERATIONS_SECURED_RECEIVABLE_STAGES].sort()).toEqual(
      ['awaitingPickup', 'withCaptain', 'withOperations'].sort(),
    );
    for (const stage of OPERATIONS_SECURED_RECEIVABLE_STAGES) {
      expect(mayReceive(row('draft', stage)), stage).toBe(true);
    }
  });

  it('offers nothing on a green row — the server would refuse a second receipt', () => {
    expect(mayReceive(row('inVault', 'inVault'))).toBe(false);
    expect(mayReceive(row('dispatched', 'dispatched'))).toBe(false);
    expect(mayReceive(row('completed', 'completed'))).toBe(false);
  });
});

describe('vaultQueueCounts and the legend — the chips’ figures, white, yellow, green', () => {
  it('counts the rows of each colour', () => {
    expect(
      vaultQueueCounts([
        row('draft', 'withCaptain'),
        row('draft', 'withOperations'),
        row('inVault', 'inVault'),
        row('draft', 'awaitingPickup'),
      ]),
    ).toEqual({ pickedUp: 2, received: 1, awaiting: 1 });
    expect(vaultQueueCounts([])).toEqual({ pickedUp: 0, received: 0, awaiting: 0 });
  });

  // The white rows are on the default list since Round 13, so their chip is always there — first,
  // in the order a محصنة goes through the colours.
  it('lists the three colours in the order a محصنة wears them', () => {
    expect(VAULT_LEGEND).toEqual(['awaiting', 'pickedUp', 'received']);
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
    expect(vaultRowTint(row('draft', 'withOperations'))).toBe(rowTint('captain'));
    expect(vaultRowTint(row('draft', 'awaitingPickup'))).toBeUndefined();
  });

  // A receipt nobody handed over: the server's stage is `inVault`, its pickup record empty — green,
  // like every receipt; its pickup column (below) says nobody collected it.
  it('paints a direct receipt green like any receipt', () => {
    expect(vaultRowTint(row('inVault', 'inVault'))).toBe(rowTint('desk'));
  });
});

const pickup = (by: OperationsSecuredPickedUpBy | null, at: string | null = null) => ({
  pickedUpBy: by,
  pickedUpAt: at,
});

describe('vaultPickupCell — «حالة الاستلام»: who collected it, and when', () => {
  it('says the captain or the desk, with the time of their ✓', () => {
    expect(vaultPickupCell(pickup('captain', '2026-11-14T06:10:00.000Z'))).toEqual({
      by: 'captain',
      at: '2026-11-14T06:10:00.000Z',
    });
    expect(vaultPickupCell(pickup('operations', '2026-11-14T07:05:00.000Z'))).toEqual({
      by: 'operations',
      at: '2026-11-14T07:05:00.000Z',
    });
  });

  it('says nobody — «لم يتم الاستلام» — with no time, on a draft and on a direct receipt alike', () => {
    expect(vaultPickupCell(pickup(null))).toEqual({ by: 'none', at: null });
    // Even a stray time with nobody's ✓ is not printed: there is no pickup to time.
    expect(vaultPickupCell(pickup(null, '2026-11-14T06:10:00.000Z'))).toEqual({
      by: 'none',
      at: null,
    });
  });

  it('reads the pickup RECORD, never the stage — past draft the stage is the vault’s', () => {
    expect(vaultPickupOf({ pickedUpBy: 'captain' })).toBe('captain');
    expect(vaultPickupOf({ pickedUpBy: null })).toBe('none');
    // A plain shipment (no board fields) has nobody's ✓ to read.
    expect(vaultPickupOf({})).toBe('none');
  });
});

describe('vaultHoldCell — «حالة الخزينة»: received yet, where it is since, and when', () => {
  const at = '2026-11-14T07:40:00.000Z';

  it('says «لم تُستلم بعد» on a draft, with no time', () => {
    expect(vaultHoldCell({ status: 'draft', vaultReceivedAt: null })).toEqual({
      hold: 'waiting',
      at: null,
    });
    expect(vaultHoldOf({ status: 'draft' })).toBe('waiting');
  });

  it('says «بالخزينة» with the vault’s time once received', () => {
    expect(vaultHoldCell({ status: 'inVault', vaultReceivedAt: at })).toEqual({
      hold: 'inVault',
      at,
    });
  });

  it('says where a receipt of today went since — out, or delivered — still with its receipt time', () => {
    expect(vaultHoldCell({ status: 'dispatched', vaultReceivedAt: at })).toEqual({
      hold: 'dispatched',
      at,
    });
    expect(vaultHoldCell({ status: 'completed', vaultReceivedAt: at })).toEqual({
      hold: 'completed',
      at,
    });
  });

  it('prints no time it was not given — a board row that is no vault-queue row', () => {
    expect(vaultHoldCell({ status: 'inVault' })).toEqual({ hold: 'inVault', at: null });
  });
});

describe('queueStampText — the time alone today, the day with it otherwise', () => {
  // 08:10 in Cairo (UTC+2 in November).
  const stamp = '2026-11-14T06:10:00.000Z';

  it('prints the time alone on the day it is about', () => {
    expect(queueStampText(stamp, '2026-11-14')).toBe('08:10');
  });

  it('prints the day too for an earlier day — a pickup from yesterday still waiting says so', () => {
    expect(queueStampText(stamp, '2026-11-15')).toBe('2026-11-14 08:10');
  });

  it('reads the Cairo day, not the UTC one', () => {
    // 23:30 UTC on the 13th is 01:30 on the 14th in Cairo.
    expect(queueStampText('2026-11-13T23:30:00.000Z', '2026-11-14')).toBe('01:30');
  });
});
