// «لوحة التشغيلة», Round 22 — what hovering shows, and that it never gets in a drag's way.
//
// The owner, on the live board:
//   C. «وعاوز لما اقف على سلاح او مزولة وتظهر يبقى فشكل احسن من كدا» — an icon's name was the
//      browser's grey `title`; now it is a TIP in the cards' own frame: the icon again, and its name;
//   D. «ولما اقف على القائد يظهر فى كارد زى السواق فى الحركة» — a person's CARD, the Fleet driver card's
//      look: the whole name, the code, «الوظيفة», the mobile, the branch; with this board's role
//      colour, where he sits in the draft, and what he holds by its icons.
//
// What a typecheck cannot see:
//   • no chip, icon or filter carries a `title` any more — a grey box would sit on top of the card;
//   • the card opens from the NAME (the mouse) and the chip's BUTTON (the keyboard) — never from the
//     icons, which open their own tips — and adds no tab stop of its own;
//   • while a drag is in progress, neither a card nor a tip can open (no trigger at all);
//   • both are drawn in the shared layer that takes no pointer events (`HoverCardLayer`), the tip in
//     its small frame, centred over its icon;
//   • the card says the facts in the Fleet card's order, then «في التشغيلة», then keeps a place for
//     the attendance line.
//
// The suite runs in node with no DOM, so nothing hovers: the triggers are read from static markup or
// from a probe that prints the props a hook hands out; the bodies are rendered on their own.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type Locale,
  type MeDto,
  type OperationsCrewMemberDto,
  type OperationsCrewRequirementsDto,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import type { ReactNode } from 'react';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { HOVER_TIP_FRAME } from '../../fleet/components/HoverCardLayer';
import { EMPTY_POOL_QUERY, PLAN_FLAGS } from '../lib/crew-plan';
import { CrewPlanChip } from './CrewPlanChip';
import { PlanMemberCardBody, usePlanMemberCard } from './CrewPlanMemberCard';
import { CrewPlanPool } from './CrewPlanPools';
import { CrewFlagMarks, FlagTipBody, useFlagTip } from './crew-plan-icons';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const BRANCH = '64b1f0bbbbbbbbbbbbbbbb01';

const requirements = (
  over: Partial<OperationsCrewRequirementsDto>,
): OperationsCrewRequirementsDto => ({
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
  notes: null,
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});

/** A BLUE one from the owner's board: a specialist who also leads, with a gun and a licence. */
const AHMED: OperationsCrewMemberDto = {
  employeeId: 'e-0200011',
  code: '0200011',
  fullNameAr: 'احمد سيد بركة محمد فياض',
  status: 'active',
  jobTitle: { id: 'jt', name: { ar: 'رئيس مجموعة نقل اموال', en: 'Cash transfer group head' } },
  phone: '01001234567',
  branchId: BRANCH,
  requirements: requirements({
    isCaptain: true,
    isSpecialist: true,
    hasWeapon: true,
    hasLicense: true,
    hasTemporaryLicense: true,
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
  {
    locale = 'ar',
    permissions = ['operationsCrew.view', 'operationsCrew.plan'],
  }: { locale?: Locale; permissions?: string[] } = {},
): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
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
      })}
    >
      <QueryClientProvider client={client()}>{node}</QueryClientProvider>
    </Provider>,
  );

const t = (key: string, locale: Locale = 'ar'): string => translate(locale, key);
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

/** Prints the props a hook hands its trigger — the only way to see handlers without a DOM. */
const keysOf = (props: object): string =>
  Object.entries(props)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort()
    .join(' ');

const FlagTipProbe = ({ quiet }: { quiet: boolean }): JSX.Element => {
  const tip = useFlagTip('hasWeapon', quiet);
  return <i data-keys={keysOf(tip.triggerProps)}>{tip.tip}</i>;
};

const CardProbe = ({ dragActive }: { dragActive: boolean }): JSX.Element => {
  const card = usePlanMemberCard(AHMED, { dragActive, seat: null });
  return (
    <i data-name={keysOf(card.nameProps)} data-button={keysOf(card.buttonProps)}>
      {card.card}
    </i>
  );
};

const chip = (over: Partial<Parameters<typeof CrewPlanChip>[0]> = {}): JSX.Element => (
  <CrewPlanChip
    member={AHMED}
    variant="pool"
    selected={false}
    dragging={false}
    canPlan
    onSelect={() => undefined}
    onDragStart={() => undefined}
    onDragEnd={() => undefined}
    {...over}
  />
);

// ── C — the icon's tip ─────────────────────────────────────────────────────────────────────────────

