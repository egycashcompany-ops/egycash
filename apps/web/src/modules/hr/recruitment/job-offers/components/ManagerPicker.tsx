// Reporting-manager picker on the offer terms form: the shared `UserPicker` with this form's
// wording. The behaviour — debounce, directory permission, RTL, the chosen-user chip — lives in the
// shared control so the offer form and the interview queue cannot drift apart.
import { useT } from '../../../../../platform/localization/useT';
import { UserPicker, type UserRef } from '../../shared/UserPicker';

export type ManagerRef = UserRef;

export const ManagerPicker = ({
  value,
  onChange,
}: {
  value: ManagerRef | null;
  onChange: (next: ManagerRef | null) => void;
}): JSX.Element => {
  const t = useT();
  return (
    <UserPicker
      value={value}
      onChange={onChange}
      searchPlaceholder={t('offers.form.managerSearch')}
      clearLabel={t('offers.form.change')}
      noAccessLabel={t('offers.form.needDirectory')}
      emptyLabel={t('offers.form.noUsers')}
    />
  );
};
