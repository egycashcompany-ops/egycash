// Round 26 — which colour each van wears on «توزيع المحصنات» and «تسليم المحصنات», and what its hover
// card lists. The owner: «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى
// عليها والاعداد وكدا», and «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه
// والسواقيين».
import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_SHIFT_TYPE_COLOURS,
  type OperationsDayBoardVehicleCrewDto,
} from '@ecms/contracts';
import {
  ACCENT_FAMILY,
  ACCENT_TONE,
  COUNT_KINDS,
  PACKAGE_KINDS,
  VAN_ACCENT_ORDER,
  accentOrderIsThePalette,
  vanAccentAt,
  vanAccents,
  vanCrewGroups,
  vanHoverAllowed,
  vanTapAllowed,
} from './van-accent';

const P = (employeeId: string, fullNameAr: string | null, code: string | null = null) => ({
  employeeId,
  code,
  fullNameAr,
});

const VAN: OperationsDayBoardVehicleCrewDto = {
  crewAssignmentId: 'cr-112',
  vehicleId: 'v-112',
  vehicleCode: '112',
  drivers: [
    { employeeId: 'd1', fullNameAr: 'أيمن فاروق شحاتة' },
    { employeeId: 'd2', fullNameAr: 'طارق محمود سليمان' },
  ],
  captains: [P('c7', 'عبد الرحمن الشناوي', 'BR-107'), P('c8', 'كريم سمير علي', 'BR-108')],
  specialist1: [P('s1', 'وليد سيد فوزي', 'SP-1'), P('s3', 'ياسر عبد الحميد', 'SP-3')],
  specialist2: [P('s4', 'إسلام مسعد عويس', 'SP-4')],
  direction: 'الشيخ زايد',
  plannedTime: '07:15',
};

describe('the accent order — the palette, re-ordered', () => {
  it('is the twenty palette colours, each once, nothing invented', () => {
    expect(accentOrderIsThePalette()).toBe(true);
    expect([...VAN_ACCENT_ORDER].sort()).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS].sort());
    expect(Object.keys(ACCENT_TONE).sort()).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS].sort());
    expect(Object.keys(ACCENT_FAMILY).sort()).toEqual([...OPERATIONS_SHIFT_TYPE_COLOURS].sort());
  });

  it('never puts one hue family beside itself — next to it, or on the card above at two, three or four a row', () => {
    // R26 verify: «السيارات» lays four vans a row at 1920 (the owner's own screen — his screenshot's
    // vans column is 1325px wide), so the card above is FOUR places back there.
    const n = VAN_ACCENT_ORDER.length;
    for (let at = 0; at < n; at += 1) {
      const here = VAN_ACCENT_ORDER[at] as (typeof VAN_ACCENT_ORDER)[number];
      for (const step of [1, 2, 3, 4]) {
        const there = VAN_ACCENT_ORDER[(at + step) % n] as (typeof VAN_ACCENT_ORDER)[number];
        expect(ACCENT_FAMILY[there], `${here} → +${step} ${there}`).not.toBe(ACCENT_FAMILY[here]);
      }
    }
  });

  it('alternates dark and light down the list — told apart without the hue', () => {
    // Twenty colours, eleven dark and nine light: they alternate until the last two dark ones.
    for (let at = 0; at < 18; at += 1) {
      const here = VAN_ACCENT_ORDER[at] as (typeof VAN_ACCENT_ORDER)[number];
      const next = VAN_ACCENT_ORDER[at + 1] as (typeof VAN_ACCENT_ORDER)[number];
      expect(ACCENT_TONE[next], `${here} → ${next}`).not.toBe(ACCENT_TONE[here]);
    }
  });

  it('keeps the colours that already mean something for last — rose, emerald, amber', () => {
    const at = (colour: (typeof VAN_ACCENT_ORDER)[number]) => VAN_ACCENT_ORDER.indexOf(colour);
    expect(at('rose')).toBeGreaterThanOrEqual(15);
    expect(at('emerald')).toBeGreaterThanOrEqual(15);
    expect(at('amber')).toBeGreaterThanOrEqual(15);
  });

  it('R26 critic — their near twins come late too: no day of up to eight vans wears them', () => {
    // brown is drawn in amber-800 (a proposal's amber), crimson in red-700 (beside a refusal's
    // rose), slate is grey — «no colour». The first eight vans of a day never wear one.
    const at = (colour: (typeof VAN_ACCENT_ORDER)[number]) => VAN_ACCENT_ORDER.indexOf(colour);
    expect(at('brown')).toBeGreaterThanOrEqual(8);
    expect(at('crimson')).toBeGreaterThanOrEqual(8);
    expect(at('slate')).toBeGreaterThanOrEqual(8);
  });

  it('R26 critic — the first van never wears a count’s colour (محصنات indigo, كراتين amber, حقائب teal, صناديق fuchsia)', () => {
    // The first van of EVERY day wore indigo — its code a solid indigo-600 pill right over the
    // محصنات badge in the same solid indigo-600.
    expect(['indigo', 'amber', 'teal', 'fuchsia']).not.toContain(VAN_ACCENT_ORDER[0]);
  });
});

