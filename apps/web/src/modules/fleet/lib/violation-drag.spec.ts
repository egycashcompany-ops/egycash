// The rules the drag carries, tested without a DOM — a drag cannot be performed in this suite, so
// what CAN be pinned is everything either side of it.
import { describe, expect, it } from 'vitest';
import {
  VIOLATION_DRAG_TYPE,
  canReceive,
  draggedIds,
  readDraggedIds,
} from './violation-drag';

describe('what a dragged row carries', () => {
  it('drags the WHOLE selection when the row pulled is part of it', () => {
    // Ticking four fines and pulling one of them means «these four», which is the entire point of
    // the multi-select: «مالتي تشيك على أكتر من سواق وأخدهم دراج».
    expect(draggedIds('b', new Set(['a', 'b', 'c'])).sort()).toEqual(['a', 'b', 'c']);
  });

  it('drags ONLY the row pulled when it is not selected, and keeps the selection', () => {
    // Picking up an unticked row must not be a silent way to move four other ones.
    expect(draggedIds('z', new Set(['a', 'b']))).toEqual(['z']);
  });

  it('drags one row when nothing is selected at all', () => {
    expect(draggedIds('a', new Set())).toEqual(['a']);
  });
});

describe('reading a drop back', () => {
  it('round-trips what a drag put on the wire', () => {
    const ids = ['65000000000000000000a1', '65000000000000000000a2'];
    expect(readDraggedIds(JSON.stringify(ids))).toEqual(ids);
  });

  it('answers with nothing for a drag that is not ours', () => {
    // A roster driver id, a file, an empty payload: all of them reach `drop` as a string, and a
    // target that trusted it would send a malformed id to the server.
    for (const raw of ['', 'not json', '{"a":1}', '[]', 'null']) {
      expect(readDraggedIds(raw), raw).toEqual([]);
    }
  });

  it('drops anything in the list that is not an id', () => {
    expect(readDraggedIds('["a", 1, null, "", "b"]')).toEqual(['a', 'b']);
  });

  it('has its own transfer type, so a roster drag cannot land here', () => {
    expect(VIOLATION_DRAG_TYPE).toBe('application/x-ecms-violations');
    expect(VIOLATION_DRAG_TYPE).not.toBe('application/x-ecms-driver');
  });
});

describe('which group may receive one', () => {
  it('refuses without the edit grant — moving a fine is a correction, not a collection', () => {
    expect(canReceive({ vehicleId: 'v1' }, false)).toBe(false);
  });

  it('refuses a group from the OLD BOOK — it has no id any write path accepts', () => {
    // Such a group is named by the code the book wrote and has no vehicle behind it, so accepting
    // the drop would be promising a 422 the reader can do nothing about.
    expect(canReceive({ vehicleId: null }, true)).toBe(false);
  });

  it('accepts an ordinary group from a reader who may edit', () => {
    expect(canReceive({ vehicleId: 'v1' }, true)).toBe(true);
  });
});
