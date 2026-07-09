import { useAppSelector } from '../../store';
import { translate } from './i18n';

export const useT = (): ((key: string) => string) => {
  const locale = useAppSelector((state) => state.locale.locale);
  return (key: string) => translate(locale, key);
};
