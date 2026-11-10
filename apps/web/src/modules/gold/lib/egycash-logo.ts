// The EGYCASH letterhead logo — moved to the contracts package so the server prints it too (the
// hiring forms of «مستندات التعيين» carry the same letterhead as every paper the browser prints).
// Imported by subpath, never through the package's barrel, so ~60 KB of image never rides along
// with an import of a schema.
export { EGYCASH_LOGO } from '@ecms/contracts/egycash-logo';
