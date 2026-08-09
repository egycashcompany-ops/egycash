// Asset detail (design §2.2) — the asset's identity card. Read-only facts plus the two actions
// IT-1 owns: edit, and print this asset's label.
//
// The QR shown here is rendered CLIENT-side from the plain `assetCode`, exactly what the server
// encodes on the printed sheet (design D2: the payload is the code, never a URL, so a label
// survives redeployment and re-domaining). Scanning the screen and scanning the sticker resolve
// to the same asset.
//
// Custody (IT-2) lives here too: the four actions in the header, the current holder beside the
// identity, and the asset's business history below. Each action is offered only when the state
// machine could accept it — assign when in stock, return/transfer when out, dispose when free —
// and each is gated by its own §7 grant. The server still decides; offering a button that can
// only ever 409 is worse than not offering it.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EditIcon, QrIcon, ResetIcon, UsersIcon, TrashIcon, LinkIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import {
  useItAsset,
  useItAssetAssignments,
  useItAssetHistory,
  useItBranchOptions,
  useItCatalog,
  useItVendor,
} from '../api/it-queries';
import { AssetStatusBadge } from '../components/AssetStatusBadge';
import { AssetFormDialog } from '../components/AssetFormDialog';
import { AssetHistoryList } from '../components/AssetHistoryList';
import {
  AssignAssetDialog,
  DisposeAssetDialog,
  ReturnAssetDialog,
  TransferAssetDialog,
} from '../components/CustodyDialogs';
import { useAssetLabels } from '../components/useAssetLabels';

const QR_SIZE = 132;

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

