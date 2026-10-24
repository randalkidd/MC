#!/usr/bin/env bash
# One-time setup of the MC queue server (Ubuntu 24.04 LTS). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/randalkidd/MC/main/server/setup.sh | sudo bash
# Safe to re-run. It never asks for or stores a token; you add keys yourself (README steps 4–6).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update -qq
apt-get install -y -qq git curl python3 poppler-utils ufw unattended-upgrades fail2ban ca-certificates >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
fi
timedatectl set-timezone America/Phoenix || true

echo "== firewall: SSH only"
ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null || true

echo "== user mcq"
id mcq >/dev/null 2>&1 || useradd -m -s /bin/bash mcq
loginctl enable-linger mcq 2>/dev/null || true

echo "== Claude Code + headless browser (as mcq)"
sudo -iu mcq bash -lc 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash'
sudo -iu mcq bash -lc 'npx -y playwright@latest install chromium >/dev/null 2>&1 || true'
npx -y playwright@latest install-deps chromium >/dev/null 2>&1 || true
sudo -iu mcq bash -lc 'export PATH=$HOME/.local/bin:$PATH; claude mcp list 2>/dev/null | grep -q playwright || claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest --headless --isolated --browser chromium' || true

echo "== SSH deploy keys (one per repo)"
sudo -iu mcq bash -lc '
mkdir -p ~/.ssh && chmod 700 ~/.ssh
for k in mc mcq; do [ -f ~/.ssh/deploy_$k ] || ssh-keygen -q -t ed25519 -N "" -C "mc-queue-server $k" -f ~/.ssh/deploy_$k; done
grep -q "Host github-mc$" ~/.ssh/config 2>/dev/null || cat >> ~/.ssh/config <<CFG
Host github-mc
  HostName github.com
  User git
  IdentityFile ~/.ssh/deploy_mc
  IdentitiesOnly yes
Host github-mcq
  HostName github.com
  User git
  IdentityFile ~/.ssh/deploy_mcq
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config; ssh-keyscan -q github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts
git config --global user.name "MC queue server"; git config --global user.email "mc-queue-server@users.noreply.github.com"; git config --global pull.rebase true'

echo
echo "Add these as deploy keys WITH WRITE ACCESS (README step 4):"
echo "  randalkidd/MC        →  $(cat /home/mcq/.ssh/deploy_mc.pub)"
echo "  randalkidd/MC-queue  →  $(cat /home/mcq/.ssh/deploy_mcq.pub)"
echo
echo "Then continue with README step 5."
