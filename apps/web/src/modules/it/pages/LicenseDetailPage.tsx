// One licence, and the list behind its seat count (design §2.8, FR-10).
//
// `seatsUsed` is a number; this page is where it becomes actionable. An over-seats warning that
// cannot say WHICH machines are consuming the seats names a problem nobody can fix, which is why
// the seats panel is a route and not a tooltip.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EditIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useItLicense, useItLicenseInstallations } from '../api/it-queries';
import { LicenseStateBadge } from '../components/LicenseStateBadge';
import { ItSoftwareProductName } from '../components/ItSoftwareProductName';
import { ItAssetLink } from '../components/ItAssetLink';
import { LicenseDialog } from '../components/LicenseDialog';

const Fact = ({ label, value }: { label: string; value: string | null }): JSX.Element => (
  <div className="py-2">
    <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">
      {value === null || value === '' ? '—' : value}
    </dd>
  </div>
);

export const LicenseDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const [editing, setEditing] = useState(false);

  const { data: license, isLoading, isError, error, refetch } = useItLicense(id);
  // Only the LIVE installations consume seats — the removed ones are history, and counting them
  // would make the panel disagree with the number above it.
  const seats = useItLicenseInstallations(
    id,
    { active: true, pageSize: 50, sortBy: 'installedAt', sortDir: 'desc' },
    can('itSoftware.view'),
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError || license === undefined) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const overSeats = license.seats !== null && license.seatsUsed > license.seats;

  return (
    <PageContainer>
      <PageHeader
        title={t('it.licenses.detailTitle')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.licenses'), to: '/it/licenses' },
          { label: t('it.licenses.detailTitle') },
        ]}
        actions={
          can('itLicense.manage') ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<EditIcon className="h-4 w-4" />}
              onClick={() => setEditing(true)}
            >
              {t('common.edit')}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('it.licenses.sections.licence')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.licenses.columns.product')}
                </dt>
                <dd className="mt-0.5">
                  <ItSoftwareProductName id={license.productId} />
                </dd>
              </div>
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.licenses.columns.state')}
                </dt>
                <dd className="mt-0.5">
                  <LicenseStateBadge state={license.state} />
                </dd>
              </div>
              <Fact
                label={t('it.licenses.columns.expiresAt')}
                value={
                  license.expiresAt === null
                    ? t('it.licenses.state.perpetual')
                    : formatDate(license.expiresAt, locale)
                }
              />
              <Fact
                label={t('it.licenses.columns.seats')}
                value={`${formatNumber(license.seatsUsed, locale)} / ${
                  license.seats === null ? '∞' : formatNumber(license.seats, locale)
                }`}
              />
              <Fact label={t('it.licenses.fields.invoiceRef')} value={license.purchase?.invoiceRef ?? null} />
              <Fact
                label={t('it.licenses.fields.cost')}
                value={
                  license.purchase?.cost === undefined || license.purchase.cost === null
                    ? null
                    : formatNumber(license.purchase.cost, locale)
                }
              />
              <div className="sm:col-span-2">
                {/* Plain text under `itLicense.view` — §13-Q5's adopted decision, so the screen
                    does not pretend to a protection the permission already provides. */}
                <Fact label={t('it.licenses.fields.licenseKey')} value={license.licenseKey} />
              </div>
              <div className="sm:col-span-2">
                <Fact label={t('it.licenses.fields.notes')} value={license.notes} />
              </div>
            </dl>
            {overSeats && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                {t('it.licenses.overSeatsNote')}
              </p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title={t('it.licenses.sections.seats')}
            description={t('it.licenses.seatsPanelHint')}
          />
          <CardBody>
            {!can('itSoftware.view') ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('it.software.pickerNoAccess')}
              </p>
            ) : seats.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (seats.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('it.licenses.noSeatsUsed')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {(seats.data?.items ?? []).map((install) => (
                  <li key={install.id} className="flex items-center justify-between gap-3 py-2">
                    <ItAssetLink id={install.assetId} />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDate(install.installedAt, locale)}
                      {install.softwareVersion === null ? '' : ` — ${install.softwareVersion}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <LicenseDialog open={editing} onClose={() => setEditing(false)} license={license} />
    </PageContainer>
  );
};
