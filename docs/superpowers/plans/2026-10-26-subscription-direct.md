# План / Plan: direct subscription ingress

Goal: prepare an opt-in HTTPS route independent of Cloudflare for affected Happ
clients, retaining the existing server's token and revocation boundary.
Spec: [design](../specs/2026-10-26-subscription-direct-design.md).

- [x] Audit branches, worktrees and PRs; preserve unrelated Mini App work.
- [x] Reject timeout-header mitigation requiring a Happ Provider ID.
- [x] Add a separate Caddyfile and opt-in Compose overlay without TCP 443/8443.
- [x] Validate the actual Caddy adapter and exercise proxy/deny behavior against
  an isolated fixture, including encoded paths, methods and secret-safe logs.
- [x] Independently review ingress scope; remove the unnecessary upstream
  response-header deadline. Deployment and phone acceptance remain pending.
- [x] Record checks and prepare the concrete release proposal in
  [deployment instructions](../../../deploy/subscription-direct.md).
- [x] After owner authorization: publish and synchronize sources, configure
  DNS-only hostname and TCP 80/9443, install the gateway, verify TLS and scope.
- [ ] Confirm successful import and refresh on the affected iPhone.

Русский: выпуск согласован и выполнен 26 октября; DNS и TLS проверены.
Прежние сервисы, подписки и токены сохранены. До проверки на iPhone
исправление на телефоне не считается подтверждённым.
