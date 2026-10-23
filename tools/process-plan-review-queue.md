# Routine: process the Queued Review plans

Run by the scheduled task **"Plan review queue"** at 12:15 AM Sunday–Thursday (America/Phoenix) on the user's computer LONDON, or when the user asks to process the queue now. It reads each plan sent with **Queued Review** on the Plan review tab of https://randalkidd.github.io/MC/ and stores what it found, so the website can load the result. It runs on the user's Claude plan (no Anthropic API key).

## What the session needs
- **Push access to the PRIVATE repo `randalkidd/MC-queue`** (branch `main`). In a cloud session, attach it first (`add_repo` owner `randalkidd`, repo `MC-queue`, access `push`) and clone it.
- **Read access to `randalkidd/MC`** for the instructions: the prompt and output schema are in `worker/cors-proxy.js` (`sitePlanPrompt()` and `SITE_PLAN_TOOL`), and the checklist items are in `js/checklists.js`.
- Never copy plans, owner names or any data from `MC-queue` into the public repo `randalkidd/MC`, a public page, or a reply beyond the short summary below. Never commit tokens or passphrases.

## Files (in `randalkidd/MC-queue`)
- `queue/<id>.pdf`: the plan. `queue/<id>.json`: `{ id, file, size, apn, type, reviewer, submitted, status, note?, processedAt?, db? }`. `status` is `queued` → `processing` → `done` | `failed`.
- `db/<id>.json`: the result the website loads: `{ id, inserted, expires, source: "queued", file, apn, type, model, result, compare: [] }`.
- `tools/retention.py`: deletes plans older than 14 days and data older than 45 days.

## Steps
1. **Retention first.** In the clone, run `python3 tools/retention.py .` and keep its deletions.
2. **Pick the work.** Every `queue/*.json` with `status` `queued` (or `processing` older than 6 hours) whose `queue/<id>.pdf` still exists. If there are none, stop: commit any retention deletions, push, and report "Nothing queued".
3. **For each item:**
   1. Set `status: "processing"`, commit and push (so the website shows it).
   2. Read the PDF. Use the Read tool on the PDF (pages in chunks of up to 20). For drawings, look closely at the title block, the site plan, dimension strings, the area/coverage table, the legend and the notes; zoom where needed. Scans are fine — read them visually.
   3. Produce the result **exactly as In-Depth Review would**: follow the rules in `sitePlanPrompt()` and produce an object matching `SITE_PLAN_TOOL.input_schema` in `worker/cors-proxy.js` of `randalkidd/MC`, including `annotations` (page + box as page fractions, origin top-left) and one `checklist` entry for every item of the item's `type` in `js/checklists.js` (`CHECKLISTS[type].items`, id = first element). Keep `shows` to about 12 words and each `correction` to about 20. Never guess a value — use `null` and add it to `uncertain`.
   4. Write `db/<id>.json`: `{ "id": <id>, "inserted": <now ISO>, "expires": <now + 45 days ISO>, "source": "queued", "file": <file>, "apn": <apn>, "type": <type>, "by": <the queue item's by>, "byName": <the queue item's byName>, "model": "Claude (Queued Review)", "result": <object>, "compare": [] }`. Copy `by`/`byName` from the queue item so the user's Profile → Clear all my data and the admin User Folders find it. The website runs the Assessor/deed comparisons itself when the result is loaded.
   5. Update `queue/<id>.json`: `status: "done"`, `processedAt: <now ISO>`, `db: "db/<id>.json"`. If the plan can't be read (corrupt, password-protected, not a site plan), set `status: "failed"` and a short `note` instead, and write no `db` file.
   6. Leave the PDF in place — retention deletes it 14 days after submission.
4. **Finish.** 2-space JSON with a trailing newline. Commit everything in one commit per item or one at the end: `Queued Review: <n> plan(s) read`. Push to `main` (fetch and rebase first; the daily retention job may have squashed history — if the push is rejected, `git fetch origin main && git rebase origin/main` and push again).
5. **Report** (no owner names, no plan contents): how many plans were read, how many failed and why, and that results are under **Plan review → Queued reviews → Load results** on the site.
