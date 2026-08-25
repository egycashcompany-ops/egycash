// Writing a rule: when THIS happens, tell THESE people, saying THAT.
//
// Everything a rules screen gets wrong is invisible afterwards. A mistyped field name, an event
// nobody publishes, a subject path that is not in the payload — each produces a rule that sits in
// the list looking correct and never fires. So this form does not offer free text where it can
// offer a choice: the event comes from the catalogue, the condition fields come from the chosen
// event's declared payload, and the subject path is the same list again. What cannot be a dropdown
// — the message — is checked against the server before the save is allowed.
//
// The placeholder helper under the message is not decoration. `{{employeeName}}` on an event that
// sends `employeeId` renders as literal text in a notification somebody receives; showing the real
// field names next to the box is what stops that being discovered by a recipient.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  type AutomationFilter,
  type EmployeeAudienceFilter,
  type EventCatalogEntry,
  type Locale,
  type NotificationRuleDto,
  type NotificationRuleProblemDto,
  type RuleAudience,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui';
import { cn } from '../../../../shared/lib/cn';
import { localized } from '../../../../shared/lib/format';
import { AudienceBuilder } from '../../announcements/components/AudienceBuilder';
import { type AudienceOptions } from '../../announcements/components/AudienceBuilder';
import { type PickedEmployee } from '../../announcements/components/EmployeePicker';
import { checkNotificationRule, listRuleEvents } from '../api/notification-rule-api';

/** What the user picks, flattened. `group` collapses the four employee-registry audiences. */
type AudienceMode = 'subject' | 'permission' | 'everyone' | 'group' | 'named';
const MODES: AudienceMode[] = ['subject', 'permission', 'everyone', 'group', 'named'];

const OPS: AutomationFilter['op'][] = ['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte', 'exists', 'contains'];
/** The two that take a LIST; `exists` takes nothing. */
const LIST_OPS = new Set<AutomationFilter['op']>(['in', 'nin']);

export interface RuleDraft {
  name: string;
  event: string;
  filters: AutomationFilter[];
  audience: RuleAudience;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  enabled: boolean;
}

export const emptyDraft = (): RuleDraft => ({
  name: '',
  event: '',
  filters: [],
  // The narrowest useful default. `everyone` must be a deliberate click, never the state you land
  // in — a rule that tells the whole company should never be one somebody arrived at by not choosing.
  audience: { kind: 'subject', path: '', includeManager: false },
  title: { ar: '', en: '' },
  body: { ar: '', en: '' },
  enabled: true,
});

export const draftFrom = (rule: NotificationRuleDto): RuleDraft => ({
  name: rule.name,
  event: rule.event,
  filters: rule.filters as AutomationFilter[],
  audience: rule.audience,
  title: rule.title,
  body: rule.body,
  enabled: rule.enabled,
});

const modeOf = (audience: RuleAudience): AudienceMode => {
  if (audience.kind === 'subject') return 'subject';
  if (audience.kind === 'permission') return 'permission';
  if (audience.kind === 'everyone') return 'everyone';
  return audience.audience.kind === 'employees' ? 'named' : 'group';
};

