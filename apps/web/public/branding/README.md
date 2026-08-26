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

## The EGYCASH mark

The logo beside the wordmark is still the platform letter tile. When the real artwork exists, it
replaces the `<span>` in `EgycashLockup` (`PortalLoginPage.tsx`) and nothing else on the page moves
— the wordmark beside it carries the name either way.
