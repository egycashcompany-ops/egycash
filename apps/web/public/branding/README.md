# Branding assets

Files here are served as-is at `/<file>`; nothing imports them, so replacing one is a deploy, not a
code change.

## `gold-portal-login.png` — the picture on the customer portal's sign-in panel

Drop a file with exactly that name in this folder and the portal login uses it on the next build.
Remove it and the built-in illustration comes back — that fallback is drawn in
`apps/web/src/modules/gold/portal/PortalLoginArt.tsx`, so a missing file is never a broken image.

- **Shape:** roughly square to 4:3. It is rendered `object-contain` inside a panel about 26rem tall,
  so nothing is cropped, but a very wide image will sit small.
- **Background:** make it transparent, or black. The panel behind it is `#0b0b0d` in both light and
  dark themes, deliberately — it is a picture surface, not a reading surface.
- **Weight:** it loads before sign-in, on a phone, possibly on mobile data. Keep it under ~200 KB.

To use a different picture per deployment without putting a file in the repository, set
`VITE_PORTAL_LOGIN_IMAGE` to any URL or absolute path. It wins over the file.

## The EGYCASH logo

The logo is drawn in code, not loaded from this folder: the company artwork, traced to vector paths,
lives in `apps/web/src/shared/ui/brand-mark-paths.ts` (the mark) and
`apps/web/src/shared/ui/egycash-wordmark-paths.ts` (the lettering). Two components
render it, and every screen uses one of them:

- `BrandMark` — the mark alone, beside the product name (the shell topbar, the sign-in screens).
- `EgycashLogo` — the mark with the lettering, where the company's name belongs (the customer and
  applicant portals, the public application and contract-verification pages). The artwork's
  tagline is left out: at 6% of the logo's height it is unreadable at any size a screen draws it.

Both follow the theme. The files that cannot be code are generated from the same paths and kept in
`public/`: `favicon.svg` (the tab icon), `icons/icon-192.png`, `icons/icon-512.png`,
`icons/icon-maskable-512.png` and `apple-touch-icon.png` (the installed app), and `icons/badge-96.png`
(the push notification badge — white on transparent, since Android uses only its alpha). Keep their
names: the manifest, `index.html` and `sw.js` point at them.
