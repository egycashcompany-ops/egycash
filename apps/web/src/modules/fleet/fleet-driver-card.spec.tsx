// «عاوز فى اى شااشه اقف على اسم السواق يجيب الاسم كامل والكود ورقم الفون والعربيه اللى متعين
// عليها والفرع».
//
// Three claims, each something a typecheck cannot see:
//   • every shared name renderer hangs the card on a name Fleet knows — and only on one: a name
//     from the old books and an unknown id keep the title they always had;
//   • the card's body says the five facts from the three shared lists, and says a missing one as
//     missing — no car line at all for a reader who may not read the roster;
//   • the places that draw a name by hand are wired too, and the pickers' option lists are not.
//
// The suite runs in node with no DOM, so nothing hovers: the trigger is read from static markup,
// and the body is rendered on its own over seeded caches.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type FleetPersonDto,
  type FleetRosterDayDto,
  type Locale,
  type MeDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../store/localeSlice';
import { authSlice } from '../../store/authSlice';
import { translate } from '../../platform/localization/i18n';
import { DriverCell, DriverIdentity, DriverPicker } from './components/DriverPerson';
import { DriverName, EmployeeName } from './components/EmployeeName';
import { DriverChip } from './components/DriverChip';
import { DriverCardBody, DriverHoverText, nameInSight } from './components/DriverHoverCard';

const HERE = dirname(fileURLToPath(import.meta.url));

const D1 = '64b1f0dddddddddddddddd01';
const D2 = '64b1f0dddddddddddddddd02';
const CAIRO = '64b1f0bbbbbbbbbbbbbbbb01';
const TODAY = new Date().toISOString().slice(0, 10);

const person = (over: Partial<FleetPersonDto> & { employeeId: string }): FleetPersonDto => ({
  code: 'HR-D1',
  fullNameAr: 'ابراهيم السيد رزق جابر',
  status: 'active',
  branchId: CAIRO,
  address: null,
  governorate: null,
  phone: '01001234567',
  hiredAt: null,
  ...over,
});

const PEOPLE = [
  person({ employeeId: D1 }),
  person({
    employeeId: D2,
    code: 'HR-D2',
    fullNameAr: 'محمد الشحات صادق',
    phone: null,
    branchId: null,
  }),
];

const BOARD: FleetRosterDayDto = {
  date: TODAY,
  rows: [
    {
      vehicleId: 'v219',
      code: '219',
      plateNumber: 'ن ص ع 219',
      typeId: 't1',
      inMaintenance: false,
      planned: true,
      missionTypeId: null,
      driver1EmployeeId: D1,
      driver2EmployeeId: null,
      notes: null,
    },
  ],
  availableDrivers: [{ employeeId: D2, assignedVehicleId: 'v-another-branch' }],
  unavailableDrivers: [],
};

const ROSTER_KEY = ['fleet', 'roster', 'day', TODAY];
const BRANCHES_KEY = ['organization', 'branches', 'options'];

const client = ({ roster = true, branches = true, people = true } = {}): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (people) qc.setQueryData(['fleet', 'people'], PEOPLE);
  if (roster) qc.setQueryData(ROSTER_KEY, BOARD);
  if (branches) {
    qc.setQueryData(BRANCHES_KEY, [
      {
        id: CAIRO,
        code: 'CAI',
        name: { ar: 'فرع القاهرة', en: 'Cairo branch' },
        parentId: null,
        catalogId: null,
      },
    ]);
  }
  return qc;
};

const ALL = ['fleetDriver.view', 'fleetRoster.view'];

const store = (permissions: string[], locale: Locale = 'ar') =>
  configureStore({
    reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
    preloadedState: {
      locale: { locale, dir: locale === 'ar' ? ('rtl' as const) : ('ltr' as const) },
      auth: {
        me: {
          id: 'u1',
          permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
        } as unknown as MeDto,
        status: 'signedIn' as const,
      },
    },
  });

const render = (
  node: ReactNode,
  { permissions = ALL, qc = client() }: { permissions?: string[]; qc?: QueryClient } = {},
): string =>
  renderToStaticMarkup(
    <Provider store={store(permissions)}>
      <QueryClientProvider client={qc}>{node}</QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);

/** The opening tag of the element whose text is `text`. */
const tagOf = (markup: string, text: string): string => {
  const at = markup.indexOf(`>${text}`);
  expect(at, `${text} is drawn`).toBeGreaterThan(-1);
  return markup.slice(markup.lastIndexOf('<', at), at + 1);
};

const MARK = 'data-driver-hover="true"';

