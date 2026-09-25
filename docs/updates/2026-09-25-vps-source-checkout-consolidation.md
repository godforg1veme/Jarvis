# VPS source checkout consolidation

Date: 2026-09-25

Both VPS source directories now use the flattened Jarvis repository from GitHub
`main`. The Windows checkout was also fast-forwarded to the same branch. Before
the rollout, both VPS directories were on `ec3cac1`, with old tracked files
nested under `jarvis/` and newer, untracked source at the root. The source
promotion used GitHub `main` at `d405494fc3af648d74b73e26b5a76b59084b0c36`.

The new checkouts are clean and have one local branch, `main`. The deployment
preflight now rejects stale or dirty source, the wrong GitHub remote, extra
branch references, and nested `jarvis/` copies. The deployment scripts check
the local and remote source before uploading or installing files.

The rollout preserved `.env`, secret files, `.backups`, `.deploy-backups`,
deployment staging files, `pendingCommandId`, and the ignored server archive.
The old VPS `data/` files are kept under
`.deploy-backups/jarvis-source-consolidation-d405494/data/` because `main`
tracks defaults at those same paths. File contents, sizes, modes, and ownership
were checked before and after copying. The secrets directory is now mode `0700`;
individual secret files retained their original content, owner, and mode.

The primary server's existing PostgreSQL and Cloudflared containers had
read-only bind mounts into the old checkout. Their exact mounted file inodes
are preserved under `.deploy-backups/jarvis-active-binds-20260925/` until those
containers are recreated from the canonical checkout. A private note in that
directory records when the hard links can be removed.

The Compose configuration hash stayed the same before and after promotion.
All four container IDs were unchanged, the running Server, PostgreSQL, GigaAM,
and Cloudflared containers remained healthy, and public readiness returned
`ok`. The active Server release at `eeb1c210d53b08cc0b322243998add8e63a2ffe6`
was verified as a clean commit reachable from `main`; it was not restarted or
replaced during source cleanup.

Both Host Agent snapshots returned `healthy`; Xray and Hysteria2 services were
active. Their `protocolProbe` fields remained `unknown`, which is not a
protocol-level route test. On the secondary VPS, the DE probe timer remained
active and the NL timer remained inactive, matching the state before rollout.
No application, database, VPN, Host Agent, probe, or ingress service was
restarted for this work.
