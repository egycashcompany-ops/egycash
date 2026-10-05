// The two pools, rendered for real in both locales.
//
// `crew-board.spec.ts` proves the split; this proves what a planner sees of it: two columns,
// captains first (so on the right in Arabic, as the legacy board had them), each with its own
// search, nobody listed twice and nobody already on a card listed at all.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import {
  type Locale,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
} from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { translate } from '../../../platform/localization/i18n';
import { SLOT_POSITIONS, type BoardRow } from '../lib/crew-board';
import { CrewPools, EMPTY_POOL_QUERIES, POOL_FILTERS } from './CrewPools';

const requirements = (over: Partial<OperationsCrewRequirementsDto>): OperationsCrewRequirementsDto =>
  ({
    id: 'r',
    employeeId: 'e',
    isCaptain: false,
    isSpecialist: false,
    hasWeapon: false,
    hasSignature: false,
    hasLicense: false,
    hasTemporaryLicense: false,
    isOpsAdmin: false,
    isNewJoiner: false,
    isAssignedSpecialTask: false,
    isPriority: false,
    ...over,
  }) as OperationsCrewRequirementsDto;

const member = (
  id: string,
  name: string,
  req: Partial<OperationsCrewRequirementsDto> | null,
): OperationsCrewMemberDto => ({
  employeeId: id,
  code: `BR${id}`,
  fullNameAr: name,
  status: 'active',
  requirements: req === null ? null : requirements(req),
  assignedVehicleId: null,
});

const CAPTAIN_FREE = member('c1', 'قائد متاح', { isCaptain: true });
const CAPTAIN_ON_BOARD = member('c2', 'قائد على سيارة', { isCaptain: true });
const SPECIALIST = member('s1', 'أخصائي متاح', { hasWeapon: true });
const NOTHING_RECORDED = member('n1', 'بلا بيانات', null);

const emptyCells = SLOT_POSITIONS.map(() => null);
const BOARD: BoardRow[] = [
  {
    vehicleId: 'v1',
    vehicleCode: '211',
    missionTypeId: null,
    captainEmployeeIds: SLOT_POSITIONS.map((p) => (p === 0 ? 'c2' : null)),
    specialist1EmployeeIds: emptyCells,
    specialist2EmployeeIds: emptyCells,
    direction: null,
    plannedTime: null,
    notes: null,
  },
];

const render = (
  members: OperationsCrewMemberDto[],
  { locale = 'ar' as Locale, rows = BOARD }: { locale?: Locale; rows?: BoardRow[] } = {},
): string => {
  const store = configureStore({
    reducer: { locale: localeSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
    },
  });
  return renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>
        <CrewPools
          members={members}
          rows={rows}
          queries={EMPTY_POOL_QUERIES}
          onQueryChange={() => undefined}
          loading={false}
          error={null}
          onRetry={() => undefined}
          rosterIsDerived
          canPlan
          onReturn={() => undefined}
        />
      </MemoryRouter>
    </Provider>,
  );
};

