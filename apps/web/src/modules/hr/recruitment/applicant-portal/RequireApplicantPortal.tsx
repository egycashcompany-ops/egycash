// The client-side half of "this surface is for candidates".
//
// The server is the authority: the confinement gate refuses an external account everywhere outside
// its declared prefix, and every portal read resolves the candidate from the session. This only
// shapes navigation, and it does the two things the server cannot — send an unauthenticated
// visitor to the CANDIDATE's login rather than the staff one, and keep employees off a surface
// built for somebody else.
//
// That second one matters for a reason worth stating: the super-admin holds every permission,
// `applicantPortal.view` included, so a grant check alone would let them onto a page whose every
// request then fails, because they have no external subject to resolve a candidate from.
import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { APPLICANT_PORTAL_SUBJECT } from './subject';

export const RequireApplicantPortal = ({ children }: { children: ReactNode }): ReactNode => {
  const t = useT();
  const status = useAppSelector((state) => state.auth.status);
  const me = useAppSelector((state) => state.auth.me);

  if (status === 'unknown') return null;
  if (status !== 'signedIn' || me === null) return <Navigate to="/applicant-portal/login" replace />;

  const external = me.external;
  if (
    external === null ||
    external.moduleId !== 'hr' ||
    external.subjectType !== APPLICANT_PORTAL_SUBJECT
  ) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <EmptyState
          title={t('hr.applicantPortal.notACandidate')}
          description={t('hr.applicantPortal.notACandidateHint')}
        />
      </div>
    );
  }
  return children;
};
