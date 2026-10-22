# MC Zoning Review

Live at **https://randalkidd.github.io/mc/** · the original single-page Parcel Lookup is at [`/parcel-lookup/`](parcel-lookup/).

A static web app for zoning and subdivision review in unincorporated Maricopa County. It runs entirely in the browser (phone, tablet or any computer) and talks to the county's public GIS services directly. It needs no server and no browser extension.

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
- **Reference.** MCZO §502/504/506 tables, accessory rules, the MCSR quick reference, all 88 P&D directives, and county tool links.

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
3. In each browser: site **⚙ Settings** → Relay URL + Passphrase → **Save settings** → **Test GitHub**.

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

The relay only forwards to an allow-list of `*.maricopa.gov` hosts. If county GIS ever starts blocking cross-site requests, tick **"Send all county requests through the relay"**.

## Sources and limits
- MCZO: Dec 10, 2025 edition (effective 1/9/2026). Use DD-3014-01 to decide which edition governs an application.
- MCSR: the built-in references use the **2016** text. The **10/23/2024** amendment supersedes parts of it, so verify MCSR citations before issuing comments.
- GIS layer IDs follow the county's current PlanNet service. If the county republishes it and results look wrong, re-check the layer IDs in `js/lookup.js`.
- This is a review aid. Verify findings against the adopted ordinance, recorded documents and case files.