describe('a van’s accent — by its place in the day’s list', () => {
  it('starts at the order’s first colour and wraps past twenty', () => {
    expect(vanAccentAt(0)).toBe(VAN_ACCENT_ORDER[0]);
    expect(vanAccentAt(19)).toBe(VAN_ACCENT_ORDER[19]);
    expect(vanAccentAt(20)).toBe(VAN_ACCENT_ORDER[0]);
    expect(vanAccentAt(41)).toBe(VAN_ACCENT_ORDER[1]);
    // Never out of the palette, whatever it is handed.
    expect(vanAccentAt(-3)).toBe(VAN_ACCENT_ORDER[0]);
    expect(vanAccentAt(2.7)).toBe(VAN_ACCENT_ORDER[2]);
  });

  it('is stable: the same list gives the same colours, read after read', () => {
    const list = ['cr-101', 'cr-104', 'cr-112', 'cr-loose-1'].map((id) => ({
      crewAssignmentId: id,
    }));
    const first = vanAccents(list);
    const again = vanAccents(list.map((van) => ({ ...van })));
    expect([...again]).toEqual([...first]);
    // R26 critic — the order now starts navy (no count's colour), orange, olive, sky.
    expect(first.get('cr-101')).toBe('navy');
    expect(first.get('cr-104')).toBe('orange');
    expect(first.get('cr-112')).toBe('olive');
    expect(first.get('cr-loose-1')).toBe('sky');
  });

  it('gives every van of a day of twenty its own colour, and a 21st the first again', () => {
    const list = Array.from({ length: 21 }, (_, at) => ({ crewAssignmentId: `cr-${at}` }));
    const accents = vanAccents(list);
    expect(new Set([...accents.values()].slice(0, 20)).size).toBe(20);
    expect(accents.get('cr-20')).toBe(accents.get('cr-0'));
  });

  it('R26 critic — a row of another type, kept while it carries, leaving the list repaints no other van', () => {
    // 106 «سفر» is listed only while it carries a محصنة (Round 25): moving its last one away and
    // saving — or handing it over — drops it from the re-read. Nobody else's colour may move.
    const row = (id: string, securedType = true) => ({ crewAssignmentId: id, securedType });
    const before = vanAccents([
      row('cr-101'),
      row('cr-104'),
      row('cr-106', false),
      row('cr-112'),
      row('cr-125'),
      row('cr-loose-1'),
    ]);
    const after = vanAccents([
      row('cr-101'),
      row('cr-104'),
      row('cr-112'),
      row('cr-125'),
      row('cr-loose-1'),
    ]);
    for (const id of ['cr-101', 'cr-104', 'cr-112', 'cr-125', 'cr-loose-1']) {
      expect(after.get(id), id).toBe(before.get(id));
    }
    // The «محصنة» rows take the order's places among themselves; the kept row a colour after them.
    expect(before.get('cr-101')).toBe(VAN_ACCENT_ORDER[0]);
    expect(before.get('cr-112')).toBe(VAN_ACCENT_ORDER[2]);
    expect(before.get('cr-loose-1')).toBe(VAN_ACCENT_ORDER[4]);
    expect(new Set(before.values()).size).toBe(6);
  });

  it('R26 critic — a kept row never wears a yellow or an amber: its own dashed amber edge and notice say «kept»', () => {
    // Whatever place it would take, it skips gold (yellow-400), amber and brown (amber-800).
    for (let secured = 0; secured < 20; secured += 1) {
      const list = [
        ...Array.from({ length: secured }, (_, at) => ({
          crewAssignmentId: `s${at}`,
          securedType: true,
        })),
        { crewAssignmentId: 'kept-a', securedType: false },
        { crewAssignmentId: 'kept-b', securedType: false },
      ];
      const accents = vanAccents(list);
      for (const kept of ['kept-a', 'kept-b']) {
        expect(['gold', 'amber', 'brown'], `${secured} + ${kept}`).not.toContain(accents.get(kept));
      }
      expect(accents.get('kept-a')).not.toBe(accents.get('kept-b'));
    }
  });

  it('R26 critic — a row with no word on its type is a «محصنة» row (the handover’s list is the same read)', () => {
    const accents = vanAccents([{ crewAssignmentId: 'a' }, { crewAssignmentId: 'b' }]);
    expect(accents.get('a')).toBe(VAN_ACCENT_ORDER[0]);
    expect(accents.get('b')).toBe(VAN_ACCENT_ORDER[1]);
  });

  it('a crew row listed twice keeps its first place — the next van is not pushed along', () => {
    const accents = vanAccents([
      { crewAssignmentId: 'a' },
      { crewAssignmentId: 'a' },
      { crewAssignmentId: 'b' },
    ]);
    expect(accents.get('a')).toBe(VAN_ACCENT_ORDER[0]);
    expect(accents.get('b')).toBe(VAN_ACCENT_ORDER[1]);
  });
});

