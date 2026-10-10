// «عاوز كل شاشات الحركه اللى فيها جدول الاسكرول يكون جوا الجدول زى شاشة السيارات والفلاتر
// والعواميد و تبويب الصفحات ثابتين».
//
// The vehicles board's layout, for every Fleet screen with a table: on a computer the page fills
// the screen's height, the toolbar, the figures and the filters keep their place above, the pager
// keeps its place below, and only the table's rows scroll — under a head that stays. A phone or a
// tablet scrolls the page as before.
//
// Used with `<PageContainer fullHeight>` and `<DataTable stickyHead>`.

/**
 * The page's column: everything stacked, the give handed to the table on a computer. It scrolls
 * only when a screen is too short to hold the table's floor under the filters — the pager is then
 * reached by scrolling rather than cut off.
 */
export const BOARD_FRAME = 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto';

/** The table's wrapper: it takes the height that is left, and its own rows scroll. */
export const BOARD_TABLE_FILL =
  'lg:flex lg:min-h-[14rem] lg:flex-1 lg:flex-col [&>div]:min-h-0 lg:[&>div]:flex-1';
