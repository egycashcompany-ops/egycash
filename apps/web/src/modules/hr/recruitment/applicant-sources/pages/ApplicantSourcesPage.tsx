// Applicant sources: the platforms candidates come from, and the link each one gets.
//
// This is the only screen that manages platforms and their links. The intake-form page next to it
// answers a different question — what candidates are asked — and every platform uses that one
// form. The link is the only thing that differs, and its token is what tells the system where an
// application came from.
//
// EVERY active source gets link tools, whatever its `kind` says. This screen used to show them for
// `publicForm` sources only, which meant a recruiter who wanted a link for Wuzzuf first had to go
// and change Wuzzuf's type — a piece of bookkeeping invented purely to satisfy a condition on this
// line. Nothing behind it ever agreed: `generateLink` asks only that the source be active, and the
// form lists every active source with or without a link. So the type went back to being what it
// reads as — a label — and the link is offered wherever it can actually be published.
import { useState } from 'react';
import { type ApplicantSourceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { useRecruitmentForm } from '../../recruitment-form/api/recruitment-form-queries';
import { useApplicantSources, useUpdateApplicantSource } from '../api/applicant-source-queries';
import { SourceDialog, type Editing } from '../components/SourceDialog';
import { SourceLink } from '../components/SourceLink';

export const ApplicantSourcesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const sources = useApplicantSources();
  // The links live on the intake form; this page joins them to their sources by id rather than
  // asking for a second copy of the same data.
  const form = useRecruitmentForm();
  const update = useUpdateApplicantSource();
  const [editing, setEditing] = useState<Editing | null>(null);

  if (sources.isLoading || form.isLoading) {
    return <PageContainer><LoadingState /></PageContainer>;
  }
  if (sources.isError || sources.data === undefined) {
    return (
      <PageContainer>
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      </PageContainer>
    );
  }

  const linkFor = (id: string) => (form.data?.links ?? []).find((l) => l.sourceId === id);

  const toggle = (source: ApplicantSourceDto): void => {
    update.mutate(
      { id: source.id, body: { active: !source.active, version: source.version } },
      { onSuccess: () => toast.success(t(source.active ? 'sources.disabled' : 'sources.enabled')) },
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('sources.title')}
        description={t('sources.subtitle')}
        breadcrumbs={[
          { label: t('recruitment.title'), to: '/' },
          { label: t('sources.title') },
        ]}
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

      <Card>
        <CardBody>
          {sources.data.length === 0 ? (
            <EmptyState title={t('sources.empty')} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {sources.data.map((s) => {
                const link = linkFor(s.id);
                return (
                  <li key={s.id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {localized(s.name, locale)}
                        </p>
                        <p className="truncate font-mono text-xs text-slate-400" dir="ltr">{s.key}</p>
                      </div>
                      <StatusBadge tone="neutral" label={t(`sources.kind.${s.kind}`)} />
                      <StatusBadge
                        tone={s.active ? 'success' : 'neutral'}
                        label={t(s.active ? 'sources.active' : 'sources.inactive')}
                      />
                      {link !== undefined && link.url !== null && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {t('recruitmentForm.submissions')}: {link.submissions}
                        </span>
                      )}
                      <div className="ms-auto flex items-center gap-2">
                        <Can permission="applicantSource.manage">
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing({ mode: 'edit', source: s })}
                            >
                              {t('common.edit')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={update.isPending}
                              onClick={() => toggle(s)}
                            >
                              {t(s.active ? 'sources.disable' : 'sources.enable')}
                            </Button>
                          </>
                        </Can>
                      </div>
                    </div>

                    {/* No `link` row means the source is disabled: the form lists the active ones,
                        and a link on a disabled platform would keep accepting applications. */}
                    {link === undefined ? (
                      <p className="text-xs text-slate-400">{t('sources.linkAfterActivation')}</p>
                    ) : (
                      <SourceLink link={link} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {editing !== null && <SourceDialog editing={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
};
