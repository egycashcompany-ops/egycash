// «كشف طاقم العمليات»'s decisions, as pure rules: what a save sends, which ticks are waiting, who
// the filters leave, what the figures count.
//
// The endpoint upserts the WHOLE row — the legacy screen saved a checkbox LINE, not a single box —
// so a save must carry every other flag with it. Getting this wrong silently clears flags the
// operator did not touch, which is the kind of bug nobody notices until a report is wrong.
//
// Round 19 («عاوز احسن الui بتاع الشاشة دى دا كان القديم برضو القى نظره»): the ticks wait for «حفظ
// (n)» as the legacy screen's did, and the screen filters by name, job title and what a member
// holds. Round 19b («والغى السيرش بالكود خليه مكان واحد للاسم والكود سوا»): the name and the code
// are searched from ONE box, and the member's card says what they hold.
import { describe, expect, it } from 'vitest';
import {
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
} from '@ecms/contracts';
import {
  NO_JOB_TITLE,
  NO_PENDING,
  REQUIREMENT_FLAGS,
  hasRosterFilter,
  heldFlags,
  isPendingCell,
  isRequirementFlag,
  jobTitleChoices,
  keepUnsaved,
  matchesNameOrCode,
  pendingCellCount,
  pendingRows,
  rosterFigures,
  rosterRows,
  saveRowsInTurn,
  searchFromOldBoxes,
  shownFlag,
  toFlagPayload,
  toRowPayload,
  toSaveRequests,
  togglePending,
  type RosterFilters,
} from './requirements';

const existing = (over: Partial<OperationsCrewRequirementsDto> = {}): OperationsCrewRequirementsDto => ({
  id: 'r1',
  employeeId: 'e1',
  isCaptain: true,
  isSpecialist: false,
  hasWeapon: true,
  hasSignature: false,
  hasLicense: true,
  hasTemporaryLicense: false,
  isOpsAdmin: false,
  isNewJoiner: false,
  isAssignedSpecialTask: false,
  isPriority: false,
  notes: 'ملاحظة قائمة',
  version: 3,
  createdAt: '',
  updatedAt: '',
  ...over,
});

const HEAD = { id: 'jt-head', name: { ar: 'رئيس قسم تشغيل نقل الاموال', en: 'Head of operations' } };
const SENIOR = { id: 'jt-senior', name: { ar: 'اخصائى اول نقل اموال', en: 'Senior specialist' } };

const member = (
  employeeId: string,
  over: Partial<OperationsCrewMemberDto> = {},
): OperationsCrewMemberDto => ({
  employeeId,
  code: `01000${employeeId}`,
  fullNameAr: `موظف ${employeeId}`,
  status: 'active',
  jobTitle: null,
  phone: null,
  branchId: null,
  requirements: null,
  assignedVehicleId: null,
  ...over,
});

const NO_FILTERS: RosterFilters = { search: '', jobs: [], flags: [] };

describe('toFlagPayload / toRowPayload — what a save sends', () => {
  it('sets the toggled flag', () => {
    expect(toFlagPayload(existing(), 'hasSignature', true).hasSignature).toBe(true);
  });

  it('carries every OTHER flag through unchanged', () => {
    const payload = toFlagPayload(existing(), 'hasSignature', true);
    expect(payload.isCaptain).toBe(true);
    expect(payload.hasWeapon).toBe(true);
    expect(payload.hasLicense).toBe(true);
    expect(payload.isSpecialist).toBe(false);
  });

  it('can turn a flag OFF as well as on', () => {
    expect(toFlagPayload(existing(), 'hasWeapon', false).hasWeapon).toBe(false);
  });

  it('preserves notes the screen does not edit', () => {
    expect(toFlagPayload(existing(), 'isPriority', true).notes).toBe('ملاحظة قائمة');
  });

  it('starts a member with no row from all-false, which is what an unticked line means', () => {
    const payload = toFlagPayload(null, 'isCaptain', true);
    expect(payload.isCaptain).toBe(true);
    for (const flag of REQUIREMENT_FLAGS) {
      if (flag !== 'isCaptain') expect(payload[flag]).toBe(false);
    }
    expect(payload.notes).toBeNull();
  });

  it('sends every flag the contract expects, so a partial save cannot drop one', () => {
    const payload = toFlagPayload(existing(), 'isNewJoiner', true);
    for (const flag of REQUIREMENT_FLAGS) {
      expect(payload).toHaveProperty(flag);
      expect(typeof payload[flag]).toBe('boolean');
    }
  });

  it('applies several ticks of one row at once over the saved row', () => {
    const payload = toRowPayload(existing(), { isCaptain: false, isSpecialist: true, isPriority: true });
    expect(payload).toMatchObject({
      isCaptain: false,
      isSpecialist: true,
      isPriority: true,
      // untouched
      hasWeapon: true,
      hasLicense: true,
      hasSignature: false,
      notes: 'ملاحظة قائمة',
    });
  });
});

