// The fund's dialogs, where the address opens them — mounted ONCE, in the head of «العهدة»
// (`CustodyFundHeader`), so they open on every tab:
//
//   `?fund=settle|replenish|charge`  the three operations (the head's `CustodyFundActions`, a card
//                                    of the dashboard, an old link);
//   `?confirm=<id>`                  «تأكيد التحويل» of a held replenishment (its line in «سجل
//                                    العهدة», or its drawer);
//   `?cancelHeld=<id>`               «إلغاء الاستعاضة المعلّقة» (its drawer).
//
// One at a time — the cancel before the confirm before `?fund` — mounted only while open, so each
// opens fresh: every memo ticked again, today's date, no amount left from last time. Closing —
// «إلغاء» / «رجوع», ×, Escape, or the operation recorded — takes its parameter out of the address
// and leaves every other one as it was.
//
// Writing money into or out of the fund needs what «إيصالات العهدة» needs to add a receipt
// (`fleetReceipt.create`) — so does leaving a hold; a reader without it opening such an address
// sees nothing.
import { useSearchParams } from 'react-router-dom';
import { useCan } from '../../../platform/rbac/Can';
import { useFundParam, useOverlayHistory } from './CustodyFundActions';
import { CustodyChargeDialog } from './CustodyChargeDialog';
import { CustodyReplenishDialog } from './CustodyReplenishDialog';
import { CustodySettleDialog } from './CustodySettleDialog';
import { CustodyConfirmTransferDialog } from './CustodyConfirmTransferDialog';
import { CustodyCancelHeldDialog } from './CustodyCancelHeldDialog';

/** A held replenishment's two ways out, as the address names them. */
export type CustodyHoldDialog = 'confirm' | 'cancelHeld';
const HOLD_DIALOGS: readonly CustodyHoldDialog[] = ['cancelHeld', 'confirm'];

/**
 * The held replenishment's dialog the address opens, and how to open or close one. Opening from a
 * line pushes one history entry (Back closes it); opening from the drawer takes the drawer's place
 * (`fromDrawer`), so closing the dialog leaves the log as it was before the drawer.
 */
export const useHoldParam = (): {
  open: { dialog: CustodyHoldDialog; id: string } | null;
  openHold: (dialog: CustodyHoldDialog, id: string, fromDrawer?: boolean) => void;
  closeHold: () => void;
} => {
  const [sp, setSp] = useSearchParams();
  const overlay = useOverlayHistory();
  const dialog = HOLD_DIALOGS.find((key) => (sp.get(key) ?? '') !== '') ?? null;
  return {
    open: dialog === null ? null : { dialog, id: sp.get(dialog) ?? '' },
    openHold: (next, id, fromDrawer = false) => {
      const params = new URLSearchParams(sp);
      if (fromDrawer) {
        params.delete('open');
        params.delete('letter');
      }
      for (const key of HOLD_DIALOGS) params.delete(key);
      params.set(next, id);
      setSp(params, overlay.openOptions(fromDrawer || dialog !== null));
    },
    closeHold: () =>
      overlay.close(() => {
        const params = new URLSearchParams(sp);
        for (const key of HOLD_DIALOGS) params.delete(key);
        setSp(params, { replace: true });
      }),
  };
};

export const CustodyFundDialogs = (): JSX.Element | null => {
  const can = useCan();
  const [fund, setFund] = useFundParam();
  const hold = useHoldParam();
  if (!can('fleetReceipt.create')) return null;
  if (hold.open !== null) {
    return hold.open.dialog === 'cancelHeld' ? (
      <CustodyCancelHeldDialog key={hold.open.id} id={hold.open.id} onClose={hold.closeHold} />
    ) : (
      <CustodyConfirmTransferDialog key={hold.open.id} id={hold.open.id} onClose={hold.closeHold} />
    );
  }
  if (fund === null) return null;
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