describe('the shared name renderers carry the card on a name Fleet knows', () => {
  it('on every look of the board cell — and no title of its own beside it', () => {
    for (const look of ['name', 'person', 'identity'] as const) {
      const markup = render(<DriverCell employeeId={D1} look={look} />);
      expect(markup, look).toContain(MARK);
      expect(markup, `${look}: reachable with Tab`).toContain('tabindex="0"');
      expect(markup, `${look}: the card replaces the title`).not.toContain('title=');
      // A mark, not the id: the row's markup carries no raw id for a person it can name.
      expect(markup, look).not.toContain(D1);
    }
  });

  it('not on a name from the old books, nor on an id the roster does not carry', () => {
    const legacy = render(<DriverCell employeeId={null} name="حسن القديم" look="name" />);
    expect(legacy).not.toContain('data-driver-hover');
    expect(legacy, 'the old title stays').toContain('title="حسن القديم"');
    const unknown = render(<DriverCell employeeId="64b1f0eeeeeeeeeeeeeeee09" look="name" />);
    expect(unknown).not.toContain('data-driver-hover');
    expect(unknown, 'the id’s tail, as before').toContain('eeeeee09');
    // «الخط … زى شاشة انذار الصيانه فى كل العواميد»: on the two boards' name look the tail reads
    // at the row's type — no size or `font-figures` of its own for the table's laptop rule to shrink.
    expect(tagOf(unknown, 'eeeeee09')).not.toMatch(/font-figures|font-mono|text-xs/u);
    const elsewhere = render(<DriverCell employeeId="64b1f0eeeeeeeeeeeeeeee09" look="identity" />);
    expect(tagOf(elsewhere, 'eeeeee09'), 'the other boards as before').toContain(
      'font-figures text-xs',
    );
    const legacyName = render(<DriverName employeeId={null} name="حسن القديم" />);
    expect(legacyName).not.toContain('data-driver-hover');
    expect(legacyName).toContain('title="حسن القديم"');
  });

  it('not for a reader who may not read the drivers — no names, so no card', () => {
    // Without `fleetDriver.view` the people list is never fetched, so it is not in the cache.
    const markup = render(<DriverCell employeeId={D1} look="name" />, {
      permissions: [],
      qc: client({ people: false }),
    });
    expect(markup).not.toContain('data-driver-hover');
  });

  it('on the name with its code, and through it on every `DriverName`', () => {
    for (const markup of [
      render(<EmployeeName employeeId={D1} />),
      render(<DriverName employeeId={D1} name={null} />),
    ]) {
      expect(tagOf(markup, 'ابراهيم السيد رزق جابر')).toContain(MARK);
      expect(markup).toContain('tabindex="0"');
    }
    const option = render(<EmployeeName employeeId={D1} card={false} />);
    expect(option, 'an option button’s name carries none').not.toContain('data-driver-hover');
    expect(option).not.toContain('tabindex');
  });

  it('on the roster chip by hover only — a drag handle is no tab stop — and not in a picker’s list', () => {
    const chip = render(<DriverChip employeeId={D1} />);
    expect(chip).toContain(MARK);
    expect(chip).not.toContain('tabindex');
    expect(chip, 'the card replaces the title').not.toContain('title=');
    expect(chip, 'the chip keeps its own mark').toContain(`data-driver-chip="${D1}"`);
    const option = render(<DriverChip employeeId={D1} card={false} />);
    expect(option).not.toContain('data-driver-hover');
    expect(option, 'the option keeps its title').toContain('title="ابراهيم السيد رزق جابر"');
  });

  it('on the picked driver in a form’s box, by hover — the box keeps the focus and Enter', () => {
    const markup = render(<DriverPicker value={D1} onChange={() => undefined} />);
    const name = markup.slice(markup.indexOf('<span class="inline-flex min-w-0'));
    expect(name.slice(0, name.indexOf('>'))).toContain(MARK);
    expect(name.slice(0, name.indexOf('>'))).not.toContain('tabindex');
    expect(markup.match(/tabindex="0"/gu), 'one tab stop: the box').toHaveLength(1);
  });

  it('the bare identity, without a card, is what it was', () => {
    const markup = render(<DriverIdentity name="ابراهيم" code="HR-D1" />);
    expect(markup).toContain('title="ابراهيم"');
    expect(markup).not.toContain('data-driver-hover');
  });

  it('plain text with nobody of ours behind it is the text alone', () => {
    const markup = render(<DriverHoverText people={[]}>طرف ثالث</DriverHoverText>);
    expect(markup).toBe('<span>طرف ثالث</span>');
  });
});