describe('the ticks waiting for «حفظ»', () => {
  const ahmed = member('16', { requirements: existing({ employeeId: '16' }) });
  const fresh = member('18');

  it('a press shows at once, and is waiting — nothing is saved by it', () => {
    const pending = togglePending(NO_PENDING, fresh, 'hasWeapon');
    expect(shownFlag(fresh, pending, 'hasWeapon')).toBe(true);
    expect(isPendingCell(fresh, pending, 'hasWeapon')).toBe(true);
    // The member's saved row is untouched: still nothing recorded.
    expect(fresh.requirements).toBeNull();
  });

  it('pressing it again puts it back — no change is left waiting, not a change of nothing', () => {
    const once = togglePending(NO_PENDING, ahmed, 'isCaptain');
    expect(shownFlag(ahmed, once, 'isCaptain')).toBe(false);
    const twice = togglePending(once, ahmed, 'isCaptain');
    expect(twice).toEqual({});
    expect(pendingRows([ahmed], twice)).toEqual([]);
  });

  it('counts the cells waiting — «حفظ (n)» — across rows, in roster order', () => {
    let pending = togglePending(NO_PENDING, fresh, 'isSpecialist');
    pending = togglePending(pending, ahmed, 'hasSignature');
    pending = togglePending(pending, fresh, 'hasLicense');
    const rows = pendingRows([ahmed, fresh], pending);
    expect(rows.map((row) => row.member.employeeId)).toEqual(['16', '18']);
    expect(rows[1]?.flags).toEqual({ isSpecialist: true, hasLicense: true });
    expect(pendingCellCount(rows)).toBe(3);
  });

  it('a tick the server has since come to agree with is no change any more', () => {
    const pending = togglePending(NO_PENDING, fresh, 'hasWeapon');
    // Another planner saved the same tick; the roster was re-read.
    const reread = { ...fresh, requirements: existing({ employeeId: '18', hasWeapon: true }) };
    expect(isPendingCell(reread, pending, 'hasWeapon')).toBe(false);
    expect(pendingRows([reread], pending)).toEqual([]);
  });

  it('writes for nobody who has left the roster', () => {
    const pending = togglePending(NO_PENDING, fresh, 'hasWeapon');
    expect(pendingRows([ahmed], pending)).toEqual([]);
  });

  it('a save sends one WHOLE row per member, built from the saved row with the ticks over it', () => {
    let pending = togglePending(NO_PENDING, ahmed, 'isSpecialist');
    pending = togglePending(pending, fresh, 'isCaptain');
    const requests = toSaveRequests(pendingRows([ahmed, fresh], pending));
    expect(requests.map((request) => request.employeeId)).toEqual(['16', '18']);
    // Ahmed's other flags and his notes travel with the one tick.
    expect(requests[0]?.body).toEqual({ ...toRowPayload(ahmed.requirements, {}), isSpecialist: true });
    // A member with no row yet: all-false, the tick over it.
    expect(requests[1]?.body).toEqual({ ...toRowPayload(null, {}), isCaptain: true });
  });

  it('after a save, only the ticks of the rows NOT saved stay waiting', () => {
    let pending = togglePending(NO_PENDING, ahmed, 'isSpecialist');
    pending = togglePending(pending, fresh, 'isCaptain');
    expect(keepUnsaved(pending, new Set(['18']))).toEqual({ '18': { isCaptain: true } });
    expect(keepUnsaved(pending, new Set())).toEqual({});
  });
});