export const AssetDetailPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { id = '' } = useParams();
  const { data: asset, isPending, isError, error, refetch } = useItAsset(id);
  const labels = useAssetLabels();
  const [editing, setEditing] = useState(false);
  const [custodyAction, setCustodyAction] = useState<
    'assign' | 'return' | 'transfer' | 'dispose' | null
  >(null);

  // Custody reads. Both are gated by `itAsset.view` server-side, which the page already required.
  const assignments = useItAssetAssignments(id, { pageSize: 20 }, id !== '');
  const history = useItAssetHistory(id, { pageSize: 50 }, id !== '');

  const categories = useItCatalog('assetCategory');
  const branches = useItBranchOptions();
  // The two optional vendor references, each resolved by id (ADR-019 rule 5). Two small keyed
  // reads rather than one scan of the catalog — and they resolve an ARCHIVED vendor too, which is
  // the common case on an older asset (FR-11 archives rather than deletes for exactly this).
  const canVendors = can('itVendor.view');
  const purchaseVendor = useItVendor(asset?.purchase?.vendorId ?? '', canVendors);
  const warrantyVendor = useItVendor(asset?.warranty?.vendorId ?? '', canVendors);

  if (isPending) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (isError || asset === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const categoryName =
    (categories.data?.items ?? []).find((c) => c.id === asset.categoryId)?.name ?? null;
  const branchName = (branches.data ?? []).find((b) => b.id === asset.branchId)?.name ?? null;

  // The open interval is the one the asset points at; falling back to "the one with no return"
  // keeps the panel honest if the denormalized pointer and the rows ever disagree.
  const rows = assignments.data?.items ?? [];
  const openAssignment =
    rows.find((a) => a.id === asset.currentAssignmentId) ??
    rows.find((a) => a.returnedAt === null) ??
    null;
  const holderLabel = openAssignment === null ? null : openAssignment.assignedToEmployeeId;

  return (
    <PageContainer>
      <PageHeader
        title={asset.name}
        description={asset.assetCode}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.assets'), to: '/it/assets' },
          { label: asset.assetCode },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<QrIcon className="h-4 w-4" />}
              loading={labels.isPrinting}
              onClick={() => void labels.print([asset.id])}
            >
              {t('it.assets.printLabel')}
            </Button>
            {can('itAsset.edit') && asset.status !== 'disposed' && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<EditIcon className="h-4 w-4" />}
                onClick={() => setEditing(true)}
              >
                {t('it.assets.edit')}
              </Button>
            )}
            {/* The state machine, expressed as which action is even offered (design §6). */}
            {can('itAsset.assign') && asset.status === 'inStock' && (
              <Button
                size="sm"
                leftIcon={<UsersIcon className="h-4 w-4" />}
                onClick={() => setCustodyAction('assign')}
              >
                {t('it.custody.assign')}
              </Button>
            )}
            {can('itAsset.assign') && asset.status === 'assigned' && (
              <>
                <Button
                  size="sm"
                  leftIcon={<ResetIcon className="h-4 w-4" />}
                  onClick={() => setCustodyAction('return')}
                >
                  {t('it.custody.return')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<LinkIcon className="h-4 w-4" />}
                  onClick={() => setCustodyAction('transfer')}
                >
                  {t('it.custody.transfer')}
                </Button>
              </>
            )}
            {can('itAsset.dispose') && asset.status === 'inStock' && (
              <Button
                size="sm"
                variant="ghost-danger"
                leftIcon={<TrashIcon className="h-4 w-4" />}
                onClick={() => setCustodyAction('dispose')}
              >
                {t('it.custody.dispose')}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('it.assets.sections.identity')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label={t('it.assets.columns.code')} value={asset.assetCode} mono />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('it.assets.columns.status')}
                </dt>
                <dd className="mt-0.5">
                  <AssetStatusBadge status={asset.status} />
                </dd>
              </div>
              <Fact label={t('it.assets.fields.name')} value={asset.name} />
              <Fact
                label={t('it.assets.fields.category')}
                value={categoryName === null ? null : localized(categoryName, locale)}
              />
              <Fact label={t('it.assets.fields.serialNumber')} value={asset.serialNumber} mono />
              <Fact label={t('it.assets.fields.externalTag')} value={asset.externalTag} mono />
              <Fact label={t('it.assets.fields.manufacturer')} value={asset.manufacturer} />
              <Fact label={t('it.assets.fields.model')} value={asset.model} />
              <Fact
                label={t('it.assets.fields.branch')}
                value={branchName === null ? null : localized(branchName, locale)}
              />
              <Fact label={t('it.assets.fields.location')} value={asset.location} />
              <div className="sm:col-span-2">
                <Fact label={t('it.assets.fields.description')} value={asset.description} />
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.assets.sections.qr')} />
          <CardBody>
            <div className="flex flex-col items-center gap-3">
              {/* White plate behind the QR: scanners need the quiet zone and the contrast in
                  dark mode too. */}
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG
                  value={asset.assetCode}
                  size={QR_SIZE}
                  level="M"
                  title={`${t('it.assets.qrTitle')} ${asset.assetCode}`}
                />
              </div>
              <p className="font-mono text-sm text-slate-700 dark:text-slate-200" dir="ltr">
                {asset.assetCode}
              </p>
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                {t('it.assets.qrHint')}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.assets.sections.purchase')} />
          <CardBody>
            <dl>
              <Fact
                label={t('it.assets.fields.purchaseDate')}
                value={
                  asset.purchase?.date == null ? null : formatDate(asset.purchase.date, locale)
                }
              />
              <Fact
                label={t('it.assets.fields.purchaseCost')}
                value={
                  asset.purchase?.cost == null ? null : formatNumber(asset.purchase.cost, locale)
                }
              />
              <Fact
                label={t('it.assets.fields.purchaseVendor')}
                value={purchaseVendor.data?.name ?? null}
              />
              <Fact
                label={t('it.assets.fields.invoiceRef')}
                value={asset.purchase?.invoiceRef ?? null}
                mono
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.assets.sections.warranty')} />
          <CardBody>
            <dl>
              <Fact
                label={t('it.assets.fields.warrantyStart')}
                value={asset.warranty === null ? null : formatDate(asset.warranty.start, locale)}
              />
              <Fact
                label={t('it.assets.fields.warrantyEnd')}
                value={asset.warranty === null ? null : formatDate(asset.warranty.end, locale)}
              />
              <Fact
                label={t('it.assets.fields.warrantyVendor')}
                value={warrantyVendor.data?.name ?? null}
              />
              <Fact
                label={t('it.assets.fields.warrantyTerms')}
                value={asset.warranty?.terms ?? null}
              />
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={t('it.custody.sections.current')}
            description={t('it.custody.currentHint')}
          />
          <CardBody>
            {asset.status === 'disposed' ? (
              <dl>
                <Fact
                  label={t('it.custody.disposalMethod')}
                  value={
                    asset.disposal === null
                      ? null
                      : t(`it.custody.method.${asset.disposal.method}`)
                  }
                />
                <Fact
                  label={t('it.custody.disposalReason')}
                  value={asset.disposal?.reason ?? null}
                />
                <Fact
                  label={t('it.custody.disposedAt')}
                  value={
                    asset.disposal === null ? null : formatDate(asset.disposal.at, locale)
                  }
                />
              </dl>
            ) : openAssignment === null ? (
              <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
                {t('it.custody.notAssigned')}
              </p>
            ) : (
              <dl className="grid gap-x-6 sm:grid-cols-2">
                <Fact
                  label={t('it.custody.holder')}
                  value={openAssignment.assignedToEmployeeId}
                  mono
                />
                <Fact
                  label={t('it.custody.assignedAt')}
                  value={formatDate(openAssignment.assignedAt, locale)}
                />
                <Fact
                  label={t('it.custody.expectedReturnAt')}
                  value={
                    openAssignment.expectedReturnAt === null
                      ? null
                      : formatDate(openAssignment.expectedReturnAt, locale)
                  }
                />
                <Fact
                  label={t('it.custody.conditionOnIssue')}
                  value={openAssignment.conditionOnIssue}
                />
              </dl>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title={t('it.custody.sections.history')}
            description={t('it.custody.historyHint')}
          />
          <CardBody>
            <AssetHistoryList
              entries={history.data?.items ?? []}
              isPending={history.isPending}
              isError={history.isError}
              error={history.error}
              onRetry={() => void history.refetch()}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('it.assets.sections.record')} />
          <CardBody>
            <dl>
              <Fact label={t('it.assets.fields.notes')} value={asset.notes} />
              <Fact
                label={t('it.assets.fields.createdAt')}
                value={formatDate(asset.createdAt, locale)}
              />
              <Fact
                label={t('it.assets.fields.updatedAt')}
                value={formatDate(asset.updatedAt, locale)}
              />
            </dl>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              <Link to="/it/assets" className="text-brand-600 hover:underline dark:text-brand-400">
                {t('it.assets.backToList')}
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>

      <AssetFormDialog open={editing} onClose={() => setEditing(false)} asset={asset} />
      <AssignAssetDialog
        open={custodyAction === 'assign'}
        onClose={() => setCustodyAction(null)}
        asset={asset}
      />
      <ReturnAssetDialog
        open={custodyAction === 'return'}
        onClose={() => setCustodyAction(null)}
        asset={asset}
        holderLabel={holderLabel}
      />
      <TransferAssetDialog
        open={custodyAction === 'transfer'}
        onClose={() => setCustodyAction(null)}
        asset={asset}
        current={openAssignment}
        holderLabel={holderLabel}
      />
      <DisposeAssetDialog
        open={custodyAction === 'dispose'}
        onClose={() => setCustodyAction(null)}
        asset={asset}
      />
    </PageContainer>
  );
};
