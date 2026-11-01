// ATM module home at /atm — a card per ported legacy screen, plus the efficiency register and
// settlement screens whose source is the owner's workbooks rather than a legacy page (sheets
// `ATMs`, `Data Report`, and the banks' daily Masters), each shown only when the caller holds the
// permission the screen is routed behind (the fleet/operations owner rule: no forbidden cards, no
// card without a shipped screen).
// The unread-mail badge rides the mail card, which is the port of the counter every legacy ATM
// page rendered in its nav (contad_app.js:266-268).
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../shared/ui/ModuleHome';
import {
  CalendarIcon,
  ChartIcon,
  ClipboardIcon,
  CogIcon,
  GridIcon,
  InboxIcon,
  LayersIcon,
  PinIcon,
  QrIcon,
  ReceiptIcon,
  ShieldIcon,
  TagIcon,
  TruckIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Shortcut {
  to: string;
  titleKey: string;
  descKey: string;
  icon: Icon;
  permission: string;
}

export const ATM_SHORTCUTS: Shortcut[] = [
  /** Legacy `/atm_replenishment`. */
  {
    to: '/atm/replenishments',
    titleKey: 'atm.nav.replenishments',
    descKey: 'atm.cards.replenishments',
    icon: ClipboardIcon,
    permission: 'atmReplenishment.view',
  },
  /** Legacy `/atm_replenishment_done`. */
  {
    to: '/atm/replenishments/done',
    titleKey: 'atm.nav.replenishmentsDone',
    descKey: 'atm.cards.replenishmentsDone',
    icon: CalendarIcon,
    permission: 'atmReplenishment.view',
  },
  /** Legacy `/atm_maintenance`. */
  {
    to: '/atm/maintenance',
    titleKey: 'atm.nav.maintenance',
    descKey: 'atm.cards.maintenance',
    icon: WrenchIcon,
    permission: 'atmMaintenance.view',
  },
  /** Legacy `/atm_maintenance_done`. */
  {
    to: '/atm/maintenance/done',
    titleKey: 'atm.nav.maintenanceDone',
    descKey: 'atm.cards.maintenanceDone',
    icon: CalendarIcon,
    permission: 'atmMaintenance.view',
  },
  /** Legacy `/mail_maintenance`. */
  {
    to: '/atm/mail-tickets',
    titleKey: 'atm.nav.mailTickets',
    descKey: 'atm.cards.mailTickets',
    icon: InboxIcon,
    permission: 'atmMailTicket.view',
  },
  /** Legacy `/mail_maintenance_log` — the admin-only decisions log. */
  {
    to: '/atm/mail-tickets/log',
    titleKey: 'atm.nav.mailLog',
    descKey: 'atm.cards.mailLog',
    icon: ClipboardIcon,
    permission: 'atmMailTicket.viewLog',
  },
  /** Legacy `/all_atm`. */
  {
    to: '/atm/machines',
    titleKey: 'atm.nav.machines',
    descKey: 'atm.cards.machines',
    icon: GridIcon,
    permission: 'atmMachine.view',
  },
  /** The machine map and its zones (docs/12-planning/atm-map-zones.md §7.4) — no legacy screen. */
  {
    to: '/atm/map',
    titleKey: 'atm.nav.map',
    descKey: 'atm.cards.map',
    icon: PinIcon,
    permission: 'atmMap.view',
  },
  /** Legacy `/reports_atm` — today's numbers per bank. */
  {
    to: '/atm/reports/daily',
    titleKey: 'atm.nav.dailyReport',
    descKey: 'atm.cards.dailyReport',
    icon: ChartIcon,
    permission: 'atmReplenishment.view',
  },
  /**
   * Legacy `/data_edit_atm`. The card follows its nav row's key — the Operations key since the
   * data-edit split (D2, spec §7.3); a `manage`-only holder still reaches the page by its route.
   */
  {
    to: '/atm/data-edit',
    titleKey: 'atm.nav.dataEdit',
    descKey: 'atm.cards.dataEdit',
    icon: TagIcon,
    permission: 'atmRefLabel.create',
  },
  /** The efficiency register — sheet `ATMs` of the owner's workbook. */
  {
    to: '/atm/register',
    titleKey: 'atm.nav.register',
    descKey: 'atm.cards.register',
    icon: ShieldIcon,
    permission: 'atmRegister.view',
  },
  /** Sheet `Data Report` — machines in operation per bank and per branch. */
  {
    to: '/atm/register/report',
    titleKey: 'atm.nav.registerReport',
    descKey: 'atm.cards.registerReport',
    icon: ChartIcon,
    permission: 'atmRegisterReport.view',
  },
  /**
   * Settlements & Review → Preparation → Control & Supplies (docs/12-planning/
   * atm-settlements-phase1.md §9.8) — the banks' daily Master workbooks, no legacy screen. Each card
   * follows its nav row's key, which is its route's guard.
   */
  {
    to: '/atm/settlements/plans',
    titleKey: 'atm.nav.settlementPlan',
    descKey: 'atm.cards.settlementPlan',
    icon: ReceiptIcon,
    permission: 'atmSettlementPlan.view',
  },
  {
    to: '/atm/settlements/layouts',
    titleKey: 'atm.nav.cassetteLayouts',
    descKey: 'atm.cards.cassetteLayouts',
    icon: LayersIcon,
    permission: 'atmCassetteLayout.view',
  },
  {
    to: '/atm/preparation',
    titleKey: 'atm.nav.preparation',
    descKey: 'atm.cards.preparation',
    icon: QrIcon,
    permission: 'atmPreparation.view',
  },
  {
    to: '/atm/control',
    titleKey: 'atm.nav.control',
    descKey: 'atm.cards.control',
    icon: TruckIcon,
    permission: 'atmControl.view',
  },
  /** The maintenance mailbox and the branches that work as one (2026-10-28) — no legacy screen. */
  {
    to: '/atm/settings',
    titleKey: 'atm.nav.settings',
    descKey: 'atm.cards.settings',
    icon: CogIcon,
    permission: 'atmSettings.manage',
  },
];

export const AtmOverviewPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();

  const shortcuts = ATM_SHORTCUTS.filter((c) => can(c.permission)).map((c) => ({
    to: c.to,
    title: t(c.titleKey),
    description: t(c.descKey),
    icon: c.icon,
  }));

  return (
    <PageContainer>
      <PageHeader title={t('atm.overview.title')} />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={[]}
        emptyTitle={t('atm.overview.noAccessTitle')}
        emptyBody={t('atm.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
