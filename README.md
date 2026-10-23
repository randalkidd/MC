# Unofficial Maricopa County Zoning Hub

Live at **https://randalkidd.github.io/MC/** · the original single-page Parcel Lookup is at [`/parcel-lookup/`](parcel-lookup/).

A static web app for zoning and subdivision review in unincorporated Maricopa County. It runs entirely in the browser (phone, tablet or any computer) and talks to the county's public GIS services directly. It needs no server and no browser extension.

## Public information

All information this system provides is public-facing and accessible to the public. Lookups draw only on public sources: Maricopa County GIS services, Assessor and Recorder records, the Zoning Ordinance, the Subdivision Regulations and department directives. Everything saved through the site (the subdivision database, parcel reports and plan reviews) is stored in this public GitHub repository, where anyone can view it. Don't enter or save anything that isn't public record.

## Contact

Questions, corrections or suggestions? Email the designer, Randal Kidd, at [randal.kidd@maricopa.gov](mailto:randal.kidd@maricopa.gov).

**What it does**
- **Parcel lookup.** Enter an APN and the app pulls:
  - the Assessor record
  - every PlanNet layer in one `identify` call (zoning, overlays, current and historic cases, districts, natural resource, military)
  - the PLSS nearest section and midsection lines
  - FEMA effective and preliminary floodplain, plus elevation certificates

  It computes lot area, draws the parcel on aerial imagery, and fills the standard parcel-report template (copy, download as .md, **Save PDF**, print, or save to the repo). **Save PDF** downloads a letter-size `Parcel-<APN>-report.pdf` with working links, a running header and page numbers. Printing always comes out in light colors, even when the screen is in dark mode, and puts snapshots of the aerial and parcel-boundary maps (refit to the parcel) right under the **Parcel <APN>** heading. Use the **Print** button for the best map snapshot: it waits for the map tiles to load first. On-demand add-ons: Road Information Tool, TSP2040 corridor projects, and the EDMS septic search (relay needed).
