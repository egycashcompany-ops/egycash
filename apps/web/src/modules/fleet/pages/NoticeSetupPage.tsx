// «إعداد النماذج» — one form's set-up: what each box starts with on a new notice, and which boxes
// share one answer.
//
// «الاول ادوس عليه اختار النموذج واحط قيم افتراضيه … وانا بحط القيم الافتراضية اللى لما اجى املى
// النموذج هلاقيها فى قيم بتتكرر فى اكتر من مكان زى كود العربيه و تواريخ معينه ف انا عاوز احدد دى
// برضو». Every box of the form, in the form's own sections, with how it starts — the same words
// every time, today's date, what the system brings, or typed by hand — and the groups of boxes
// that are one answer. Beside it, the insurer's page with those defaults on it, drawn by the very
// renderer the print uses.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FLEET_NOTICE_TEMPLATES,
  type FleetNoticeDefaultMode,
  type FleetNoticeSettingsDto,
  type FleetNoticeTemplate,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { Button } from '../../../shared/ui/Button';
import { Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { useNoticeSettings, useSaveNoticeSettings } from '../api/fleet-queries';
import { NOTICE_TEMPLATES, noticeTemplate, type NoticeField } from '../lib/notice-templates';
import { startingValues } from '../lib/notice-setup';
import { NoticeSheet } from '../components/NoticeSheet';

type Rule = { mode: FleetNoticeDefaultMode; value: string };
type Group = { name: string; keys: string[] };

/** The groups' colours, in order — a box and its group read as one on the page. */
const GROUP_TONES = [
  'border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  'border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300',
];
const tone = (index: number): string => GROUP_TONES[index % GROUP_TONES.length] ?? '';

/** A box that holds a day — the ones «تاريخ اليوم» means something for. */
const holdsDay = (field: NoticeField): boolean =>
  field.kind === 'date' || /date|Date|Issue|Expiry|signedAt/u.test(field.key);

/** How a box starts when nobody has set it up: the system's answer if it has one, else by hand. */
const naturalMode = (field: NoticeField): FleetNoticeDefaultMode =>
  field.source === undefined ? 'empty' : 'system';

export const NoticeSetupPage = (): JSX.Element => {
  const t = useT();
  const { template: key = '' } = useParams();
  const template = noticeTemplate(key);
  if (template === undefined || !(FLEET_NOTICE_TEMPLATES as readonly string[]).includes(key)) {
    return (
      <div className="p-6">
        <EmptyState title={t('fleet.notices.notFound')} />
        <Link to="/fleet/notices" className="mt-4 inline-block text-sm text-brand-600">
          {t('fleet.notices.backToList')}
        </Link>
      </div>
    );
  }
  return <NoticeSetup key={template.key} templateKey={template.key} />;
};

const NoticeSetup = ({ templateKey }: { templateKey: FleetNoticeTemplate }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const template = noticeTemplate(templateKey)!;
  const settings = useNoticeSettings(templateKey);
  const save = useSaveNoticeSettings();
  const mayEdit = can('fleetNotice.edit');

  const [rules, setRules] = useState<Record<string, Rule>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadedVersion, setLoadedVersion] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (settings.data === undefined || loadedVersion === settings.data.version) return;
    setRules(settings.data.defaults);
    setGroups(settings.data.links.map((link) => ({ name: link.name, keys: [...link.keys] })));
    setLoadedVersion(settings.data.version);
  }, [settings.data, loadedVersion]);

  const fields = useMemo(() => template.sections.flatMap((section) => section.fields), [template]);
  const groupOf = (fieldKey: string): number => groups.findIndex((g) => g.keys.includes(fieldKey));
  const labelOf = (fieldKey: string): string => {
    const section = template.sections.find((s) => s.fields.some((f) => f.key === fieldKey));
    const field = fields.find((f) => f.key === fieldKey);
    return section === undefined || field === undefined
      ? fieldKey
      : `${section.title} › ${field.label}`;
  };

  const ruleOf = (field: NoticeField): Rule =>
    rules[field.key] ?? { mode: naturalMode(field), value: '' };
  const setRule = (field: NoticeField, next: Partial<Rule>): void =>
    setRules((prev) => ({ ...prev, [field.key]: { ...ruleOf(field), ...next } }));

  /** Put a box in a group (or none) — a box is in one group at most. */
  const assign = (fieldKey: string, index: number): void =>
    setGroups((prev) =>
      prev.map((group, i) => ({
        ...group,
        keys:
          i === index
            ? [...group.keys.filter((k) => k !== fieldKey), fieldKey]
            : group.keys.filter((k) => k !== fieldKey),
      })),
    );
  const addGroup = (): void =>
    setGroups((prev) => [
      ...prev,
      { name: t('fleet.notices.setup.groupN', { n: String(prev.length + 1) }), keys: [] },
    ]);

  // What gets saved: only the boxes set to something other than how they start anyway, and only
  // the groups that hold two boxes or more.
  const draft: FleetNoticeSettingsDto = useMemo(() => {
    const defaults = Object.fromEntries(
      fields.flatMap((field) => {
        const rule = rules[field.key];
        if (rule === undefined) return [];
        if (rule.mode === 'fixed' && rule.value.trim() === '') return [];
        if (rule.mode === naturalMode(field) && rule.mode !== 'fixed') return [];
        return [[field.key, rule] as const];
      }),
    );
    return {
      template: templateKey,
      defaults,
      links: groups
        .filter((group) => group.keys.length >= 2)
        .map((group) => ({ name: group.name.trim() || '—', keys: group.keys })),
      version: settings.data?.version ?? null,
      updatedAt: null,
    };
  }, [fields, rules, groups, templateKey, settings.data]);

  const preview = useMemo(() => startingValues(template, draft), [template, draft]);

  const onSave = async (): Promise<void> => {
    try {
      const saved = await save.mutateAsync({
        template: templateKey,
        body: {
          defaults: draft.defaults,
          links: draft.links,
          ...(settings.data?.version === null || settings.data === undefined
            ? {}
            : { version: settings.data.version }),
        },
      });
      setLoadedVersion(saved.version);
      toast.success(t('fleet.notices.setup.saved'));
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  const modeLabel = (mode: FleetNoticeDefaultMode): string =>
    t(`fleet.notices.setup.modes.${mode}`);

  return (
    <div className="flex h-full min-h-0 flex-col" data-notice-setup-page={templateKey}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link
          to="/fleet/notices"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {t('fleet.notices.backToList')}
        </Link>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          {t('fleet.notices.setup.title', { insurer: template.insurer })}
        </h1>
        <span className="flex-1" />
        {NOTICE_TEMPLATES.map((other) => (
          <button
            key={other.key}
            type="button"
            aria-pressed={other.key === templateKey}
            data-notice-setup-tab={other.key}
            onClick={() => navigate(`/fleet/notices/setup/${other.key}`)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-bold transition',
              other.key === templateKey
                ? 'border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-200'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {other.insurer}
          </button>
        ))}
        {mayEdit && (
          <Button
            onClick={() => void onSave()}
            loading={save.isPending}
            data-notice-setup-save="true"
          >
            {t('fleet.notices.setup.save')}
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <section className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:w-[52%]">
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            {t('fleet.notices.setup.modeHint')}
          </p>
          {template.sections.map((section) => (
            <div key={section.title} className="mb-4">
              <h2 className="mb-2 border-b border-brand-100 pb-1 text-sm font-bold text-brand-700 dark:border-brand-900 dark:text-brand-300">
                {section.title}
              </h2>
              <div className="space-y-2">
                {section.fields.map((field) => {
                  const rule = ruleOf(field);
                  const at = groupOf(field.key);
                  const modes = (['fixed', 'today', 'system', 'empty'] as const).filter(
                    (mode) =>
                      (mode !== 'today' || holdsDay(field)) &&
                      (mode !== 'system' || field.source !== undefined),
                  );
                  return (
                    <div
                      key={field.key}
                      data-notice-setup-field={field.key}
                      className="grid grid-cols-[9rem_minmax(0,1fr)_8.5rem_8.5rem] items-center gap-2"
                    >
                      <span
                        className="truncate text-sm text-slate-700 dark:text-slate-300"
                        title={field.label}
                      >
                        {field.label}
                      </span>
                      <Input
                        aria-label={field.label}
                        disabled={!mayEdit || rule.mode !== 'fixed'}
                        value={rule.mode === 'fixed' ? rule.value : ''}
                        placeholder={
                          rule.mode === 'fixed'
                            ? ''
                            : t(`fleet.notices.setup.placeholder.${rule.mode}`)
                        }
                        onChange={(event) => setRule(field, { value: event.target.value })}
                        type={rule.mode === 'fixed' && field.kind === 'date' ? 'date' : 'text'}
                      />
                      <Select
                        aria-label={t('fleet.notices.setup.mode')}
                        disabled={!mayEdit}
                        value={rule.mode}
                        onChange={(event) =>
                          setRule(field, { mode: event.target.value as FleetNoticeDefaultMode })
                        }
                      >
                        {modes.map((mode) => (
                          <option key={mode} value={mode}>
                            {modeLabel(mode)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label={t('fleet.notices.setup.link')}
                        disabled={!mayEdit || groups.length === 0}
                        value={String(at)}
                        className={cn(at !== -1 && tone(at))}
                        onChange={(event) => assign(field.key, Number(event.target.value))}
                      >
                        <option value="-1">{t('fleet.notices.setup.noLink')}</option>
                        {groups.map((group, index) => (
                          <option key={index} value={String(index)}>
                            {group.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-brand-700 dark:text-brand-300">
                {t('fleet.notices.setup.links')}
              </h2>
              {mayEdit && (
                <button
                  type="button"
                  data-notice-setup-add-group="true"
                  onClick={addGroup}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-400 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  {t('fleet.notices.setup.newGroup')}
                </button>
              )}
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              {t('fleet.notices.setup.linksHint')}
            </p>
            <div className="space-y-2">
              {groups.map((group, index) => (
                <div
                  key={index}
                  data-notice-setup-group={index}
                  className={cn('rounded-lg border p-2.5', tone(index))}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Input
                      aria-label={t('fleet.notices.setup.groupName')}
                      disabled={!mayEdit}
                      value={group.name}
                      onChange={(event) =>
                        setGroups((prev) =>
                          prev.map((g, i) =>
                            i === index ? { ...g, name: event.target.value } : g,
                          ),
                        )
                      }
                    />
                    {mayEdit && (
                      <button
                        type="button"
                        aria-label={t('fleet.notices.setup.removeGroup')}
                        title={t('fleet.notices.setup.removeGroup')}
                        onClick={() => setGroups((prev) => prev.filter((_, i) => i !== index))}
                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.keys.map((fieldKey) => (
                      <span
                        key={fieldKey}
                        className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold dark:bg-slate-900/60"
                      >
                        {labelOf(fieldKey)}
                        {mayEdit && (
                          <button
                            type="button"
                            aria-label={t('common.remove')}
                            onClick={() => assign(fieldKey, -1)}
                            className="text-slate-500 hover:text-red-600"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {mayEdit && (
                      <select
                        aria-label={t('fleet.notices.setup.addBox')}
                        value=""
                        onChange={(event) => {
                          if (event.target.value !== '') assign(event.target.value, index);
                        }}
                        className="rounded-full border border-dashed border-slate-400 bg-transparent px-2 py-0.5 text-[11px] dark:border-slate-600"
                      >
                        <option value="">{t('fleet.notices.setup.addBox')}</option>
                        {fields
                          .filter((field) => !group.keys.includes(field.key))
                          .map((field) => (
                            <option key={field.key} value={field.key}>
                              {labelOf(field.key)}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                  {group.keys.length < 2 && (
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {t('fleet.notices.setup.groupTooSmall')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-slate-200 p-4 dark:bg-slate-800">
            <p className="mb-3 text-center text-sm text-slate-600 dark:text-slate-300">
              {t('fleet.notices.setup.preview')}
            </p>
            <NoticeSheet template={template} answers={{ values: preview, checks: {} }} />
          </div>
        </section>
      </div>
    </div>
  );
};
