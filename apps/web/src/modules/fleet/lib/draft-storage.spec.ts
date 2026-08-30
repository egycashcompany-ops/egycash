// A draft survives a reload, belongs to one board, and never breaks a screen.
//
// The three claims worth defending, in order of what goes wrong when they fail: a draft that
// does not come back loses a morning's work; a draft that comes back on the WRONG DAY writes
// one day's crew onto another; and a draft that throws takes the whole screen with it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDraft,
  FIXED_ROSTER_DRAFT_KEY,
  readDraft,
  rosterDraftKey,
  ROSTER_EDITABLE_FIELDS,
  writeDraft,
} from './draft-storage';

/** The web suite runs in node, so `sessionStorage` is stood up here rather than assumed. */
const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
vi.stubGlobal('window', { sessionStorage: storage });

interface Row {
  vehicleId: string;
  code: string;
  driver1EmployeeId: string | null;
  inMaintenance?: boolean;
}
const row = (vehicleId: string, code: string, d1: string | null = null): Row => ({
  vehicleId,
  code,
  driver1EmployeeId: d1,
});

const EDITABLE = { driver1EmployeeId: 'id' } as const;

/**
 * Real 24-hex ids. The fixtures used to say `'e1'`, which no board ever holds — and a restore
 * rule that checks the shape of an id is exactly the thing such a fixture would hide.
 */
const minted = new Map<string, string>();
const oid = (tag: string): string => {
  const found = minted.get(tag);
  if (found !== undefined) return found;
  const id = `6500000000000000000${String(minted.size + 1).padStart(5, '0')}`;
  minted.set(tag, id);
  return id;
};

const BOARD: Row[] = [row('v1', '150'), row('v2', '151'), row('v3', '152')];

beforeEach(() => store.clear());

describe('a draft comes back after a reload', () => {
  it('restores what was written', () => {
    const edited = [row('v1', '150', oid('e1')), ...BOARD.slice(1)];
    writeDraft(FIXED_ROSTER_DRAFT_KEY, edited);
    expect(readDraft(FIXED_ROSTER_DRAFT_KEY, BOARD, EDITABLE)).toEqual(edited);
  });

  it('is nothing at all when nothing was written', () => {
    expect(readDraft(FIXED_ROSTER_DRAFT_KEY, BOARD, EDITABLE)).toBeNull();
  });

  it('is nothing after it is cleared — «إلغاء», and a completed save', () => {
    writeDraft(FIXED_ROSTER_DRAFT_KEY, [row('v1', '150', oid('e1')), ...BOARD.slice(1)]);
    clearDraft(FIXED_ROSTER_DRAFT_KEY);
    expect(readDraft(FIXED_ROSTER_DRAFT_KEY, BOARD, EDITABLE)).toBeNull();
  });

  it('does not restore a draft that says the same thing as the board', () => {
    // What a SAVE leaves behind: the server's answer now matches what was persisted, so those
    // rows are no longer anybody's pending work. Restoring them would show a dirty banner over
    // a board with nothing to save.
    writeDraft(FIXED_ROSTER_DRAFT_KEY, BOARD);
    expect(readDraft(FIXED_ROSTER_DRAFT_KEY, BOARD, EDITABLE)).toBeNull();
  });

  it('keeps one vehicle’s edit off another', () => {
    const edited = [row('v1', '150', oid('e1')), row('v2', '151'), row('v3', '152', oid('e3'))];
    writeDraft(FIXED_ROSTER_DRAFT_KEY, edited);
    const back = readDraft(FIXED_ROSTER_DRAFT_KEY, BOARD, EDITABLE);
    expect(back?.map((r) => r.driver1EmployeeId)).toEqual([oid('e1'), null, oid('e3')]);
  });
});

