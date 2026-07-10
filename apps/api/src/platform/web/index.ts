// Platform web kit — the HTTP-layer surface Layer 2 modules build their routers and
// controllers against. Modules may import `platform` and `shared` but NOT `infrastructure`
// directly (ESLint boundary, Module Structure §1); this barrel re-exports the small,
// stable set of request/response helpers a module needs, so the boundary stays intact
// (module → platform → infrastructure) instead of every module reaching into infra.
export { asyncHandler } from '../../infrastructure/http/async-handler';
export { validate, validated, type ValidatedRequest } from '../../infrastructure/http/validate';
export { ok, okPage, created, noContent } from '../../infrastructure/http/respond';
