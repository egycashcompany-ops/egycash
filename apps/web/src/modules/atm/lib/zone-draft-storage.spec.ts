// The draft kept on this device (spec §9.4, DM-29): a storage that throws is survived and `saveDraft`
// says so; an outdated revision is detected; and the key carries the user, so user B is never
// offered user A's draft for the same branch.
import { describe, expect, it } from 'vitest';
import {
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
