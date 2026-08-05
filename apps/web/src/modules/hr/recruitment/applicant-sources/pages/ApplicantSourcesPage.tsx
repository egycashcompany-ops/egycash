// Applicant sources: the platforms candidates come from, and the link each one gets.
//
// This is the only screen that manages platforms and their links. The intake-form page next to it
// answers a different question — what candidates are asked — and every platform uses that one
// form. The link is the only thing that differs, and its token is what tells the system where an
// application came from.
//
// EVERY active source gets link tools, whatever its `kind` says. `kind` describes what a platform
// IS, not whether it can be published to: `generateLink` asks only that the source be active, and
// the form lists every active source with or without a link.
//
// Search, sort and paging run on the CLIENT. The catalog is one small list — a few dozen rows at
// most — and it already arrives whole, because this screen is the one place that must show
// disabled sources too. Filtering it in the browser is instant and, more to the point, needs no
// new query parameters on an endpoint whose contract is already in use elsewhere.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ApplicantSourceDto, type Locale, type PageMeta } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { ListView } from '../../../../../shared/ui/ListView';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { StatCard } from '../../../../../shared/ui/StatCard';
import { Select } from '../../../../../shared/ui/form';
import { Button } from '../../../../../shared/ui/Button';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { CheckIcon, GridIcon, LinkIcon, PlusIcon, UsersIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDate, formatNumber, localized } from '../../../../../shared/lib/format';
import { useRecruitmentForm } from '../../recruitment-form/api/recruitment-form-queries';
import { useApplicantTotal } from '../api/applicant-total-query';
import { useApplicantSources, useUpdateApplicantSource } from '../api/applicant-source-queries';
import { SourceDialog, type Editing } from '../components/SourceDialog';
import { SourceIcon } from '../components/SourceIcon';
import { SourceLinkActions, SourceLinkCell } from '../components/SourceLink';

const DEFAULT_PAGE_SIZE = 25;

/** Enable/disable for one source. Disabling is how a platform is retired — never a delete, because
 *  applicants registered last year still point at it. */
const StatusToggle = ({ source }: { source: ApplicantSourceDto }): JSX.Element => {
  const t = useT();
  const update = useUpdateApplicantSource();
  const toggle = (): void => {
    update.mutate(
      { id: source.id, body: { active: !source.active, version: source.version } },
      { onSuccess: () => toast.success(t(source.active ? 'sources.disabled' : 'sources.enabled')) },
    );
  };
  return (
    <Button size="sm" variant="ghost" loading={update.isPending} onClick={toggle}>
      {t(source.active ? 'sources.disable' : 'sources.enable')}
    </Button>
  );
};

