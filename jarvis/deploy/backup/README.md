# Encrypted backups and restore drill

The backup runs on the Docker host, not inside the Jarvis application
container. It writes three encrypted restic streams: `postgres.dump`,
`documents.tar`, and a final `manifest.json`. The manifest is written only
after the database and documents streams succeed; restore accepts only a run
with that completion marker.

## One-time host setup

Install `restic` and create a repository outside the VPS. Store its settings in
`/etc/jarvis/backup.env`, mode `0600`, owned by root. This file is not part of
the repository:

```bash
RESTIC_REPOSITORY=sftp:user@backup-host:/srv/restic/jarvis
RESTIC_PASSWORD_FILE=/etc/jarvis/restic-password
JARVIS_BACKUP_COMPOSE_FILE=deploy/docker-compose.yml
JARVIS_BACKUP_ENV_FILE=deploy/.env
JARVIS_BACKUP_PROJECT=jarvis-family
JARVIS_DOCUMENT_VOLUME=jarvis-family_document-data
JARVIS_BACKUP_PAUSE_SERVER=1
```

Create `/etc/jarvis/restic-password` directly on the host, mode `0600`; never
put its contents in an environment variable, shell history, git, or a log.

`JARVIS_BACKUP_PAUSE_SERVER=1` is the safe default: it briefly stops the
control plane while PostgreSQL and the document volume are captured. Set it to
`0` only after an application-level ingestion lock has been implemented and
tested.

Install the systemd units with absolute paths adjusted if the deployment root
is different:

```bash
install -m 0644 deploy/backup/jarvis-backup.service /etc/systemd/system/
install -m 0644 deploy/backup/jarvis-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jarvis-backup.timer
systemctl list-timers jarvis-backup.timer
```

Run the first backup manually and inspect the resulting run ID:

```bash
systemctl start jarvis-backup.service
systemctl status jarvis-backup.service --no-pager
restic snapshots --tag jarvis-complete
```

Do not paste restic output if it contains a remote repository address you do
not want shared.

## Restore drill

Restore only into an explicitly named empty test directory. This does not
touch Docker, the production volume, or PostgreSQL:

```bash
set -a
. /etc/jarvis/backup.env
set +a
JARVIS_RESTORE_RUN=20260902T120000Z \
JARVIS_RESTORE_TARGET=/srv/jarvis-restore-test/20260902 \
bash deploy/backup/restore.sh
```

Then create an explicitly named empty test database and load the dump manually:

```bash
createdb jarvis_restore_test
pg_restore --clean --if-exists --no-owner --dbname=jarvis_restore_test /srv/jarvis-restore-test/20260902/postgres.dump
```

Verify document checksums, run migrations/read-only queries, and perform a
private-document search before considering the backup process accepted. Never
point `pg_restore` or the restore target at production by default.
