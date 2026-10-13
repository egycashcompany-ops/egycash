// «إجمالي العهدة» — the fund itself, beside what it paid for: «عاوز ازود اجمالى العهده فى الاحصايات و
// تكون فى الداس بورد».
//
// The fund is what «شحن العهدة» charges into it — the owner's word: «المفروض هيكون فى زرار تسوية
// العهدة و استعاضة العهدة و شحن العهدة كل واحد هيعمل اكشن معين … دلوقتى اجمالى العهدة 0». That action
// does not exist yet, so the fund is 0 until it does; when it lands, its sum is read here and
// nowhere else — the figures and the dashboard both carry this, under the custody screen's own
// grant, and no filter changes it.

/** The fund in EGP: the sum of «شحن العهدة» — 0 until that action exists. */
export const readCustodyFundTotal = async (): Promise<number> => 0;