- **Plan review.** Pick the submittal type (residential, commercial, lot split, preliminary plat, final plat). Enter the plan's dimensions to auto-check setbacks, height, front-garage plane, lot coverage (DD-2021-01 method) and accessory rules. Work the county intake checklist. The app outputs a markup table with a hyperlinked citation and a required correction on every row.
- **Three plan reviews (Plan Review Hub tab).** Drop the site plan PDF, then pick:
  - **Superficial Review** — free and instant, in this browser (reads the PDF's own text; CAD/Word exports, not scans). Details below.
  - **Rapid Review** — Claude reads every sheet now (about a minute) through the relay's Anthropic API key (billed per plan).
  - **Queued Review** — no API cost: the plan is stored in the **private repo `randalkidd/MC-queue`** and Claude reads it on LONDON at **12:15 AM Sunday–Thursday** (scheduled task "Plan review queue", routine [`tools/process-plan-review-queue.md`](tools/process-plan-review-queue.md)). Results are listed in the **Plan Queue** box to the right of the reader (same height as the reader; ▾ on either header collapses both) (Refresh → **Load results**), which fills the page, runs the Assessor/deed checks and opens the Plan Viewer. ✕ deletes a plan and its data immediately.
  - **Review Verification** — the box above Plan Queue. **Start Verification** (or **Flagged only**) opens a window that steps through the review one item at a time: every checklist item for the submittal type (with what the plan reader found beside it), each measured standard (setbacks, height, coverage, lot area — the measured value can be corrected right there and the result recomputes), each plan-vs-record mismatch or other finding, and each value the reader marked hard to read. Keys 1–4 pick a status, ← → move; **🔍 Show on plan** opens the Plan Viewer on that item's box. Every decision goes straight into the Checklist and the Markup Table (and so the comment letter); progress is kept, so **Resume Verification** picks up where you stopped. A new plan read starts a fresh verification.
  - **Private data and retention.** The queue and the data read from every plan (all three reviews) live only in `MC-queue`, reached through the relay (`/q/*`, passphrase required) — so only a connected browser and the LONDON routine can use them. Plans are kept **14 days**, plan data **45 days**: the repo's daily *Retention* Action deletes expired files and squashes its history, the routine also purges before each run, and this browser drops its local copy of a plan after 14 days and of plan data after 45. **Save to GitHub** in the public repo no longer includes the data read from the plan. Setup: the relay's `GITHUB_TOKEN` must include `MC-queue` (Contents: Read and write); relay **v15**; optional Text variable `QUEUE_REPO`.
- **Read a site plan PDF — free first.** Drop the applicant's site plan PDF at the top of the Plan review tab and click **Read plan (free)**. The free reader (`js/freeread.js`) runs entirely in the browser with pdf.js: nothing is uploaded and there is no cost. It reads the PDF's own text (plans exported from CAD/Word/Excel; not scans or hand drawings) and fills what it can find from labels, whether the value is on the same line ("LOT SIZE: 47,874 SQFT"), to the right, or on the line below a title-block label ("OWNER:" / "MARK WEIDHAAS"); "lot size" and "lot area" are treated the same, and "RURAL (R-43)" reads as RU-43. It also picks up the lot-split survey/plat book and page from the legal description and compares it with the Assessor's MCR. Fields: APN, owner, site address, lot area, zoning, legal description/subdivision/lot, scale (and whether it's standard), north arrow/vicinity map labels, water source, septic/sewer, the area table (each structure's sq ft, new/existing, detached or attached), coverage %, setbacks (from labels like "FRONT SETBACK 22'", or else from the dimension text drawn around the residence: the farthest dimension on each side, with front = the side toward the driveway/access easement/street) and height, easements, ROW, wells, and "future"/"not for construction" notes. It marks checklist items OK or Verify (Deficient only when something wrong is actually shown, e.g. a non-standard scale or a "future" note), keeps anything you already entered, and records exact text positions for the plan viewer. The record checks (APN, owner vs deed, address, lot area, zoning, subdivision/lot) run the same way.
  - **When it can't read the plan** (a scan with no text, or fewer than 4 of: APN, owner, address, lot area, scale, area table, setbacks), the page says what it couldn't find and offers **Read with Claude**. After a good free read a smaller **Not right? Read with Claude** button stays available. Setback dimensions are usually drawn graphically, so the free reader often won't find them; measure them on the plan or use Claude.
- **Read with Claude.** Click **Read with Claude** (offered after a free read). Claude reads every sheet and fills the page: plan title/revision, residence setbacks, height and garage plane, every structure (new and existing) with square footage, cover type and setbacks (lot coverage is then computed per DD-2021-01), and a status, note and correction for every checklist item of the chosen submittal type. Anything else a reviewer would red-line (structures in easements, "future" notes, missing dimensions) is added to the markup table. The plan's **APN, owner name, site address, lot area, zoning and subdivision/lot** are then checked against the Assessor record (the parcel is looked up automatically if needed) and the **grantee names on the recorded deed** from the County Recorder; mismatches become markup rows. Values Claude found hard to read are listed for verification, and the markup notes that the plan was AI-read. **Always verify each value against the plan.**
  - **Plan viewer.** After a read, **🔍 Open plan viewer** shows the PDF full-screen with every issue boxed and numbered on the plan (red = deficient, orange = verify) and a list beside it grouped as plan vs. records, setbacks/height/coverage, checklist, other findings and hard-to-read values. Click an item to jump to its page, zoom in and center its box with a ripple around it; click a box on the plan to bring its comment up in the list. Scrolling past the bottom of a sheet goes to the next sheet (past the top, the previous one); Ctrl/⌘ + scroll zooms. The page behind the viewer stops scrolling while the viewer is open. **Show values read** adds a blue box for every value Claude took from the plan (APN, owner, each setback dimension, each structure's area) so you can check them one by one. Boxes are Claude's estimate of the location. For PDFs exported from CAD (with real text), the viewer also finds values such as the APN, owner, address, lot area, setback dimensions and structure areas by matching the plan's own text, which gives exact positions; a note at the top of the viewer says how many locations came from Claude and how many from text matching, and warns when a plan was read by a relay too old to return locations. The last PDF is kept in this browser (IndexedDB) so the viewer still opens after a reload. Uses pdf.js 3.2.146, vendored in `js/vendor/` (Apache-2.0) and loaded only when the viewer opens, with script evaluation disabled.
  - Setup (once): create an API key at console.anthropic.com and add it to the relay as a **Secret** named `ANTHROPIC_API_KEY` (Cloudflare → mc-relay → Settings → Variables and Secrets), then deploy relay **v20**. **Test GitHub** in Settings reports whether site-plan reading is on. Optional Text variable `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).
  - How it works: the browser posts the PDF to the relay (`POST /ai/siteplan`, passphrase required, site origin only). The relay uploads it to Anthropic's Files API, asks Claude with a fixed prompt and output schema kept in the relay (the page can't change them), and deletes the file right after. Usage is billed to that API key; the page shows the tokens used per read.
- **Comment letter (PDF).** In the Plan review markup card, **Comment letter (PDF)** builds the reviewer's *Zoning Plan Review Comments* letter from the 2026 BB Batch Summary template (`assets/templates/zoning-plan-review-comments-template.pdf`): Maricopa County P&D letterhead, the reviewer box (name and email from the Reviewer / Reviewer email fields, remembered in this browser), the NOTICE with the resubmittal guide link, a project block (APN, site address, owner, permit/case #, submittal type, plan reviewed, zoning district, review date), then **only the items that do not meet requirements** (Deficient, or Missing on the checklist), grouped (ownership & parcel information, submittal completeness, zoning standards, other comments) and numbered, each with sheet/location, what the plan shows, the requirement with its citation link, and the correction. Items marked OK or Verify are left out. Every page carries the standard footer links. Saved as `<APN> - Zoning Plan Review Comments - <date>.pdf`.
- **Checklist cells.** "Plan shows" and "Required correction" show three lines of smaller text and grow to fit while you edit; the full text is in the tooltip. Claude keeps these to about 12 and 20 words (relay v14).
- **Land division classifier.** Subdivision, minor land division, replat or exempt, per MCSR §105/§204 and DD-2013-10.
- **Subdivision plat database.** `data/subdivision-plats.json`. Search, add and edit it, then save from the site; each save is a commit to this repo. Lookups inside a listed subdivision show its recorded setbacks and flag cases dated after the plat.
- **All Subdivisions** (in the SubdivisionDB tab, below the database table). Every recorded subdivision in the county, about 32,000 from county GIS, cities included. Search by name or MCR, filter by status (in SubdivisionDB, on the Plat Automation Waitlist, not reviewed yet), sort by name or MCR, and export to CSV. Each row links to its plat, and unreviewed subdivisions have an **Add to waitlist** button. Clicking a **⏳ Waitlist** label takes that subdivision off the waitlist again. Quick successive changes are saved together in one commit. The list comes from `data/all-subdivisions.json`, a snapshot that the **Refresh All Subdivisions** GitHub Action (`.github/workflows/refresh-subdivisions.yml`) rebuilds from county GIS on the **1st of every month**. It commits only when something changed and refuses to save a partial download. To refresh now: GitHub → Actions → Refresh All Subdivisions → **Run workflow**. **Refresh from county GIS** on the page loads live data into that browser (cached for a day).
- **SubdivisionDB tab layout.** The SubdivisionDB table is on top (search box above it; 5 rows visible, the rest scroll). Below it: **All Subdivisions** (collapsed by default — ▸ opens it and loads the countywide list), then the land-division tools (the collapsible lawful-split check, with the land-division classification shown under its search box, and the classifier form), then the **Plat Automation Waitlist** (visible to administrators only).
- **Plat Automation Waitlist.** When a lookup lands in a subdivision that isn't in SubdivisionDB, nothing opens automatically. The subdivision is added to the Plat Automation Waitlist (`data/subdivision-queue.json`) at the top of the SubdivisionDB tab, with its plat recording number (found by name at the County Recorder), lot count, zoning and the APNs that found it.
  - **✦ Process with Claude** opens Claude with the request prefilled (it's also copied to the clipboard). Claude follows [`tools/process-subdivision-queue.md`](tools/process-subdivision-queue.md): it reads each plat in the Claude desktop app's browser, adds the full record to SubdivisionDB, removes the subdivision from the list, and commits.
  - Plats Claude can't read stay on the list marked ⚠ needs-manual. Use ✕ to drop an item yourself.
- **Reference.** MCZO §502/504/506 tables, accessory rules, the MCSR quick reference, all 88 P&D directives, and county tool links, plus:
  - **County codes, ordinances & regulations**: every document on the county's [Ordinances, Regulations and Codes](https://www.maricopa.gov/2271/Ordinances-Regulations-and-Codes) page with its edition, whether it's current or superseded, and links.
  - **Regulation lookup**: one searchable table (about 200 rules) covering the MCSR, Local Additions & Addenda (building-code amendments and fees), Abatement P-11, Hours of Construction P-22, Noise P-23, Military Airport Zoning P-16, the Addressing Regulations and the 36 Staff Interpretations. Each row links to its source PDF.

## Access

Anyone can use **Parcel lookup**, **Reference** and **⚙ Settings**. **Plan review, Land division, SubdivisionDB and Saved Parcels** appear only in a browser that has the relay URL and passphrase saved **and** has passed **Test GitHub** (write access through the relay). Each later visit opens at once from that saved record. The site then re-checks quietly in the background and locks the tools again if the passphrase is rejected or changed in Cloudflare. **Forget on this browser** locks them too.

This only hides the staff tools from casual visitors. The repo, its code and its `data/` files stay public. What's actually protected is **saving**, because the relay only commits with the correct passphrase. While locked, parcel lookups don't add anything to the subdivision Plat Automation Waitlist.

## Publish on GitHub Pages (about 5 minutes)

1. (Done for `randalkidd/mc`.) Create a repository, e.g. `mc-zoning`. It must be **public** for free GitHub Pages; Pages on a private repo needs a paid plan.
2. Upload the *contents* of this folder (`index.html`, `css/`, `js/`, `data/`, `worker/`, `.nojekyll`) to the repo root.
3. Repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root → Save.**
4. The site appears at `https://<you>.github.io/mc-zoning/` within a minute or two.

> Because the repo is public, everything saved to it (the subdivision database, parcel reports, reviews) is public too. Assessor and recorded-plat data is already public record. Don't save anything you wouldn't post.

## Easiest setup for several browsers (work + home)

Store the GitHub token **once** in the Cloudflare relay; each browser then only needs a short passphrase.

1. Paste the latest `worker/cors-proxy.js` into your Cloudflare Worker → **Deploy**.
2. Worker → **Settings → Variables and Secrets → Add**, Type **Secret**:
   - `GITHUB_TOKEN` = your `github_pat_…` token (repo `randalkidd/MC`, Contents: Read and write)
   - `SITE_KEY` = a passphrase you choose
3. In the **first** browser: site **⚙ Settings** → Relay URL + Passphrase → **Save settings** → **Test GitHub**. On success the relay address is saved to `data/site-config.json` (address only, never the passphrase or token).
4. In every **other** browser: just type the passphrase → **Save settings**. The relay address fills in automatically.

The relay commits only files under `data/`, only for requests carrying the passphrase. When the token expires, replace `GITHUB_TOKEN` in Cloudflare — no browser needs touching.

## Alternative: token in each browser

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories → `mc-zoning`**. Permissions: **Contents → Read and write**. Set an expiration.
3. Open the site → **Settings** → enter owner, repo, branch (`main`) and the token → **Save settings** → **Test GitHub**.

The token is kept only in that browser's local storage. Repeat this on each device you use, and use **Forget token** on a shared computer.

Saves go to:
- `data/subdivision-plats.json`, the plat database (public repo)
- **Saved Items are private and per user:** parcel reports (**Save to Saved Items** on a lookup) and plan reviews (**Save to Saved Items** in the Plan Review Hub) go to `users/<your key>/parcels/` and `users/<your key>/reviews/` in the private repo `MC-queue` (relay v18, `/u/*`). The folder comes from the passphrase/key you signed in with, so nobody else can list or open them; the **Saved Items** tab shows only yours (Open → view, Download, Delete).

## Optional relay (septic search, Recorder)

County GIS answers the site directly. `edms.maricopa.gov` (septic) and the Recorder refuse cross-site requests from a browser page. A browser embedded inside the page can't get around that either: those sites block framing. The fix is a tiny relay:

1. Create a free Cloudflare account → **Workers & Pages → Create → Worker** → replace the code with `worker/cors-proxy.js` → **Deploy**.
2. In the worker code, set `ALLOWED_ORIGIN` to `https://<you>.github.io` and redeploy.
3. Paste the worker URL (`https://<name>.<you>.workers.dev`) into the site's **Settings → Relay URL**.

The relay only forwards to an allow-list of `*.maricopa.gov` hosts, and (from relay v7) only for requests coming from the site itself, so it can't be used as an open proxy by scripts or other websites. If county GIS ever starts blocking cross-site requests, tick **"Send all county requests through the relay"**.

## Patent Easement Abandonment Tracker

Every parcel lookup checks MCDOT's [Patent Easement Abandonment Tracker](https://www.maricopa.gov/DocumentCenter/View/111506/Patent-Easement-Abandonment-Tracking-PDF) and says in the **Easements** section whether the parcel is listed:

- **Listed** — each case (PAB number) is added to the easement table: *abandoned* (Board approved, with a link to the recorded resolution), *in progress* (Initial Determination, Application or Board of Supervisors phase — not abandoned yet), or *lapsed / withdrawn* (not abandoned). When PlanNet also shows a patent easement and an abandonment is recorded, the warning says to open the resolution before applying the setback.
- **Same parent** — another split of the same book-map-item is listed (the abandonment may predate a lot split); confirm whether it covers this lot.
- **Not listed** — no abandonment has been applied for on this APN.

The site reads a snapshot, `data/patent-abandonments.json`, made from the PDF by `tools/refresh_patent_abandonments.py` in the GitHub Action **Refresh Patent Easement Abandonments** (Mondays, or "Run workflow" on the Actions tab). The downloaded PDF and its text are kept in `data/source/`. Multi-parcel cells ("216-50-159C, 159D", "202-13-007E, F, G", "formerly …") are expanded to every APN. The tracker is also linked under Reference → County Tools.

## Sources and limits
- MCZO: Dec 10, 2025 edition (effective 1/9/2026). Use DD-3014-01 to decide which edition governs an application.
- MCSR: the **January 9, 2026** revision (10/23/2024 amendment plus updated MCZO references). The 2016 text and its Administrative Guidelines are retired; current submittal details live in the county application packets.
- GIS layer IDs follow the county's current PlanNet service. If the county republishes it and results look wrong, re-check the layer IDs in `js/lookup.js`.
- This is a review aid. Verify findings against the adopted ordinance, recorded documents and case files.

## Behind the Curtains (game center)

A tab visible to everyone. **MCTrained** (top left): 10-question multiple-choice rounds — MCZO standards, Local Additions & Addenda, department directives, quick plan-review scenarios, or mixed. Questions are generated from the site's own tables (`js/standards.js`, `js/refdata.js`), so the answer key always matches the data the site uses; the ordinance text controls. 10 points per correct answer, +20 for a perfect round. **Trivia & More** (bottom left) is reserved for future games. **Leaderboard** (right): top 20 players by total points, readable without a key.

Playing needs a key. Scores live in `games/scores.json` in the private repo; the relay (v20, `/g/board`, `/g/start`, `/g/finish`) issues a signed single-use token per round, caps a round at 10 questions, rejects reused/expired tokens and doesn't count rounds answered faster than ~2.5 s per question. (Answers are checked in the browser, so this deters casual cheating rather than preventing it.)

## Accent color

Teal is the default accent. The original Sunrise Orange is saved as a preset: the **●** button next to the light/dark switch (top right) toggles Teal ↔ Orange, and each browser remembers the choice. Printed/PDF reports and the parcel outline on the map follow the chosen accent.

## Sign In and Profile

- **Sign In** (shown only while not connected): name, passphrase (or the access key you were given), **Save**, then **Test GitHub**. On success it says which account type you have (Super Account, Administrator, Senior Reviewer, Reviewer, Read-Only or custom) and its privileges.
- **Profile** — click **Connected** (top right; its tooltip shows "*Name* - Profile Page"): change your own name, see your account type and how much data you have, **Sign out (forget key on this browser)** — which also removes the last plan and plan data kept in this browser — and **Clear all my data**, which deletes only your Saved Items and the plans (and plan data) you submitted to the Plan Queue (typed DELETE confirmation; cannot be undone).
- **⚙ Settings** (relay URL, county relay test, GitHub owner/repo, Access Keys, **User Folders**) is shown only to administrators. **User Folders**: pick any user to open, download or remove their Saved Items and the plans they submitted.
- Queue items and plan data record who submitted them (`by`, set by the relay), which is how Clear all my data and User Folders find them.

## Access keys (super account + limited keys)

- **Super account:** the relay passphrase (`SITE_KEY` in Cloudflare). It has every permission and manages the other keys. Rotate it by changing `SITE_KEY` in Cloudflare.
- **Names:** administrators can **Edit name** for any user, including the super account, in ⚙ Settings → Access keys. That name is used for the user's badge, reviewer name and comment letters at their next page load.
- **More keys with less access:** ⚙ Settings → **Access keys** (shown only to admins). Pick who it's for, a role and an optional expiry; the key is shown once — the person opens **Sign in**, enters their name and pastes the key as the **Passphrase**, Save, then Test GitHub. **Revoke** removes it (effective within a minute).
- **Permissions:** `review` (Plan Review Hub, Land division, Saved Parcels), `write` (save to the public repo: SubdivisionDB, waitlist, parcel reports, reviews), `queue` (Queued Review / MC-queue), `rapid` (Rapid Review — uses the Anthropic API key), `admin` (manage keys). Roles: Read-only = review · Reviewer = review, write, queue · Senior reviewer = + rapid · Administrator = all.
- **Enforced by the relay (v16+)** on every request; after 10 wrong passphrases in 10 minutes from one network the relay answers 429 for the rest of that window (v17); the site also hides tools the key can't use. Keys are stored only as SHA-256 hashes in the private repo (`MC-queue/access/keys.json`). Parcel lookup and the Reference tab stay open to everyone.

## Secrets and .env files

The website is public static files, so **no secret can live in anything the browser loads** (a `.env` file served by GitHub Pages would be readable by anyone). Secrets live in exactly two places:

| Secret | Where it lives | Never in |
|---|---|---|
| `GITHUB_TOKEN` (fine-grained, Contents: Read and write on this repo) | Cloudflare → mc-relay → Settings → Variables and Secrets (**Type: Secret**) | the repo, chat, the browser |
| `ANTHROPIC_API_KEY` (optional; site-plan reading) | Same place in Cloudflare (Type: Secret) | the repo, the browser |
| `SITE_KEY` (the passphrase) | Same place in Cloudflare; each browser stores only a hash-checked copy you typed | the repo |

`.env` files are for **local tools only**, and are git-ignored:

- **`.env`** (copy `.env.example`): settings for the Python scripts in `tools/` (loaded by `tools/envfile.py`; real environment variables win).
- **`worker/.dev.vars`** (copy `worker/.dev.vars.example`): `GITHUB_TOKEN` and `SITE_KEY` for running the relay locally with `npx wrangler dev`. `worker/wrangler.toml` lets you deploy from the command line (`npx wrangler deploy`, secrets via `npx wrangler secret put …`) instead of pasting into the Cloudflare editor.
- **Relay settings as variables (relay v9):** `ALLOWED_ORIGIN` (comma-separate to add `http://localhost:8000` for testing), `REPO` and `BRANCH` can be set as plain-text Cloudflare variables instead of editing the code. Invalid values fall back to the defaults.

**Guard rails**

- `.gitignore` blocks `.env`, `.env.*`, `.dev.vars`, keys and certificates (the `*.example` files are allowed).
- `tools/check_secrets.py` scans for GitHub/Cloudflare/AWS/Slack/AI tokens, private keys and `TOKEN=`-style assignments, and fails if a real `.env`/`.dev.vars` is tracked.
- The **Secret scan** GitHub Action runs it on every push and pull request.
- Optional local hook, once per clone: `git config core.hooksPath tools/hooks` (blocks the commit before it happens).
- Also turn on GitHub's own **push protection**: repo Settings → Code security → Secret Protection → Push protection.
- If a token ever leaks, **revoke it first** (GitHub → Settings → Developer settings → Fine-grained tokens), then replace `GITHUB_TOKEN` in Cloudflare.

## Maintenance

- **After editing any JS/CSS, run `python3 tools/stamp.py` before committing.** It stamps every file reference with a content version (`?v=…`) so browsers load the new code immediately instead of a cached copy.
- **Security:** the page runs under a Content-Security-Policy that only allows its own scripts (including jsPDF 2.5.2, vendored in `js/vendor/` under its MIT license and loaded only when you click Save PDF), Leaflet from unpkg (pinned with Subresource Integrity), and network calls to county GIS, the County Recorder, EDMS, GitHub and `*.workers.dev`. If you add a new data source, add its host to the `connect-src` list in `index.html` (and to `ALLOWED_HOSTS` in the relay if it needs the relay).
- **Relay:** answers only requests from `https://randalkidd.github.io`, forwards only to allow-listed county hosts, and saves only under `data/`. After changing `worker/cors-proxy.js`, paste it into Cloudflare (Settings → Copy relay code) and Deploy.

The footer shows **Version MM.DD.YY.NNN**: the Arizona date of the last code change, plus that day's build count. `tools/stamp.py` sets it, together with the `?v=` cache-busting stamps, so run it before every commit. If the footer still shows the old number after a deploy, press Ctrl+Shift+R.

The Reference tab's document index and Regulation lookup come from the project's reference docs (`county-ordinances-regulations.md`, `local-additions-addenda.md`, `staff-interpretations.md`, and the MCSR `README.md`). After editing those docs, rebuild with `python3 tools/build_reglookup.py <folder with the docs>`, then run `tools/stamp.py`.
