#!/usr/bin/env bash
# README step 7: clone the repos (deploy keys must be added first) and turn on the nightly timers. Run with sudo.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
sudo -iu mcq bash -lc '
[ -d ~/MC/.git ] || git clone -q github-mc:randalkidd/MC.git ~/MC
[ -d ~/MC-queue/.git ] || git clone -q github-mcq:randalkidd/MC-queue.git ~/MC-queue
git -C ~/MC pull -q; git -C ~/MC-queue pull -q; chmod +x ~/MC/server/run-queue.sh; echo "repos ok"'
cp /home/mcq/MC/server/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mc-queue-plan.timer mc-queue-subdivisions.timer
systemctl list-timers 'mc-queue-*' --no-pager
