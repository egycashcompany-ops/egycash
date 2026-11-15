// «الإعدادات» route subtree (lazy-loaded): `/hr-settings/<tab>`, one route per hub tab.
//
// The tabs and their permissions come from `HR_SETTINGS_HUB` in the contracts — the list the API
// also reads to decide who sees the sidebar row — so a tab cannot be added on one side only. Each
// route is guarded by the SAME key its screen always had; the bare address opens the first section
// the reader holds.
import { type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { HR_SETTINGS_HUB, hubPermissions } from '@ecms/contracts';
import { RequirePermission } from '../../../platform/router/RequirePermission';
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';
import { AppShell } from '../../../platform/layout/AppShell';
import { RecruitmentFormPage } from '../recruitment/recruitment-form/pages/RecruitmentFormPage';
import { InsuranceJobTitlesPage } from '../contracts/pages/InsuranceJobTitlesPage';
import { ApplicantSourcesPage } from '../recruitment/applicant-sources/pages/ApplicantSourcesPage';
import { InterviewStagesPage } from '../recruitment/interviews/pages/InterviewStagesPage';
import { EvaluationPhasesPage } from '../recruitment/evaluations/pages/EvaluationPhasesPage';
import { ComposeAnnouncementPage } from '../announcements/pages/ComposeAnnouncementPage';
import { NotificationRulesPage } from '../notification-rules/pages/NotificationRulesPage';
import { HrSettingsLayout, useSettingsTabs } from './HrSettingsLayout';

type TabKey = (typeof HR_SETTINGS_HUB.tabs)[number]['key'];

/** The screen behind each tab. Keyed by the hub's own type, so a tab without a screen is an error. */
export const SETTINGS_SCREENS: Record<TabKey, ComponentType> = {
  'recruitment-form': RecruitmentFormPage,
  'insurance-job-titles': InsuranceJobTitlesPage,
  'applicant-sources': ApplicantSourcesPage,
  'interview-stages': InterviewStagesPage,
  'evaluation-phases': EvaluationPhasesPage,
  announcements: ComposeAnnouncementPage,
  'notification-rules': NotificationRulesPage,
};

/** The bare address: the first section this reader holds (the guard above refuses one with none). */
const FirstSection = (): JSX.Element => {
  const first = useSettingsTabs()[0];
  return first === undefined ? <NotFoundPage /> : <Navigate to={first.to} replace />;
};

export default function HrSettingsRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route
          element={
            <RequirePermission anyOf={hubPermissions(HR_SETTINGS_HUB.route)}>
              <HrSettingsLayout />
            </RequirePermission>
          }
        >
          <Route index element={<FirstSection />} />
          {HR_SETTINGS_HUB.tabs.map((tab) => {
            const Screen = SETTINGS_SCREENS[tab.key];
            return (
              <Route
                key={tab.key}
                path={tab.key}
                element={
                  <RequirePermission permission={tab.permission}>
                    <Screen />
                  </RequirePermission>
                }
              />
            );
          })}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
