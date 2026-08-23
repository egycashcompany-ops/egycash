// ATM module home at /atm — a card per ported legacy screen, shown only when the caller holds
// the permission the screen is routed behind (the fleet/operations owner rule: no forbidden
// cards, no card without a shipped screen). The unread-mail badge rides the mail card, which is
// the port of the counter every legacy ATM page rendered in its nav (contad_app.js:266-268).
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../shared/ui/ModuleHome';
import {
  CalendarIcon,
  ClipboardIcon,
  GridIcon,
  InboxIcon,
  TagIcon,
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
  /** Legacy `/data_edit_atm`. */
  {
    to: '/atm/data-edit',
    titleKey: 'atm.nav.dataEdit',
    descKey: 'atm.cards.dataEdit',
    icon: TagIcon,
    permission: 'atmMachine.manage',
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
      <PageHeader title={t('atm.overview.title')} description={t('atm.overview.subtitle')} />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={[]}
        emptyTitle={t('atm.overview.noAccessTitle')}
        emptyBody={t('atm.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
