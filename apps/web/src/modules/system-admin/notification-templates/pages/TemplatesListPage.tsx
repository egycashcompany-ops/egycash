// The notification-template catalog (P10).
//
// The service behind this has been complete since Sprint 3.3 — versioned templates, an audit row on
// every edit, preview and test-send — and its own design named "the administration console
// (template management UI)" as deliberately out of scope. This is that console. It adds no
// endpoint, no permission, no setting and no model.
//
// One thing the list says that the API does not: which templates the PLATFORM sends by name.
// `isProtected` is derived server-side from the code's own constants, and the rows that carry it
// cannot be switched off — because deactivating one does not hide it, it stops the notification.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  NOTIFICATION_CATEGORIES,
  TEMPLATE_STATUSES,
  type NotificationTemplateDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, FilterBar, Pagination, type Column } from '../../../../shared/ui';
import { Select } from '../../../../shared/ui/form';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../shared/lib/errors';
import { useAppSelector } from '../../../../store';
import { useCreateTemplate, useTemplates } from '../api/template-api';
import { TemplateFormDialog } from '../components/TemplateFormDialog';
import { emptyDraft, toCreateBody, type TemplateDraft } from '../lib/template-form';

const PAGE_SIZE = 20;

export const TemplatesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state) => state.locale.locale);

  // Creation is a DIALOG, not a route: this module routes no form, because a form route is
  // reachable by URL with nothing linking to it and would need a guard of its own.
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft());
  const create = useCreateTemplate();

  // Addressable, like every other list in this module: the filters live in the URL so a screen
  // full of them can be sent to somebody else.
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const category = sp.get('category') ?? '';
  const page = Number(sp.get('page') ?? '1');

  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete(name);
    else next.set(name, value);
    if (name !== 'page') next.delete('page'); // a new filter starts at the first page
    setSp(next, { replace: true });
  };

  const query = useTemplates({
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
    ...(status === '' ? {} : { status: status as (typeof TEMPLATE_STATUSES)[number] }),
    ...(category === '' ? {} : { category: category as (typeof NOTIFICATION_CATEGORIES)[number] }),
  });

  const columns: Column<NotificationTemplateDto>[] = [
    {
      key: 'key',
      header: t('systemAdmin.templates.fields.key'),
      // A template key is an identifier, not prose — left-to-right in both locales.
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.key}
        </span>
      ),
    },
    {
      key: 'category',
      header: t('systemAdmin.templates.fields.category'),
      render: (row) => t(`systemAdmin.templates.category.${row.category}`),
    },
    {
      key: 'priority',
      header: t('systemAdmin.templates.fields.priority'),
      render: (row) => t(`systemAdmin.templates.priority.${row.priority}`),
    },
    {
      key: 'channels',
      header: t('systemAdmin.templates.fields.channels'),
      render: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.channels.map((channel) => (
            <Badge key={channel} tone="neutral">
              {t(`systemAdmin.templates.channel.${channel}`)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      key: 'version',
      header: t('systemAdmin.templates.fields.version'),
      render: (row) => <span dir="ltr">{row.version}</span>,
    },
    {
      key: 'status',
      header: t('systemAdmin.templates.fields.status'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
            {t(`systemAdmin.templates.status.${row.status}`)}
          </Badge>
          {/* Said on the list, not only on the detail screen: it is the reason the row has no
              deactivate control, and a reader should not have to open it to find that out. */}
          {row.isProtected && (
            <Badge tone="info">{t('systemAdmin.templates.protected')}</Badge>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('systemAdmin.templates.title')}
        description={t('systemAdmin.templates.subtitle')}
        actions={
          can('notificationTemplate.create') ? (
            <Button
              onClick={() => {
                setDraft(emptyDraft());
                setCreating(true);
              }}
            >
              {t('systemAdmin.templates.create')}
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <Select
          aria-label={t('systemAdmin.templates.fields.status')}
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
        >
          <option value="">{t('systemAdmin.templates.filters.allStatuses')}</option>
          {TEMPLATE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`systemAdmin.templates.status.${value}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('systemAdmin.templates.fields.category')}
          value={category}
          onChange={(e) => setParam('category', e.target.value)}
        >
          <option value="">{t('systemAdmin.templates.filters.allCategories')}</option>
          {NOTIFICATION_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`systemAdmin.templates.category.${value}`)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(row) => navigate(row.id)}
        empty={<EmptyState title={t('systemAdmin.templates.empty')} />}
      />

      {query.data !== undefined && (
        <Pagination
          meta={query.data.meta}
          onPageChange={(next) => setParam('page', String(next))}
        />
      )}

      <TemplateFormDialog
        open={creating}
        mode="create"
        draft={draft}
        saving={create.isPending}
        onChange={setDraft}
        onClose={() => setCreating(false)}
        onSubmit={() =>
          create.mutate(toCreateBody(draft), {
            onSuccess: (template) => {
              setCreating(false);
              // A template nobody sends is a template nobody sees, so the screen says so once,
              // where the decision was just made.
              toast.success(t('systemAdmin.templates.createdHint'));
              navigate(template.id);
            },
            onError: (error) => toast.error(errorMessage(error, locale)),
          })
        }
      />
    </PageContainer>
  );
};

export default TemplatesListPage;
