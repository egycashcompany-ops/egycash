// «خلاص افصلهم»: the custody menu row «العهدة» (`/fleet/custody`) is no page of its own any more — it
// opens SCREEN 1 «العهدة» on «سجل العهدة». The board that stood at that address is SCREEN 2
// «مصروفات العهدة» (`/fleet/custody-expenses`) now, so an old link or bookmark that carries any of the
// board's own parameters lands there, its query kept; one that opens a fund dialog (`?fund=`) lands
// on «سجل العهدة», where the fund's dialogs live now. Pure, so the node suite reads it directly.
import { isCustodyFundOp } from '../components/CustodyFundActions';

/** Every parameter the board ever wrote into its own address — its filters, sorts and pager. */
export const CUSTODY_BOARD_PARAMS = [
  'from',
  'to',
  'vehicleCodes',
  'source',
  'driver',
  'sort',
  'carSort',
  'size',
  'page',
] as const;

/** Where `/fleet/custody` + `search` goes now. */
export const custodyEntryTarget = (search: string): string => {
  const sp = new URLSearchParams(search);
  const fund = sp.get('fund');
  // The fund's dialogs live on SCREEN 1; the board's filters do not, so they are left behind.
  if (isCustodyFundOp(fund)) return `/fleet/custody/log?fund=${fund}`;
  // An old board link or bookmark: «مصروفات العهدة», with its whole query.
  if (CUSTODY_BOARD_PARAMS.some((key) => sp.has(key))) return `/fleet/custody-expenses${search}`;
  // «العهدة» opens on «سجل العهدة».
  return '/fleet/custody/log';
};