describe('the counts — four kinds, in the order every screen writes them', () => {
  it('محصنات first, then the packages in the owner’s order', () => {
    expect(COUNT_KINDS).toEqual(['shipments', 'cartons', 'bags', 'boxes']);
    expect(PACKAGE_KINDS).toEqual(['cartons', 'bags', 'boxes']);
  });
});

describe('the van’s hover card — everyone on it', () => {
  it('every captain in the order put on the row, the first marked as the one the card shows', () => {
    const [captains] = vanCrewGroups(VAN, true);
    expect(captains?.slot).toBe('captains');
    expect(captains?.state).toBe('people');
    expect(captains?.people.map((one) => one.employeeId)).toEqual(['c7', 'c8']);
    expect(captains?.people.map((one) => one.shown)).toEqual([true, false]);
    expect(captains?.people[0]).toMatchObject({ name: 'عبد الرحمن الشناوي', code: 'BR-107' });
  });

  it('both specialist slots, everyone in each, then the drivers by name only', () => {
    const groups = vanCrewGroups(VAN, true);
    expect(groups.map((group) => group.slot)).toEqual([
      'captains',
      'specialist1',
      'specialist2',
      'drivers',
    ]);
    expect(groups[1]?.people.map((one) => one.employeeId)).toEqual(['s1', 's3']);
    expect(groups[2]?.people.map((one) => one.employeeId)).toEqual(['s4']);
    expect(groups[3]?.people.map((one) => one.name)).toEqual([
      'أيمن فاروق شحاتة',
      'طارق محمود سليمان',
    ]);
    // A driver's details are Fleet's: no code ever rides along.
    expect(groups[3]?.people.every((one) => one.code === null)).toBe(true);
  });

  it('says an empty slot is empty', () => {
    const groups = vanCrewGroups(
      { ...VAN, captains: [], specialist1: [], specialist2: [], drivers: [] },
      true,
    );
    expect(groups.map((group) => group.state)).toEqual(['empty', 'empty', 'empty', 'empty']);
    expect(groups.every((group) => group.people.length === 0)).toBe(true);
  });

  it('without the crew plan’s grant: the specialists and drivers were withheld — said, not «nobody»', () => {
    const groups = vanCrewGroups({ ...VAN, specialist1: [], specialist2: [], drivers: [] }, false);
    expect(groups.map((group) => group.state)).toEqual(['people', 'hidden', 'hidden', 'hidden']);
  });

  it('a crew without a van: no van to drive — said so, not «no drivers»', () => {
    const groups = vanCrewGroups({ ...VAN, vehicleId: null, drivers: [] }, true);
    expect(groups[3]).toEqual({ slot: 'drivers', state: 'noVan', people: [] });
    expect(vanCrewGroups({ ...VAN, vehicleId: null, drivers: [] }, false)[3]?.state).toBe('noVan');
  });

  it('a person the directory cannot name keeps his place, nameless', () => {
    const groups = vanCrewGroups({ ...VAN, captains: [P('c9', null)] }, true);
    expect(groups[0]?.people[0]).toEqual({
      employeeId: 'c9',
      name: null,
      code: null,
      shown: true,
    });
  });
});

describe('when resting on a van opens its card', () => {
  it('only with no drag on, no «نقل إلى…» menu open, and not on a captain’s own name', () => {
    expect(vanHoverAllowed({ dragging: false, menuOpen: false, onPerson: false })).toBe(true);
    expect(vanHoverAllowed({ dragging: true, menuOpen: false, onPerson: false })).toBe(false);
    expect(vanHoverAllowed({ dragging: false, menuOpen: true, onPerson: false })).toBe(false);
    expect(vanHoverAllowed({ dragging: false, menuOpen: false, onPerson: true })).toBe(false);
  });

  it('R26 critic — a tap opens it only from a touch, and never on the captain’s own name', () => {
    expect(vanTapAllowed({ touch: true, onPerson: false })).toBe(true);
    // The pointer path skips his name (his own card); the tap path must too.
    expect(vanTapAllowed({ touch: true, onPerson: true })).toBe(false);
    // A mouse click is the hover's: no toggle.
    expect(vanTapAllowed({ touch: false, onPerson: false })).toBe(false);
  });
});