describe('C — an icon is named by a tip in the cards’ frame, not by the browser’s `title`', () => {
  it('draws every icon of a chip with its name for the screen reader, its tip’s trigger, and no `title`', () => {
    const html = render(<CrewFlagMarks flags={['hasWeapon', 'hasLicense']} />);
    for (const flag of ['hasWeapon', 'hasLicense']) {
      expect(html).toContain(`data-flag="${flag}"`);
      expect(html).toContain(`data-flag-tip="${flag}"`);
      expect(html).toContain(`aria-label="${t(`operations.crew.flag.${flag}`)}"`);
    }
    expect(html).not.toContain('title=');
  });

  it('opens on hover and on a keyboard focus, closes on leave, blur, a press and a drag start — and adds no tab stop', () => {
    const html = render(<FlagTipProbe quiet={false} />);
    expect(html).toContain(
      'data-keys="data-flag-tip onBlur onDragStart onFocus onKeyDown onMouseDown onMouseEnter onMouseLeave ref"',
    );
    // Not described by the tip: the `aria-label` already says the same name.
    expect(html).not.toContain('aria-describedby');
  });

  it('cannot open at all while a chip is being dragged', () => {
    expect(render(<FlagTipProbe quiet />)).toContain('data-keys="data-flag-tip"');
  });

  it('says the icon again and its name — «سلاح» — in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      const html = render(<FlagTipBody flag="hasWeapon" />, { locale });
      expect(html).toContain('data-flag-tip-body="hasWeapon"');
      expect(html).toContain('<svg');
      expect(text(html)).toBe(t('operations.crew.flag.hasWeapon', locale));
    }
  });

  it('rides the shared layer — no pointer events — in the small frame, centred over its icon, in both themes', () => {
    const icons = read('./crew-plan-icons.tsx');
    expect(icons).toContain("from '../../fleet/components/HoverCardLayer'");
    expect(icons).toContain('mark="crew-flag"');
    expect(icons).toContain('frame={HOVER_TIP_FRAME}');
    expect(icons).toContain('align="center"');
    expect(icons).not.toMatch(/\btitle=/u);
    expect(read('../../fleet/components/HoverCardLayer.tsx')).toContain(
      "className={cn('pointer-events-none fixed z-[110] animate-menu-in', frame)}",
    );
    expect(HOVER_TIP_FRAME).toContain('dark:bg-[#131d35]');
    expect(HOVER_TIP_FRAME).toContain('bg-white');
  });

  it('gives each pool filter the tip too — named with its pool for the screen reader, no `title`', () => {
    const html = render(
      <CrewPlanPool
        pool="captains"
        listed={[AHMED]}
        total={1}
        free={1}
        ready
        query={EMPTY_POOL_QUERY}
        onQueryChange={() => undefined}
        chips={{
          selected: null,
          dragging: null,
          canPlan: true,
          placedAt: () => null,
          onSelect: () => undefined,
          onDragStart: () => undefined,
          onDragEnd: () => undefined,
        }}
        drop={{ armed: false, over: false }}
        returnSelected={null}
      />,
    );
    for (const flag of PLAN_FLAGS) {
      expect(html).toContain(`data-pool-flag="${flag}"`);
      expect(html).toContain(
        `aria-label="${t(`operations.crew.flag.${flag}`)} — ${t('operations.crewPlan.pools.captains')}"`,
      );
    }
    expect(html.match(/data-flag-tip="/g)).toHaveLength(PLAN_FLAGS.length + 3);
    expect(html).not.toContain('title=');
  });
});

// ── D — the person's card ──────────────────────────────────────────────────────────────────────────

