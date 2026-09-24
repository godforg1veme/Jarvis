# Telegram Memory Gallery and VPN Fix Rollout

Date: 2026-09-14

## Outcome

The Telegram `🔐 VPN` entry no longer loses the authenticated owner's canonical
user UUID at the bottom-menu boundary. The existing VPN domain authorization is
unchanged and still validates the owner on every action.

`🧠 Память` now exposes `🖼 Файлы и кадры`, one owner-scoped paginated gallery
that merges every active uploaded document with every readable retained Visual
Memory frame when the visual-memory reader is configured. Selecting an item
sends its actual content as a Telegram photo or file and then provides separate
`🗑 Удалить`, `✅ Оставить`, and back controls. Selection, keep, and back do not
mutate content; deletion delegates to the owning document or visual-memory
service.

## Safety boundaries

- Gallery listings expose presentation metadata only and use parameterized,
  owner-scoped database queries.
- Preview reads repeat owner scoping at the document or visual-memory service.
- Callback data is closed and bounded and contains no paths, storage keys,
  content, or credentials.
- File and image buffers remain transient and are not written to conversations,
  Life OS, telemetry, or logs.
- Media size and type are validated before delivery. Delivery failure never
  deletes the source.
- Unsupported or invalid image content is rejected or delivered as a document;
  it is not trusted solely because of a declared MIME type.
- VPN confirmation and one-time profile handling are unchanged.

## Verification

- Focused Telegram, knowledge, repository, and gallery tests: 61 passed.
- Complete server suite: 261 passed, 0 failed.
- JavaScript syntax checks and `git diff --check`: passed.
- Deployment preflight: passed.
- Server-only production image rebuild: passed.
- `server`, `postgres`, `cloudflared`, and `gigaam-asr`: healthy/running after
  rollout.
- Public `deploy/scripts/smoke.sh https://jarvis.rilora.ru`: passed.
- Bounded post-start logs contained no server, Telegram, or VPN errors.
- A read-only production contract resolved the real owner internally, called
  the actual VPN menu service, and ran the gallery query successfully. No owner
  identifier, filename, content, or secret was printed.

## Manual acceptance still required

Automated verification does not simulate destructive operations against the
owner's real data. From the real owner Telegram account, still verify:

1. Tap `🔐 VPN` and confirm the protocol menu renders.
2. Open `🧠 Память` → `🖼 Файлы и кадры` and preview an image and a non-image
   document.
3. Confirm `✅ Оставить` makes no change.
4. Delete only a disposable test item and confirm the gallery refreshes.
5. Confirm a family member cannot see owner-only VPN controls or owner content.

The restricted pre-deployment rollback archive remains on the VPS at
`/home/deploy/apps/jarvis/.deploy-backups/telegram-gallery-vpn-fix-predeploy-20260914.tar.gz`.
