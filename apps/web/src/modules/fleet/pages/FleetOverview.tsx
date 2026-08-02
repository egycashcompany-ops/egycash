// Fleet module home (FW-1) — the same permission-aware ModuleHome shape Organization and
// Recruitment use: cards the user cannot open are hidden, everything localized. FW-2 upgrades
// this surface into the live dashboard (real KPI numbers from the fleet queries).
import { type ComponentType, type SVGProps } from 'react';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ModuleHome } from '../../../shared/ui/ModuleHome';
import {
  AlertIcon,
  CalendarIcon,
  ClipboardIcon,
  CogIcon,
  FolderIcon,
  GaugeIcon,
  ShieldIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const SHORTCUTS: { to: string; key: string; icon: Icon; permission: string }[] = [
  { to: '/fleet/vehicles', key: 'vehicles', icon: TruckIcon, permission: 'fleetVehicle.view' },
  { to: '/fleet/drivers', key: 'drivers', icon: UsersIcon, permission: 'fleetDriver.view' },
  {
    to: '/fleet/attendance',
    key: 'attendance',
    icon: CalendarIcon,
    permission: 'fleetAvailability.view',
  },
  { to: '/fleet/odometer', key: 'odometer', icon: GaugeIcon, permission: 'fleetOdometer.view' },
  {
    to: '/fleet/maintenance',
    key: 'maintenance',
    icon: WrenchIcon,
    permission: 'fleetMaintenance.view',
  },
  {
    to: '/fleet/maintenance-alarms',
    key: 'maintenanceAlarms',
    icon: AlertIcon,
    permission: 'fleetOdometer.view',
  },
  { to: '/fleet/roster', key: 'roster', icon: ClipboardIcon, permission: 'fleetRoster.view' },
  { to: '/fleet/accidents', key: 'accidents', icon: AlertIcon, permission: 'fleetAccident.view' },
  {
    to: '/fleet/violations',
    key: 'violations',
    icon: ShieldIcon,
    permission: 'fleetViolation.view',
  },
  { to: '/fleet/catalogs', key: 'catalogs', icon: FolderIcon, permission: 'fleetCatalog.manage' },
  {
    to: '/fleet/settings',
    key: 'settings',
    icon: CogIcon,
    permission: 'fleetMaintenanceRule.manage',
  },
];

const KPIS: { key: string; icon: Icon; permission: string }[] = [
  { key: 'vehicles', icon: TruckIcon, permission: 'fleetVehicle.view' },
  { key: 'drivers', icon: UsersIcon, permission: 'fleetDriver.view' },
  { key: 'maintenance', icon: WrenchIcon, permission: 'fleetMaintenance.view' },
  { key: 'maintenanceAlarms', icon: AlertIcon, permission: 'fleetOdometer.view' },
];

export const FleetOverview = (): JSX.Element => {
  const t = useT();
  const can = useCan();

  const shortcuts = SHORTCUTS.filter((c) => can(c.permission)).map((c) => ({
    to: c.to,
    title: t(`fleet.nav.${c.key}`),
    description: t(`fleet.cards.${c.key}`),
    icon: c.icon,
  }));
  const kpis = KPIS.filter((k) => can(k.permission)).map((k) => ({
    label: t(`fleet.nav.${k.key}`),
    icon: k.icon,
  }));

  return (
    <PageContainer>
      <PageHeader title={t('fleet.overview.title')} description={t('fleet.overview.subtitle')} />
      <ModuleHome
        shortcuts={shortcuts}
        kpis={kpis}
        emptyTitle={t('fleet.overview.noAccessTitle')}
        emptyBody={t('fleet.overview.noAccessBody')}
      />
    </PageContainer>
  );
};
