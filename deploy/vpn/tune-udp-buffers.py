#!/usr/bin/env python3
"""Apply or roll back Jarvis VPN UDP socket limits without restarting services."""
import argparse
import json
import os
from pathlib import Path
import tempfile

TARGET = 7340032
KEYS = ('rmem_max', 'wmem_max')
SYSCTL = Path('/proc/sys/net/core')
DROPIN = Path('/etc/sysctl.d/90-jarvis-vpn-udp-buffers.conf')
JOURNAL = Path('/var/lib/jarvis-vpn/udp-buffer-tuning.json')


def atomic_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        temp = Path(out.name)
        os.chmod(temp, mode)
        out.write(content.encode())
        out.flush()
        os.fsync(out.fileno())
    os.replace(temp, path)


def dropin_info(path):
    if path.is_symlink():
        raise RuntimeError('managed file is a symlink')
    if not path.exists():
        return None
    stat = path.stat()
    if getattr(os, 'geteuid', lambda: 1)() == 0 and stat.st_uid != 0:
        raise RuntimeError('managed file is not root-owned')
    return {'mode': stat.st_mode & 0o777, 'uid': stat.st_uid, 'gid': stat.st_gid}


def values(root):
    return {key: int((root / key).read_text().strip()) for key in KEYS}


def set_values(root, wanted):
    for key in KEYS:
        (root / key).write_text(str(wanted[key]) + '\n')


def managed_text(wanted):
    return ''.join(f'net.core.{key} = {wanted[key]}\n' for key in KEYS)


def apply(root=SYSCTL, dropin=DROPIN, journal=JOURNAL):
    now = values(root)
    current_info = dropin_info(dropin)
    if journal.exists():
        state = json.loads(journal.read_text())
        phase = state.get('phase')
        current_file = dropin.read_text() if dropin.exists() else None
        if phase == 'applied':
            if current_file != state['applied_file'] or now != state['applied']:
                raise RuntimeError('managed state differs; refusing apply')
            return now
        if phase != 'applying' or current_file not in (state['before_file'], state['applied_file']) or any(now[k] not in (state['before'][k], state['applied'][k]) for k in KEYS):
            raise RuntimeError('managed state differs; refusing apply')
        wanted = state['applied']
        applied_file = state['applied_file']
    else:
        wanted = {key: max(now[key], TARGET) for key in KEYS}
        original = dropin.read_text() if dropin.exists() else None
        applied_file = managed_text(wanted)
        state = {'phase': 'applying', 'before': now, 'before_file': original, 'before_info': current_info, 'applied': wanted, 'applied_file': applied_file}
        atomic_write(journal, json.dumps(state, sort_keys=True) + '\n')
    atomic_write(dropin, applied_file, 0o644)
    set_values(root, wanted)
    state['phase'] = 'applied'
    atomic_write(journal, json.dumps(state, sort_keys=True) + '\n')
    return values(root)


def rollback(root=SYSCTL, dropin=DROPIN, journal=JOURNAL):
    state = json.loads(journal.read_text())
    dropin_info(dropin)
    phase = state.get('phase')
    now = values(root)
    current_file = dropin.read_text() if dropin.exists() else None
    if phase == 'applied':
        if current_file != state['applied_file'] or now != state['applied']:
            raise RuntimeError('managed state differs; refusing rollback')
        state['phase'] = 'rolling_back'
        atomic_write(journal, json.dumps(state, sort_keys=True) + '\n')
    elif phase != 'rolling_back' or current_file not in (state['before_file'], state['applied_file']) or any(now[k] not in (state['before'][k], state['applied'][k]) for k in KEYS):
        raise RuntimeError('managed state differs; refusing rollback')
    if state['before_file'] is None:
        dropin.unlink(missing_ok=True)
    else:
        info = state['before_info']
        atomic_write(dropin, state['before_file'], info['mode'])
        if getattr(os, 'geteuid', lambda: 1)() == 0:
            os.chown(dropin, info['uid'], info['gid'])
    set_values(root, state['before'])
    journal.unlink()
    return values(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('status', 'apply', 'rollback'))
    action = parser.parse_args().action
    if action != 'status' and os.geteuid() != 0:
        parser.error('root required')
    result = values(SYSCTL) if action == 'status' else apply() if action == 'apply' else rollback()
    phase = json.loads(JOURNAL.read_text()).get('phase') if JOURNAL.exists() else 'unmanaged'
    print(json.dumps({'status': action, 'phase': phase, **result}, sort_keys=True))


if __name__ == '__main__':
    main()
