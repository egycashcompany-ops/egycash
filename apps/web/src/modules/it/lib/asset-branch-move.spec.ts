// «نقل إلى فرع» — which picked assets go to the chosen branch and why the others stay: an asset in
// stock moves, one held by an employee moves with its custody («ينتقل مع عهدته»), and one disposed,
// under maintenance or already there is left out of the request, the server refusing each too.
import { describe, expect, it } from 'vitest';
import { IT_ASSET_MOVE_MAX, type ItAssetStatus } from '@ecms/contracts';
import { translate } from '../../../platform/localization/i18n';
import {
  ASSET_MOVE_REFUSALS,
  assetMoveEligibility,
  assetMovePlan,
  assetMoveRequest,
  assetsMovedWords,
  sharedBranch,
  type MovableAsset,
} from './asset-branch-move';

const asset = (
  id: string,
  status: ItAssetStatus,
  branchId = 'b-hq',
  hasActiveMaintenance = false,
): MovableAsset => ({ id, status, branchId, hasActiveMaintenance });

const IN_STOCK = asset('a-1', 'inStock');
const HELD = asset('a-2', 'assigned');
const IN_REPAIR = asset('a-3', 'underMaintenance');
const GONE = asset('a-4', 'disposed');
const IN_OCTOBER = asset('a-5', 'inStock', 'b-oct');
// An order open on it (the preventive sweep's, say) leaves the status as it was.
const ORDER_OPEN = asset('a-6', 'inStock', 'b-hq', true);
const HELD_ORDER_OPEN = asset('a-7', 'assigned', 'b-hq', true);

describe('one asset against the branch chosen', () => {
  it('moves an asset in stock, and one held by an employee — with its custody', () => {
    expect(assetMoveEligibility(IN_STOCK, 'b-oct')).toEqual({ movable: true, held: false });
    expect(assetMoveEligibility(HELD, 'b-oct')).toEqual({ movable: true, held: true });
  });

  it('leaves out what the server refuses: disposed, under maintenance, already there', () => {
    expect(assetMoveEligibility(GONE, 'b-oct')).toEqual({ movable: false, reason: 'disposed' });
    expect(assetMoveEligibility(IN_REPAIR, 'b-oct')).toEqual({
      movable: false,
      reason: 'underMaintenance',
    });
    expect(assetMoveEligibility(IN_OCTOBER, 'b-oct')).toEqual({
      movable: false,
      reason: 'alreadyThere',
    });
    expect([...ASSET_MOVE_REFUSALS]).toEqual(['disposed', 'underMaintenance', 'alreadyThere']);
  });

  it('before a branch is chosen, refuses only what no branch could change', () => {
    expect(assetMoveEligibility(IN_OCTOBER, '')).toEqual({ movable: true, held: false });
    expect(assetMoveEligibility(GONE, '')).toEqual({ movable: false, reason: 'disposed' });
    expect(assetMoveEligibility(ORDER_OPEN, '')).toEqual({
      movable: false,
      reason: 'underMaintenance',
    });
  });

  it('an order open or in progress is under maintenance whatever the status says', () => {
    const verdict = { movable: false, reason: 'underMaintenance' };
    expect(assetMoveEligibility(ORDER_OPEN, 'b-oct')).toEqual(verdict);
    expect(assetMoveEligibility(HELD_ORDER_OPEN, 'b-oct')).toEqual(verdict);
    const plan = assetMovePlan([IN_STOCK, ORDER_OPEN, HELD_ORDER_OPEN], 'b-oct');
    expect(plan.movable.map((a) => a.id)).toEqual(['a-1']);
    expect(plan.refused.map((r) => [r.asset.id, r.reason])).toEqual([
      ['a-6', 'underMaintenance'],
      ['a-7', 'underMaintenance'],
    ]);
    // The held one stays, so no custody moves.
    expect(plan.anyHeld).toBe(false);
  });
});

