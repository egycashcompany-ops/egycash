// The column lists that start over each time they open (2026-11-03): «عايز كمان فى الفلتر الكبير
// اللى فوق الجدول لما أضغط على فلتر (المنطقة فقط) يعمله Reset وأقدر أختار من الأول في كل الصفحات
// بتاعت ATM». The area only: a click on its list clears the areas picked, the table shows every
// area again, and the reader picks afresh. Every other column keeps its picks while its list opens,
// so a second value can be added to them.
export const FRESH_ON_OPEN: readonly string[] = ['area'];
