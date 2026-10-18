// The draft kept on this device (spec §9.4, DM-29): a storage that throws is survived and `saveDraft`
// says so; an outdated revision is detected; and the key carries the user, so user B is never
// offered user A's draft for the same branch.
import { describe, expect, it } from 'vitest';
import { type AtmMapZoneSetDto } from '@ecms/contracts';
import { dirtyCount, initialZoneEditorState, zoneEditorReducer } from './zone-editor';
import {
  autosaveAction,
  clearDraft,
  draftKey,
  draftOffer,
  loadDraft,
  saveDraft,
  type DraftStorage,
  type StoredDraft,
} from './zone-draft-storage';

const memory = (): DraftStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
};

const throwing: DraftStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const DRAFT: StoredDraft = {
  baseRevision: 4,
  savedAt: '2026-10-18T10:00:00.000Z',
  draft: [
    {
      id: 'new-1',
      name: 'قطاع 1',
      color: '#483bba',
      points: [
        { lat: 30, lng: 31 },
        { lat: 30, lng: 31.01 },
        { lat: 30.01, lng: 31 },
      ],
    },
  ],
};

describe('zone draft storage', () => {
  it('keeps and returns a draft under the user and branch key', () => {
    const storage = memory();
    expect(saveDraft('userA', 'b1', DRAFT, storage)).toBe(true);
    expect([...storage.data.keys()]).toEqual([draftKey('userA', 'b1')]);
    expect(draftKey('userA', 'b1')).toBe('ecms.atmMap.zoneDraft.userA.b1');
    expect(loadDraft('userA', 'b1', storage)).toEqual(DRAFT);
    clearDraft('userA', 'b1', storage);
    expect(loadDraft('userA', 'b1', storage)).toBeNull();
  });

  it('a draft saved by user A is not offered to user B for the same branch', () => {
    const storage = memory();
    saveDraft('userA', 'b1', DRAFT, storage);
    expect(loadDraft('userB', 'b1', storage)).toBeNull();
    expect(loadDraft('userA', 'b2', storage)).toBeNull();
  });

  it('survives a storage that throws, and saveDraft returns false', () => {
    expect(saveDraft('userA', 'b1', DRAFT, throwing)).toBe(false);
    expect(loadDraft('userA', 'b1', throwing)).toBeNull();
    expect(() => clearDraft('userA', 'b1', throwing)).not.toThrow();
    // No storage at all (the node test environment has no `window`).
    expect(saveDraft('userA', 'b1', DRAFT)).toBe(false);
    expect(loadDraft('userA', 'b1')).toBeNull();
  });

  it('ignores a value that is not a draft', () => {
    const storage = memory();
    storage.setItem(draftKey('userA', 'b1'), '{"baseRevision":"4"}');
    expect(loadDraft('userA', 'b1', storage)).toBeNull();
    storage.setItem(draftKey('userA', 'b1'), 'not json');
    expect(loadDraft('userA', 'b1', storage)).toBeNull();
  });

  it('detects an outdated revision', () => {
    expect(draftOffer(DRAFT, 4)).toBe('restore');
    expect(draftOffer(DRAFT, 5)).toBe('outdated');
    expect(draftOffer(null, 5)).toBeNull();
  });
});

describe('autosaveAction — what the page does with the stored draft after a render', () => {
  const SET: AtmMapZoneSetDto = {
    branchId: 'b1',
    revision: 4,
    zones: [
      {
        id: '6650a1b2c3d4e5f60000000a',
        branchId: 'b1',
        name: 'قطاع 1',
        color: '#483bba',
        order: 0,
        points: [
          { lat: 30, lng: 31 },
          { lat: 30, lng: 31.01 },
          { lat: 30.01, lng: 31.01 },
          { lat: 30.01, lng: 31 },
        ],
        updatedAt: '2026-10-18T00:00:00.000Z',
      },
    ],
  };
  /** The page's own effect, run against a storage after each state. */
  const effect = (
    storage: DraftStorage,
    state: typeof initialZoneEditorState,
    offerPending: boolean,
  ): void => {
    const action = autosaveAction({
      gestureActive: state.gesture !== null,
      offerPending,
      dirty: dirtyCount(state.base, state.draft),
    });
    if (action === 'clear') clearDraft('userA', 'b1', storage);
    if (action === 'save' && state.base !== null) {
      saveDraft(
        'userA',
        'b1',
        { baseRevision: state.base.revision, draft: state.draft, savedAt: 'now' },
        storage,
      );
    }
  };

  it('opening the editor while a draft is offered leaves that draft stored', () => {
    const storage = memory();
    saveDraft('userA', 'b1', DRAFT, storage);
    const opened = zoneEditorReducer(initialZoneEditorState, { type: 'ENTER_EDIT', set: SET });
    effect(storage, opened, true);
    // A reload, or «خروج من التعديل» before choosing, still finds it.
    expect(loadDraft('userA', 'b1', storage)).toEqual(DRAFT);
    // «تجاهلها»: the offer ends, the draft is clean — now it is cleared.
    effect(storage, opened, false);
    expect(loadDraft('userA', 'b1', storage)).toBeNull();
  });

  it('a drag writes nothing until it ends, then one draft — never a mid-gesture shape', () => {
    const storage = memory();
    let state = zoneEditorReducer(initialZoneEditorState, { type: 'ENTER_EDIT', set: SET });
    const writes: string[] = [];
    const counting: DraftStorage = {
      ...storage,
      setItem: (k, v) => {
        writes.push(v);
        storage.setItem(k, v);
      },
    };
    for (let frame = 1; frame <= 30; frame += 1) {
      state = zoneEditorReducer(state, {
        type: 'MOVE_VERTEX',
        zoneId: '6650a1b2c3d4e5f60000000a',
        index: 2,
        point: { lat: 30.01 + frame * 1e-4, lng: 31.01 },
        unlink: false,
      });
      effect(counting, state, false);
    }
    expect(writes).toHaveLength(0);
    state = zoneEditorReducer(state, { type: 'END_GESTURE' });
    effect(counting, state, false);
    expect(writes).toHaveLength(1);
    expect(autosaveAction({ gestureActive: true, offerPending: false, dirty: 3 })).toBe('none');
  });
});
