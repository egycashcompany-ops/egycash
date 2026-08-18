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
import { BadgeIcon, ClipboardIcon, TagIcon, UsersIcon } from '../../../shared/ui/icons';

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
