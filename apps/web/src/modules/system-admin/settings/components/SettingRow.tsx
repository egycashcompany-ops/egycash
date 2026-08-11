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
import { useEffect, useId, useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { useSetSetting } from '../../../../platform/settings/settings-api';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Checkbox, Input } from '../../../../shared/ui/form';
import { ApiError } from '../../../../shared/lib/api-client';
import { toast } from '../../../../shared/ui/toast/toast-store';
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

export const SettingRow = ({ row, canEdit }: { row: SettingRowModel; canEdit: boolean }): JSX.Element => {
  const t = useT();
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const editability = rowEditability(row, canEdit);
  const disabled = editability !== 'editable';
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

  const label = (() => {
    const key = settingLabelKey(row.key);
    const translated = t(key);
    // A setting declared after this screen was written has no label yet. It keeps its place and
    // shows its key — hiding it would remove the only way to configure it.
    return translated === key ? row.key : translated;
  })();

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

  return (
    <div className="grid gap-3 border-t border-slate-200 py-4 first:border-t-0 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] dark:border-slate-800">
      <div className="min-w-0 space-y-1">
        <label htmlFor={fieldId} className="block text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </label>
        <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
          {row.key}
        </p>
        <p id={hintId} className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">
          {row.definition.description}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <Badge tone={RESOLVED_TONE[row.resolved?.resolvedFrom ?? 'default']}>
            {t(`systemAdmin.settings.resolvedFrom.${row.resolved?.resolvedFrom ?? 'default'}`)}
          </Badge>
          {row.definition.allowedScopes.map((scope) => (
            <Badge key={scope} tone="neutral">
              {t(`systemAdmin.settings.scope.${scope}`)}
            </Badge>
          ))}
        </div>
        {/* The one thing this screen cannot fix, so it says it instead: the value above is the
            caller's, the write below is the organization's, and here they differ. */}
        {row.shadowed && (
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {t('systemAdmin.settings.shadowed')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {row.editor === 'boolean' ? (
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
          <Input
            id={fieldId}
            dir="ltr"
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
        )}

        {row.editor !== 'boolean' && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
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
        {editability !== 'editable' && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t(`systemAdmin.settings.locked.${editability}`)}
          </p>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500" dir="ltr">
          {t('systemAdmin.settings.defaultValue', {
            value: serializeValue(row.definition.defaultValue, row.editor),
          })}
        </p>
      </div>
    </div>
  );
};
