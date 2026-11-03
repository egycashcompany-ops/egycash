// Around every ATM page: how the pages read, from /atm/settings (`atm.display`, «خلى حجم الكلام فى
// الصفحات وإذا كان Bold أو لأ + درجة لون خطوط الجداول»), and how their tables copy («لما أخد Copy من
// الجدول تطلعهولى بشكل جدول … لما أبعته واتساب»), both 2026-11-03.
//
// A layout route inside the module's shell: the side bar and the top bar keep the app's own look,
// the page under them reads as the setting says. The box is `display: contents` — it lays out
// nothing, so every page's frame (`PageContainer fullHeight`, the board scroll) is as it was, and
// the size and weight it carries still reach every text inside by inheritance. Until the setting
// is read — or when it cannot be — the pages draw as they always did.
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { ATM_DEFAULT_DISPLAY } from '@ecms/contracts';
import { tableCopyHandler } from '../../../shared/lib/table-copy';
import { useAtmDisplay } from '../api/settings-queries';
import { atmDisplayScopeProps } from '../lib/atm-display';

/** Is this element on an ATM page — inside the scope? */
const onAtmPage = (element: Element): boolean => element.closest('[data-atm-display]') !== null;

export const AtmDisplayScope = (): JSX.Element => {
  const display = useAtmDisplay();
  useEffect(() => {
    const onCopy = tableCopyHandler(onAtmPage);
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);
  return (
    <div className="contents" {...atmDisplayScopeProps(display.data ?? ATM_DEFAULT_DISPLAY)}>
      <Outlet />
    </div>
  );
};
