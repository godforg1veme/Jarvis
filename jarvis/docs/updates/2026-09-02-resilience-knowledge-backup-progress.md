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

## Semantic retrieval and confirmed Desktop commands

- OpenAI-compatible embeddings are configured only through environment
  variables. Production currently uses OpenRouter with
  `openai/text-embedding-3-small` (1536 dimensions). Document and query
  embeddings are bounded, owner-scoped, processed by background jobs, and
  combined with PostgreSQL FTS through reciprocal-rank fusion. Provider
  failures preserve lexical search.
- Remote commands now have persisted lifecycle state, source-client confirmation,
  expiry, audit events, authenticated WSS delivery, Tool Gateway execution, and
  a Desktop command journal that prevents replay after a client restart.
- The Action Orchestrator now converts natural Desktop/Telegram requests into a
  bounded strict plan, persists workflows and action runs, resumes from WSS
  results, and delivers delayed completion to the originating client. Search
  paths remain local behind short-lived opaque candidate IDs.
- Migration 006 and the updated control plane passed VPS preflight, Compose
  health and public Cloudflare smoke checks on 2026-09-02. A real Telegram TXT
  document produced a ready production vector and answered a low-lexical-overlap
  query with the expected citation. A Telegram-origin file deletion displayed
  its confirmation in Telegram; replying `нет` cancelled it and left the file
  intact. Live multi-device acceptance remains outstanding.
