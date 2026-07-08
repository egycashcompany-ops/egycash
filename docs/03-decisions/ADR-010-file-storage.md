# ADR-010: File metadata in MongoDB, binaries behind a StorageAdapter

**Status:** Proposed · **Date:** 2026-07-08

## Context

ECMS is document-heavy (IDs, resumes, contracts, hiring documents) and the requirements forbid
storing files inside MongoDB. Storage location will change over time (Railway volume now, cloud
object storage later); access control and auditability of documents are business-critical.

## Decision

- **Binary data never enters MongoDB.** A `files` collection stores metadata only: names,
  description, category, mime, size, sha-256 checksum, storage key, uploader, timestamps, entity
  reference, version group.
- **`StorageAdapter` interface** (`put`, `getStream`, `delete`, `getSignedUrl`) with
  `LocalDiskAdapter` (Railway volume) first and an S3-compatible adapter later — call sites never
  change ([Platform Core §7](../02-architecture/platform-core.md)).
- **Versioning** via `file_groups`: re-upload to a group = version n+1; old versions retrievable.
- **No static serving.** Every download is an authorized, audited endpoint issuing short-lived
  signed URLs; authorization derives from permission on the *owning entity*.
- **Upload pipeline**: Multer (memory/disk temp) → mime + size validation per category →
  checksum → adapter `put` → metadata insert → thumbnail/preview job.

## Alternatives considered

- **GridFS** — rejected: still stores binaries in Mongo (prohibited), bloats backups, no CDN path.
- **Direct-to-cloud presigned uploads now** — deferred: right pattern for the cloud adapter later;
  premature while storage is a local volume.

## Consequences

- ✅ Storage migration is an adapter + data-move script; metadata, permissions, audit are untouched.
- ✅ Checksums enable dedup and integrity verification (chain-of-custody-grade for this industry).
- ⚠️ Local volume ties file availability to a single service instance until the cloud adapter
  lands — accepted for the first deployments, and the adapter interface caps the cost of the fix.