describe('the picked assets as one move', () => {
  it('splits them, in the order picked, and says when a held one goes with its custody', () => {
    const plan = assetMovePlan([IN_STOCK, GONE, HELD, IN_OCTOBER, IN_REPAIR], 'b-oct');
    expect(plan.movable.map((a) => a.id)).toEqual(['a-1', 'a-2']);
    expect(plan.refused.map((r) => [r.asset.id, r.reason])).toEqual([
      ['a-4', 'disposed'],
      ['a-5', 'alreadyThere'],
      ['a-3', 'underMaintenance'],
    ]);
    expect(plan.anyHeld).toBe(true);
    expect(plan.tooMany).toBe(false);
    expect(assetMovePlan([IN_STOCK], 'b-oct').anyHeld).toBe(false);
  });

  it('a held asset that stays is no custody moving', () => {
    expect(assetMovePlan([asset('a-9', 'assigned', 'b-oct')], 'b-oct').anyHeld).toBe(false);
  });

  it('knows when one request could not carry them all', () => {
    const many = Array.from({ length: IT_ASSET_MOVE_MAX + 1 }, (_, i) =>
      asset(`a-${i}`, 'inStock'),
    );
    expect(assetMovePlan(many, 'b-oct').tooMany).toBe(true);
    expect(assetMovePlan(many.slice(1), 'b-oct').tooMany).toBe(false);
  });

  it('names the branch they all sit in — no destination — and none when they differ', () => {
    expect(sharedBranch([IN_STOCK, HELD])).toBe('b-hq');
    expect(sharedBranch([IN_STOCK, IN_OCTOBER])).toBeNull();
    expect(sharedBranch([])).toBeNull();
  });
});

describe('the request', () => {
  const plan = assetMovePlan([IN_STOCK, GONE, HELD], 'b-oct');

  it('carries only what moves, to the branch chosen, with the date and the notes when given', () => {
    expect(assetMoveRequest(plan, 'b-oct', '2026-11-11T10:30', '  إلى مخزن أكتوبر  ')).toEqual({
      assetIds: ['a-1', 'a-2'],
      toBranchId: 'b-oct',
      at: new Date('2026-11-11T10:30'),
      notes: 'إلى مخزن أكتوبر',
    });
    // No date: the server stamps now. No notes: none sent.
    expect(assetMoveRequest(plan, 'b-oct', '', ' ')).toEqual({
      assetIds: ['a-1', 'a-2'],
      toBranchId: 'b-oct',
    });
  });

  it('is not sent with no branch chosen, nothing to move, or more than one request carries', () => {
    expect(assetMoveRequest(plan, '', '', '')).toBeNull();
    expect(assetMoveRequest(assetMovePlan([GONE, IN_REPAIR], 'b-oct'), 'b-oct', '', '')).toBeNull();
    const many = Array.from({ length: IT_ASSET_MOVE_MAX + 1 }, (_, i) =>
      asset(`a-${i}`, 'inStock'),
    );
    expect(assetMoveRequest(assetMovePlan(many, 'b-oct'), 'b-oct', '', '')).toBeNull();
  });
});

describe('the toast, in Arabic’s count forms', () => {
  const t = (key: string, params?: Record<string, string | number>): string =>
    translate('ar', key, params);

  it('counts the assets moved as Arabic counts them', () => {
    expect(assetsMovedWords(t, 'ar', 1, 'أكتوبر')).toBe('نُقل أصل واحد إلى أكتوبر');
    expect(assetsMovedWords(t, 'ar', 2, 'أكتوبر')).toBe('نُقل أصلان إلى أكتوبر');
    expect(assetsMovedWords(t, 'ar', 5, 'أكتوبر')).toBe('نُقل ٥ أصول إلى أكتوبر');
    expect(assetsMovedWords(t, 'ar', 12, 'أكتوبر')).toBe('نُقل ١٢ أصلًا إلى أكتوبر');
    expect(assetsMovedWords(t, 'ar', 100, 'أكتوبر')).toBe('نُقل ١٠٠ أصل إلى أكتوبر');
  });

  it('and in English', () => {
    const en = (key: string, params?: Record<string, string | number>): string =>
      translate('en', key, params);
    expect(assetsMovedWords(en, 'en', 1, 'October')).toBe('Moved 1 asset to October');
    expect(assetsMovedWords(en, 'en', 3, 'October')).toBe('Moved 3 assets to October');
  });
});
