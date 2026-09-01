#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "run as root: sudo $0 /path/to/public-key [ssh-port]" >&2
  exit 1
fi

public_key_file="${1:-}"
ssh_port="${2:-22}"
deploy_user="jarvis"

if [[ ! -f "${public_key_file}" ]]; then
  echo "a readable SSH public-key file is required" >&2
  exit 1
fi
if [[ ! "${ssh_port}" =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then
  echo "SSH port must be between 1 and 65535" >&2
  exit 1
fi
if ! grep -Eq '^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh.com) ' "${public_key_file}"; then
  echo "use an Ed25519, ECDSA, or security-key SSH public key" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl ffmpeg gnupg postgresql-client restic ufw unattended-upgrades wireguard

install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

arch="$(dpkg --print-architecture)"
codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${codename}
Components: stable
Architectures: ${arch}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if ! id "${deploy_user}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${deploy_user}"
fi
usermod -aG docker "${deploy_user}"
install -d -m 0700 -o "${deploy_user}" -g "${deploy_user}" "/home/${deploy_user}/.ssh"
install -m 0600 -o "${deploy_user}" -g "${deploy_user}" "${public_key_file}" "/home/${deploy_user}/.ssh/authorized_keys"

cat >/etc/ssh/sshd_config.d/60-jarvis-hardening.conf <<EOF
Port ${ssh_port}
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh

cat >/etc/sysctl.d/60-jarvis-swap.conf <<'EOF'
vm.swappiness=10
EOF
sysctl --system >/dev/null
if ! swapon --show=NAME --noheadings | grep -q .; then
  fallocate -l 4G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow "${ssh_port}/tcp" comment 'SSH'
ufw allow 80/tcp comment 'HTTP for TLS provisioning'
ufw allow 443/tcp comment 'Jarvis HTTPS/WSS'
ufw allow 51820/udp comment 'Personal WireGuard'
ufw --force enable

dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now docker

echo "Ubuntu 22.04 bootstrap complete. Reconnect as ${deploy_user} before closing the current SSH session."
