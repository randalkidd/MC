# MC queue server

A small always-on Linux server that runs the two nightly queues in place of the user's computer (LONDON):

| Queue | Routine | When (Arizona time) |
|---|---|---|
| Plan review (Queued Review) | `tools/process-plan-review-queue.md`, reads `randalkidd/MC-queue` | 12:15 AM Sunday–Thursday |
| SubdivisionDB review list | `tools/process-subdivision-queue.md`, writes `randalkidd/MC` | 1:45 AM daily |

Each run pulls both repos, skips straight to the end when its queue is empty, and otherwise runs Claude Code headless (`claude -p`) on the routine with `server/SERVER-NOTES.md`. The notes tell Claude to use `curl` and `pdftoppm` for the Recorder plats instead of the desktop browser. A headless Chromium (Playwright) is installed as a fallback. Runs use your Claude plan, not an API key.

Nothing secret is in this folder. The server makes its own GitHub deploy keys, and you sign in to Claude on the server yourself.

## Setup

### 1. Create the server
Any VPS provider works (DigitalOcean, Hetzner, AWS Lightsail, Linode, Vultr…). Choose:
- **Ubuntu 24.04 LTS**
- **2 vCPU / 4 GB RAM / 40 GB+ disk.** Claude Code and Chromium don't fit well in 1–2 GB.
- **US West region**
- **SSH key login** (add your public key when you create it), plus the provider's disk encryption and backups if offered.

### 2. Connect
```
ssh root@<server-ip>
```

### 3. Run the setup script
```
curl -fsSL https://raw.githubusercontent.com/randalkidd/MC/main/server/setup.sh | sudo bash
```
It installs the following, and at the end prints **two deploy keys**:
- git, Python, poppler (PDF tools) and Node
- Claude Code and headless Chromium
- a firewall that allows SSH only, automatic security updates and fail2ban
- a service user `mcq`

### 4. Add the deploy keys on GitHub
For each repo: **Settings → Deploy keys → Add deploy key**, paste the matching key, tick **Allow write access**, then save.
- `randalkidd/MC` gets the key ending `mc-queue-server mc`.
- `randalkidd/MC-queue` gets the key ending `mc-queue-server mcq`.

Each key can only reach its own repo. To revoke the server later, delete the two keys.

### 5. Check that the county sites answer the server
```
H='-H Origin:https://recorder.maricopa.gov -H Referer:https://recorder.maricopa.gov/ -A Mozilla/5.0'
curl -s $H "https://publicapi.recorder.maricopa.gov/documents/search?businessNames=SAVANNAH" | head -c 300; echo
curl -s "https://gis.maricopa.gov/arcgis/rest/services/IndividualService/Parcel/MapServer/1?f=json" | head -c 200; echo
```
Both should print JSON. If the Recorder refuses (HTML, 403, or an empty reply), datacenter addresses are being blocked. The plan queue still works without it. For SubdivisionDB, tell Claude, and the routine can fetch plats through your Cloudflare relay instead.

### 6. Sign in to Claude on the server
```
sudo -iu mcq
claude
```
In Claude, type `/login`, choose your Claude account, and open the link it shows on any device (your phone works). Paste the code back, then `/exit`, then `exit`. The login is saved for the `mcq` user and refreshes itself.

*Alternative:* on your own computer, run `claude setup-token`. Then on the server:
```
sudo -iu mcq
umask 077
echo 'CLAUDE_CODE_OAUTH_TOKEN=<token>' > ~/.mcq.env
```
Keep that token out of chats and repos.

### 7. Clone the repos and turn on the timers
```
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/randalkidd/MC/main/server/install-timers.sh)"
```
It lists the next run times when it finishes.

### 8. Do a test run
```
sudo systemctl start mc-queue@plan.service           # or mc-queue@subdivisions.service
sudo tail -n 50 /home/mcq/logs/$(ls -t /home/mcq/logs | head -1)
```
"nothing queued — done" means it worked and there was nothing to do. To test a real run, queue a plan (or a subdivision) on the site first.

### 9. Retire LONDON's scheduled tasks
Once a few nightly runs have succeeded, turn off the "Plan review queue" scheduled task on LONDON so the two don't both process the queue. Runs on the server hold a lock, but LONDON doesn't know about it.

## Day to day
- **Logs:** `/home/mcq/logs/<queue>-<date>.log` (kept 30 days).
  ```
  systemctl list-timers 'mc-queue-*'   # next runs
  journalctl -u 'mc-queue@*'           # service messages
  ```
- **Run now:** `sudo systemctl start mc-queue@plan.service`.
- **Change the schedule:** edit `server/systemd/*.timer` in the repo and re-run step 7.
- **Updates:** security updates install automatically, and Claude Code updates itself. Reboot after kernel updates (`sudo reboot`).
- **Usage:** each run counts toward your Claude plan's limits. Empty queues use nothing.
- **Privacy:** queued plans now also sit on this server's disk, in `~/MC-queue`. Retention deletions reach it on the next pull. The server is yours, not the county's; check that against county policy before using it for real submittals.
