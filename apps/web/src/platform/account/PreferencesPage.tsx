// Self-service preferences (P9-B): the language, the colour scheme and the navigation shell.
//
// The same three values the shell bar toggles — this page is not a second source of truth, it is
// the same `usePreferences` with room to say what each option MEANS. A cycling icon button can show
// the current theme; it cannot explain that `system` follows the device, and it cannot be found by
// someone who does not already know the icon is there.
//
// No permission, and no entry in the page registry: the registry describes administration screens,
// and the subject here is always the caller. That is the same footing `/account/security` has stood
// on since it shipped.
import { THEME_MODES, type ThemeMode, type Locale, type NavLayout } from '@ecms/contracts';
import { useT } from '../localization/useT';
import { PageContainer, PageHeader } from '../layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../shared/ui';
import { cn } from '../../shared/lib/cn';
import { usePreferences } from '../preferences/usePreferences';

interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * A labelled row of mutually exclusive options.
 *
 * A radio group rather than a `<select>`: there are two or three options with a sentence of
 * explanation each, and a native select can show neither the explanation nor the current state
 * without being opened. `role` is left to the native inputs — a `<fieldset>` with a `<legend>` is
 * already the accessible grouping, in both writing directions.
 */
const ChoiceGroup = <T extends string>({
  legend,
  description,
  name,
  value,
  choices,
  disabled,
  onChange,
}: {
  legend: string;
  description: string;
  name: string;
  value: T;
  choices: Choice<T>[];
  disabled: boolean;
  onChange: (next: T) => void;
}): JSX.Element => (
  <fieldset className="space-y-3" disabled={disabled}>
    <legend className="text-sm font-medium text-slate-800 dark:text-slate-100">{legend}</legend>
    <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
    <div className="grid gap-2 sm:grid-cols-3">
      {choices.map((choice) => (
        <label
          key={choice.value}
          data-selected={choice.value === value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            choice.value === value
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30'
              : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
          )}
        >
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={choice.value === value}
            onChange={() => onChange(choice.value)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
              {choice.label}
            </span>
            {choice.hint !== undefined && (
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {choice.hint}
              </span>
            )}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);

export const PreferencesPage = (): JSX.Element => {
  const t = useT();
  const { locale, theme, navLayout, saving, save } = usePreferences();

  const locales: Choice<Locale>[] = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];
  const themes: Choice<ThemeMode>[] = THEME_MODES.map((mode) => ({
    value: mode,
    label: t(`account.preferences.theme.${mode}`),
    ...(mode === 'system' ? { hint: t('account.preferences.theme.systemHint') } : {}),
  }));
  const layouts: Choice<NavLayout>[] = [
    { value: 'launchpad', label: t('account.preferences.layout.launchpad') },
    { value: 'rail', label: t('account.preferences.layout.rail') },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('account.preferences.title')}
        description={t('account.preferences.subtitle')}
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title={t('account.preferences.language')} />
          <CardBody>
            <ChoiceGroup
              legend={t('account.preferences.language')}
              // The one preference with an effect outside this browser — worth saying plainly,
              // because it is the reason it is stored on the account rather than locally.
              description={t('account.preferences.languageHint')}
              name="preference-locale"
              value={locale}
              choices={locales}
              disabled={saving}
              onChange={(next) => save({ locale: next })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('account.preferences.appearance')} />
          <CardBody>
            <ChoiceGroup
              legend={t('account.preferences.theme.legend')}
              description={t('account.preferences.themeHint')}
              name="preference-theme"
              value={theme}
              choices={themes}
              disabled={saving}
              onChange={(next) => save({ theme: next })}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('account.preferences.navigation')} />
          <CardBody>
            <ChoiceGroup
              legend={t('account.preferences.layout.legend')}
              description={t('account.preferences.layoutHint')}
              name="preference-nav-layout"
              value={navLayout}
              choices={layouts}
              disabled={saving}
              onChange={(next) => save({ navLayout: next })}
            />
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
};

export default PreferencesPage;