describe('D — a person’s card, «زى السواق فى الحركة»', () => {
  it('says the whole name, the role in its colour, then the Fleet card’s facts and «في التشغيلة»', () => {
    const html = render(<PlanMemberCardBody member={AHMED} mayReadCrew seat="213 · قائد الطاقم" />);
    expect(html).toContain('data-plan-member-card="dual"');
    expect(html).toContain(AHMED.fullNameAr);
    // BLUE, as his chip — «أخصائي يعمل قائدًا».
    expect(html).toMatch(/data-plan-member-role="dual" class="[^"]*bg-sky-600/u);
    expect(html).toContain(t('operations.crewPlan.role.dual'));
    expect(facts(html)).toEqual([
      [t('fleet.drivers.columns.employeeCode'), '0200011'],
      [t('operations.crew.requirements.jobTitle'), 'رئيس مجموعة نقل اموال'],
      [t('fleet.drivers.columns.phone'), '01001234567'],
      [t('fleet.drivers.columns.branch'), 'المهندسين'],
      [t('operations.crewPlan.card.seat'), '213 · قائد الطاقم'],
      [
        t('operations.crew.requirements.holds'),
        ['hasWeapon', 'hasLicense', 'hasTemporaryLicense']
          .map((flag) => t(`operations.crew.flag.${flag}`))
          .join(' '),
      ],
    ]);
  });

  it('draws what he holds by the chips’ own icons — «قائد» and «أخصائي» are the role, not chips', () => {
    const html = render(<PlanMemberCardBody member={AHMED} mayReadCrew seat={null} />);
    expect(html).toContain('data-plan-member-held="hasWeapon hasLicense hasTemporaryLicense"');
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(4); // the head's person + 3 icons
    const held = Object.fromEntries(facts(html))[t('operations.crew.requirements.holds')];
    expect(held).not.toContain(t('operations.crew.flag.isCaptain'));
    expect(held).not.toContain(t('operations.crew.flag.isSpecialist'));
  });

  it('says «غير معيَّن اليوم» for somebody on no row, and keeps the attendance line’s place after it', () => {
    const html = render(
      <PlanMemberCardBody
        member={AHMED}
        mayReadCrew
        seat={null}
        attendance={
          <>
            <dt>الحضور</dt>
            <dd>غائب</dd>
          </>
        }
      />,
    );
    const said = facts(html);
    expect(said.map(([label]) => label).slice(4, 6)).toEqual([
      t('operations.crewPlan.card.seat'),
      'الحضور',
    ]);
    expect(Object.fromEntries(said)[t('operations.crewPlan.card.seat')]).toBe(
      t('operations.crewPlan.card.unseated'),
    );
    expect(t('operations.crewPlan.card.unseated')).toBe('غير معيَّن اليوم');
  });

  it('gives a reader the server sends no phone to no phone line, and says «nothing held» for a red one', () => {
    const red = { ...AHMED, phone: null, requirements: requirements({ isSpecialist: true }) };
    const html = render(<PlanMemberCardBody member={red} mayReadCrew={false} seat={null} />, {
      permissions: [],
    });
    expect(html).toContain('data-plan-member-card="specialist"');
    expect(html).not.toContain(t('fleet.drivers.columns.phone'));
    expect(Object.fromEntries(facts(html))[t('operations.crew.requirements.holds')]).toBe(
      t('operations.crew.flag.carriesNothing'),
    );
  });

  it('opens from the NAME with the mouse and from the chip’s BUTTON with the keyboard, adding no tab stop', () => {
    const html = render(<CardProbe dragActive={false} />);
    expect(html).toContain(
      'data-name="data-plan-member-hover onMouseDown onMouseEnter onMouseLeave ref"',
    );
    expect(html).toContain('data-button="onBlur onFocus onKeyDown"');
    expect(html).not.toContain('tabIndex');
  });

  it('cannot open at all while a chip is being dragged', () => {
    const html = render(<CardProbe dragActive />);
    expect(html).toContain('data-name=""');
    expect(html).toContain('data-button=""');
  });

  it('is on the chip in the pool and on the row: the name marked, no `title` on it or its icons', () => {
    for (const node of [chip(), chip({ variant: 'seat', seatedAt: '213 · قائد الطاقم' })]) {
      const html = render(node);
      expect(html).toMatch(/<span data-plan-member-hover="true" class="[^"]*truncate[^"]*">احمد/u);
      expect(html).not.toContain('title=');
      // Closed until hovered.
      expect(html).not.toContain('data-plan-member-card');
    }
  });

  it('under a drag, the chip carries no card and no tip trigger — nothing can open over the slots', () => {
    const html = render(chip({ dragActive: true }));
    expect(html).not.toContain('data-plan-member-hover');
    // The icons still say their names to a screen reader.
    expect(html).toContain(`aria-label="${t('operations.crew.flag.hasWeapon')}"`);
  });

  it('rides the shared layer (no pointer events) with the Fleet card’s frame, and the page wires it', () => {
    const card = read('./CrewPlanMemberCard.tsx');
    expect(card).toContain('<HoverCardLayer id={hover.id} anchor={hover.anchor} mark="crew-plan">');
    expect(card).not.toMatch(/\bframe=/u);
    expect(card).toContain("from './RosterMemberCard'");
    const page = read('../pages/CrewBoardPage.tsx');
    expect(page).toContain('seatedAt={placedAt(employeeId)?.long ?? null}');
    expect(page).toContain('dragActive={dragging !== null}');
    expect(read('./CrewPlanPools.tsx')).toContain('dragActive={chips.dragging !== null}');
  });
});