describe('the card says the five facts', () => {
  const body = (opts: Parameters<typeof render>[1] = {}, people = [PEOPLE[0]!]) =>
    render(<DriverCardBody people={people} />, opts);

  it('the whole name, the code, the phone, today’s car and the branch', () => {
    const markup = body();
    expect(markup).toContain('ابراهيم السيد رزق جابر');
    expect(markup).toContain(t('fleet.drivers.columns.employeeCode'));
    expect(markup).toContain('HR-D1');
    expect(markup).toContain(t('fleet.drivers.columns.phone'));
    expect(markup).toContain('01001234567');
    expect(markup).toContain(t('fleet.drivers.card.vehicle'));
    expect(markup).toContain('>219<');
    expect(markup).toContain(t('fleet.drivers.columns.branch'));
    expect(markup).toContain('فرع القاهرة');
    // Numbers read left to right inside the Arabic card.
    expect(tagOf(markup, 'HR-D1')).toContain('dir="ltr"');
    expect(tagOf(markup, '01001234567')).toContain('dir="ltr"');
  });

  it('a car outside the reader’s board as «another car», and what HR lacks as a dash', () => {
    const markup = body({}, [PEOPLE[1]!]);
    expect(markup).toContain(t('fleet.roster.otherVehicle'));
    expect(markup, 'no phone, no branch: dashes').toMatch(/(?:>—<[\s\S]*){2}/u);
  });

  it('no car line at all for a reader who may not read the roster', () => {
    const markup = body({ permissions: ['fleetDriver.view'] });
    expect(markup).not.toContain(t('fleet.drivers.card.vehicle'));
    expect(markup).not.toContain('219');
    expect(markup, 'the other four stay').toContain('فرع القاهرة');
  });

  it('a list still on its way as «…», never a guess', () => {
    const markup = body({ qc: client({ roster: false, branches: false }) });
    expect(markup).toContain(t('fleet.drivers.card.vehicle'));
    expect(markup.match(/>…</gu)).toHaveLength(2);
  });

  it('one block per driver — an accident with two of ours at fault', () => {
    const markup = body({}, PEOPLE);
    expect(markup).toContain('ابراهيم السيد رزق جابر');
    expect(markup).toContain('محمد الشحات صادق');
    expect(markup.match(/data-driver-card-person=/gu)).toHaveLength(2);
  });

  it('in the card’s own words, in both languages', () => {
    expect(translate('ar', 'fleet.drivers.card.vehicle')).toBe('السيارة المعيّنة اليوم');
    expect(translate('en', 'fleet.drivers.card.vehicle')).toBe('Assigned car today');
  });
});

describe('the names drawn by hand are wired as well', () => {
  const source = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

  it('the drivers board, the decided driver of a التمام, and an accident’s culprits', () => {
    expect(source('pages/DriversListPage.tsx')).toMatch(/useDriverHoverCard\(/u);
    expect(source('components/UnavailabilityDialog.tsx')).toMatch(/useDriverHoverCard\(/u);
    expect(source('pages/AccidentsPage.tsx')).toContain('<CulpritCell accident={r} />');
    expect(source('pages/AccidentsPage.tsx')).toContain('<DriverHoverText');
  });

  it('and the pickers’ option lists are left without one', () => {
    expect(source('components/DriverSlotPicker.tsx')).toContain('card={false}');
    expect(source('components/RosterAssignDialog.tsx')).toContain(
      '<EmployeeName employeeId={driver.employeeId} card={false} />',
    );
  });
});

describe('the card follows its name only while the name is in sight', () => {
  const VIEW = { width: 1440, height: 900 };
  // The odometer board's scrolling box, 200px down the window, with its sticky head 48px tall.
  const TABLE_BOX = { top: 248, right: 1400, bottom: 880, left: 40 };
  const at = (top: number, left = 600) => ({ top, bottom: top + 24, left, right: left + 160 });

  it('a name inside the table’s box is in sight', () => {
    expect(nameInSight(at(400), [TABLE_BOX], VIEW)).toBe(true);
  });

  it('a name scrolled up under the head, out of the box, is not — though still inside the window', () => {
    expect(nameInSight(at(150), [TABLE_BOX], VIEW)).toBe(false);
    expect(nameInSight(at(150), [], VIEW), 'the window alone would still show it').toBe(true);
  });

  it('nor one scrolled sideways out of the box', () => {
    expect(nameInSight(at(400, 1420), [TABLE_BOX], VIEW)).toBe(false);
  });

  it('and, with no box round it, the window’s edge is the edge', () => {
    expect(nameInSight(at(-30), [], VIEW)).toBe(false);
    expect(nameInSight(at(905), [], VIEW)).toBe(false);
  });
});