describe('one day’s draft is not another day’s', () => {
  const D1 = rosterDraftKey('2026-09-01');
  const D2 = rosterDraftKey('2026-09-02');
  const D3 = rosterDraftKey('2026-09-03');

  it('gives each date its own key', () => {
    expect(D1).not.toBe(D2);
    expect(rosterDraftKey('2026-09-01')).toBe(D1);
  });

  it('does not show day 1’s draft on day 2', () => {
    writeDraft(D1, [row('v1', '150', oid('day-1-driver')), ...BOARD.slice(1)]);
    expect(readDraft(D2, BOARD, EDITABLE), 'day 2 has no draft of its own').toBeNull();
  });

  it('shows day 2 its OWN draft when it has one', () => {
    writeDraft(D1, [row('v1', '150', oid('day-1-driver')), ...BOARD.slice(1)]);
    writeDraft(D2, [row('v1', '150', oid('day-2-driver')), ...BOARD.slice(1)]);
    expect(readDraft(D2, BOARD, EDITABLE)?.[0]?.driver1EmployeeId).toBe(oid('day-2-driver'));
  });

  it('restores day 1 again on the way back', () => {
    writeDraft(D1, [row('v1', '150', oid('day-1-driver')), ...BOARD.slice(1)]);
    writeDraft(D2, [row('v1', '150', oid('day-2-driver')), ...BOARD.slice(1)]);
    expect(readDraft(D1, BOARD, EDITABLE)?.[0]?.driver1EmployeeId).toBe(oid('day-1-driver'));
  });

  it('leaks nothing across three days', () => {
    writeDraft(D1, [row('v1', '150', oid('a')), ...BOARD.slice(1)]);
    writeDraft(D3, [row('v1', '150', oid('c')), ...BOARD.slice(1)]);
    expect(readDraft(D1, BOARD, EDITABLE)?.[0]?.driver1EmployeeId).toBe(oid('a'));
    expect(readDraft(D2, BOARD, EDITABLE), 'the middle day was never edited').toBeNull();
    expect(readDraft(D3, BOARD, EDITABLE)?.[0]?.driver1EmployeeId).toBe(oid('c'));
  });

  it('saving one day does not throw away another day’s work', () => {
    writeDraft(D1, [row('v1', '150', oid('a')), ...BOARD.slice(1)]);
    writeDraft(D2, [row('v1', '150', oid('b')), ...BOARD.slice(1)]);
    clearDraft(D1); // day 1 saved
    expect(readDraft(D1, BOARD, EDITABLE)).toBeNull();
    expect(readDraft(D2, BOARD, EDITABLE)?.[0]?.driver1EmployeeId, 'day 2 is untouched').toBe(oid('b'));
  });

  it('the FIXED roster key carries no date — it is not a day', () => {
    // `fleet_fixed_crews` is one standing row per vehicle with no date anywhere in it. A date in
    // this key would split one board's draft across a key per day, so a reader would lose their
    // work by doing nothing but waiting past midnight.
    expect(FIXED_ROSTER_DRAFT_KEY).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(FIXED_ROSTER_DRAFT_KEY).not.toBe(rosterDraftKey(''));
  });
});

