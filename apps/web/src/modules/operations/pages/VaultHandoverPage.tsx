// «تسليم المحصنات» (Round 12) — the vault hands each van of the day its load: «نفس الشاشة هنعمل زيها
// للخزنة هيكون فوق كل عربيه تسليم وطباعه … بس لما يدوس تسليم المحصنات هتتسلم ساعتها وخلاص مش هتبقى ف
// الخزنة».
//
// Routed and catalogued with the SERVER half of Round 12 (the read is
// `GET /operations/secured/distribution`, the handover the existing `POST /operations/secured/dispatch`,
// the navigation row and its guard), so the sidebar, the route guard and the API agree from the first
// commit. The screen itself is the web half of the round. Until it lands, the URL answers the
// standard 404 — the owner rule in routes.tsx: no placeholder surface is ever reachable.
import { NotFoundPage } from '../../../platform/app/pages/NotFoundPage';

export const VaultHandoverPage = (): JSX.Element => <NotFoundPage />;
