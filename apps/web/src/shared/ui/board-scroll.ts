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
// Used with `<PageContainer fullHeight>` and `<DataTable stickyHead>`. Since «عايز بردو كل الصفحات
// اللى فى مديول الإدارة ميبقاش الصفحات كلها بتعمل Scroll لكن الجداول بس» (2026-11-17), every page of
// the Administration menu too — and for its screens whose list is cards rather than a table (roles,
// the permission catalog, approval workflows, settings), `BOARD_LIST_FILL` is the same give for a
// list region.

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
 * A list region that is not a `DataTable` — cards, grouped rows — taking the height that is left
 * and scrolling on its own on a computer, as `BOARD_TABLE_FILL` does for a table. A phone or a
 * tablet scrolls the page as before.
 */
export const BOARD_LIST_FILL =
  'lg:min-h-[14rem] lg:flex-1 lg:overflow-y-auto lg:overscroll-contain';

/**
 * A `ListView` card inside `BOARD_TABLE_FILL`. `ListView` draws the toolbar, the table and the
 * pager as ONE card and takes no class of its own, so this reaches its `<section>` from outside:
 * the card becomes a column, its toolbar and its pager keep their height, and the table — the
 * card's one child holding a `<table>` — takes what is left and scrolls under its head. A phone or
 * a tablet scrolls the page as before.
 */
export const BOARD_LISTVIEW_FILL =
  'lg:flex lg:flex-col lg:[&>section]:flex lg:[&>section]:min-h-0 lg:[&>section]:flex-1 lg:[&>section]:flex-col lg:[&>section>div:has(>table)]:min-h-0 lg:[&>section>div:has(>table)]:flex-1';

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
