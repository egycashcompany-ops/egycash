import { useAppSelector } from '../../store';
import { translate } from './i18n';

/** Translator bound to the current locale, with optional `{{name}}` interpolation. */
export const useT = (): ((key: string, params?: Record<string, string | number>) => string) => {
  const locale = useAppSelector((state) => state.locale.locale);
  return (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
};