export const ApplicantSourcesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const [editing, setEditing] = useState<Editing | null>(null);

  const sources = useApplicantSources();
  // The links live on the intake form; this page joins them to their sources by id rather than
  // asking for a second copy of the same data.
  const form = useRecruitmentForm();
  const applicantTotal = useApplicantTotal();

  const search = sp.get('q') ?? '';
  const kind = sp.get('kind') ?? '';
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'name:asc').split(':');
  const sort = { by: sortByRaw ?? 'name', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const all = sources.data ?? [];
  const linkFor = (id: string) => (form.data?.links ?? []).find((l) => l.sourceId === id);

  // ── The four numbers above the table ───────────────────────────────────────
  // Each is derived from data this page already holds, except the applicant total, which is the
  // `meta.totalItems` of an applicants query asking for a single row.
  const stats = useMemo(() => {
    const active = all.filter((s) => s.active).length;
    const published = (form.data?.links ?? []).filter((l) => l.url !== null).length;
    return { total: all.length, active, published };
  }, [all, form.data]);

  // ── Search, filter, sort, paginate — in that order, all client-side ────────
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = (s: ApplicantSourceDto): boolean => {
      if (term !== '' && !`${s.name.ar} ${s.name.en} ${s.key}`.toLowerCase().includes(term)) {
        return false;
      }
      if (kind !== '' && s.kind !== kind) return false;
      if (status === 'active' && !s.active) return false;
      if (status === 'inactive' && s.active) return false;
      return true;
    };
    const rows = all.filter(matches);
    const direction = sort.dir === 'asc' ? 1 : -1;
    const value = (s: ApplicantSourceDto): string | number => {
      if (sort.by === 'key') return s.key;
      if (sort.by === 'kind') return t(`sources.kind.${s.kind}`);
      if (sort.by === 'status') return s.active ? 1 : 0;
      if (sort.by === 'submissions') return linkFor(s.id)?.submissions ?? 0;
      if (sort.by === 'generatedAt') return linkFor(s.id)?.generatedAt ?? '';
      return localized(s.name, locale);
    };
    return [...rows].sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * direction;
      return String(x).localeCompare(String(y), locale === 'ar' ? 'ar' : 'en') * direction;
    });
  }, [all, form.data, search, kind, status, sort.by, sort.dir, locale]);

  const meta: PageMeta = {
    page,
    pageSize,
    totalItems: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const columns: Column<ApplicantSourceDto>[] = [
    {
      key: 'icon',
      header: '',
      className: 'w-12',
      render: (s) => <SourceIcon source={s} locale={locale} />,
    },
    {
      key: 'name',
      header: t('sources.name'),
      sortable: true,
      render: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800 dark:text-slate-100">
            {localized(s.name, locale)}
          </p>
          <p className="truncate font-mono text-xs text-slate-400" dir="ltr">
            {s.key}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: t('sources.kind'),
      sortable: true,
      render: (s) => <StatusBadge tone="neutral" label={t(`sources.kind.${s.kind}`)} />,
    },
    {
      key: 'status',
      header: t('sources.status'),
      sortable: true,
      render: (s) => (
        <StatusBadge
          tone={s.active ? 'success' : 'neutral'}
          label={t(s.active ? 'sources.active' : 'sources.inactive')}
        />
      ),
    },
    {
      key: 'link',
      header: t('sources.link'),
      render: (s) => <SourceLinkCell link={linkFor(s.id)} />,
    },
    {
      key: 'submissions',
      header: t('recruitmentForm.submissions'),
      sortable: true,
      align: 'end',
      render: (s) => formatNumber(linkFor(s.id)?.submissions ?? 0, locale),
    },
    {
      key: 'generatedAt',
      header: t('sources.publishedAt'),
      sortable: true,
      render: (s) => {
        const at = linkFor(s.id)?.generatedAt ?? null;
        return at === null ? <span className="text-slate-300">—</span> : formatDate(at, locale);
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (s) => (
        <div className="flex items-center justify-end gap-1">
          <Can permission="applicantSource.manage">
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ mode: 'edit', source: s })}>
                {t('common.edit')}
              </Button>
              <StatusToggle source={s} />
            </>
          </Can>
          <SourceLinkActions link={linkFor(s.id)} />
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('sources.title')}
        description={t('sources.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('sources.title') }]}
        actions={
          <Can permission="applicantSource.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setEditing({ mode: 'create' })}
            >
              {t('sources.add')}
            </Button>
          </Can>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('sources.stat.total')} icon={GridIcon} value={formatNumber(stats.total, locale)} />
        <StatCard label={t('sources.stat.active')} icon={CheckIcon} value={formatNumber(stats.active, locale)} />
        <StatCard label={t('sources.stat.published')} icon={LinkIcon} value={formatNumber(stats.published, locale)} />
        <StatCard
          label={t('sources.stat.applicants')}
          icon={UsersIcon}
          // No number rather than a wrong one while the count is still in flight.
          {...(applicantTotal.data === undefined
            ? {}
            : { value: formatNumber(applicantTotal.data, locale) })}
        />
      </div>

      <ListView
        total={filtered.length}
        hasActiveFilters={search !== '' || kind !== '' || status !== ''}
        onClear={() => setSp(new URLSearchParams())}
        search={
          <SearchInput
            className="w-full sm:w-64"
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('sources.searchPlaceholder')}
          />
        }
        filters={
          <>
            <Select className="w-44" value={kind} onChange={(e) => patch({ kind: e.target.value || null })}>
              <option value="">{t('sources.filter.allKinds')}</option>
              <option value="publicForm">{t('sources.kind.publicForm')}</option>
              <option value="integration">{t('sources.kind.integration')}</option>
              <option value="manual">{t('sources.kind.manual')}</option>
            </Select>
            <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
              <option value="">{t('sources.filter.allStatuses')}</option>
              <option value="active">{t('sources.active')}</option>
              <option value="inactive">{t('sources.inactive')}</option>
            </Select>
          </>
        }
        pagination={
          filtered.length > 0 ? (
            <Pagination
              meta={meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          loading={sources.isLoading || form.isLoading}
          error={sources.isError ? sources.error : undefined}
          onRetry={() => void sources.refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          embedded
        />
      </ListView>

      {editing !== null && <SourceDialog editing={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
