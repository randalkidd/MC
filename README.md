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

  It computes lot area, draws the parcel on aerial imagery, and fills the standard parcel-report template (copy, download, or save to the repo). On-demand add-ons: Road Information Tool, TSP2040 corridor projects, and the EDMS septic search (relay needed).
- **Plan review.** Pick the submittal type (residential, commercial, lot split, preliminary plat, final plat). Enter the plan's dimensions to auto-check setbacks, height, front-garage plane, lot coverage (DD-2021-01 method) and accessory rules. Work the county intake checklist. The app outputs a markup table with a hyperlinked citation and a required correction on every row.
- **Land division classifier.** Subdivision, minor land division, replat or exempt, per MCSR §105/§204 and DD-2013-10.
- **Subdivision plat database.** `data/subdivision-plats.json`. Search, add and edit it, then save from the site; each save is a commit to this repo. Lookups inside a listed subdivision show its recorded setbacks and flag cases dated after the plat.
- **All Subdivisions** (staff tab). Every recorded subdivision in the county, about 32,000 from county GIS, cities included. Search by name or MCR, filter by status (in SubdivisionDB, on the review list, not reviewed yet), sort by name or MCR, and export to CSV. Each row links to its plat, and unreviewed subdivisions have an **Add to review list** button. The list comes from `data/all-subdivisions.json`, a snapshot that the **Refresh All Subdivisions** GitHub Action (`.github/workflows/refresh-subdivisions.yml`) rebuilds from county GIS on the **1st of every month**. It commits only when something changed and refuses to save a partial download. To refresh now: GitHub → Actions → Refresh All Subdivisions → **Run workflow**. **Refresh from county GIS** on the page loads live data into that browser (cached for a day).
- **Subdivision review list.** When a lookup lands in a subdivision that isn't in SubdivisionDB, nothing opens automatically. The subdivision is added to the review list (`data/subdivision-queue.json`) at the top of the SubdivisionDB tab, with its plat recording number (found by name at the County Recorder), lot count, zoning and the APNs that found it.
  - **✦ Process with Claude** opens Claude with the request prefilled (it's also copied to the clipboard). Claude follows [`tools/process-subdivision-queue.md`](tools/process-subdivision-queue.md): it reads each plat in the Claude desktop app's browser, adds the full record to SubdivisionDB, removes the subdivision from the list, and commits.
  - Plats Claude can't read stay on the list marked ⚠ needs-manual. Use ✕ to drop an item yourself.
- **Reference.** MCZO §502/504/506 tables, accessory rules, the MCSR quick reference, all 88 P&D directives, and county tool links, plus:
  - **County codes, ordinances & regulations**: every document on the county's [Ordinances, Regulations and Codes](https://www.maricopa.gov/2271/Ordinances-Regulations-and-Codes) page with its edition, whether it's current or superseded, and links.
  - **Regulation lookup**: one searchable table (about 200 rules) covering the MCSR, Local Additions & Addenda (building-code amendments and fees), Abatement P-11, Hours of Construction P-22, Noise P-23, Military Airport Zoning P-16, the Addressing Regulations and the 36 Staff Interpretations. Each row links to its source PDF.

## Access

Anyone can use **Parcel lookup**, **Reference** and **⚙ Settings**. **Plan review, Land division, SubdivisionDB, All Subdivisions and Saved Parcels** appear only in a browser that has the relay URL and passphrase saved **and** has passed **Test GitHub** (write access through the relay). Each later visit opens at once from that saved record. The site then re-checks quietly in the background and locks the tools again if the passphrase is rejected or changed in Cloudflare. **Forget on this browser** locks them too.

This only hides the staff tools from casual visitors. The repo, its code and its `data/` files stay public. What's actually protected is **saving**, because the relay only commits with the correct passphrase. While locked, parcel lookups don't add anything to the subdivision review list.

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
- `data/subdivision-plats.json`, the plat database
- `data/parcels/<APN>.md`, parcel reports
- `data/reviews/<APN>-<date>-<type>.md` and `.json`, plan reviews

## Optional relay (septic search, Recorder)

County GIS answers the site directly. `edms.maricopa.gov` (septic) and the Recorder refuse cross-site requests from a browser page. A browser embedded inside the page can't get around that either: those sites block framing. The fix is a tiny relay:

1. Create a free Cloudflare account → **Workers & Pages → Create → Worker** → replace the code with `worker/cors-proxy.js` → **Deploy**.
2. In the worker code, set `ALLOWED_ORIGIN` to `https://<you>.github.io` and redeploy.
3. Paste the worker URL (`https://<name>.<you>.workers.dev`) into the site's **Settings → Relay URL**.

The relay only forwards to an allow-list of `*.maricopa.gov` hosts, and (from relay v7) only for requests coming from the site itself, so it can't be used as an open proxy by scripts or other websites. If county GIS ever starts blocking cross-site requests, tick **"Send all county requests through the relay"**.

## Sources and limits
- MCZO: Dec 10, 2025 edition (effective 1/9/2026). Use DD-3014-01 to decide which edition governs an application.
- MCSR: the **January 9, 2026** revision (10/23/2024 amendment plus updated MCZO references). The 2016 text and its Administrative Guidelines are retired; current submittal details live in the county application packets.
- GIS layer IDs follow the county's current PlanNet service. If the county republishes it and results look wrong, re-check the layer IDs in `js/lookup.js`.
- This is a review aid. Verify findings against the adopted ordinance, recorded documents and case files.

## Maintenance

- **After editing any JS/CSS, run `python3 tools/stamp.py` before committing.** It stamps every file reference with a content version (`?v=…`) so browsers load the new code immediately instead of a cached copy.
- **Security:** the page runs under a Content-Security-Policy that only allows its own scripts, Leaflet from cdnjs, and network calls to county GIS, the County Recorder, EDMS, GitHub and `*.workers.dev`. If you add a new data source, add its host to the `connect-src` list in `index.html` (and to `ALLOWED_HOSTS` in the relay if it needs the relay).
- **Relay:** answers only requests from `https://randalkidd.github.io`, forwards only to allow-listed county hosts, and saves only under `data/`. After changing `worker/cors-proxy.js`, paste it into Cloudflare (Settings → Copy relay code) and Deploy.

The footer shows **Version MM.DD.YY.NNN**: the Arizona date of the last code change, plus that day's build count. `tools/stamp.py` sets it, together with the `?v=` cache-busting stamps, so run it before every commit. If the footer still shows the old number after a deploy, press Ctrl+Shift+R.

The Reference tab's document index and Regulation lookup come from the project's reference docs (`county-ordinances-regulations.md`, `local-additions-addenda.md`, `staff-interpretations.md`, and the MCSR `README.md`). After editing those docs, rebuild with `python3 tools/build_reglookup.py <folder with the docs>`, then run `tools/stamp.py`.
