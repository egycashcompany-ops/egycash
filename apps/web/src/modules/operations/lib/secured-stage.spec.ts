// Where a محصنة stands on a board — its row's colour, the stages the secured screen's filter
// offers, and where the desk's ✓ is offered — asserted directly.
//
// «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها
// هتبقى اخضر عند الخزنة وعند العمليات».
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SECURED_STAGES,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { rowTint } from './day-board';
import {
  SECURED_SCREEN_STAGES,
  SECURED_STAGE_TINT,
  boardRowTint,
  offersDeliveryToggle,
  shownStage,
} from './secured-stage';

describe('SECURED_STAGE_TINT — white, yellow with the captain, green in the vault', () => {
  it('leaves a محصنة no captain has collected white', () => {
    expect(SECURED_STAGE_TINT.awaitingPickup).toBeUndefined();
  });

  it('turns it yellow once the captain has it — the daily rows’ own yellow', () => {
    expect(SECURED_STAGE_TINT.withCaptain).toBe(rowTint('captain'));
    expect(SECURED_STAGE_TINT.withCaptain).toMatch(/amber|yellow/);
  });

  // «هتبقى اخضر عند الخزنة وعند العمليات» — the same green the desk's ✓ gives a daily row.
  it('turns it green once the vault has received it, and once its delivery is confirmed', () => {
    expect(SECURED_STAGE_TINT.inVault).toBe(rowTint('desk'));
    expect(SECURED_STAGE_TINT.completed).toBe(rowTint('desk'));
    expect(SECURED_STAGE_TINT.inVault).toContain('emerald');
  });

  it('gives a dispatched one a tone of its own — neither the captain’s yellow nor the green', () => {
    const tint = SECURED_STAGE_TINT.dispatched ?? '';
    expect(tint).toContain('sky');
    expect(tint).not.toMatch(/amber|yellow|emerald/);
    // A light shade and a dark one, as every other tint has.
    expect(tint).toMatch(/!bg-sky-50\b/);
    expect(tint).toMatch(/dark:!bg-/);
  });

  it('has a colour (or none) for every stage the server can send', () => {
    for (const stage of OPERATIONS_SECURED_STAGES) expect(stage in SECURED_STAGE_TINT).toBe(true);
  });
});

describe('boardRowTint — a محصنة by its stage, a daily row by who delivered it', () => {
  const at = '2026-11-11T08:00:00.000Z';

  it('colours a secured row by its stage', () => {
    expect(
      boardRowTint({
        shipmentType: 'secured',
        status: 'dispatched',
        securedStage: 'dispatched',
        captainDeliveredAt: null,
      }),
    ).toBe(SECURED_STAGE_TINT.dispatched);
    expect(
      boardRowTint({ shipmentType: 'secured', status: 'draft', securedStage: 'withCaptain' }),
    ).toBe(rowTint('captain'));
    expect(
      boardRowTint({ shipmentType: 'secured', status: 'draft', securedStage: 'awaitingPickup' }),
    ).toBeUndefined();
    expect(
      boardRowTint({ shipmentType: 'secured', status: 'completed', securedStage: 'completed' }),
    ).toBe(rowTint('desk'));
  });

  // «لو تم التسليم من القائد من برا الحالة هتكون تم التسليم بس الصف لونه اصفر ولما ادوس انا على صح من
  // عندى يبقى الصف اخضر» — the day board's rule before the stages, and still its rule: a محصنة on the
  // road its DELIVERY captain has delivered from the app turns yellow, waiting for the desk's ✓.
  it('turns a dispatched محصنة its delivery captain has delivered yellow, as a daily row', () => {
    expect(
      boardRowTint({
        shipmentType: 'secured',
        status: 'dispatched',
        securedStage: 'dispatched',
        captainDeliveredAt: at,
      }),
    ).toBe(rowTint('captain'));
    // …and green once the desk confirms, whatever the captain did.
    expect(
      boardRowTint({
        shipmentType: 'secured',
        status: 'completed',
        securedStage: 'completed',
        captainDeliveredAt: at,
      }),
    ).toBe(rowTint('desk'));
  });

  it('keeps the daily rule for a daily row — yellow for the captain, green for the desk', () => {
    expect(
      boardRowTint({
        shipmentType: 'daily',
        status: 'draft',
        securedStage: null,
        captainDeliveredAt: at,
      }),
    ).toBe(rowTint('captain'));
    expect(boardRowTint({ shipmentType: 'daily', status: 'completed', securedStage: null })).toBe(
      rowTint('desk'),
    );
    expect(
      boardRowTint({ shipmentType: 'daily', status: 'draft', securedStage: null }),
    ).toBeUndefined();
  });

  it('falls back to the daily rule for a row sent with no stage at all', () => {
    expect(boardRowTint({ shipmentType: 'secured', status: 'completed' })).toBe(rowTint('desk'));
  });
});

