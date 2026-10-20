// The fund's three dialogs, where the address opens them: `?fund=settle|replenish|charge` (the
// toolbar's `CustodyFundActions` writes it, on «العهدة» and on «سجل العهدة»). One at a time, mounted
// only while open, so each opens fresh — every memo ticked again, today's date, no amount left from
// last time. Closing — «إلغاء», ×, Escape, or the operation recorded — takes `fund` out of the
// address and leaves every other parameter as it was.
//
// Writing money into or out of the fund needs what «إيصالات العهدة» needs to add a receipt
// (`fleetReceipt.create`); a reader without it opening such an address sees nothing.
import { useCan } from '../../../platform/rbac/Can';
import { useFundParam } from './CustodyFundActions';
import { CustodyChargeDialog } from './CustodyChargeDialog';
import { CustodyReplenishDialog } from './CustodyReplenishDialog';
import { CustodySettleDialog } from './CustodySettleDialog';

export const CustodyFundDialogs = (): JSX.Element | null => {
  const can = useCan();
  const [fund, setFund] = useFundParam();
  if (fund === null || !can('fleetReceipt.create')) return null;
  const close = (): void => setFund(null);
  switch (fund) {
    case 'settle':
      return <CustodySettleDialog open onClose={close} />;
    case 'replenish':
      return <CustodyReplenishDialog open onClose={close} />;
    case 'charge':
      return <CustodyChargeDialog open onClose={close} />;
  }
};
