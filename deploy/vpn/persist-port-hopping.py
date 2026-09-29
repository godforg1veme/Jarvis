#!/usr/bin/env python3
"""Persist one public Hysteria2 DNAT rule in UFW without flushing live tables."""
import ipaddress
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def render(text, address, port_range, target_port):
    address = str(ipaddress.IPv4Address(address))
    start, end = map(int, port_range.split(':'))
    target = int(target_port)
    if not 20000 <= start <= end <= 50000 or not 1 <= target <= 65535:
        raise ValueError('invalid port range')
    rule = f'-A PREROUTING -d {address}/32 -p udp -m udp --dport {start}:{end} -j DNAT --to-destination {address}:{target}'
    lines = text.splitlines()
    if rule in lines:
        return text
    if '*nat' in lines:
        begin = lines.index('*nat')
        commit = lines.index('COMMIT', begin)
        lines.insert(commit, rule)
        return '\n'.join(lines) + '\n'
    return f'# Jarvis Hysteria2 port hopping: persistent public DNAT\n*nat\n:PREROUTING ACCEPT [0:0]\n{rule}\nCOMMIT\n\n{text}'


def main():
    if os.geteuid() != 0 or len(sys.argv) != 4:
        raise ValueError('root and three arguments required')
    path = Path('/etc/ufw/before.rules')
    if path.is_symlink() or not path.is_file():
        raise ValueError('regular UFW configuration required')
    old = path.read_text(encoding='utf-8')
    new = render(old, *sys.argv[1:])
    subprocess.run(['/usr/sbin/iptables-restore', '--test', '--noflush'],
                   input=new.encode('utf-8'), check=True, stdout=subprocess.DEVNULL)
    if new == old:
        print('Persistent UFW DNAT already present')
        return
    info = path.stat()
    descriptor, temporary = tempfile.mkstemp(prefix='.jarvis-before-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(new)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, info.st_mode & 0o777)
        os.chown(temporary, info.st_uid, info.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('Persistent UFW DNAT saved and syntax verified')


if __name__ == '__main__':
    main()
