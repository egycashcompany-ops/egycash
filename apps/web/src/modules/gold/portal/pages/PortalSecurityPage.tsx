// الأمان — where a customer turns on sign-in with their phone's fingerprint or face (ADR-035,
// «الموظفين وعملاء بوابة الذهب»), and removes a device they no longer use. The card is the staff
// Security page's own; only the frame around it is the portal's.
import { PasskeysCard } from '../../../../platform/account/PasskeysCard';

export const PortalSecurityPage = (): JSX.Element => (
  <div className="mx-auto max-w-3xl">
    <PasskeysCard />
  </div>
);
