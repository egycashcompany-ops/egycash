// IT module landing surface at /it. IT-1 is the asset registry, so this is a registry overview,
// not a dashboard — the dashboards in design §11 are IT-6 and nothing here pretends to be them.
//
// Every number is a SERVER count read from the list endpoint's pagination meta (`pageSize: 1`),
// never a client-side tally of a page of rows. Each card gates its own §7 permission, so a query
// never fires for something the user may not see, and a user with no IT grants gets one honest
// empty state instead of a wall of errors.
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { StatCard } from '../../../shared/ui/StatCard';
import { ShortcutCard } from '../../../shared/ui/ShortcutCard';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import {
  AlertIcon,
  BadgeIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  CogIcon,
  FolderIcon,
  GridIcon,
  InboxIcon,
  LayersIcon,
  MonitorIcon,
  QrIcon,
  UsersIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useItAssets, useItTickets, useItVendors } from '../api/it-queries';

export const ItHomePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);

  const canAssets = can('itAsset.view');
  const canVendors = can('itVendor.view');
  const canCatalogs = can('itCatalog.manage');
  const canTickets = can('itTicket.view');
  const canSla = can('itSlaPolicy.manage');
  // IT-4 shipped its routes and nav rows without home cards; IT-5 adds them alongside its own, so
  // the module index finally lists every screen a viewer's grants allow.
  const canMaintenance = can('itMaintenance.view');
  const canSpareParts = can('itSparePart.view');
  const canSoftware = can('itSoftware.view');
  const canLicenses = can('itLicense.view');
  // Every grant that opens at least one card below. A viewer holding only `itSoftware.view` has a
  // screen to reach, so leaving them on the "no access" state would be a lie about their access.
  const anything =
    canAssets ||
    canVendors ||
    canCatalogs ||
    canTickets ||
    canMaintenance ||
    canSpareParts ||
    canSoftware ||
    canLicenses;

  // pageSize 1 — only `meta.totalItems` is wanted.
  const total = useItAssets({ pageSize: 1 }, canAssets);
  const inStock = useItAssets({ pageSize: 1, status: 'inStock' }, canAssets);
  const assigned = useItAssets({ pageSize: 1, status: 'assigned' }, canAssets);
  const vendors = useItVendors({ pageSize: 1, isActive: true }, canVendors);
  // Help-desk counts. Both ride the SERVER's own filters — `active` is the lifecycle split and
  // `breached` reads the STAMPS, so neither number is a clock this page recomputed (FR-6). Under
  // the `own` scope these are honestly the caller's own tickets, which is what a requester wants.
  const activeTickets = useItTickets({ pageSize: 1, active: true }, canTickets);
  const breachedTickets = useItTickets({ pageSize: 1, breached: true, active: true }, canTickets);

  /**
   * A count tile's props, from its query.
   *
   * StatCard renders a placeholder dash whenever `value` is absent — which is right while a count
   * is loading and WRONG when it failed, because a dash then reads as "zero assets" rather than
   * "this number could not be fetched". So a failed query keeps the dash and adds a caption
   * saying so; a reader can tell the three states apart.
   *
   * (`exactOptionalPropertyTypes` is on, so an absent value must be an absent prop, never
   * `undefined` — hence the spread rather than `value={…}`.)
   */
  const tile = (query: {
    data?: { meta: { totalItems: number } } | undefined;
    isPending: boolean;
    isError: boolean;
  }): { value?: string; caption?: string; loading: boolean } => {
    if (query.isError) return { caption: t('it.overview.countUnavailable'), loading: false };
    const total = query.data?.meta.totalItems;
    return {
      ...(total === undefined ? {} : { value: formatNumber(total, locale) }),
      loading: query.isPending,
    };
  };

  return (
    <PageContainer>
      <PageHeader title={t('it.module.title')} description={t('it.overview.subtitle')} />

      {!anything ? (
        <EmptyState
          title={t('it.overview.noAccessTitle')}
          description={t('it.overview.noAccessBody')}
        />
      ) : (
        <div className="space-y-6">
          {canAssets && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t('it.overview.totalAssets')}
                {...tile(total)}
                icon={MonitorIcon}
              />
              <StatCard
                label={t('it.assets.status.inStock')}
                {...tile(inStock)}
                icon={CheckIcon}
              />
              <StatCard
                label={t('it.assets.status.assigned')}
                {...tile(assigned)}
                icon={UsersIcon}
              />
              {canVendors && (
                <StatCard
                  label={t('it.overview.activeVendors')}
                  {...tile(vendors)}
                  icon={FolderIcon}
                />
              )}
            </div>
          )}

          {canTickets && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t('it.overview.activeTickets')}
                {...tile(activeTickets)}
                icon={InboxIcon}
              />
              <StatCard
                label={t('it.overview.breachedTickets')}
                {...tile(breachedTickets)}
                icon={AlertIcon}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canTickets && (
              <ShortcutCard
                to="/it/tickets"
                title={t('it.nav.tickets')}
                description={t('it.tickets.subtitle')}
                icon={ChatIcon}
              />
            )}
            {canAssets && (
              <>
                <ShortcutCard
                  to="/it/assets"
                  title={t('it.nav.assets')}
                  description={t('it.assets.subtitle')}
                  icon={MonitorIcon}
                />
                <ShortcutCard
                  to="/it/assets/scan"
                  title={t('it.nav.scan')}
                  description={t('it.scan.subtitle')}
                  icon={QrIcon}
                />
              </>
            )}
            {canVendors && (
              <ShortcutCard
                to="/it/vendors"
                title={t('it.nav.vendors')}
                description={t('it.vendors.subtitle')}
                icon={FolderIcon}
              />
            )}
            {canMaintenance && (
              <>
                <ShortcutCard
                  to="/it/maintenance"
                  title={t('it.nav.maintenance')}
                  description={t('it.maintenance.subtitle')}
                  icon={WrenchIcon}
                />
                <ShortcutCard
                  to="/it/maintenance-plans"
                  title={t('it.nav.maintenancePlans')}
                  description={t('it.plans.subtitle')}
                  icon={CalendarIcon}
                />
              </>
            )}
            {canSpareParts && (
              <ShortcutCard
                to="/it/spare-parts"
                title={t('it.nav.spareParts')}
                description={t('it.parts.subtitle')}
                icon={LayersIcon}
              />
            )}
            {canSoftware && (
              <ShortcutCard
                to="/it/software"
                title={t('it.nav.software')}
                description={t('it.software.subtitle')}
                icon={GridIcon}
              />
            )}
            {canLicenses && (
              <ShortcutCard
                to="/it/licenses"
                title={t('it.nav.licenses')}
                description={t('it.licenses.subtitle')}
                icon={BadgeIcon}
              />
            )}
            {canCatalogs && (
              <ShortcutCard
                to="/it/catalogs"
                title={t('it.nav.catalogs')}
                description={t('it.catalogs.subtitle')}
                icon={FolderIcon}
              />
            )}
            {canSla && (
              <ShortcutCard
                to="/it/helpdesk-settings"
                title={t('it.nav.helpDeskSettings')}
                description={t('it.priorities.subtitle')}
                icon={CogIcon}
              />
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
};
