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
import { CheckIcon, FolderIcon, MonitorIcon, QrIcon, UsersIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useItAssets, useItVendors } from '../api/it-queries';

export const ItHomePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);

  const canAssets = can('itAsset.view');
  const canVendors = can('itVendor.view');
  const canCatalogs = can('itCatalog.manage');
  const anything = canAssets || canVendors || canCatalogs;

  // pageSize 1 — only `meta.totalItems` is wanted.
  const total = useItAssets({ pageSize: 1 }, canAssets);
  const inStock = useItAssets({ pageSize: 1, status: 'inStock' }, canAssets);
  const assigned = useItAssets({ pageSize: 1, status: 'assigned' }, canAssets);
  const vendors = useItVendors({ pageSize: 1, isActive: true }, canVendors);

  // `exactOptionalPropertyTypes` is on: an absent value must be an ABSENT prop, not `undefined`.
  // StatCard renders its own placeholder dash when `value` is missing, which is exactly what a
  // still-loading count should show.
  const count = (value: number | undefined): { value?: string } =>
    value === undefined ? {} : { value: formatNumber(value, locale) };

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
                {...count(total.data?.meta.totalItems)}
                loading={total.isPending}
                icon={MonitorIcon}
              />
              <StatCard
                label={t('it.assets.status.inStock')}
                {...count(inStock.data?.meta.totalItems)}
                loading={inStock.isPending}
                icon={CheckIcon}
              />
              <StatCard
                label={t('it.assets.status.assigned')}
                {...count(assigned.data?.meta.totalItems)}
                loading={assigned.isPending}
                icon={UsersIcon}
              />
              {canVendors && (
                <StatCard
                  label={t('it.overview.activeVendors')}
                  {...count(vendors.data?.meta.totalItems)}
                  loading={vendors.isPending}
                  icon={FolderIcon}
                />
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            {canCatalogs && (
              <ShortcutCard
                to="/it/catalogs"
                title={t('it.nav.catalogs')}
                description={t('it.catalogs.subtitle')}
                icon={FolderIcon}
              />
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
};
