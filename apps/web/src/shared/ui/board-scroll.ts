// «عاوز كل شاشات الحركه اللى فيها جدول الاسكرول يكون جوا الجدول زى شاشة السيارات والفلاتر
// والعواميد و تبويب الصفحات ثابتين».
//
// The vehicles board's layout, for every Fleet screen with a table — and, since «عايزك فى كل
// الصفحات تثبت الفورم والفلتر وتخلي الجدول بس هو اللى يعمل Scroll» (2026-10-27), for every ATM
// screen with one too; `fleet/components/board-scroll.ts` re-exports this file. On a computer the page fills
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

/**
 * The IT boards' table wrapper — `BOARD_TABLE_FILL` with a lower floor (8rem, not 14rem).
 * «الزراير والفلتر يبقوا ثابتين» (IT, 2026-11-17): on a short screen (a laptop's 768 or 720 px)
 * under a tall filter bar, the rows shrink before the filters move — the 14rem floor would make
 * the whole board scroll instead, the title and the filters with it. 8rem is what the tallest IT
 * bar (custody's labelled column filters, three rows below 1536 px) leaves the rows on a 1024×768
 * or 1280×720 screen — measured in the browser, not guessed.
 */
export const BOARD_TABLE_FILL_LOW =
  'lg:flex lg:min-h-[8rem] lg:flex-1 lg:flex-col [&>div]:min-h-0 lg:[&>div]:flex-1';