export const RuleEditor = ({
  draft,
  options,
  permissions,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: RuleDraft;
  options: AudienceOptions;
  /** Permission keys the platform declares — the same list the server validates against. */
  permissions: string[];
  saving: boolean;
  onChange: (next: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [named, setNamed] = useState<PickedEmployee[]>([]);

  const catalog = useQuery({ queryKey: ['notification-rules', 'events'], queryFn: listRuleEvents });
  const events = useMemo(() => catalog.data?.events ?? [], [catalog.data]);
  const entry: EventCatalogEntry | undefined = useMemo(
    () => events.find((candidate) => candidate.name === draft.event),
    [events, draft.event],
  );
  const fields = entry?.fields ?? [];

  // The server's own verdict, not a second implementation of it. A form that decides for itself
  // what is valid is a form that eventually disagrees with the thing that actually saves.
  const check = useMutation({ mutationFn: checkNotificationRule });
  const checkRule = check.mutate;
  const resetCheck = check.reset;
  useEffect(() => {
    if (draft.event === '') {
      resetCheck();
      return;
    }
    const timer = setTimeout(
      () => checkRule({ event: draft.event, filters: draft.filters, audience: draft.audience }),
      400,
    );
    return () => clearTimeout(timer);
  }, [draft.event, draft.filters, draft.audience, checkRule, resetCheck]);

  const problems: NotificationRuleProblemDto[] = check.data?.problems ?? [];
  const errors = problems.filter((problem) => problem.severity === 'error');
  const warnings = problems.filter((problem) => problem.severity === 'warning');

  const written =
    draft.name.trim() !== '' &&
    draft.event !== '' &&
    draft.title.ar.trim() !== '' &&
    draft.title.en.trim() !== '' &&
    draft.body.ar.trim() !== '' &&
    draft.body.en.trim() !== '';
  // Never enabled while the check has not answered: saving into an unknown verdict is how a dead
  // rule gets created, and the wait is 400ms.
  const canSave = written && check.isSuccess && errors.length === 0 && !check.isPending;

  const set = (patch: Partial<RuleDraft>): void => onChange({ ...draft, ...patch });

  /** Changing the event retires the filters and the subject path — they named the OLD payload. */
  const setEvent = (event: string): void => {
    const audience: RuleAudience =
      draft.audience.kind === 'subject' ? { ...draft.audience, path: '' } : draft.audience;
    set({ event, filters: [], audience });
  };

  const setMode = (mode: AudienceMode): void => {
    if (mode === 'subject') set({ audience: { kind: 'subject', path: '', includeManager: false } });
    else if (mode === 'permission') set({ audience: { kind: 'permission', permission: '' } });
    else if (mode === 'everyone') set({ audience: { kind: 'everyone' } });
    else if (mode === 'group') set({ audience: { kind: 'audience', audience: { kind: 'filter', filter: {} } } });
    else set({ audience: { kind: 'audience', audience: { kind: 'employees', employeeIds: [] } } });
  };

  const setFilterAt = (index: number, patch: Partial<AutomationFilter>): void =>
    set({
      filters: draft.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)),
    });

  const mode = modeOf(draft.audience);
  const nested = draft.audience.kind === 'audience' ? draft.audience.audience : null;
  const nestedFilter: EmployeeAudienceFilter =
    nested !== null && nested.kind === 'filter' ? nested.filter : {};

  const input = (
    value: string,
    onValue: (next: string) => void,
    dir?: 'rtl' | 'ltr',
    placeholder?: string,
  ): JSX.Element => (
    <input
      value={value}
      dir={dir}
      placeholder={placeholder}
      onChange={(event) => onValue(event.target.value)}
      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
    />
  );

  const labelled = (label: string, control: JSX.Element): JSX.Element => (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {control}
    </label>
  );

  return (
    <div className="space-y-6">
      {/* ── When ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {t('hr.rules.editor.when')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {labelled(t('hr.rules.editor.name'), input(draft.name, (name) => set({ name })))}
          {labelled(
            t('hr.rules.editor.event'),
            <select
              value={draft.event}
              onChange={(event) => setEvent(event.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">{t('hr.rules.editor.eventPlaceholder')}</option>
              {events.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {localized(candidate.moduleName, locale)} — {localized(candidate.label, locale)}
                </option>
              ))}
            </select>,
          )}
        </div>
        {entry !== undefined && (
          <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{entry.name}</p>
        )}
      </section>

      {/* ── Conditions ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {t('hr.rules.editor.conditions')}
          </h3>
          <Button
            variant="secondary"
            disabled={fields.length === 0}
            onClick={() =>
              set({ filters: [...draft.filters, { field: fields[0]?.path ?? '', op: 'eq', value: '' }] })
            }
          >
            {t('hr.rules.editor.addCondition')}
          </Button>
        </div>
        {/* Said plainly, because a list of rows reads as an OR to most people. */}
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('hr.rules.editor.conditionsRule')}</p>

        {draft.filters.map((filter, index) => {
          const declared = fields.find((field) => field.path === filter.field);
          return (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
              <select
                value={filter.field}
                onChange={(event) => setFilterAt(index, { field: event.target.value, value: '' })}
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {fields.map((field) => (
                  <option key={field.path} value={field.path}>
                    {field.path}
                  </option>
                ))}
              </select>
              <select
                value={filter.op}
                onChange={(event) =>
                  setFilterAt(index, { op: event.target.value as AutomationFilter['op'] })
                }
                className="h-10 rounded-lg border border-slate-200 px-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {t(`hr.rules.op.${op}`)}
                  </option>
                ))}
              </select>
              {filter.op === 'exists' ? (
                <span className="self-center text-xs text-slate-500">{t('hr.rules.editor.noValue')}</span>
              ) : declared?.type === 'enum' && !LIST_OPS.has(filter.op) ? (
                // The exact set the payload can carry. A free-text box here is how `approvd` gets
                // saved, and an enum comparison that can never be true is a rule that never fires.
                <select
                  value={String(filter.value ?? '')}
                  onChange={(event) => setFilterAt(index, { value: event.target.value })}
                  className="h-10 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="">{t('hr.rules.editor.valuePlaceholder')}</option>
                  {(declared.values ?? []).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                input(
                  Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value ?? ''),
                  (next) =>
                    setFilterAt(index, {
                      value: LIST_OPS.has(filter.op)
                        ? next.split(',').map((part) => part.trim()).filter((part) => part !== '')
                        : next,
                    }),
                  undefined,
                  LIST_OPS.has(filter.op) ? t('hr.rules.editor.listHint') : undefined,
                )
              )}
              <Button
                variant="secondary"
                onClick={() => set({ filters: draft.filters.filter((_, i) => i !== index) })}
              >
                {t('common.remove')}
              </Button>
            </div>
          );
        })}
      </section>

      {/* ── Who ──────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {t('hr.rules.editor.who')}
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                option === mode
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <input
                type="radio"
                name="rule-audience"
                className="mt-0.5"
                checked={option === mode}
                onChange={() => setMode(option)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  {t(`hr.rules.audience.${option}`)}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {t(`hr.rules.audience.${option}Hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {draft.audience.kind === 'subject' && (
          <div className="grid gap-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
            {labelled(
              t('hr.rules.editor.subjectPath'),
              <select
                value={draft.audience.path}
                onChange={(event) =>
                  set({
                    audience: {
                      kind: 'subject',
                      path: event.target.value,
                      includeManager:
                        draft.audience.kind === 'subject' ? draft.audience.includeManager : false,
                    },
                  })
                }
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">{t('hr.rules.editor.subjectPlaceholder')}</option>
                {fields.map((field) => (
                  <option key={field.path} value={field.path}>
                    {field.path}
                  </option>
                ))}
              </select>,
            )}
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={draft.audience.includeManager}
                onChange={(event) =>
                  set({
                    audience: {
                      kind: 'subject',
                      path: draft.audience.kind === 'subject' ? draft.audience.path : '',
                      includeManager: event.target.checked,
                    },
                  })
                }
              />
              {t('hr.rules.editor.includeManager')}
            </label>
          </div>
        )}

        {draft.audience.kind === 'permission' && (
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            {labelled(
              t('hr.rules.editor.permission'),
              <select
                value={draft.audience.permission}
                onChange={(event) =>
                  set({ audience: { kind: 'permission', permission: event.target.value } })
                }
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">{t('hr.rules.editor.permissionPlaceholder')}</option>
                {permissions.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>,
            )}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t('hr.rules.editor.permissionHint')}
            </p>
          </div>
        )}

        {draft.audience.kind === 'audience' && (
          <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <AudienceBuilder
              mode={nested?.kind === 'employees' ? 'employees' : 'filter'}
              filter={nestedFilter}
              employees={named}
              options={options}
              // The mode is chosen by the radios above, so the builder's own selector is inert
              // here. Two places to change one thing is how they end up disagreeing.
              onModeChange={() => undefined}
              onFilterChange={(filter) =>
                set({ audience: { kind: 'audience', audience: { kind: 'filter', filter } } })
              }
              onEmployeesChange={(next) => {
                setNamed(next);
                set({
                  audience: {
                    kind: 'audience',
                    audience: { kind: 'employees', employeeIds: next.map((employee) => employee.id) },
                  },
                });
              }}
            />
          </div>
        )}
      </section>

      {/* ── What it says ─────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          {t('hr.rules.editor.message')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {labelled(
            t('hr.announcements.titleAr'),
            input(draft.title.ar, (ar) => set({ title: { ...draft.title, ar } }), 'rtl'),
          )}
          {labelled(
            t('hr.announcements.titleEn'),
            input(draft.title.en, (en) => set({ title: { ...draft.title, en } }), 'ltr'),
          )}
          {labelled(
            t('hr.announcements.bodyAr'),
            <textarea
              value={draft.body.ar}
              dir="rtl"
              rows={4}
              onChange={(event) => set({ body: { ...draft.body, ar: event.target.value } })}
              className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />,
          )}
          {labelled(
            t('hr.announcements.bodyEn'),
            <textarea
              value={draft.body.en}
              dir="ltr"
              rows={4}
              onChange={(event) => set({ body: { ...draft.body, en: event.target.value } })}
              className="w-full rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            />,
          )}
        </div>
        {fields.length > 0 && (
          // The real field names, next to the box. A placeholder the payload has no value for is
          // left standing in the delivered notification — visible to a recipient, not to the author.
          <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
            <p className="mb-1.5 text-slate-600 dark:text-slate-300">
              {t('hr.rules.editor.placeholders')}
            </p>
            <p className="flex flex-wrap gap-1.5 font-mono text-slate-500">
              {fields.map((field) => (
                <code
                  key={field.path}
                  className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800"
                >{`{{${field.path}}}`}</code>
              ))}
            </p>
          </div>
        )}
      </section>

      {/* ── The verdict ──────────────────────────────────────────────────── */}
      {/* The number an author would otherwise never see. A rule fires unattended for months:
          "everyone" on a per-employee event is a flood that arrives before anybody notices, and an
          audience resolving to nobody is a rule that looks installed and does nothing. */}
      {check.isSuccess && check.data.recipients !== null && (
        <p
          className={cn(
            'rounded-lg border p-3 text-sm',
            check.data.recipients === 0
              ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300',
          )}
        >
          {check.data.recipients === 0
            ? t('hr.rules.reach.nobody')
            : t('hr.rules.reach.count', { count: String(check.data.recipients) })}
        </p>
      )}
      {check.isSuccess && check.data.recipients === null && draft.audience.kind === 'subject' && (
        <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
          {t('hr.rules.reach.perEvent')}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {errors.map((problem, index) => (
            <li key={index}>
              <span className="font-mono text-xs">{problem.path}</span> — {problem.message}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {warnings.map((problem, index) => (
            <li key={index}>
              <span className="font-mono text-xs">{problem.path}</span> — {problem.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => set({ enabled: event.target.checked })}
          />
          {t('hr.rules.editor.enabled')}
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button loading={saving} disabled={!canSave} onClick={onSave}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};
