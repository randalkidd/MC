# Routine: process the SubdivisionDB review list

This is the routine for Claude. Run it when the user clicks **Process with Claude** on the SubdivisionDB tab of https://randalkidd.github.io/MC/, or asks for the review list to be processed.

Each subdivision on the review list was found by a parcel lookup and isn't in SubdivisionDB yet. For each one, read its recorded plat, add a full record to SubdivisionDB, and remove it from the review list.

## What the session needs
- **On the queue server** (`server/`, run by `server/run-queue.sh`): follow `server/SERVER-NOTES.md`, which replaces the browser and repo-attach steps below.
- **Push access to `randalkidd/MC`** (branch `main`). In a cloud session, attach the repo first.
- **The built-in browser in the Claude desktop app on the user's computer.** The County Recorder and county GIS refuse requests from the cloud sandbox, so do every Recorder and GIS step in that browser, not with the shell or WebFetch. If the browser can't be reached, stop and tell the user. Change nothing.
- Data is public record, and the repo is public. Never commit tokens or passphrases.

## Files
- `data/subdivision-queue.json`: `{ schema, updated, items: [ { name, displayName, mcr, rec, recorded, totalLots, baseZoning, controllingCases, apns, firstSeen, lastSeen, status, note? } ] }`
  - `name` is the exact Assessor SubdivisionName (upper case).
  - `rec` and `recorded` may be blank if the site couldn't find the plat.
- `data/subdivision-plats.json`: `{ schema, updated, subdivisions: [ record, … ] }`, which is SubdivisionDB.

## Steps for each item
1. **Find the plat.**
   - If `rec` is blank, run a search from a `https://recorder.maricopa.gov/` page in the built-in browser (`javascript_tool`): `fetch('https://publicapi.recorder.maricopa.gov/documents/search?businessNames=' + encodeURIComponent(NAME)).then(r => r.json())`.
   - From `searchResults`, take the row whose `documentCode` contains `PLAT` and whose `docketBook`/`pageMap` equal the item's `mcr` book and page. Ignore leading zeros. If the full name finds nothing, retry without a trailing "UNIT/PHASE/PARCEL …".
2. **Open the plat.**
   - Open `https://recorder.maricopa.gov/recording/document-details.html?recordingNumber=REC&suffix=`.
   - Get a signed PDF link from that page: `fetch('https://publicapi.recorder.maricopa.gov/preview/pdf-link?recordingNumber=REC&suffix=&affidavit=false').then(r => r.json())`. It returns `{url}`, valid for about 2 minutes.
   - Navigate a tab to `url`. It redirects to `legacy.recorder.maricopa.gov/PlatPdf/…`.
   - If that file returns 404, use the page's **PNG - Page by Page** link instead.
   - Plats are scanned images with no text layer. Read them visually: take screenshots and use `zoom` on the notes, the setback table/chart, the title block, the dedication and the legend.
3. **Read the plat.** Record exactly what it says, with sheet numbers:
   - Building setback lines or setback table: front, rear, side, street-side. Capture each lot range / zoning district separately.
   - Height limits and stories, lot coverage, minimum lot width.
   - Zoning shown and case numbers cited (Z…, DMP…, CPA…).
   - Easements: public utility (PUE), drainage, vehicular non-access (VNAE), access, irrigation, wall/landscape, sight visibility. Include their widths and locations.
   - Tracts and their uses. Restrictive notes (one-story lots, Luke AFB / airport notices, subsidence, floodplain).
   - If the plat shows **no** setbacks, say so. MCZO then governs.
4. **Write the SubdivisionDB record.** Insert or replace by name, case-insensitive. Use the shape of the existing `Savannah` record:
   - `name`: the item's `displayName`, a title-cased Assessor name. It must match SubdivisionName case-insensitively.
   - `mcr`, `docType` (`PLAT MAP`), `rec`, `recorded` (YYYY-MM-DD), `totalLots` (from the item), `baseZoning`, `controllingCases`.
   - `setbacks`: summary text. One lot range: `"20 ft / 25 ft / 7 ft / 10 ft (Front / Rear / Side / Street-side)"`. Several: `"Lots 1–268 (R1-10): 20 ft / 25 ft / 7 ft / 10 ft. Lots 269–319 (R1-18): …"`. No setbacks: `"None on plat — MCZO governs"`.
   - `setbackTable`: one row per lot range, `{ lots, district, front, rear, side, street, height, coverage, coverageNow: "", coverageBy: "", width, other }`. Numbers are feet; `lots` is `"All"` when there's a single standard. Use `[]` when the plat has none.
   - `height`, `easements` (semicolon-separated, with widths).
   - `notes`: start with `Read by Claude from plat sheets N–M on YYYY-MM-DD.`, then anything to verify. Prefix a line with `⚠` when a newer zoning case (in `controllingCases`, dated after `recorded`) may change the plat standards. The site shows `⚠` lines as warnings.
   - `parcelsChecked`: the item's `apns`.
   - `platUrl`: `https://recorder.maricopa.gov/recording/document-details.html?recordingNumber=REC&suffix=`.
   - `platControls: false`. The user confirms this flag after review.
   - `autoAdded: false`, `lastUpdated`: today.
5. **Clear the item.**
   - On success, remove it from `subdivision-queue.json`.
   - If the plat can't be found or read, leave it on the list with `status: "needs-manual"` and a short `note` saying why. The site shows these with a ⚠.

## Finish
- Set `updated` (ISO timestamp) in both files. Keep 2-space JSON indentation and a trailing newline.
- Commit both files to `main` in one commit: `SubdivisionDB: add <names> from plats (Claude); review list cleared`. Push.
- Report to the user: each subdivision added (setbacks found, or none), each one left as needs-manual and why, and anything flagged ⚠. The site picks up the changes within about a minute; click **Reload** on the SubdivisionDB tab.
