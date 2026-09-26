// `/` — where a signed-in person lands. Not a page of its own: it finds the first page of the
// person's OWN menu and replaces itself with it, so Back never returns to an empty hop.
//
// It used to be HR's recruitment overview, for everybody — the recruitment routes were the app's
// catch-all — so somebody granted only the fleet or the operations screens signed in to an HR page
// with nothing on it. The rule lives in `landingRoute`; this only covers the three moments before
// the rule can answer: the menu is loading, the menu failed, or the menu is empty.
import { Navigate } from 'react-router-dom';
import { useT } from '../../localization/useT';
import { useMyApplications } from '../../navigation/me-applications-queries';
import { landingRoute } from '../../navigation/nav-model';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { InboxIcon } from '../../../shared/ui/icons';
import { StatusMessage } from './StatusMessage';

export const LandingPage = (): JSX.Element => {
  const t = useT();
  const applications = useMyApplications();

  if (applications.isPending) return <LoadingState />;
  if (applications.isError) {
    return <ErrorState error={applications.error} onRetry={() => void applications.refetch()} />;
  }

  const route = landingRoute(applications.data);
  if (route !== null) return <Navigate to={route} replace />;

  // Signed in, and holding nothing: a new account whose access has not been set up yet. Saying
  // so is the whole job — an empty module page would read as a broken system, and a 403 would
  // read as a mistake on their part. The shell around this still gives them the way out.
  return (
    <StatusMessage
      icon={<InboxIcon className="h-10 w-10" />}
      title={t('platform.landing.nothingGrantedTitle')}
      description={t('platform.landing.nothingGrantedBody')}
    />
  );
};
