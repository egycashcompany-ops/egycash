// The browser tab's title, for the screens that speak for EGYCASH rather than for the staff product.
//
// `index.html` names the tab «ECMS», the staff platform. The customer and applicant portals and the
// public pages show the EGYCASH logo, so their tab says EGYCASH too; leaving such a screen puts back
// whatever the tab said before.
import { useEffect } from 'react';

export const useDocumentTitle = (title: string): void => {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
};
