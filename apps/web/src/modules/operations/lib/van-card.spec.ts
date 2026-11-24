// Round 26 — what a van card counts on «توزيع المحصنات» and «تسليم المحصنات», and what its hover card
// lists: «لما اقف على العربية يطلع كارت بقى بالقادة والاخصائيين اللى على العربيه والسواقيين».
//
// Round 26b — «لون واحد لكل العربيات»: the per-van colour and its order are gone (their specs with
// them); every van wears one look (`components/distribution-colours.spec.ts` measures it).
import { describe, expect, it } from 'vitest';
import { type OperationsDayBoardVehicleCrewDto } from '@ecms/contracts';
import {
  COUNT_KINDS,
  PACKAGE_KINDS,
  vanCrewGroups,
  vanHoverAllowed,
  vanRestArms,
  vanTapAllowed,
} from './van-card';

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

// Round 33 C — «عاوز كلمة طباعة دى تكون العلامة بس وممكن تحطها فى مكان فى الكارد عشان متخدش مساحة
// كبيره»: «تسليم المحصنات»'s «طباعة» is an icon at the end of the van's head (`VanCard`'s
// `headAction`). A press on it only prints, and resting on it is no question about the van.
describe('Round 33 C — the head’s own act is its own', () => {
  it('a press on it — a tap, a click, Enter or Space — neither opens nor closes the van’s card', () => {
    // A phone's tap on the head still toggles the card; on the act it does not.
    expect(vanTapAllowed({ touch: true, onPerson: false, onAct: false })).toBe(true);
    expect(vanTapAllowed({ touch: true, onPerson: false, onAct: true })).toBe(false);
    // A mouse click, Enter or Space (a click with no touch before it): never a toggle, act or not.
    expect(vanTapAllowed({ touch: false, onPerson: false, onAct: true })).toBe(false);
    // «توزيع المحصنات» has no act: the rule it had.
    expect(vanTapAllowed({ touch: true, onPerson: false })).toBe(true);
    expect(vanTapAllowed({ touch: true, onPerson: true, onAct: false })).toBe(false);
  });

  it('resting on it is not resting on the head — nor is resting on the captain’s own name', () => {
    expect(vanRestArms({ onPerson: false, onAct: false })).toBe(true);
    expect(vanRestArms({ onPerson: false, onAct: true })).toBe(false);
    expect(vanRestArms({ onPerson: true, onAct: false })).toBe(false);
    expect(vanRestArms({ onPerson: true, onAct: true })).toBe(false);
  });
});
