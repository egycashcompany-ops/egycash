// One supplier's record (design §2.3.6, §13.6 B): who the company buys from — its identity and
// registration numbers, how to reach it and whom to ask, the categories it supplies, and its papers.
// Written after IT's `AssetDetailPage`, as the module's item record is. Opened from the register;
// its edit is the register's own form, opened here, never a route.
//
// A TAX NUMBER ANOTHER SUPPLIER HOLDS IS SAID HERE AS A WARNING, NEVER A BLOCK (OD-11 (i)): the
// record names up to five other holders, newest first, retired ones marked, each a link to its own
// record — a supplier's branches may be separate records, so nothing is refused. The phone shows
// whole on this page, the one a reader opens to call the supplier; the register masks it (§6.8).
//
// The category names arrive on the record, resolved by the server (retired ones included), so the
// page asks nothing more for them. A supplier that does not exist is the API's 404, shown as the
// shared error panel. No VAT status is shown: it has no values until OD-29 gives them.
//
// The record is mounted afresh for each `:id`: the warning's links lead from one supplier's page to
// another's on the same route, and a dialog left open across Back or Forward must never file a
// paper on, or save a form over, a supplier other than the one it was opened for.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type AdministrationSupplierDetailDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { EditIcon } from '../../../shared/ui/icons';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { localized } from '../../../shared/lib/format';
import { useAdministrationSupplier } from '../api/suppliers-queries';
import { SupplierDocuments } from '../components/SupplierDocuments';
import { SupplierFormDialog } from '../components/SupplierFormDialog';
import { supplierCategoryNames } from '../lib/supplier-view';

/**
 * One label/value row. `value` is already formatted — this only lays it out. An empty value is a
 * dash in the page's own direction; a code reads left to right as IT's `Fact` writes it, and a
 * phone, an e-mail or an English name is isolated left to right inside a cell that keeps the
 * page's side, as the contact people's rows write theirs.
 */
