# Fallback, private knowledge and backup progress

Status: 2026-09-02. This update supersedes the relevant roadmap status in the
2026-09-01 rollout note without rewriting that historical snapshot.

## Implemented and covered by server tests

- Text answers can fall through from the configured Salad/OpenRouter primary
  to a separately configured OpenRouter key/model and then Gemini. The
  fallback chain is disabled for requests that expose tools, so a future device
  action is never replayed on a second model.
- Telegram-first attachment ingest accepts bounded documents, photos, audio,
  voice messages, videos, animations, archives, stickers, and generic binary
  files. Objects are stored under opaque keys in the private document volume.
- TXT, Markdown, CSV, JSON, XML, YAML, HTML, DOCX and text-bearing PDFs are
  normalized, chunked and indexed with owner-scoped PostgreSQL full-text
  search; PDF chunks retain page metadata for citations. Audio/video container
  metadata is safely probed; other accepted types remain searchable by private
  filename and metadata.
  Document context is passed to the model as untrusted data and citations map
  only known server source labels.
- The server has a DB-backed ingest job queue, per-user byte quota, bounded
  downloads, path-traversal rejection, and no automatic archive extraction.
- Encrypted restic backup/restore scripts and a systemd timer are committed
  under `deploy/backup/`. Restore materializes only into a named empty test
  directory and never defaults to production.

## Not yet production-accepted

- Real fallback keys/models have not been configured on the VPS.
- A full production deployment and restore drill have not run yet.
- Audio/video speech content requires the later server-ASR benchmark and
  provider rollout; their metadata is already stored privately.
