// «عاوز اخلى بتاع الصفحات دا فى كل الشاشات اللى بيبقى فيها يتغير ل كدا»: the Fleet screens' pager.
// «عرض 1 - 8 من أصل 48» on one side, the page numbers in the middle — the current one in the
// site's purple, the far ones folded into «…» — and «الصفوف بالصفحة» on the other side.
//
// The current page is the site's purple — the custody screen too («لا بنفسجى») — or emerald on the
// fuel cards and fuel charging boards, which ask for it (`tone`).
//
// Drawn by the shared numbered pager (`shared/ui/NumberedPager`) since another module's screen
// wears it too; Fleet keeps its own words (`fleet.pager.*`) and its mark (`data-fleet-pager`).
import { type ComponentProps } from 'react';
import { NumberedPager, type PagerWords } from '../../../shared/ui/NumberedPager';

export { pagerPages } from '../../../shared/ui/NumberedPager';

const FLEET_WORDS: PagerWords = {
  showingBefore: 'fleet.pager.showing.before',
  showingOf: 'fleet.pager.showing.of',
  perPage: 'fleet.pager.perPage',
  label: 'fleet.pager.label',
};

export const FleetPager = (
  props: Omit<ComponentProps<typeof NumberedPager>, 'words' | 'mark'>,
): JSX.Element => <NumberedPager {...props} words={FLEET_WORDS} mark="fleet-pager" />;