describe('saveRowsInTurn — «حفظ (n)» runs down the rows one after the other', () => {
  const body = toRowPayload(null, { isCaptain: true });

  it('never has two rows in flight, and keeps the order', async () => {
    const log: string[] = [];
    let inFlight = 0;
    const result = await saveRowsInTurn(
      ['a', 'b', 'c'].map((employeeId) => ({ employeeId, body })),
      async (employeeId) => {
        inFlight += 1;
        expect(inFlight).toBe(1);
        log.push(employeeId);
        await Promise.resolve();
        inFlight -= 1;
      },
    );
    expect(log).toEqual(['a', 'b', 'c']);
    expect(result).toEqual({ saved: ['a', 'b', 'c'], failed: [] });
  });

  it('a refused row is reported with its reason — it neither throws nor stops the rest', async () => {
    const refusal = new Error('exited');
    const result = await saveRowsInTurn(
      ['a', 'b', 'c'].map((employeeId) => ({ employeeId, body })),
      async (employeeId) => {
        if (employeeId === 'b') throw refusal;
      },
    );
    expect(result.saved).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ employeeId: 'b', error: refusal }]);
  });
});

describe('the filters — الاسم أو الكود · الوظيفة · يحمل', () => {
  const roster = [
    member('20', {
      fullNameAr: 'أحمد سيد بركة محمد فياض',
      jobTitle: SENIOR,
      requirements: existing({ employeeId: '20', isCaptain: true, hasWeapon: true }),
    }),
    member('07', {
      fullNameAr: 'ايمن اسماعيل عبد العظيم رافع',
      jobTitle: HEAD,
      requirements: existing({ employeeId: '07', isCaptain: true, hasWeapon: false }),
    }),
    member('35', {
      fullNameAr: 'احمد سيد محمود محمود',
      jobTitle: SENIOR,
      requirements: existing({ employeeId: '35', isCaptain: false, isSpecialist: true }),
    }),
    member('64', { fullNameAr: 'عبد الغنى ظهير محمد', code: '0300064' }),
  ];
  const ids = (filters: Partial<RosterFilters>): string[] =>
    rosterRows(roster, { ...NO_FILTERS, ...filters }).map((row) => row.employeeId);

  it('runs by code, as the legacy roster ran by ID', () => {
    expect(ids({})).toEqual(['07', '20', '35', '64']);
  });

  it('finds a code from part of it in the one box, typed on either keyboard', () => {
    expect(ids({ search: '0020' })).toEqual(['20']);
    expect(ids({ search: '٠٣٠٠' })).toEqual(['64']);
    // Every code on this roster starts «0»: a digit typed is the codes', not nobody's.
    expect(ids({ search: '0' })).toEqual(['07', '20', '35', '64']);
  });

  it('finds a name in the same box the way an Arabic typist writes it — hamza, ى/ي, ة/ه folded', () => {
    // «احمد» finds «أحمد» and «احمد» alike; «ايمن اسماعيل» finds the row however it is spelled.
    expect(ids({ search: 'احمد سيد' })).toEqual(['20', '35']);
    expect(ids({ search: 'إسماعيل' })).toEqual(['07']);
    expect(ids({ search: 'عبد الغني' })).toEqual(['64']);
    // Surrounding spaces are not part of what was meant.
    expect(ids({ search: '  عبد الغني ' })).toEqual(['64']);
  });

  it('matches the name OR the code — never a text that is in neither', () => {
    const ayman = roster[1] as OperationsCrewMemberDto;
    expect(matchesNameOrCode(ayman, '')).toBe(true);
    expect(matchesNameOrCode(ayman, 'رافع')).toBe(true);
    expect(matchesNameOrCode(ayman, '٠٠٠٠٧')).toBe(true);
    expect(matchesNameOrCode(ayman, 'رافع 0100007')).toBe(false);
    expect(matchesNameOrCode(ayman, '999')).toBe(false);
    expect(ids({ search: 'لا أحد' })).toEqual([]);
  });

  it('puts the two old boxes’ text in the one — the code first, since it names one person', () => {
    expect(searchFromOldBoxes('0035', 'احمد')).toBe('0035');
    expect(searchFromOldBoxes(null, ' احمد ')).toBe('احمد');
    expect(searchFromOldBoxes('  ', 'احمد')).toBe('احمد');
    expect(searchFromOldBoxes('0035', null)).toBe('0035');
    expect(searchFromOldBoxes(null, null)).toBe('');
  });

  it('«الوظيفة» keeps any of the titles chosen — and «بلا وظيفة» the members with none', () => {
    expect(ids({ jobs: [HEAD.id] })).toEqual(['07']);
    expect(ids({ jobs: [HEAD.id, SENIOR.id] })).toEqual(['07', '20', '35']);
    expect(ids({ jobs: [NO_JOB_TITLE] })).toEqual(['64']);
  });

  it('«يحمل» keeps the members holding EVERY flag chosen', () => {
    expect(ids({ flags: ['isCaptain'] })).toEqual(['07', '20']);
    expect(ids({ flags: ['isCaptain', 'hasWeapon'] })).toEqual(['20']);
    expect(ids({ flags: ['isSpecialist'] })).toEqual(['35']);
  });

  it('«يحمل» reads what is SAVED, so a row does not vanish while a box in it is unticked', () => {
    // «قائد» unticked on Ayman's row, not saved yet: the cell says no, the row stays under «قائد»
    // so the reader can tick it back.
    const ayman = roster[1] as OperationsCrewMemberDto;
    const pending = togglePending(NO_PENDING, ayman, 'isCaptain');
    expect(shownFlag(ayman, pending, 'isCaptain')).toBe(false);
    expect(ids({ flags: ['isCaptain'] })).toContain('07');
  });

  it('combines every filter', () => {
    expect(ids({ search: 'احمد', jobs: [SENIOR.id], flags: ['isCaptain'] })).toEqual(['20']);
    expect(ids({ search: '0035', jobs: [SENIOR.id], flags: ['isCaptain'] })).toEqual([]);
  });

  it('says whether anything narrows', () => {
    expect(hasRosterFilter(NO_FILTERS)).toBe(false);
    expect(hasRosterFilter({ ...NO_FILTERS, search: ' ' })).toBe(false);
    expect(hasRosterFilter({ ...NO_FILTERS, search: '٠٧' })).toBe(true);
    expect(hasRosterFilter({ ...NO_FILTERS, flags: ['isPriority'] })).toBe(true);
  });

  it('offers the titles on the roster, each once, by name — and «none» only when someone has none', () => {
    expect(jobTitleChoices(roster, 'ar')).toEqual({
      titles: [
        { id: SENIOR.id, label: SENIOR.name.ar },
        { id: HEAD.id, label: HEAD.name.ar },
      ],
      anyWithout: true,
    });
    expect(jobTitleChoices(roster.slice(0, 3), 'en').anyWithout).toBe(false);
    expect(jobTitleChoices(roster.slice(0, 3), 'en').titles.map((title) => title.label)).toEqual([
      HEAD.name.en,
      SENIOR.name.en,
    ]);
  });

  it('reads a flag in the URL only if it is one', () => {
    expect(isRequirementFlag('isCaptain')).toBe(true);
    expect(isRequirementFlag('canFly')).toBe(false);
  });

  it('counts the rows shown, and their captains and specialists as the table shows them', () => {
    const shown = rosterRows(roster, NO_FILTERS);
    expect(rosterFigures(shown, NO_PENDING)).toEqual({ members: 4, captains: 2, specialists: 1 });
    // A tick waiting moves the figure under the reader's hand, as it moves the cell.
    const pending = togglePending(NO_PENDING, roster[3] as OperationsCrewMemberDto, 'isCaptain');
    expect(rosterFigures(shown, pending).captains).toBe(3);
  });
});

