// 404 — unknown route inside the authenticated shell.
import { Link } from 'react-router-dom';
import { useT } from '../../localization/useT';
import { StatusMessage } from './StatusMessage';

export const NotFoundPage = (): JSX.Element => {
  const t = useT();
  return (
    <StatusMessage
      code="404"
      title={t('common.notFound.title')}
      description={t('common.notFound.body')}
      action={
        <Link to="/" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          {t('common.backHome')}
        </Link>
      }
    />
  );
};
