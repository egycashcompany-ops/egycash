// Create or edit a template. A dialog rather than a route, because this module routes no form —
// a form route is reachable by URL with nothing linking to it and needs a guard of its own.
//
// Two things this editor does differently from a plain CRUD form, both because of G-2:
//
//   • **The variable list is not a field.** It is derived from the placeholders the two bodies
//     share, and shown read-only. An editor with a text area and a separate variable list is an
//     editor whose two halves drift, and every drift is a 400 the administrator did not cause on
//     purpose.
//   • **A placeholder in one language and not the other is reported here**, in the language it is
//     missing from, rather than sent and refused with a message about `body.en`.
//
// An edit publishes a NEW VERSION; the dialog says so rather than letting "Save" imply the current
// row is being changed in place.

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  type NotificationChannel,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button, Dialog } from '../../../../shared/ui';
import { Checkbox, Field, Input, Select, Textarea } from '../../../../shared/ui/form';
import {
  derivedVariables,
  draftProblems,
  placeholdersIn,
  unbalancedPlaceholders,
  undeclaredSubjectPlaceholders,
  type TemplateDraft,
} from '../lib/template-form';

export interface TemplateFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  draft: TemplateDraft;
  saving: boolean;
  onChange: (next: TemplateDraft) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * The editable half of the dialog, exported on its own.
 *
 * `Dialog` portals to `document.body`, which does not exist in this workspace's test environment —
 * so the panel is a separate component that a render spec can mount directly. The same shape P9-A's
 * setup-link panel takes, for the same reason.
 */
export const TemplateFormPanel = ({
  mode,
  draft,
  onChange,
}: Pick<TemplateFormDialogProps, 'mode' | 'draft' | 'onChange'>): JSX.Element => {
  const t = useT();
  const variables = derivedVariables(draft);
  const unbalanced = unbalancedPlaceholders(draft);
  const orphanSubject = undeclaredSubjectPlaceholders(draft);
  const set = <K extends keyof TemplateDraft>(field: K, value: TemplateDraft[K]): void =>
    onChange({ ...draft, [field]: value });

  const toggleChannel = (channel: NotificationChannel): void =>
    set(
      'channels',
      draft.channels.includes(channel)
        ? draft.channels.filter((c) => c !== channel)
        : [...draft.channels, channel],
    );

  return (
    <div className="space-y-4">
      {mode === 'create' && (
        <Field label={t('systemAdmin.templates.fields.key')} htmlFor="template-key">
          {/* An identifier, never prose — left-to-right in both locales, like every key field. */}
          <Input
            id="template-key"
            dir="ltr"
            value={draft.key}
            onChange={(e) => set('key', e.target.value)}
            placeholder="module.eventName"
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('systemAdmin.templates.fields.category')} htmlFor="template-category">
          <Select
            id="template-category"
            value={draft.category}
            onChange={(e) => set('category', e.target.value as TemplateDraft['category'])}
          >
            {NOTIFICATION_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`systemAdmin.templates.category.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('systemAdmin.templates.fields.priority')} htmlFor="template-priority">
          <Select
            id="template-priority"
            value={draft.priority}
            onChange={(e) => set('priority', e.target.value as TemplateDraft['priority'])}
          >
            {NOTIFICATION_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {t(`systemAdmin.templates.priority.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('systemAdmin.templates.fields.defaultExpiryHours')}
          htmlFor="template-expiry"
          hint={t('systemAdmin.templates.expiryHint')}
        >
          <Input
            id="template-expiry"
            dir="ltr"
            inputMode="numeric"
            value={draft.defaultExpiryHours}
            onChange={(e) => set('defaultExpiryHours', e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('systemAdmin.templates.fields.channels')}
        </legend>
        <div className="flex flex-wrap gap-4">
          {NOTIFICATION_CHANNELS.map((channel) => (
            <Checkbox
              key={channel}
              checked={draft.channels.includes(channel)}
              onChange={() => toggleChannel(channel)}
              label={t(`systemAdmin.templates.channel.${channel}`)}
            />
          ))}
        </div>
      </fieldset>

      {/* Arabic and English side by side. The English fields carry `dir="ltr"` explicitly: the page
          around them is RTL, and a left-to-right message typed into an RTL field reads with its
          punctuation in the wrong place. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('systemAdmin.templates.fields.subjectAr')} htmlFor="template-subject-ar">
          <Input
            id="template-subject-ar"
            dir="rtl"
            value={draft.subjectAr}
            onChange={(e) => set('subjectAr', e.target.value)}
          />
        </Field>
        <Field label={t('systemAdmin.templates.fields.subjectEn')} htmlFor="template-subject-en">
          <Input
            id="template-subject-en"
            dir="ltr"
            value={draft.subjectEn}
            onChange={(e) => set('subjectEn', e.target.value)}
          />
        </Field>
        <Field label={t('systemAdmin.templates.fields.bodyAr')} htmlFor="template-body-ar">
          <Textarea
            id="template-body-ar"
            dir="rtl"
            rows={6}
            value={draft.bodyAr}
            onChange={(e) => set('bodyAr', e.target.value)}
          />
        </Field>
        <Field label={t('systemAdmin.templates.fields.bodyEn')} htmlFor="template-body-en">
          <Textarea
            id="template-body-en"
            dir="ltr"
            rows={6}
            value={draft.bodyEn}
            onChange={(e) => set('bodyEn', e.target.value)}
          />
        </Field>
      </div>

      {/* Derived, never typed — the placeholders the two bodies share ARE the declared variables. */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('systemAdmin.templates.detectedVariables')}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t('systemAdmin.templates.detectedVariablesHint')}
        </p>
        <p className="mt-2 flex flex-wrap gap-1" data-variables={variables.join(',')}>
          {variables.length === 0 ? (
            <span className="text-xs text-slate-400">{t('systemAdmin.templates.noVariables')}</span>
          ) : (
            variables.map((name) => (
              <code key={name} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800" dir="ltr">
                {`{{${name}}}`}
              </code>
            ))
          )}
        </p>
      </div>

      {/* Caught here rather than sent and refused: the server's message names `body.en`, which is
          accurate and unhelpful when the mistake was made while typing in Arabic. */}
      {unbalanced.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {unbalanced
            .map((problem) =>
              t('systemAdmin.templates.unbalanced', {
                name: problem.name,
                language: t(`systemAdmin.templates.language.${problem.missingFrom}`),
              }),
            )
            .join(' ')}
        </p>
      )}
      {orphanSubject.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {t('systemAdmin.templates.subjectUndeclared', { names: orphanSubject.join(', ') })}
        </p>
      )}
      {mode === 'edit' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('systemAdmin.templates.savePublishesVersion')}
        </p>
      )}
    </div>
  );
};

export const TemplateFormDialog = ({
  open,
  mode,
  draft,
  saving,
  onChange,
  onSubmit,
  onClose,
}: TemplateFormDialogProps): JSX.Element => {
  const t = useT();
  const blocked = draftProblems(draft, mode === 'create').length > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t(mode === 'create' ? 'systemAdmin.templates.create' : 'systemAdmin.templates.edit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={saving || blocked}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TemplateFormPanel mode={mode} draft={draft} onChange={onChange} />
    </Dialog>
  );
};

/** Re-exported for the preview panel, which lists the same detected variables. */
export { placeholdersIn };
