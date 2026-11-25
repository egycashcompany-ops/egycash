// One item's record (design §2.3.4, §13.6 B): what the catalog knows of it — its identity, where it
// is filed, its unit and its stock levels. Written after IT's `AssetDetailPage`. Opened from the
// register; its edit is the register's own form, opened here, never a route.
//
// The references arrive named on the item itself (`categoryName`, `categoryParentName`,
// `unitName`, resolved by the server, retired ones included), so the page asks nothing more. An
// item outside the reader's reach, or one that does not exist, is the API's 404, shown as the
// shared error panel. No stock is shown: the item carries none (ADR-024); from P5 the record gains
// its stock card.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type AdministrationItemDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon } from '../../../shared/ui/icons';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useAdministrationItem } from '../api/catalog-queries';
import { ItemFormDialog, itemCategoryLabel } from '../components/ItemFormDialog';

/** One label/value row. `value` is already formatted — this only lays it out. */
const Fact = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): JSX.Element => (
  <div className="py-2">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd
      className={`mt-0.5 text-sm text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}
      {...(mono ? { dir: 'ltr' as const } : {})}
    >
      {value === null || value === '' ? '—' : value}
    </dd>
  </div>
);

export const ItemDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams<{ id: string }>();
  const { data: item, isPending, isError, error, refetch } = useAdministrationItem(id);
  // The item as it was when its form opened: a re-read underneath (a stale save re-reads the
  // record) must not reset what is being typed, nor the refusal the form is showing.
  const [editing, setEditing] = useState<AdministrationItemDto | null>(null);

  if (isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || item === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const level = (value: number | null): string | null =>
    value === null ? null : formatNumber(value, locale);

  return (
    <PageContainer>
      <PageHeader
        title={localized(item.name, locale)}
        breadcrumbs={[
          { label: t('administration.module.title'), to: '/administration' },
          { label: t('administration.nav.items'), to: '/administration/items' },
          { label: item.code },
        ]}
        actions={
          can('administrationItem.edit') ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<EditIcon className="h-4 w-4" />}
              onClick={() => setEditing(item)}
            >
              {t('administration.items.edit')}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('administration.items.sections.identity')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label={t('administration.items.columns.code')} value={item.code} mono />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('administration.items.columns.status')}
                </dt>
                <dd className="mt-0.5">
                  <StatusBadge
                    tone={item.isActive ? 'success' : 'neutral'}
                    label={t(
                      item.isActive
                        ? 'administration.status.active'
                        : 'administration.status.inactive',
                    )}
                  />
                </dd>
              </div>
              <Fact label={t('administration.items.fields.nameAr')} value={item.name.ar} />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('administration.items.fields.nameEn')}
                </dt>
                <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100" dir="ltr">
                  {item.name.en}
                </dd>
              </div>
              <Fact label={t('administration.items.fields.barcode')} value={item.barcode} mono />
              <Fact
                label={t('administration.items.fields.category')}
                value={itemCategoryLabel(item, locale) ?? null}
              />
              <Fact
                label={t('administration.items.fields.unit')}
                value={item.unitName === null ? null : localized(item.unitName, locale)}
              />
              <div className="sm:col-span-2">
                <Fact
                  label={t('administration.items.fields.description')}
                  value={item.description}
                />
              </div>
              <div className="sm:col-span-2">
                <Fact label={t('administration.items.fields.notes')} value={item.notes} />
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t('administration.items.sections.levels')}
            description={t('administration.items.levelsCaption')}
          />
          <CardBody>
            <dl>
              <Fact label={t('administration.items.fields.minQty')} value={level(item.minQty)} />
              <Fact
                label={t('administration.items.fields.reorderPointQty')}
                value={level(item.reorderPointQty)}
              />
              <Fact label={t('administration.items.fields.maxQty')} value={level(item.maxQty)} />
            </dl>
          </CardBody>
        </Card>
      </div>

      <ItemFormDialog open={editing !== null} onClose={() => setEditing(null)} item={editing} />
    </PageContainer>
  );
};
