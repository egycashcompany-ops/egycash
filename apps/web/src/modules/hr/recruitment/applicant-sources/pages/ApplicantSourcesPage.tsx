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
// The row is built to be READ down a column rather than parsed cell by cell: one identity cell
// (logo, name, key) instead of two, a coloured chip per type, a status dot, and the link as an
// address you can act on. Everything that changes state sits in the last cell, in one order,
// always.
import { type ComponentType, type SVGProps, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type ApplicantSourceDto,
  type ApplicantSourceKind,
  type Locale,
  type PageMeta,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { ListView } from '../../../../../shared/ui/ListView';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { StatStrip, type StatStripItem } from '../../../../../shared/ui/StatStrip';
import { RowActions } from '../../../../../shared/ui/RowActions';
import { Select } from '../../../../../shared/ui/form';
import { Button } from '../../../../../shared/ui/Button';
import { Badge, StatusBadge, type Tone } from '../../../../../shared/ui/Badge';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import {
  CheckIcon,
  EditIcon,
  GlobeIcon,
  GridIcon,
  LayersIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
} from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDate, formatNumber, localized } from '../../../../../shared/lib/format';
import { useRecruitmentForm } from '../../recruitment-form/api/recruitment-form-queries';
import { useApplicantTotal } from '../api/applicant-total-query';
import {
  useApplicantSources,
  useSourceCounts,
  useUpdateApplicantSource,
} from '../api/applicant-source-queries';
import { SourceDialog, type Editing } from '../components/SourceDialog';
import { SourceIcon } from '../components/SourceIcon';
import { SourceLinkActions, SourceLinkCell } from '../components/SourceLink';

const DEFAULT_PAGE_SIZE = 25;

/**
 * A type is a CLASS of platform, so it gets a colour and a glyph rather than a grey word: a
 * recruiter scanning the column sees three shapes, not three strings to read.
 *
 * Keyed by the contract's own union, so adding a kind to `APPLICANT_SOURCE_KINDS` fails to compile
 * here until this screen says how it looks — the alternative is a new kind silently rendering as
 * the default and nobody noticing.
 */
const KIND_STYLE: Record<
  ApplicantSourceKind,
  { tone: Tone; icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  publicForm: { tone: 'brand', icon: GlobeIcon },
  integration: { tone: 'info', icon: LayersIcon },
  manual: { tone: 'neutral', icon: UserIcon },
};

