const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return fs.existsSync(gitBash) ? gitBash : null;
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, 'utf8');
  fs.chmodSync(file, 0o755);
}

function runBash(bash, script, env) {
  return childProcess.spawnSync(bash, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('backup and restore scripts produce an isolated restic restore set', (t) => {
  const bash = bashExecutable();
  if (!bash) {
    t.skip('Bash is unavailable on this workstation');
    return;
  }

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-backup-test-'));
  const fakeBin = path.join(fixture, 'bin');
  const resticDir = path.join(fixture, 'restic');
  const documents = path.join(fixture, 'documents');
  const restoreTarget = path.join(fixture, 'restore');
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(resticDir);
  fs.mkdirSync(documents);
  fs.mkdirSync(restoreTarget);
  fs.writeFileSync(path.join(documents, 'private.txt'), 'семейный секрет', 'utf8');
  fs.writeFileSync(path.join(fixture, 'compose.yml'), 'services: {}\n', 'utf8');
  fs.writeFileSync(path.join(fixture, 'env'), '', 'utf8');
  fs.writeFileSync(path.join(fixture, 'password'), 'test-only-password\n', 'utf8');

  const unix = (value) => value.replace(/\\/g, '/');
  writeExecutable(path.join(fakeBin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "volume" ]]; then
  echo "$FAKE_DOCUMENT_MOUNT"
  exit 0
fi
case " $* " in
  *" ps --status running --services "*) echo server ;;
  *" exec -T postgres "*) printf 'fake-postgres-dump' ;;
  *) exit 0 ;;
esac
`);
  writeExecutable(path.join(fakeBin, 'restic'), `#!/usr/bin/env bash
set -euo pipefail
command="$1"
shift
case "$command" in
  backup)
    filename=""
    while [[ "$#" -gt 0 ]]; do
      if [[ "$1" == "--stdin-filename" ]]; then filename="$2"; shift 2; continue; fi
      shift
    done
    [[ -n "$filename" ]]
    cat >"$FAKE_RESTIC_DIR/$filename"
    ;;
  forget) exit 0 ;;
  snapshots) printf '[{"id":"test-complete"}]' ;;
  dump)
    if [[ " $* " == *" jarvis-database "* ]]; then cat "$FAKE_RESTIC_DIR/postgres.dump";
    elif [[ " $* " == *" jarvis-documents "* ]]; then cat "$FAKE_RESTIC_DIR/documents.tar";
    else cat "$FAKE_RESTIC_DIR/manifest.json"; fi
    ;;
  *) exit 1 ;;
esac
`);
  writeExecutable(path.join(fakeBin, 'flock'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(path.join(fakeBin, 'install'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "-d" ]]; then
  mkdir -p "\${@: -1}"
  exit 0
fi
exit 1
`);

  const environment = {
    PATH: `${unix(fakeBin)}:/usr/bin:/bin`,
    FAKE_DOCUMENT_MOUNT: unix(documents),
    FAKE_RESTIC_DIR: unix(resticDir),
    RESTIC_REPOSITORY: 'test-repository',
    RESTIC_PASSWORD_FILE: unix(path.join(fixture, 'password')),
    JARVIS_BACKUP_COMPOSE_FILE: unix(path.join(fixture, 'compose.yml')),
    JARVIS_BACKUP_ENV_FILE: unix(path.join(fixture, 'env')),
    JARVIS_BACKUP_PROJECT: 'test-project',
    JARVIS_DOCUMENT_VOLUME: 'test-volume',
    JARVIS_BACKUP_LOCK_FILE: unix(path.join(fixture, 'backup.lock')),
    JARVIS_BACKUP_KEEP_DAILY: '1',
    JARVIS_BACKUP_KEEP_WEEKLY: '1',
    JARVIS_BACKUP_KEEP_MONTHLY: '1',
  };

  try {
    const backup = runBash(bash, 'deploy/backup/backup.sh', environment);
    assert.equal(backup.status, 0, `${backup.stdout}\n${backup.stderr}`);
    assert.equal(fs.readFileSync(path.join(resticDir, 'postgres.dump'), 'utf8'), 'fake-postgres-dump');
    const manifest = JSON.parse(fs.readFileSync(path.join(resticDir, 'manifest.json'), 'utf8'));
    assert.match(manifest.runId, /^\d{8}T\d{6}Z$/);

    const restore = runBash(bash, 'deploy/backup/restore.sh', {
      ...environment,
      JARVIS_RESTORE_RUN: manifest.runId,
      JARVIS_RESTORE_TARGET: unix(restoreTarget),
    });
    assert.equal(restore.status, 0, `${restore.stdout}\n${restore.stderr}`);
    assert.equal(fs.readFileSync(path.join(restoreTarget, 'postgres.dump'), 'utf8'), 'fake-postgres-dump');
    assert.equal(fs.readFileSync(path.join(restoreTarget, 'documents', 'private.txt'), 'utf8'), 'семейный секрет');
    assert.ok(fs.existsSync(path.join(restoreTarget, 'documents.sha256')));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