const Fact = ({
  label,
  value,
  mono = false,
  ltr = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  /** A phone, an e-mail, an English name: read left to right in either language. */
  ltr?: boolean;
}): JSX.Element => {
  const empty = value === null || value === '';
  return (
    <div className="py-2">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`mt-0.5 text-sm text-slate-800 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}
        {...(mono && !empty ? { dir: 'ltr' as const } : {})}
      >
        {empty ? '—' : ltr ? <span dir="ltr">{value}</span> : value}
      </dd>
    </div>
  );
};

/** The other holders of this supplier's tax number — the warning, never a block. */
const TaxNumberWarning = ({
  supplier,
}: {
  supplier: AdministrationSupplierDetailDto;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (supplier.taxNumberMatches.length === 0) return null;
  return (
    <div
      role="status"
      data-supplier-tax-warning=""
      className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="font-medium">{t('administration.suppliers.taxNumberShared.title')}</p>
      <p className="mt-0.5">{t('administration.suppliers.taxNumberShared.body')}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {supplier.taxNumberMatches.map((holder) => (
          <li key={holder.id}>
            <Link to={`/administration/suppliers/${holder.id}`} className="font-medium underline">
              <span className="font-mono" dir="ltr">
                {holder.code}
              </span>{' '}
              — {localized(holder.name, locale)}
            </Link>
            {!holder.isActive && ` (${t('administration.status.inactive')})`}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** One supplier's record, mounted for one id: its dialogs never outlive it. */
const SupplierRecord = ({ id }: { id: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: supplier, isPending, isError, error, refetch } = useAdministrationSupplier(id);
  // The supplier as it was when its form opened: a re-read underneath (a stale save re-reads the
  // record, a pending paper re-reads it with backoff) must not reset what is being typed, nor the
  // refusal the form is showing. After a stale save the form reads the supplier afresh itself.
  const [editing, setEditing] = useState<AdministrationSupplierDetailDto | null>(null);

  if (isPending) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }
  if (isError || supplier === undefined) {
    return (
      <PageContainer>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const categories = supplierCategoryNames(supplier, locale);

  return (
    <PageContainer>
      <PageHeader
        title={localized(supplier.name, locale)}
        breadcrumbs={[
          { label: t('administration.module.title'), to: '/administration' },
          { label: t('administration.nav.suppliers'), to: '/administration/suppliers' },
          { label: supplier.code },
        ]}
        actions={
          can('administrationSupplier.edit') ? (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<EditIcon className="h-4 w-4" />}
              onClick={() => setEditing(supplier)}
            >
              {t('administration.suppliers.edit')}
            </Button>
          ) : undefined
        }
      />

      <TaxNumberWarning supplier={supplier} />

      {/* One column of zero minimum below `lg`: a paper's truncated row never widens the cards past
          a phone's screen (an implicit track would grow to the row's unwrapped length). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('administration.suppliers.sections.identity')} />
          <CardBody>
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <Fact label={t('administration.suppliers.columns.code')} value={supplier.code} mono />
              <div className="py-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('administration.suppliers.columns.status')}
                </dt>
                <dd className="mt-0.5">
                  <StatusBadge
                    tone={supplier.isActive ? 'success' : 'neutral'}
                    label={t(
                      supplier.isActive
                        ? 'administration.status.active'
                        : 'administration.status.inactive',
                    )}
                  />
                </dd>
              </div>
              <Fact label={t('administration.suppliers.fields.nameAr')} value={supplier.name.ar} />
              <Fact
                label={t('administration.suppliers.fields.nameEn')}
                value={supplier.name.en}
                ltr
              />
              <Fact
                label={t('administration.suppliers.fields.taxNumber')}
                value={supplier.taxNumber}
                mono
              />
              <Fact
                label={t('administration.suppliers.fields.commercialRegistry')}
                value={supplier.commercialRegistry}
                mono
              />
              <div className="py-2 sm:col-span-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {t('administration.suppliers.fields.categories')}
                </dt>
                <dd className="mt-1 text-sm text-slate-800 dark:text-slate-100">
                  {categories.length === 0 ? (
                    '—'
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {categories.map((name, i) => (
                        <Badge key={`${name}-${String(i)}`} size="sm" tone="neutral">
                          {name}
                        </Badge>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <Fact
                  label={t('administration.suppliers.fields.paymentTerms')}
                  value={supplier.paymentTerms}
                />
              </div>
              <div className="sm:col-span-2">
                <Fact label={t('administration.suppliers.fields.notes')} value={supplier.notes} />
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('administration.suppliers.sections.reach')} />
          <CardBody>
            <dl>
              <Fact label={t('administration.suppliers.fields.phone')} value={supplier.phone} ltr />
              <Fact label={t('administration.suppliers.fields.email')} value={supplier.email} ltr />
              <Fact label={t('administration.suppliers.fields.address')} value={supplier.address} />
            </dl>
          </CardBody>
        </Card>

        <SupplierDocuments
          className="lg:col-span-2"
          supplier={supplier}
          onScanPending={() => void refetch()}
        />

        <Card>
          <CardHeader title={t('administration.suppliers.contacts.title')} />
          <CardBody>
            {supplier.contacts.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('administration.suppliers.contacts.none')}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {supplier.contacts.map((contact, i) => (
                  <li
                    key={`${contact.name}-${String(i)}`}
                    className="py-2"
                    data-supplier-contact=""
                  >
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {contact.name}
                    </p>
                    {contact.role !== null && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{contact.role}</p>
                    )}
                    {(contact.phone !== null || contact.email !== null) && (
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-600 dark:text-slate-300">
                        {contact.phone !== null && <span dir="ltr">{contact.phone}</span>}
                        {contact.email !== null && <span dir="ltr">{contact.email}</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <SupplierFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        supplier={editing}
      />
    </PageContainer>
  );
};

export const SupplierDetailPage = (): JSX.Element => {
  const { id = '' } = useParams<{ id: string }>();
  return <SupplierRecord key={id} id={id} />;
};