export const ApplicantSourcesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const [editing, setEditing] = useState<Editing | null>(null);

  const search = sp.get('q') ?? '';
  const kind = sp.get('kind') ?? '';
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'key:asc').split(':');
  const sort = { by: sortByRaw === 'createdAt' ? 'createdAt' : 'key', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
    by: 'key' | 'createdAt';
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

  const term = search.trim().toLowerCase();
  const publishedOnly = sp.get('published') === '1';
  // Two things the endpoint cannot express: a text search, and "has a published link" — the link
  // lives on the intake-form document, not on the source. Either one puts the screen in the
  // whole-catalog mode described below.
  const clientFiltering = term !== '' || publishedOnly;
  const activeFilter = status === '' ? undefined : status === 'active';

  // Filtering and paging are the SERVER's, through the query parameters the endpoint already
  // documents. The one exception is the text search, which the endpoint has no parameter for.
  //
  // TODO (temporary): while searching, the screen asks for the whole catalog and narrows it here.
  // That is correct only because the catalog is small. The moment it is not, `/hr/applicant-sources`
  // needs a `search` parameter and this branch collapses into the query above — and until then the
  // two modes must NOT be mixed, because the server would page first and the browser would filter
  // one page, hiding matches that live on another.
  const sources = useApplicantSources(
    clientFiltering
      ? { pageSize: 100, sortBy: sort.by, sortDir: sort.dir, kind, ...(activeFilter === undefined ? {} : { active: activeFilter }) }
      : { page, pageSize, sortBy: sort.by, sortDir: sort.dir, kind, ...(activeFilter === undefined ? {} : { active: activeFilter }) },
  );
  // The links live on the intake form; this page joins them to their sources by id rather than
  // asking for a second copy of the same data.
  const form = useRecruitmentForm();
  const applicantTotal = useApplicantTotal();
  const counts = useSourceCounts();
  const update = useUpdateApplicantSource();
  const canManage = useCan()('applicantSource.manage');

  const linkFor = (id: string) => (form.data?.links ?? []).find((l) => l.sourceId === id);
  const published = (form.data?.links ?? []).filter((l) => l.url !== null).length;

  const matched = useMemo(() => {
    const items = sources.data?.items ?? [];
    if (!clientFiltering) return items;
    const links = form.data?.links ?? [];
    return items.filter((s: ApplicantSourceDto) => {
      if (term !== '' && !`${s.name.ar} ${s.name.en} ${s.key}`.toLowerCase().includes(term)) {
        return false;
      }
      if (publishedOnly && links.find((l) => l.sourceId === s.id)?.url == null) return false;
      return true;
    });
  }, [sources.data, form.data, clientFiltering, term, publishedOnly]);

  // While searching the whole (filtered) catalog is in hand, so the page is cut here; otherwise the
  // server's own paging is what the footer reports.
  const meta: PageMeta = clientFiltering
    ? {
        page,
        pageSize,
        totalItems: matched.length,
        totalPages: Math.max(1, Math.ceil(matched.length / pageSize)),
      }
    : (sources.data?.meta ?? { page, pageSize, totalItems: 0, totalPages: 1 });
  const rows = clientFiltering ? matched.slice((page - 1) * pageSize, page * pageSize) : matched;
  const hasFilters = search !== '' || kind !== '' || status !== '' || publishedOnly;

  const toggleActive = (source: ApplicantSourceDto): void => {
    update.mutate(
      { id: source.id, body: { active: !source.active, version: source.version } },
      { onSuccess: () => toast.success(t(source.active ? 'sources.disabled' : 'sources.enabled')) },
    );
  };

  const columns: Column<ApplicantSourceDto>[] = [
    {
      // The row's subject, in one cell: mark, name, type and identifier. The type used to have a
      // column of its own, which spent a sixth of the table's width on one short word and split
      // the platform's identity across two cells. Beside the name — the way a repository's
      // visibility sits beside its name — it says the same thing and gives the width back.
      //
      // Sorted server-side by `key`, one of the two fields the endpoint accepts in `sortBy`.
      // TODO: ordering by the DISPLAYED name needs the API to sort on `name.ar` / `name.en` with a
      // collation; until it does, sorting here would only order the page in hand.
      key: 'key',
      header: t('sources.name'),
      sortable: true,
      className: 'min-w-[18rem]',
      render: (s) => {
        const { tone, icon: KindIcon } = KIND_STYLE[s.kind];
        return (
          <div className="flex items-center gap-3">
            {/* 48px: the screen lets each platform carry its own logo, and at 40 the mark was a
                decoration beside the name rather than the thing you recognise the row by. */}
            <SourceIcon source={s} locale={locale} size="lg" />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                {/* The heaviest thing in the row — it is what the row IS. */}
                <span className="truncate font-semibold text-slate-900 dark:text-slate-50">
                  {localized(s.name, locale)}
                </span>
                <Badge size="sm" tone={tone} className="shrink-0 whitespace-nowrap">
                  <KindIcon className="h-3 w-3 shrink-0" />
                  {t(`sources.kind.${s.kind}`)}
                </Badge>
              </div>
              <span
                className="block truncate font-mono text-[11px] leading-tight text-slate-400 dark:text-slate-500"
                dir="ltr"
              >
                {s.key}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      // Green dot / red dot. Disabled is not "neutral" — it is a platform that has been switched
      // off, and the column exists so that is visible without reading.
      key: 'status',
      header: t('sources.status'),
      render: (s) => (
        <StatusBadge
          tone={s.active ? 'success' : 'danger'}
          label={t(s.active ? 'sources.active' : 'sources.inactive')}
        />
      ),
    },
    {
      // Not sortable, and not a TODO: submissions live on the intake-form document, not on a
      // source, so no query against this catalog could order by them.
      key: 'submissions',
      header: t('recruitmentForm.submissions'),
      align: 'end',
      render: (s) => {
        // Zero is the resting state of most rows and should read as background — a dash, not a
        // figure to compare. Anything above it is what the column exists to surface.
        const count = linkFor(s.id)?.submissions ?? 0;
        return count === 0 ? (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        ) : (
          <Badge tone="brand" className="tabular-nums">
            {formatNumber(count, locale)}
          </Badge>
        );
      },
    },
    {
      // The link, when it was published, and everything you do with the row — all at the row's
      // end, in the widest column. "Last published" used to be a column of its own and was a dash
      // on every unpublished row: width spent on nothing. It is a fact about the LINK, so it now
      // sits under the address, on the rows that actually have one.
      //
      // What is visible is decided by what the row NEEDS. Editing and suspending are things you
      // come looking for, so they appear with the row rather than repeating down the page; a
      // platform with no link exists to get one, so that row keeps a labelled button that is
      // always there.
      key: 'link',
      header: t('sources.link'),
      render: (s) => {
        const at = linkFor(s.id)?.generatedAt ?? null;
        return (
          <div className="flex items-center justify-between gap-3">
            <SourceLinkCell
              link={linkFor(s.id)}
              sourceName={localized(s.name, locale)}
              {...(at === null ? {} : { publishedAt: formatDate(at, locale) })}
            />
            <span className="flex shrink-0 items-center gap-1">
              {canManage && (
                <RowActions>
                  <Button
                    size="icon"
                    variant="ghost"
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                    onClick={() => setEditing({ mode: 'edit', source: s })}
                  >
                    <EditIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={s.active ? 'ghost-warning' : 'ghost-brand'}
                    title={t(s.active ? 'sources.disable' : 'sources.enable')}
                    aria-label={t(s.active ? 'sources.disable' : 'sources.enable')}
                    onClick={() => toggleActive(s)}
                  >
                    {s.active ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                  </Button>
                </RowActions>
              )}
              <SourceLinkActions link={linkFor(s.id)} />
            </span>
          </div>
        );
      },
    },
  ];

  // Three of the four are also VIEWS of the list below, so they are pressable — a number a
  // recruiter reads and then wants to see the rows behind. The applicant total is not: those rows
  // live on another screen, so it stays a plain readout rather than a button that lies.
  const stats: StatStripItem[] = [
    {
      key: 'total',
      label: t('sources.stat.total'),
      icon: GridIcon,
      active: status === '' && kind === '' && !publishedOnly,
      loading: counts.isLoading,
      onClick: () => patch({ status: null, kind: null, published: null }),
      ...(counts.data === undefined ? {} : { value: formatNumber(counts.data.total, locale) }),
    },
    {
      key: 'active',
      label: t('sources.stat.active'),
      icon: CheckIcon,
      active: status === 'active',
      loading: counts.isLoading,
      onClick: () => patch({ status: 'active' }),
      ...(counts.data === undefined ? {} : { value: formatNumber(counts.data.active, locale) }),
    },
    {
      key: 'published',
      label: t('sources.stat.published'),
      icon: LinkIcon,
      active: publishedOnly,
      loading: form.isLoading,
      onClick: () => patch({ published: sp.get('published') === '1' ? null : '1' }),
      ...(form.data === undefined ? {} : { value: formatNumber(published, locale) }),
    },
    {
      key: 'applicants',
      label: t('sources.stat.applicants'),
      icon: UsersIcon,
      loading: applicantTotal.isLoading,
      // No number rather than a wrong one while the count is still in flight.
      ...(applicantTotal.data === undefined
        ? {}
        : { value: formatNumber(applicantTotal.data, locale) }),
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

      {/* The metrics summarise the list, so they live INSIDE it — one surface with a summary band,
          a toolbar, the rows and their paging, instead of a dashboard floating above a table. */}
      <ListView
        summary={<StatStrip items={stats} />}
        total={meta.totalItems}
        hasActiveFilters={hasFilters}
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
          meta.totalItems > 0 ? (
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
          empty={
            // An empty CATALOG and an empty RESULT are different problems: one wants a first
            // platform, the other wants a different search — down to the glyph.
            hasFilters ? (
              <EmptyState
                icon={<SearchIcon className="h-10 w-10" />}
                title={t('sources.empty.noResults')}
                description={t('sources.empty.noResultsBody')}
                action={
                  <Button size="sm" variant="secondary" onClick={() => setSp(new URLSearchParams())}>
                    {t('common.filters.clear')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<LinkIcon className="h-10 w-10" />}
                title={t('sources.empty.title')}
                description={t('sources.empty.body')}
                action={
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
            )
          }
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          embedded
          // The row is not clickable — every action on it is a button — but it is six columns
          // wide, and the highlight is what carries the eye from a platform's name to its link.
          hoverable
          dense
        />
      </ListView>

      {editing !== null && <SourceDialog editing={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