describe('shownStage — the stage a status cell shows, or who delivered it', () => {
  const at = '2026-11-11T08:00:00.000Z';

  it('shows the stage of a secured row — every stage, before its delivery', () => {
    for (const stage of OPERATIONS_SECURED_STAGES) {
      expect(
        shownStage({
          shipmentType: 'secured',
          status: 'draft',
          securedStage: stage,
          captainDeliveredAt: null,
        }),
      ).toBe(stage);
    }
  });

  it('shows who delivered it instead once its delivery captain did, on the road', () => {
    expect(
      shownStage({
        shipmentType: 'secured',
        status: 'dispatched',
        securedStage: 'dispatched',
        captainDeliveredAt: at,
      }),
    ).toBeNull();
    // The desk's ✓ is a stage of its own — «تم التسليم», green.
    expect(
      shownStage({
        shipmentType: 'secured',
        status: 'completed',
        securedStage: 'completed',
        captainDeliveredAt: at,
      }),
    ).toBe('completed');
  });

  it('shows no stage on a daily row, nor on a row sent with none', () => {
    expect(
      shownStage({
        shipmentType: 'daily',
        status: 'draft',
        securedStage: null,
        captainDeliveredAt: at,
      }),
    ).toBeNull();
    expect(shownStage({ shipmentType: 'secured', status: 'draft' })).toBeNull();
  });
});

describe('SECURED_SCREEN_STAGES — what the secured screen’s «الحالة» offers', () => {
  it('lists the stages a row on it can be in, in their order', () => {
    expect([...SECURED_SCREEN_STAGES]).toEqual([
      'awaitingPickup',
      'withCaptain',
      'inVault',
      'dispatched',
    ]);
  });

  // The screen is every محصنة NOT completed — a «تم التسليم» answer could only empty the table.
  it('does not offer «تم التسليم», which never appears there', () => {
    expect(SECURED_SCREEN_STAGES).not.toContain('completed');
    expect(OPERATIONS_SECURED_STAGES.filter((s) => s !== 'completed')).toEqual([
      ...SECURED_SCREEN_STAGES,
    ]);
  });
});

describe('offersDeliveryToggle — the ✓ only where the server takes it', () => {
  const row = (shipmentType: OperationsShipmentType, status: OperationsShipmentStatus) => ({
    shipmentType,
    status,
  });

  it('is offered on every daily row — it completes from draft and reopens from completed', () => {
    expect(offersDeliveryToggle(row('daily', 'draft'))).toBe(true);
    expect(offersDeliveryToggle(row('daily', 'completed'))).toBe(true);
  });

  // shipment-status.ts: secured draft → inVault → dispatched → completed, completed → dispatched.
  // The desk's ✓ is only the last step and its undo; before that the steps are other hands'.
  it('is offered on a محصنة only once it has left the vault — and on a delivered one, to undo', () => {
    expect(offersDeliveryToggle(row('secured', 'dispatched'))).toBe(true);
    expect(offersDeliveryToggle(row('secured', 'completed'))).toBe(true);
  });

  it('is not offered while the محصنة is on its way to the vault, or in it', () => {
    expect(offersDeliveryToggle(row('secured', 'draft'))).toBe(false);
    expect(offersDeliveryToggle(row('secured', 'inVault'))).toBe(false);
  });
});
