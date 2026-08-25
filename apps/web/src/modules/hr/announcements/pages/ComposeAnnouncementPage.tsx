// Writing an announcement, and seeing who it will reach before it reaches them.
//
// THE PREVIEW IS THE POINT. A compose form on its own cannot show the one thing a sender needs to
// know: an audience is a description, and a description that quietly matches four thousand people
// — or nobody, because a criterion was mis-set — looks exactly like a correct one. So sending is
// gated behind resolving: the button stays disabled until the audience has been counted, and the
// count is produced by the same server code that will choose the recipients, never by a guess
// made here.
//
// The count is invalidated by every edit to the audience. A stale number is worse than none: it
// is the number a person will remember having seen.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type AnnouncementAudience,
  type AudienceOptionsDto,
  type EmployeeAudienceFilter,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Button, Card, CardBody, CardHeader } from '../../../../shared/ui';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { get } from '../../../../shared/lib/api-client';
import { cn } from '../../../../shared/lib/cn';
import { previewAudience, sendAnnouncement } from '../api/announcement-api';
import { AudienceBuilder, type AudienceMode } from '../components/AudienceBuilder';
import { type PickedEmployee } from '../components/EmployeePicker';

const orgOptions = (path: string): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>(`/platform/${path}/options`);

export const ComposeAnnouncementPage = (): JSX.Element => {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<AudienceMode>('filter');
  const [filter, setFilter] = useState<EmployeeAudienceFilter>({});
  const [employees, setEmployees] = useState<PickedEmployee[]>([]);

  const branches = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgOptions('branches') });
  const departments = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgOptions('departments') });
  const sections = useQuery({ queryKey: ['org', 'sections'], queryFn: () => orgOptions('sections') });
  const jobTitles = useQuery({ queryKey: ['org', 'job-titles'], queryFn: () => orgOptions('job-titles') });
  const personal = useQuery({
    queryKey: ['announcements', 'audience-options'],
    queryFn: () => get<AudienceOptionsDto>('/hr/announcements/audience-options'),
  });

  /** `null` while unresolved — which is also what disables sending. */
  const preview = useMutation({ mutationFn: previewAudience });
  const send = useMutation({ mutationFn: sendAnnouncement });

  const audience: AnnouncementAudience | null = useMemo(() => {
    if (mode === 'everyone') return { kind: 'everyone' };
    if (mode === 'filter') {
      // An empty filter is NOT everybody — the server refuses it, and so does this.
      return Object.keys(filter).length === 0 ? null : { kind: 'filter', filter };
    }
    // Nobody named is not everybody either.
    return employees.length === 0
      ? null
      : { kind: 'employees', employeeIds: employees.map((employee) => employee.id) };
  }, [mode, filter, employees]);

  // Any edit to the audience retires the count. A number that no longer describes what is on
  // screen is the one thing worse than no number.
  // `preview` is intentionally not a dependency: including the mutation object would re-run this
  // on every settle and wipe the very result it just produced.
  const resetPreview = preview.reset;
  useEffect(() => {
    resetPreview();
  }, [mode, filter, employees, resetPreview]);

  const written = title.trim() !== '' && body.trim() !== '';
  const resolved = preview.data ?? null;
  const canSend = written && audience !== null && resolved !== null && resolved.recipients > 0;

  const submit = (): void => {
    if (audience === null || !canSend) return;
    send.mutate(
      {
        title: title.trim(),
        body: body.trim(),
        audience,
        priority: 'normal',
      },
      {
        onSuccess: (dto) => {
          toast.success(t('hr.announcements.sent', { count: String(dto.recipients) }));
          setTitle('');
          setBody('');
          setFilter({});
          setEmployees([]);
          preview.reset();
        },
        onError: () => toast.error(t('hr.announcements.sendFailed')),
      },
    );
  };

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    dir: 'rtl' | 'ltr',
    rows?: number,
  ): JSX.Element => (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {rows === undefined ? (
        <input
          value={value}
          dir={dir}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      ) : (
        <textarea
          value={value}
          dir={dir}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
        />
      )}
    </label>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('hr.announcements.compose.title')}
        description={t('hr.announcements.compose.subtitle')}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('hr.announcements.message')} />
          <CardBody>
            <div className="space-y-4">
              {field(t('hr.announcements.title'), title, setTitle, 'rtl')}
              {field(t('hr.announcements.body'), body, setBody, 'rtl', 6)}
            </div>
            {/* One message, delivered as written. It used to ask for an English translation too —
                which doubled the form for a company that works in Arabic, and made a send fail
                over a sentence nobody was going to read. */}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('hr.announcements.asWritten')}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('hr.announcements.audience.title')} />
          <CardBody>
            <AudienceBuilder
              mode={mode}
              filter={filter}
              employees={employees}
              options={{
                branches: branches.data ?? [],
                departments: departments.data ?? [],
                sections: sections.data ?? [],
                jobTitles: jobTitles.data ?? [],
                religions: personal.data?.religions ?? [],
                nationalities: personal.data?.nationalities ?? [],
              }}
              onModeChange={setMode}
              onFilterChange={setFilter}
              onEmployeesChange={setEmployees}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('hr.announcements.preview.title')} />
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                loading={preview.isPending}
                disabled={audience === null}
                onClick={() => audience !== null && preview.mutate(audience)}
              >
                {t('hr.announcements.preview.run')}
              </Button>
              {audience === null && (
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {t('hr.announcements.preview.needsAudience')}
                </span>
              )}
            </div>

            {resolved !== null && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ['matched', resolved.matched],
                    ['recipients', resolved.recipients],
                    ['unreachable', resolved.unreachable],
                  ].map(([key, value]) => (
                    <div
                      key={key}
                      className={cn(
                        'rounded-lg border p-3',
                        key === 'unreachable' && Number(value) > 0
                          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
                          : 'border-slate-200 dark:border-slate-700',
                      )}
                    >
                      <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t(`hr.announcements.preview.${key}`)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* The gap between "matched" and "recipients" is the number a sender would never
                    otherwise see: employees with no login cannot be notified at all. */}
                {resolved.unreachable > 0 && (
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {t('hr.announcements.preview.unreachableHint')}
                  </p>
                )}
                {resolved.narrowedByScope && (
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {t('hr.announcements.preview.narrowed')}
                  </p>
                )}
                {resolved.recipients === 0 && (
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {t('hr.announcements.preview.nobody')}
                  </p>
                )}
                {resolved.sample.length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('hr.announcements.preview.sample')}{' '}
                    {resolved.sample.map((e) => `${e.name} (${e.code})`).join('، ')}
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button loading={send.isPending} disabled={!canSend} onClick={submit}>
            {t('hr.announcements.send')}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};

export default ComposeAnnouncementPage;
