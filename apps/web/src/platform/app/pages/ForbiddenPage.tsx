// 403 — shown when a route's permission gate denies access (the server also enforces).
import { Link } from 'react-router-dom';
import { useT } from '../../localization/useT';
import { StatusMessage } from './StatusMessage';
import { AlertIcon } from '../../../shared/ui/icons';

export const ForbiddenPage = (): JSX.Element => {
  const t = useT();
  return (
    <StatusMessage
      icon={<AlertIcon className="h-12 w-12" />}
      title={t('common.forbidden.title')}
      description={t('common.forbidden.body')}
      action={
        <Link to="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('common.backHome')}
        </Link>
      }
    />
  );
};
