// «لوحة تحكم العهدة» (`/fleet/custody/dashboard`) — the third tab of SCREEN 1 «العهدة»: the fund's
// head (the fund now, its three actions and dialogs, the tabs) over the fund's part of the
// dashboard. No filters: everything on it is the fund over its whole history.
import { PageContainer } from '../../../platform/layout/PageContainer';
import { CustodyFundDashboard } from '../components/CustodyFundDashboard';
import { CustodyFundHeader } from '../components/CustodyFundHeader';

export const CustodyFundDashboardPage = (): JSX.Element => (
  <PageContainer>
    <CustodyFundHeader />
    <CustodyFundDashboard />
  </PageContainer>
);
