// Operations module home at /operations — the landing surface for the cash-transfer desk.
//
// The shortcut list IS the migration map: each card is one legacy screen's replacement, and a card
// appears only when the user holds the permission the screen is routed behind. A user with no
// Operations grants gets one honest empty state, never a wall of forbidden cards.
//
// Cards land here in the SAME slice that ships the screen behind them (the fleet owner rule): no
// card ever points at a route that does not exist yet.
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../shared/ui/ModuleHome';
import {
  BadgeIcon,
  CalendarIcon,
  ChartIcon,
  ClipboardIcon,
  InboxIcon,
  ShieldIcon,
  TagIcon,
  TruckIcon,
  UsersIcon,
} from '../../../shared/ui/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Shortcut {
  to: string;
  titleKey: string;
  descKey: string;
  icon: Icon;
  permission: string;
}

export const OPERATIONS_SHORTCUTS: Shortcut[] = [
  /** Legacy `/main_ops` — the desk's working set for a day. */
  {
    to: '/operations/shipments',
    titleKey: 'operations.nav.dailyOps',
    descKey: 'operations.cards.dailyOps',
    icon: ClipboardIcon,
    permission: 'operationsShipment.view',
  },
  /** Legacy `/tashghela` — tomorrow's crews, planned a day ahead. */
  {
    to: '/operations/crew-board',
    titleKey: 'operations.nav.crewBoard',
    descKey: 'operations.cards.crewBoard',
    icon: UsersIcon,
    permission: 'operationsCrew.view',
  },
  /** Legacy `/requirement` — who is operations crew, and what they carry. */
  {
    to: '/operations/requirements',
    titleKey: 'operations.nav.requirements',
    descKey: 'operations.cards.requirements',
    icon: BadgeIcon,
    permission: 'operationsCrew.view',
  },
  /** Legacy `/mohsana` — the open secured backlog, all-time and deliberately undated. */
  {
    to: '/operations/secured',
    titleKey: 'operations.nav.secured',
    descKey: 'operations.cards.secured',
    icon: InboxIcon,
    permission: 'operationsShipment.view',
  },
  /** Legacy `/receive_mohsana` — the treasurer's receiving queue. */
  {
    to: '/operations/vault/receive',
    titleKey: 'operations.nav.vaultReceive',
    descKey: 'operations.cards.vaultReceive',
    icon: ShieldIcon,
    permission: 'operationsVault.view',
  },
  /** Legacy `/tash4ela_mohasana` + `/deliver_mohsana` — one list, two acts. */
  {
    to: '/operations/vault/dispatch',
    titleKey: 'operations.nav.vaultDispatch',
    descKey: 'operations.cards.vaultDispatch',
    icon: TruckIcon,
    permission: 'operationsVault.view',
  },
  /** Legacy `/vault1` — what is in the vault right now. */
  {
    to: '/operations/vault',
    titleKey: 'operations.nav.vault',
    descKey: 'operations.cards.vault',
    icon: ShieldIcon,
    permission: 'operationsVault.view',
  },
  /** Legacy `/vault1_reports` — what the vault holds, rolled up by bank. */
  {
    to: '/operations/reports/vault',
    titleKey: 'operations.nav.vaultReport',
    descKey: 'operations.cards.vaultReport',
    icon: ChartIcon,
    permission: 'operationsVault.view',
  },
  /** Legacy `/ops_report` — the month's work by captain. */
  {
    to: '/operations/reports/captains',
    titleKey: 'operations.nav.captainReport',
    descKey: 'operations.cards.captainReport',
    icon: ChartIcon,
    permission: 'operationsShipment.view',
  },
  /** Legacy `/ops_bank_report` — the same month, by bank. */
  {
    to: '/operations/reports/banks',
    titleKey: 'operations.nav.bankReport',
    descKey: 'operations.cards.bankReport',
    icon: ChartIcon,
    permission: 'operationsShipment.view',
  },
  /**
   * NO legacy equivalent (discovery §2.2): `/ops_attendance` never existed and `/fleet_attendance`
   * is Fleet's drivers screen. Gated on `attendance.view` — HR's grant, because it is HR's data —
   * so the card is absent for a planner who may not read attendance at all.
   */
  {
    to: '/operations/attendance',
    titleKey: 'operations.nav.attendance',
    descKey: 'operations.cards.attendance',
    icon: CalendarIcon,
    permission: 'attendance.view',
  },
  /** Legacy `/data_edit` — the reference data every other Operations screen picks from. */
  {
    to: '/operations/catalogs',
    titleKey: 'operations.nav.catalogs',
    descKey: 'operations.cards.catalogs',
    icon: TagIcon,
    permission: 'operationsCatalog.manage',
  },
];

export const OperationsOverviewPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();

  const shortcuts = OPERATIONS_SHORTCUTS.filter((c) => can(c.permission)).map((c) => ({
    to: c.to,
    title: t(c.titleKey),
    description: t(c.descKey),
    icon: c.icon,
  }));

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.overview.title')}
        description={t('operations.overview.subtitle')}
      />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={[]}
        emptyTitle={t('operations.overview.noAccessTitle')}
        emptyBody={t('operations.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