describe('a bad draft never breaks the screen', () => {
  const KEY = FIXED_ROSTER_DRAFT_KEY;

  it('survives text that is not JSON', () => {
    store.set(KEY, 'not json at all {{{');
    expect(() => readDraft(KEY, BOARD, EDITABLE)).not.toThrow();
    expect(readDraft(KEY, BOARD, EDITABLE)).toBeNull();
  });

  for (const [what, value] of [
    ['an object where an array belongs', '{"vehicleId":"v1"}'],
    ['a bare string', '"hello"'],
    ['null', 'null'],
    ['an empty array', '[]'],
    ['entries that are not rows', '[1,2,3]'],
    ['a row with no vehicleId', '[{"code":"150"}]'],
    ['a row whose vehicleId is not a string', '[{"vehicleId":42}]'],
    ['a row with an empty vehicleId', '[{"vehicleId":""}]'],
  ] as const) {
    it(`survives ${what}`, () => {
      store.set(KEY, value);
      expect(() => readDraft(KEY, BOARD, EDITABLE)).not.toThrow();
      expect(readDraft(KEY, BOARD, EDITABLE), 'falls back to the server board').toBeNull();
    });
  }

  it('drops rows for vehicles the board no longer has', () => {
    // A vehicle sold, or a reader whose scope narrowed between the edit and the reload. Such a
    // row must not be restored: the board cannot show it, and sending it would be a save the
    // server refuses and the reader cannot explain.
    writeDraft(KEY, [row('v1', '150', oid('e1')), row('GONE', '999', oid('e9'))]);
    const back = readDraft(KEY, BOARD, EDITABLE);
    expect(back?.map((r) => r.vehicleId)).toEqual(['v1', 'v2', 'v3']);
    expect(back?.some((r) => r.driver1EmployeeId === oid('e9'))).toBe(false);
  });

  it('takes new vehicles from the SERVER, not from the stale draft', () => {
    writeDraft(KEY, [row('v1', '150', oid('e1'))]);
    const grown = [...BOARD, row('v4', '153', oid('from-server'))];
    const back = readDraft(KEY, grown, EDITABLE);
    expect(back?.map((r) => r.vehicleId)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(back?.[3]?.driver1EmployeeId).toBe(oid('from-server'));
  });

  it('takes facts about the WORLD from the server, not from storage', () => {
    // The workshop took the vehicle while the draft sat in storage. That is the server's to say,
    // and a stale `false` would offer a drop the rule (FR-5) then refuses.
    writeDraft(KEY, [{ ...row('v1', '150', oid('e1')), inMaintenance: false }]);
    const now = [{ ...row('v1', '150'), inMaintenance: true }, ...BOARD.slice(1)];
    const back = readDraft(KEY, now, EDITABLE);
    expect(back?.[0]?.inMaintenance, 'the workshop still holds it').toBe(true);
    expect(back?.[0]?.driver1EmployeeId, 'and the edit is still restored').toBe(oid('e1'));
  });

  it('cannot reorder or duplicate the board from storage', () => {
    writeDraft(KEY, [row('v3', '152', oid('e3')), row('v1', '150', oid('e1')), row('v1', '150', 'again')]);
    const back = readDraft(KEY, BOARD, EDITABLE);
    expect(back?.map((r) => r.vehicleId), 'the board keeps its own order').toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('restores nothing before the board has arrived', () => {
    // On a cold load the query answers after the first paint. Restoring against an empty board
    // would produce an empty draft and then reconcile it away — so it simply waits.
    writeDraft(KEY, [row('v1', '150', oid('e1'))]);
    expect(readDraft(KEY, [], EDITABLE)).toBeNull();
  });

  it('survives storage being unavailable entirely', () => {
    // Private mode, or a browser with site data blocked. A board that cannot remember must
    // still work.
    const blown = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    vi.stubGlobal('window', { sessionStorage: blown });
    expect(() => writeDraft(KEY, BOARD)).not.toThrow();
    expect(() => clearDraft(KEY)).not.toThrow();
    expect(readDraft(KEY, BOARD, EDITABLE)).toBeNull();
    vi.stubGlobal('window', { sessionStorage: storage });
  });
});

describe('the draft is a local memory, never a save', () => {
  it('writes only to sessionStorage — nothing here reaches the server', async () => {
    // The rule stated as source: this module imports no api client, and uses no fetch. A future
    // edit that "helpfully" posted the draft would be creating server state nobody asked for.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./draft-storage.ts', import.meta.url)), 'utf8');
    // Comments stripped: the header EXPLAINS why localStorage was rejected, and matching raw
    // source would fail on its own reasoning.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code, 'nothing here talks to the API').not.toMatch(/\bfetch\(|\bapi\.|axios/);
    expect(code, 'and it is session-scoped, not localStorage').not.toContain('localStorage');
    expect(code).toContain('sessionStorage');
  });
});

// ── a stored field the server would refuse never reaches the payload ───────
//
// The defect this closes, proven in a browser before it was written: a draft written by an
// older build of this screen held `missionTypeId: "undefined"` — what the API's mapper produced
// from a field the database did not have. The server's own answer was corrected, but the
// restore laid the stored value back over it verbatim, so the board showed an unsaved change
// nobody had made and «حفظ» was refused every time. There was no way out but to know that
// «إلغاء» clears storage.
//
// The rule restated here is the CONTRACT'S OWN, not a looser second one: an id is null or 24
// hex characters; a note is null or 1–500 characters trimmed. Nothing is validated on the
// client's authority — the server still decides and still refuses all of these. What stops is
// the board PROPOSING a value it can already see will be refused, and one the reader never typed.
describe('a draft field the server would refuse is dropped, not restored', () => {
  const KEY = FIXED_ROSTER_DRAFT_KEY;
  const MISSION = oid('mission');
  const FIELDS = {
    missionTypeId: 'id',
    driver1EmployeeId: 'id',
    notes: 'text',
  } as const;

  interface Full {
    vehicleId: string;
    code: string;
    missionTypeId: string | null;
    driver1EmployeeId: string | null;
    notes: string | null;
  }
  const full = (over: Partial<Full> = {}): Full => ({
    vehicleId: 'v1',
    code: '150',
    missionTypeId: null,
    driver1EmployeeId: null,
    notes: null,
    ...over,
  });
  const restore = (server: Full, stored: Record<string, unknown>): Full | null => {
    writeDraft(KEY, [{ vehicleId: 'v1', ...stored }]);
    return readDraft(KEY, [server], FIELDS)?.[0] ?? null;
  };

  it('1. server null + stored "undefined" → stays null', () => {
    expect(restore(full(), { missionTypeId: 'undefined' })).toBeNull();
  });

  it('2. server a real id + stored "undefined" → keeps the SERVER’s id', () => {
    const back = restore(full({ missionTypeId: MISSION }), { missionTypeId: 'undefined' });
    // Nothing usable was stored, so there is no draft at all — the board equals the server.
    expect(back).toBeNull();
    expect(readDraft(KEY, [full({ missionTypeId: MISSION })], FIELDS)).toBeNull();
  });

  it('3. server null + stored "" → stays null', () => {
    expect(restore(full(), { missionTypeId: '' })).toBeNull();
  });

  it('4. server a real id + stored "" → keeps the server’s id', () => {
    expect(restore(full({ missionTypeId: MISSION }), { missionTypeId: '' })).toBeNull();
  });

  it('5. server a real id + stored "null" → keeps the server’s id', () => {
    expect(restore(full({ missionTypeId: MISSION }), { missionTypeId: 'null' })).toBeNull();
  });

  it('6. a VALID stored id is restored, exactly as before', () => {
    const other = oid('other');
    expect(restore(full(), { missionTypeId: other })?.missionTypeId).toBe(other);
  });

  it('7. an explicit null CLEARS a value the server still holds — that is a real edit', () => {
    // The one case that must not be confused with junk: «no mission» is a decision.
    expect(restore(full({ missionTypeId: MISSION }), { missionTypeId: null })?.missionTypeId).
      toBeNull();
  });

  it('8. one bad field does not take the rest of the draft with it', () => {
    const driver = oid('driver');
    const back = restore(full({ missionTypeId: MISSION }), {
      missionTypeId: 'undefined', // dropped
      driver1EmployeeId: driver, // kept
      notes: 'يبدأ من المخزن', // kept
    });
    expect(back?.missionTypeId, 'the server’s value survives').toBe(MISSION);
    expect(back?.driver1EmployeeId, 'the good edit survives').toBe(driver);
    expect(back?.notes).toBe('يبدأ من المخزن');
  });

  it('refuses every other shape of junk in an id field', () => {
    for (const junk of [
      'undefined',
      'null',
      '',
      '   ',
      'NaN',
      '650000000000000000000',
      '65000000000000000000012345',
      'zzzzzzzzzzzzzzzzzzzzzzzz',
      42,
      true,
      { id: MISSION },
      ['x'],
    ]) {
      expect(
        restore(full({ missionTypeId: MISSION }), { missionTypeId: junk }),
        JSON.stringify(junk),
      ).toBeNull();
    }
  });

  it('leaves a NOTE alone — free text, even when the text is the word "undefined"', () => {
    // A note is not a reference. A reader who typed that word meant it, and dropping it would
    // be this rule overreaching into data it has no business judging.
    expect(restore(full(), { notes: 'undefined' })?.notes).toBe('undefined');
    expect(restore(full(), { notes: 'null' })?.notes).toBe('null');
  });

  it('still refuses a note the CONTRACT refuses — empty, blank, or too long', () => {
    for (const bad of ['', '   ', 'x'.repeat(501)]) {
      expect(restore(full({ notes: 'kept' }), { notes: bad }), JSON.stringify(bad.slice(0, 12))).
        toBeNull();
    }
  });

  it('SHOWS NO UNSAVED BANNER when every stored field was junk', () => {
    // The user-visible half: a board that says «لديك تغييرات غير محفوظة» over work nobody did
    // and nobody could save. `null` here is what the page reads as "no draft".
    writeDraft(KEY, [
      { vehicleId: 'v1', missionTypeId: 'undefined', driver1EmployeeId: '', notes: '' },
    ]);
    expect(readDraft(KEY, [full({ missionTypeId: MISSION })], FIELDS)).toBeNull();
  });

  it('the shared field spec covers every editable id on both boards', () => {
    // A field added to one board's editable set and not checked here is the next "undefined".
    expect(ROSTER_EDITABLE_FIELDS).toEqual({
      missionTypeId: 'id',
      driver1EmployeeId: 'id',
      driver2EmployeeId: 'id',
      notes: 'text',
    });
  });
});
