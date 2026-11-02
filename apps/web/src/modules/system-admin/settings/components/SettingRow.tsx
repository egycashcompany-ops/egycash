// One configurable value, and everything the administrator needs to know before changing it.
//
// The row carries its own mutation rather than sharing one with the card. `SetSettingSchema` takes
// a single key, so "save the card" would be seven independent requests reported as one outcome —
// the same argument that kept a bulk assignment-revoke endpoint out of ADR-026 §5. Here it is
// cheaper still: an isolated mutation means an isolated pending state and an isolated error, so a
// value the server refused shows its reason under ITS field and nowhere else.
//
// Nothing in this file validates. The parse turns text into the declared JSON type; every rule
// about that type — a minimum length, a regex, an allowed element — lives in the Zod schema on the
// server and arrives as the message of a 422. Displaying that message verbatim is deliberate: it is
// the only description of the rule that cannot drift from the rule itself.
//
// What the row SAYS is in the page's language: its label and its description come from the
// catalog (`systemAdmin.settings.keys.*` / `.descriptions.*`). The registry's own description is
// written for developers, in English; it is shown only for a setting the catalog has not caught up
// with, and then left-to-right. The key stays on the row, small, for whoever searches by it.
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { useSetSetting } from '../../../../platform/settings/settings-api';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Input } from '../../../../shared/ui/form';
import { ApiError } from '../../../../shared/lib/api-client';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { DESCRIPTION_TOKENS, settingDescriptionKey } from '../lib/settings-catalog';
import {
  parseValue,
  rowEditability,
  serializeValue,
  settingLabelKey,
  type SettingRowModel,
} from '../lib/settings-view';

/** `resolvedFrom` → how loudly to say it. The two this screen does not write are the loud ones. */
const RESOLVED_TONE = {
  user: 'warning',
  branch: 'warning',
  organization: 'brand',
  default: 'neutral',
} as const;

/** The label and description a row reads as, falling back to the key and the registry's text. */
export const useSettingText = (): ((row: SettingRowModel) => {
  label: string;
  description: string;
  describedInCatalog: boolean;
}) => {
  const t = useT();
  return useCallback(
    (row: SettingRowModel) => {
      const labelKey = settingLabelKey(row.key);
      const label = t(labelKey);
      const descriptionKey = settingDescriptionKey(row.key);
      const description = t(descriptionKey, DESCRIPTION_TOKENS);
      return {
        // A setting declared after this screen was written has no label yet. It keeps its place
        // and shows its key — hiding it would remove the only way to configure it.
        label: label === labelKey ? row.key : label,
        description: description === descriptionKey ? row.definition.description : description,
        describedInCatalog: description !== descriptionKey,
      };
    },
    [t],
  );
};

