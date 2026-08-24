// The rules screen: what the system will say on its own, and whether it is actually saying it.
//
// The two columns most rule screens leave out are here on purpose — `firedCount` and `lastFiredAt`.
// A rule that has never fired looks exactly like one that fires correctly, and the difference only
// surfaces when somebody asks why a notification never came. "0 times" next to a rule somebody
// wrote last month is the answer, visible before anyone has to go looking for it.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Locale, type NotificationRuleDto, type OrgUnitOptionDto } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, Card, CardBody, Dialog, EmptyState, LoadingState } from '../../../../shared/ui';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { get } from '../../../../shared/lib/api-client';
import { localized } from '../../../../shared/lib/format';
import { formatDateTime } from '../../../../shared/lib/format';
import {
  createNotificationRule,
  deleteNotificationRule,
  getRuleAudienceOptions,
  listNotificationRules,
  listRuleEvents,
  listRulePermissions,
  updateNotificationRule,
} from '../api/notification-rule-api';
import { RuleEditor, draftFrom, emptyDraft, type RuleDraft } from '../components/RuleEditor';

const orgOptions = (path: string): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>(`/platform/${path}/options`);

/** What is being edited: nothing, a new rule, or an existing one at a known version. */
type Editing = { rule: NotificationRuleDto | null; draft: RuleDraft } | null;

export const NotificationRulesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);

  const rules = useQuery({
    queryKey: ['notification-rules', 'list'],
    queryFn: () => listNotificationRules({ page: 1, pageSize: 50 }),
  });
  const catalog = useQuery({ queryKey: ['notification-rules', 'events'], queryFn: listRuleEvents });
  const permissions = useQuery({
    queryKey: ['notification-rules', 'permissions'],
    queryFn: listRulePermissions,
  });
  const personal = useQuery({
    queryKey: ['notification-rules', 'audience-options'],
    queryFn: getRuleAudienceOptions,
  });

  const branches = useQuery({ queryKey: ['org', 'branches'], queryFn: () => orgOptions('branches') });
  const departments = useQuery({ queryKey: ['org', 'departments'], queryFn: () => orgOptions('departments') });
  const sections = useQuery({ queryKey: ['org', 'sections'], queryFn: () => orgOptions('sections') });
  const jobTitles = useQuery({ queryKey: ['org', 'job-titles'], queryFn: () => orgOptions('job-titles') });

  /** Event name → its human label, so the list is not a column of dotted strings. */
  const eventLabel = useMemo(() => {
    const byName = new Map((catalog.data?.events ?? []).map((entry) => [entry.name, entry]));
    return (name: string): string => {
      const entry = byName.get(name);
      return entry === undefined ? name : localized(entry.label, locale);
    };
  }, [catalog.data, locale]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['notification-rules', 'list'] });
  };

  const save = useMutation({
    mutationFn: async (input: { rule: NotificationRuleDto | null; draft: RuleDraft }) =>
      input.rule === null
        ? createNotificationRule(input.draft)
        : updateNotificationRule(input.rule.id, { ...input.draft, version: input.rule.version }),
    onSuccess: () => {
      toast.success(t('hr.rules.saved'));
      setEditing(null);
      refresh();
    },
    onError: () => toast.error(t('hr.rules.saveFailed')),
  });

  const remove = useMutation({
    mutationFn: deleteNotificationRule,
    onSuccess: () => {
      toast.success(t('hr.rules.deleted'));
      refresh();
    },
    onError: () => toast.error(t('hr.rules.deleteFailed')),
  });

  /**
   * Switching a rule off is one click, not a trip through the editor.
   *
   * It is the action somebody takes when a rule is misbehaving RIGHT NOW, and making them open a
   * form to reach it is the difference between stopping it and watching it fire again.
   */
  const toggle = useMutation({
    mutationFn: (rule: NotificationRuleDto) =>
      updateNotificationRule(rule.id, { enabled: !rule.enabled, version: rule.version }),
    onSuccess: refresh,
    onError: () => toast.error(t('hr.rules.saveFailed')),
  });

  const items = rules.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t('hr.rules.title')}
        description={t('hr.rules.subtitle')}
        actions={
          <Button onClick={() => setEditing({ rule: null, draft: emptyDraft() })}>
            {t('hr.rules.new')}
          </Button>
        }
      />

      {rules.isPending ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState title={t('hr.rules.empty.title')} description={t('hr.rules.empty.body')} />
      ) : (
        <div className="space-y-3">
          {items.map((rule) => (
            <Card key={rule.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        {rule.name}
                      </h3>
                      <Badge tone={rule.enabled ? 'success' : 'neutral'}>
                        {t(rule.enabled ? 'hr.rules.on' : 'hr.rules.off')}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {t('hr.rules.when')} {eventLabel(rule.event)}
                      {rule.filters.length > 0 && ` · ${t('hr.rules.withConditions', {
                        count: String(rule.filters.length),
                      })}`}
                    </p>
                    {/* The two numbers that separate a working rule from a decorative one. */}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {rule.firedCount === 0
                        ? t('hr.rules.neverFired')
                        : t('hr.rules.firedCount', { count: String(rule.firedCount) })}
                      {rule.lastFiredAt !== null && ` · ${formatDateTime(rule.lastFiredAt, locale)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" onClick={() => toggle.mutate(rule)}>
                      {t(rule.enabled ? 'hr.rules.disable' : 'hr.rules.enable')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditing({ rule, draft: draftFrom(rule) })}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button variant="secondary" onClick={() => remove.mutate(rule.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {editing !== null && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editing.rule === null ? t('hr.rules.new') : t('hr.rules.edit')}
          size="xl"
        >
          <RuleEditor
            draft={editing.draft}
            permissions={(permissions.data ?? []).map((permission) => permission.key)}
            options={{
              branches: branches.data ?? [],
              departments: departments.data ?? [],
              sections: sections.data ?? [],
              jobTitles: jobTitles.data ?? [],
              religions: personal.data?.religions ?? [],
              nationalities: personal.data?.nationalities ?? [],
            }}
            saving={save.isPending}
            onChange={(draft) => setEditing({ rule: editing.rule, draft })}
            onSave={() => save.mutate(editing)}
            onCancel={() => setEditing(null)}
          />
        </Dialog>
      )}
    </PageContainer>
  );
};

export default NotificationRulesPage;
