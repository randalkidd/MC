# Queue server notes (for Claude)

These notes apply when a queue routine runs on the queue server (`server/run-queue.sh`), not on the user's computer. They replace any routine step that says to use the built-in browser in the Claude desktop app, or to attach or clone a repo.

## General
- Both repos are already cloned and pulled: `~/MC` (public) and `~/MC-queue` (private). Commit and push with plain `git`. If a push is rejected, `git pull --rebase` and push again.
- No one is watching. Do not ask questions; when something can't be done, record it the way the routine says (`needs-manual` / `failed` with a note) and move on.
- Keep scratch files in `/tmp/mcq/` (create it). Never put plan data anywhere in `~/MC`.

## County Recorder (SubdivisionDB routine)
The server reaches the Recorder directly — use `curl` from the shell instead of the browser. Send headers that look like the Recorder's own website:

```
H=(-H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' -H 'Accept: application/json, text/plain, */*' -H 'Origin: https://recorder.maricopa.gov' -H 'Referer: https://recorder.maricopa.gov/')
curl -s "${H[@]}" "https://publicapi.recorder.maricopa.gov/documents/search?businessNames=<urlencoded NAME>"
curl -s "${H[@]}" "https://publicapi.recorder.maricopa.gov/preview/pdf-link?recordingNumber=REC&suffix=&affidavit=false"   # → {"url": …}, valid ~2 min
curl -sL "${H[@]}" -o /tmp/mcq/REC.pdf "<that url>"
```

Read the plat:
- `pdfinfo /tmp/mcq/REC.pdf` for the page count.
- Render pages: `pdftoppm -r 150 -png /tmp/mcq/REC.pdf /tmp/mcq/REC` and Read each PNG.
- Zoom on notes, setback charts, title blocks and legends by rendering a crop at higher resolution: `pdftoppm -r 300 -f N -l N -x X -y Y -W W -H H -png /tmp/mcq/REC.pdf /tmp/mcq/REC-zoom` (pixel box at 300 dpi).
- If the PDF link fails (404 / HTML instead of a PDF), try the Playwright browser tools (`mcp__playwright__*`) on the document-details page, and use its **PNG - Page by Page** link. If that fails too, mark the item `needs-manual` with the reason.
- Delete `/tmp/mcq/*` at the end.

## County GIS
If a routine needs county GIS, query `https://gis.maricopa.gov/arcgis/rest/services/...` with `curl` (form POST to `/query`). If it refuses the server, use the Playwright browser tools.

## Plan review routine
The plan PDF is in `~/MC-queue/queue/<id>.pdf`. Read it with the Read tool (pages in chunks of up to 20); for close-ups, render a crop with `pdftoppm` as above.