export const SettingRow = ({ row, canEdit }: { row: SettingRowModel; canEdit: boolean }): JSX.Element => {
  const t = useT();
  const textOf = useSettingText();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const editability = rowEditability(row, canEdit);
  const disabled = editability !== 'editable';
  // Retired and managed-elsewhere rows offer no field at all: there is nothing here to change.
  const hasField = !row.retired && row.managedAt === null;
  const stored = row.resolved?.value ?? row.definition.defaultValue;
  // Compared and tracked as TEXT, not as the value: a list resolves to a fresh array on every
  // refetch, so an identity comparison would reset the field under a typing administrator each
  // time any other row saved.
  const storedText = serializeValue(stored, row.editor);

  const [draft, setDraft] = useState(storedText);
  const [localError, setLocalError] = useState<string | null>(null);
  // A save elsewhere on the screen re-resolves every value; an untouched row follows it rather
  // than keep showing what it was first rendered with.
  useEffect(() => {
    setDraft(storedText);
    setLocalError(null);
  }, [storedText]);

  const save = useSetSetting();
  const serverError = save.error instanceof ApiError ? save.error.message : null;
  const { label, description, describedInCatalog } = textOf(row);

  const submit = (next: string): void => {
    const parsed = parseValue(next, row.editor, row.definition.defaultValue);
    if (!parsed.ok) {
      setLocalError(t(`systemAdmin.settings.parse.${parsed.reason}`));
      return;
    }
    setLocalError(null);
    save.mutate(
      { key: row.key, scope: 'organization', value: parsed.value },
      { onSuccess: () => toast.success(t('systemAdmin.settings.saved')) },
    );
  };

  const dirty = draft !== storedText;
  const message = localError ?? serverError;
  const resolvedFrom = row.resolved?.resolvedFrom ?? 'default';
  const entries = Array.isArray(stored) ? stored.length : 0;

  return (
    <div className="grid gap-x-8 gap-y-3 border-t border-slate-200 py-4 first:border-t-0 first:pt-1 last:pb-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] dark:border-slate-800">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {hasField ? (
            <label htmlFor={fieldId} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {label}
            </label>
          ) : (
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
          )}
          {row.retired ? (
            <Badge tone="neutral">{t('systemAdmin.settings.retiredBadge')}</Badge>
          ) : (
            <Badge tone={RESOLVED_TONE[resolvedFrom]}>
              {t(`systemAdmin.settings.resolvedFrom.${resolvedFrom}`)}
            </Badge>
          )}
        </div>
        <p
          id={hintId}
          className="text-sm leading-6 text-slate-600 dark:text-slate-400"
          dir={describedInCatalog ? undefined : 'ltr'}
        >
          {description}
        </p>
        {/* The one thing this screen cannot fix, so it says it instead: the value above is the
            caller's, the write below is the organization's, and here they differ. */}
        {row.shadowed && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t('systemAdmin.settings.shadowed')}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400 dark:text-slate-500">
          <span className="break-all font-mono" dir="ltr">
            {row.key}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {t('systemAdmin.settings.scopes', {
              scopes: row.definition.allowedScopes
                .map((scope) => t(`systemAdmin.settings.scope.${scope}`))
                .join(t('systemAdmin.settings.scopeSeparator')),
            })}
          </span>
        </p>
      </div>

      <div className="space-y-2">
        {row.retired ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t('systemAdmin.settings.retiredNote')}
          </p>
        ) : row.managedAt !== null ? (
          // A list of ids or of branch rows means nothing printed raw; its own screen edits it with
          // names. Say how much is set and go there.
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {entries > 0
                ? t('systemAdmin.settings.managed.count', { count: entries })
                : t('systemAdmin.settings.managed.empty')}
            </p>
            <Link
              to={row.managedAt.route}
              className="mt-1 inline-flex text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              {t('systemAdmin.settings.managed.open', { screen: t(row.managedAt.screen) })}
            </Link>
          </div>
        ) : row.editor === 'boolean' ? (
          <Checkbox
            id={fieldId}
            aria-describedby={hintId}
            label={t(draft === 'true' ? 'common.yes' : 'common.no')}
            checked={draft === 'true'}
            disabled={disabled || save.isPending}
            onChange={(event) => {
              const next = event.target.checked ? 'true' : 'false';
              setDraft(next);
              submit(next);
            }}
          />
        ) : (
          // The field and its Save on one line: a row is read, changed and saved in one place.
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id={fieldId}
                // Numbers and lists read left-to-right; free text follows its own script, or an
                // Arabic signature line would be cut off at its start.
                dir={row.editor === 'text' ? 'auto' : 'ltr'}
                value={draft}
                error={message !== null}
                aria-invalid={message !== null}
                aria-describedby={message === null ? hintId : `${hintId} ${errorId}`}
                readOnly={row.editor === 'readonly'}
                disabled={disabled || save.isPending}
                inputMode={row.editor === 'number' ? 'numeric' : undefined}
                placeholder={row.editor === 'list' ? t('systemAdmin.settings.listHint') : undefined}
                onChange={(event) => setDraft(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="mt-1"
              onClick={() => submit(draft)}
              disabled={disabled || !dirty}
              loading={save.isPending}
            >
              {t('common.save')}
            </Button>
            {dirty && !disabled && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() => {
                  setDraft(storedText);
                  setLocalError(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            )}
          </div>
        )}

        {message !== null && (
          <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400" dir="ltr">
            {message}
          </p>
        )}
        {hasField && editability !== 'editable' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t(`systemAdmin.settings.locked.${editability}`)}
          </p>
        )}
        {/* The default is worth a line only when the value is not it — the badge already says so
            when it is. */}
        {hasField && resolvedFrom !== 'default' && (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {t('systemAdmin.settings.defaultValueLabel')}{' '}
            <span dir="ltr">{serializeValue(row.definition.defaultValue, row.editor)}</span>
          </p>
        )}
      </div>
    </div>
  );
};
