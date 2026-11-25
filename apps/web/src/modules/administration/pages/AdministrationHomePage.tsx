// Administrative Affairs home «الرئيسية» (design §13.3, §19.5): a tile per screen the reader's
// grants open, and the registers' counts. The route carries no guard (§13.3 note 1): this page
// decides what to show from the grants, and says so when there is nothing — every breadcrumb of the
// module links here, so a reader holding only the catalogs' key still lands on a page.
//
// No placeholder is ever drawn (the owner's rule): the shared `ModuleHome` always paints an
// activity card that is a placeholder, so the tiles are composed from `ShortcutCard` and `StatCard`
// directly. A count is a real figure — the register's own total, read with `pageSize: 1` as IT's
// help-desk counts are — asked only under the key its read takes; a failed count says so in its
// caption rather than showing 0.
//
// The tiles come from the exported `ADMINISTRATION_SHORTCUTS`, so the module's routes spec holds
// each to a served route, its guard and its sidebar row.
import { type ComponentType, type SVGProps } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { ShortcutCard } from '../../../shared/ui/ShortcutCard';
import { StatCard } from '../../../shared/ui/StatCard';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { BoxIcon, BuildingIcon, TagIcon, WarehouseIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { useAdministrationItems } from '../api/catalog-queries';
import { useAdministrationSuppliers } from '../api/suppliers-queries';
import { useAdministrationWarehouses } from '../api/warehouses-queries';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Shortcut {
  to: string;
  titleKey: string;
  descKey: string;
  icon: Icon;
  /** The key the screen's route guard and its sidebar row ask. */
  permission: string;
}

export const ADMINISTRATION_SHORTCUTS: Shortcut[] = [
  {
    to: '/administration/warehouses',
    titleKey: 'administration.nav.warehouses',
    descKey: 'administration.home.cards.warehouses',
    icon: WarehouseIcon,
    permission: 'administrationWarehouse.view',
  },
  {
    to: '/administration/items',
    titleKey: 'administration.nav.items',
    descKey: 'administration.home.cards.items',
    icon: BoxIcon,
    permission: 'administrationItem.view',
  },
  {
    to: '/administration/catalogs',
    titleKey: 'administration.nav.catalogs',
    descKey: 'administration.home.cards.catalogs',
    icon: TagIcon,
    permission: 'administrationCatalog.manage',
  },
  {
    to: '/administration/suppliers',
    titleKey: 'administration.nav.suppliers',
    descKey: 'administration.home.cards.suppliers',
    icon: BuildingIcon,
    permission: 'administrationSupplier.view',
  },
];

/** The live rows of a register: only `meta.totalItems` is wanted. */
const COUNT_PARAMS = { page: 1, pageSize: 1, isActive: true } as const;

/**
 * Where a count opens: its register under the view it counts. A bare URL would restore the
 * reader's remembered filters (a branch, a kind, «retired»), so the list could disagree with the
 * figure that opened it — the query string says what is counted, as IT's help-desk counts do.
 */
export const COUNT_LINKS = {
  warehouses: '/administration/warehouses?active=true',
  items: '/administration/items?active=true',
  suppliers: '/administration/suppliers?active=true',
} as const;

/** A count tile's figure, its loading, or the caption that says it could not be read. */
const useCountTile = (query: {
  isError: boolean;
  isPending: boolean;
  data?: { meta: { totalItems: number } } | undefined;
}): { value?: string; caption?: string; loading: boolean } => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (query.isError) return { caption: t('administration.home.countUnavailable'), loading: false };
  const total = query.data?.meta.totalItems;
  return {
    ...(total === undefined ? {} : { value: formatNumber(total, locale) }),
    loading: query.isPending,
  };
};

const Counts = ({
  warehouses,
  items,
  suppliers,
}: {
  warehouses: boolean;
  items: boolean;
  suppliers: boolean;
}): JSX.Element => {
  const t = useT();
  const warehouseCount = useCountTile(useAdministrationWarehouses(COUNT_PARAMS, warehouses));
  const itemCount = useCountTile(useAdministrationItems(COUNT_PARAMS, items));
  const supplierCount = useCountTile(useAdministrationSuppliers(COUNT_PARAMS, suppliers));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-administration-counts="">
      {warehouses && (
        <StatCard
          label={t('administration.home.activeWarehouses')}
          icon={WarehouseIcon}
          to={COUNT_LINKS.warehouses}
          {...warehouseCount}
        />
      )}
      {items && (
        <StatCard
          label={t('administration.home.activeItems')}
          icon={BoxIcon}
          to={COUNT_LINKS.items}
          {...itemCount}
        />
      )}
      {suppliers && (
        <StatCard
          label={t('administration.home.activeSuppliers')}
          icon={BuildingIcon}
          to={COUNT_LINKS.suppliers}
          {...supplierCount}
        />
      )}
    </div>
  );
};

export const AdministrationHomePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const shortcuts = ADMINISTRATION_SHORTCUTS.filter((card) => can(card.permission));
  const countWarehouses = can('administrationWarehouse.view');
  const countItems = can('administrationItem.view');
  const countSuppliers = can('administrationSupplier.view');

  return (
    <PageContainer>
      <PageHeader title={t('administration.home.title')} />
      {shortcuts.length === 0 ? (
        <EmptyState
          title={t('administration.home.noAccessTitle')}
          description={t('administration.home.noAccessBody')}
        />
      ) : (
        <div className="space-y-6">
          {(countWarehouses || countItems || countSuppliers) && (
            <Counts warehouses={countWarehouses} items={countItems} suppliers={countSuppliers} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {shortcuts.map((card) => (
              <ShortcutCard
                key={card.to}
                to={card.to}
                title={t(card.titleKey)}
                description={t(card.descKey)}
                icon={card.icon}
              />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
};
