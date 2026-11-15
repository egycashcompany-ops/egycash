// The member card on «كشف طاقم العمليات» — Round 19b: «ولما اقف على القائد يجيب بياناته زى السواق».
//
// What a typecheck cannot see:
//   • the card says the Fleet driver card's facts for the member — the whole name, the code,
//     «الوظيفة», the mobile number, the branch named from the shared list — and then what they hold,
//     each flag a chip that says its name in words;
//   • a reader the server sends no phone to (no `operationsCrew.view`) gets NO phone line, not a
//     dash; one with the grant whose member HR has no phone for gets the dash;
//   • a member with nothing saved says so, rather than an empty line;
//   • the name is the trigger — reachable with Tab, marked, and carrying no raw id.
//
// The suite runs in node with no DOM, so nothing hovers: the trigger is read from static markup, and
// the body is rendered on its own over a seeded branch list (as `BoardCrewCards.spec`).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { RosterMemberCardBody, RosterMemberHoverName } from './RosterMemberCard';

const BRANCH = '64b1f0bbbbbbbbbbbbbbbb01';
const EMPLOYEE = '64b1f0dddddddddddddddd18';

const requirements = (
  over: Partial<OperationsCrewRequirementsDto>,
): OperationsCrewRequirementsDto => ({
  id: 'r-18',
  employeeId: EMPLOYEE,
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
  notes: null,
  version: 2,
  createdAt: '',
  updatedAt: '',
  ...over,
});

// The legacy roster's own row: «محمود محمد محمود محمد اسد», 0100018, «رئيس مجموعة نقل اموال».
const MAHMOUD: OperationsCrewMemberDto = {
  employeeId: EMPLOYEE,
  code: '0100018',
  fullNameAr: 'محمود محمد محمود محمد اسد',
  status: 'active',
  jobTitle: {
    id: 'jt-group',
    name: { ar: 'رئيس مجموعة نقل اموال', en: 'Cash transfer group head' },
  },
  phone: '01001234567',
  branchId: BRANCH,
  requirements: requirements({
    isCaptain: true,
    hasWeapon: true,
    hasSignature: true,
    hasLicense: true,
  }),
  assignedVehicleId: null,
};

const client = (): QueryClient => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['organization', 'branches', 'options', 'withInactive'], [
    {
      id: BRANCH,
      code: 'MOH',
      name: { ar: 'المهندسين', en: 'Mohandessin' },
      parentId: null,
      catalogId: null,
    },
  ] satisfies OrgUnitOptionDto[]);
  return qc;
};

const render = (
  node: ReactNode,
  { permissions = ['operationsCrew.view'] }: { permissions?: string[] } = {},
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as const, dir: 'rtl' as const },
          auth: {
            me: {
              id: 'u1',
              permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <QueryClientProvider client={client()}>{node}</QueryClientProvider>
    </Provider>,
  );

const t = (key: string): string => translate('ar', key);
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** The card's facts as label → value, in the order the card says them. */
const facts = (html: string): [string, string][] =>
  [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => [
    text(m[1] as string),
    text(m[2] as string),
  ]);

describe('the member card — the Fleet driver card’s facts, then what they hold', () => {
  it('says the whole name, then the code, «الوظيفة», the phone, the branch and «يحمل», in that order', () => {
    const html = render(<RosterMemberCardBody member={MAHMOUD} mayReadCrew />);
    expect(html).toContain('data-roster-card="true"');
    expect(html).toContain(MAHMOUD.fullNameAr);
    expect(facts(html)).toEqual([
      [t('fleet.drivers.columns.employeeCode'), '0100018'],
      [t('operations.crew.requirements.jobTitle'), 'رئيس مجموعة نقل اموال'],
      [t('fleet.drivers.columns.phone'), '01001234567'],
      [t('fleet.drivers.columns.branch'), 'المهندسين'],
      [
        t('operations.crew.requirements.holds'),
        ['isCaptain', 'hasWeapon', 'hasSignature', 'hasLicense']
          .map((flag) => t(`operations.crew.flag.${flag}`))
          .join(' '),
      ],
    ]);
  });

  it('sets the code and the phone as figures — left to right, in the figures’ face', () => {
    const html = render(<RosterMemberCardBody member={MAHMOUD} mayReadCrew />);
    expect(html).toContain('<span dir="ltr" class="font-figures">0100018</span>');
    expect(html).toContain('<span dir="ltr" class="font-figures">01001234567</span>');
  });

  it('draws each flag held as a chip that names it, in the table’s order', () => {
    const html = render(<RosterMemberCardBody member={MAHMOUD} mayReadCrew />);
    expect(html).toContain('data-roster-card-held="isCaptain hasWeapon hasSignature hasLicense"');
    // Not held: not named.
    expect(text(html)).not.toContain(t('operations.crew.flag.isSpecialist'));
    expect(text(html)).not.toContain(t('operations.crew.flag.hasTemporaryLicense'));
  });

  it('gives a reader the server sends no phone to NO phone line — not a dash that reads «no phone»', () => {
    const html = render(<RosterMemberCardBody member={MAHMOUD} mayReadCrew={false} />, {
      permissions: [],
    });
    expect(html).not.toContain(t('fleet.drivers.columns.phone'));
    expect(html).not.toContain('01001234567');
    // The rest of the card is all there.
    expect(facts(html).map(([label]) => label)).toEqual([
      t('fleet.drivers.columns.employeeCode'),
      t('operations.crew.requirements.jobTitle'),
      t('fleet.drivers.columns.branch'),
      t('operations.crew.requirements.holds'),
    ]);
  });

  it('marks what HR has no answer for with a dash — never a guess, never an id', () => {
    const html = render(
      <RosterMemberCardBody
        member={{ ...MAHMOUD, phone: null, branchId: null, jobTitle: null }}
        mayReadCrew
      />,
    );
    const said = Object.fromEntries(facts(html));
    expect(said[t('fleet.drivers.columns.phone')]).toBe('—');
    expect(said[t('fleet.drivers.columns.branch')]).toBe('—');
    expect(said[t('operations.crew.requirements.jobTitle')]).toBe('—');
    expect(html).not.toContain(BRANCH);
  });

  it('says a member with nothing saved carries nothing recorded — a row all off, or no row yet', () => {
    for (const member of [
      { ...MAHMOUD, requirements: null },
      { ...MAHMOUD, requirements: requirements({}) },
    ]) {
      const said = Object.fromEntries(
        facts(render(<RosterMemberCardBody member={member} mayReadCrew />)),
      );
      expect(said[t('operations.crew.requirements.holds')]).toBe(
        t('operations.crew.flag.carriesNothing'),
      );
    }
  });
});

describe('the name — the card’s trigger', () => {
  it('is the name itself, marked, reachable with Tab, and closed until hovered', () => {
    const html = render(<RosterMemberHoverName member={MAHMOUD} className="block" />);
    expect(html).toContain('data-roster-hover="true"');
    expect(html).toContain('tabindex="0"');
    expect(text(html)).toBe(MAHMOUD.fullNameAr);
    expect(html).not.toContain('data-roster-card');
    expect(html).not.toContain(EMPLOYEE);
  });
});