describe('heldFlags — what a member’s card says they hold', () => {
  it('names the flags SAVED, in the table’s order', () => {
    const held = member('18', {
      requirements: existing({
        employeeId: '18',
        isCaptain: true,
        hasWeapon: true,
        hasLicense: false,
        isPriority: true,
      }),
    });
    expect(heldFlags(held)).toEqual(['isCaptain', 'hasWeapon', 'isPriority']);
  });

  it('holds nothing for a member with no row yet, nor for a row with every flag off', () => {
    expect(heldFlags(member('64'))).toEqual([]);
    expect(
      heldFlags(member('70', { requirements: existing({ isCaptain: false, hasWeapon: false, hasLicense: false }) })),
    ).toEqual([]);
  });
});

describe('REQUIREMENT_FLAGS', () => {
  it('is the legacy nine plus the explicit specialist role (Q17)', () => {
    expect(REQUIREMENT_FLAGS).toHaveLength(10);
    expect(REQUIREMENT_FLAGS).toContain('isCaptain');
    expect(REQUIREMENT_FLAGS).toContain('isSpecialist');
  });

  it('puts what a member IS first, then the legacy screen’s order', () => {
    expect(REQUIREMENT_FLAGS).toEqual([
      'isCaptain',
      'isSpecialist',
      'hasWeapon',
      'hasSignature',
      'hasLicense',
      'hasTemporaryLicense',
      'isOpsAdmin',
      'isNewJoiner',
      'isAssignedSpecialTask',
      'isPriority',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(REQUIREMENT_FLAGS).size).toBe(REQUIREMENT_FLAGS.length);
  });
});
