// Dragging the currencies into order — «اقدر ارتبهم عن طريق الشد والترك», Fleet's catalogs' rules
// (fleet/pages/CatalogsPage.tsx `move` / `step`), asserted directly.
import { describe, expect, it } from 'vitest';
import { inPendingOrder, moveInOrder, stepInOrder } from './catalog-order';

const IDS = ['egp', 'usd', 'eur', 'gbp'];

describe('moveInOrder — dropped ON a row, it takes that row’s place', () => {
  it('lands below the row it was dropped on when moving down', () => {
    expect(moveInOrder(IDS, 'egp', 'eur')).toEqual(['usd', 'eur', 'egp', 'gbp']);
  });

  it('lands above the row it was dropped on when moving up', () => {
    expect(moveInOrder(IDS, 'gbp', 'usd')).toEqual(['egp', 'gbp', 'usd', 'eur']);
  });

  it('moves to either end', () => {
    expect(moveInOrder(IDS, 'eur', 'egp')).toEqual(['eur', 'egp', 'usd', 'gbp']);
    expect(moveInOrder(IDS, 'egp', 'gbp')).toEqual(['usd', 'eur', 'gbp', 'egp']);
  });

  it('is null when nothing moves — dropped on itself, or an id the list does not hold', () => {
    expect(moveInOrder(IDS, 'usd', 'usd')).toBeNull();
    expect(moveInOrder(IDS, 'gone', 'usd')).toBeNull();
    expect(moveInOrder(IDS, 'usd', 'gone')).toBeNull();
  });

  it('never touches the list it was given', () => {
    const ids = [...IDS];
    moveInOrder(ids, 'egp', 'gbp');
    expect(ids).toEqual(IDS);
  });
});

describe('stepInOrder — the arrows, how a keyboard moves a row', () => {
  it('swaps a row with its neighbour', () => {
    expect(stepInOrder(IDS, 'eur', -1)).toEqual(['egp', 'eur', 'usd', 'gbp']);
    expect(stepInOrder(IDS, 'eur', 1)).toEqual(['egp', 'usd', 'gbp', 'eur']);
  });

  it('is null at either end — the first cannot go up, the last cannot go down', () => {
    expect(stepInOrder(IDS, 'egp', -1)).toBeNull();
    expect(stepInOrder(IDS, 'gbp', 1)).toBeNull();
    expect(stepInOrder(IDS, 'gone', 1)).toBeNull();
  });
});

describe('inPendingOrder — the dropped order on screen while it is being saved', () => {
  const items = IDS.map((id) => ({ id }));

  it('shows the server’s order when nothing is pending', () => {
    expect(inPendingOrder(items, null).map((item) => item.id)).toEqual(IDS);
  });

  it('shows the dropped order at once, before the server answers', () => {
    const pending = ['gbp', 'egp', 'usd', 'eur'];
    expect(inPendingOrder(items, pending).map((item) => item.id)).toEqual(pending);
  });

  it('keeps a row the pending order does not name — added meanwhile — after the named ones', () => {
    const more = [...items, { id: 'sar' }];
    expect(inPendingOrder(more, ['usd', 'egp', 'eur', 'gbp']).map((item) => item.id)).toEqual([
      'usd',
      'egp',
      'eur',
      'gbp',
      'sar',
    ]);
  });

  it('drops a pending id the list no longer holds', () => {
    expect(inPendingOrder(items, ['gone', 'usd']).map((item) => item.id)).toEqual([
      'usd',
      'egp',
      'eur',
      'gbp',
    ]);
  });
});