/** The markup of one pool column, by its `data-pool` attribute. */
const column = (html: string, kind: 'captains' | 'specialists'): string => {
  const start = html.indexOf(`data-pool="${kind}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-pool="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

const ALL = [CAPTAIN_FREE, CAPTAIN_ON_BOARD, SPECIALIST, NOTHING_RECORDED];

describe('CrewPools — two pools, captains and specialists', () => {
  for (const locale of ['ar', 'en'] as Locale[]) {
    it(`titles both pools in ${locale}`, () => {
      const html = render(ALL, { locale });
      for (const kind of ['captains', 'specialists'] as const) {
        const key = `operations.crew.pools.${kind}`;
        expect(translate(locale, key)).not.toBe(key);
        expect(column(html, kind)).toContain(translate(locale, key));
      }
    });
  }

  // First in the markup is first in the grid — the RIGHT-hand column in Arabic, where the legacy
  // board drew the leaders.
  it('draws the captains before the specialists', () => {
    const html = render(ALL);
    expect(html.indexOf('data-pool="captains"')).toBeLessThan(html.indexOf('data-pool="specialists"'));
  });

  it('lists each available member in exactly one pool', () => {
    const html = render(ALL);
    const captains = column(html, 'captains');
    const specialists = column(html, 'specialists');
    expect(captains).toContain(CAPTAIN_FREE.fullNameAr);
    expect(specialists).not.toContain(CAPTAIN_FREE.fullNameAr);
    expect(specialists).toContain(SPECIALIST.fullNameAr);
    expect(captains).not.toContain(SPECIALIST.fullNameAr);
    // Nothing recorded means no captain flag — the specialists, as legacy had it.
    expect(specialists).toContain(NOTHING_RECORDED.fullNameAr);
  });

  it('leaves out whoever is already on a card', () => {
    expect(render(ALL)).not.toContain(CAPTAIN_ON_BOARD.fullNameAr);
  });

  it('counts what each pool lists', () => {
    const html = render(ALL);
    expect(column(html, 'captains')).toContain('(1)');
    expect(column(html, 'specialists')).toContain('(2)');
  });

  // Each legacy column had its own search box; one shared box would make the two lists answer a
  // question asked of only one of them.
  it('gives each pool its own search, labelled with the pool it searches', () => {
    const html = render(ALL);
    for (const kind of ['captains', 'specialists'] as const) {
      expect(column(html, kind)).toContain(
        `aria-label="${translate('ar', `operations.crew.pools.${kind}`)} — ${translate('ar', 'operations.crew.searchPool')}"`,
      );
    }
  });

  // The pools are split on the captain flag, so a captain filter would empty one of them.
  it('no longer offers the captain flag as a filter', () => {
    expect(POOL_FILTERS).not.toContain('isCaptain');
    // The filter BUTTONS only — the member card still carries a captain badge, as it should.
    const filterLabels = [...render(ALL).matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]*)</g)].map(
      (match) => match[1],
    );
    expect(filterLabels).toHaveLength(POOL_FILTERS.length * 2);
    expect(filterLabels).not.toContain(translate('ar', 'operations.crew.flag.isCaptain'));
  });

  // Every row in the captains column is a captain, so the badge would say nothing there; in the
  // specialists column it would still mean something if a captain ever landed there.
  it('drops the captain badge inside the captains column only', () => {
    const badge = `>${translate('ar', 'operations.crew.role.captain')}</span>`;
    expect(column(render(ALL), 'captains')).not.toContain(badge);
  });

  it('says plainly when a pool has nobody left', () => {
    const html = render([CAPTAIN_ON_BOARD, SPECIALIST]);
    expect(column(html, 'captains')).toContain(translate('ar', 'operations.crew.pools.empty.captains'));
  });
});

describe('CrewPools — nobody marked as a captain', () => {
  const html = render([SPECIALIST, NOTHING_RECORDED], { rows: [] });

  // Without a single captain flag the split has nothing to split on, and an empty captains column
  // with no reason given reads as a broken screen.
  it('explains the empty captains column and links to where captains are marked', () => {
    const captains = column(html, 'captains');
    expect(captains).toContain(translate('ar', 'operations.crew.pools.noCaptainsFlagged'));
    expect(captains).toContain('href="/operations/requirements"');
  });

  it('says it once, in the column that looks wrong', () => {
    expect(column(html, 'specialists')).not.toContain(
      translate('ar', 'operations.crew.pools.noCaptainsFlagged'),
    );
  });

  it('stays quiet once anybody on the roster is a captain, assigned or not', () => {
    expect(render([CAPTAIN_ON_BOARD, SPECIALIST])).not.toContain(
      translate('ar', 'operations.crew.pools.noCaptainsFlagged'),
    );
  });
});
