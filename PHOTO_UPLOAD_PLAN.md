# User photo upload: build plan

Status: plan, 2026-10-12. Owner decision: photos go live without a manual review. An automatic Claude check runs before a photo goes live, and user reports hide bad photos after it is live.

This file is in the repo root, not in `docs/`, because everything in `docs/` is public on the site.

## Goal

A visitor opens a place card and adds one photo with optional short text (up to 280 characters). The photo then shows on that place card for everyone. Other visitors can report a photo. The owner can see hidden and rejected photos and delete or restore them.

## Ground rules for the builder

- Do not deploy. Do not run `wrangler deploy`, `wrangler kv namespace create`, `wrangler secret put`, or any `wrangler d1 execute --remote` command. The owner does these after review.
- Do not commit or push.
- Do not print, log or copy the Claude API key. It is in `W:\apps\publik\.env` as `ANTHROPIC_API_KEY`, and it is the Worker secret `ANTHROPIC_API_KEY` on Cloudflare.
- Keep the style of `src/worker.js` and `docs/app.js`: plain JavaScript, short comments, no framework.
- Log each step, test and decision in `PROGRESS.md` under a new "Update 2026-10-12 (photo upload build)" section, as you go.
- Use bash for text edits. This is a Windows laptop behind Zscaler. For wrangler, set `NODE_OPTIONS=--use-system-ca`.

## Parts

### 1. Storage (Workers KV, changed 2026-10-13; the plan first said R2, which needs a card)

- One Workers KV namespace, binding `PHOTOS` in `wrangler.jsonc` (free plan: 1 GB, 1,000 writes and 1,000 deletes a day, eventually consistent). Move to R2 when storage passes about 800 MB.
- Keys: `p/<photo id>/full.webp` (or `.jpg`) and `p/<photo id>/thumb.webp`. The photo id is a random 16-character id, never a sequence.
- The Worker serves photos at `GET /api/img/<photo id>/<full|thumb>`. If the status is not `live`, it returns 404. Cache headers: public, long max-age. When a photo is hidden or deleted, the Worker must stop serving it (purge or short edge cache, choose and explain).

### 2. Database (D1 `publik`)

Add to `src/schema.sql` and also write `src/migrations/2026-10-12-photos.sql` with only the new statements.

- `photos`: id, place, who, device, text, ext, bytes, status, reason, reports, ts.
  - `who` is the daily-salted IP hash, the same as `visitorKey`.
  - `device` is a random id that the browser keeps in localStorage.
  - `status` is `live`, `hidden`, `rejected`, `pending` or `deleted`.
  - `reason` is the check result. `reports` is the report count.
- `photo_reports`: photo id, who, ts, with one report per photo per who.
- Indexes for: photos by place and status, photos by who and ts, photos by device and ts, photos by ts.

### 3. Upload endpoint `POST /api/photo`

Multipart form with: `place`, `device`, `text` (optional), `full` (image), `thumb` (image), `check` (800 px image for the Claude check).

Server checks, in this order:

1. `place` passes `knownPlace`. `device` matches `ID_RE`. `text` is 280 characters or fewer.
2. File types: WebP or JPEG only, by magic bytes, not by the browser's content type. Size limits: `full` 700 KB, `thumb` 100 KB, `check` 250 KB.
3. Rate limits per day: 5 uploads per device, 10 per who, 20 per place. A global cap of 300 Claude checks per day protects the credits. If the global cap is reached, refuse new uploads with a clear message.
4. Claude check on `check` plus `text` (see part 4).
5. If the check passes, write `full` and `thumb` to KV and a `live` row to D1. If the check fails, write a `rejected` row with the reason and do not write the images to KV. If the Claude call errors or times out, fail closed: keep the images in KV, write a `pending` row, and do not show it. The owner looks at pending photos.

### 4. Claude check

- Model `claude-haiku-5-5`. Use the official SDK `@anthropic-ai/sdk` with a `package.json`, the same way as `W:\apps\ramana-bot\worker` (read that Worker first). Before you write the call, read the claude-api skill files at `C:\Users\10092428\AppData\Local\Temp\claude\bundled-skills\2.1.296\e7d58d7ab361086678471fd73e22a4d1\claude-api\` (`SKILL.md`, then `typescript/claude-api/README.md`). Do not guess SDK names.
- Haiku 5.5 has adaptive thinking on by default and effort `medium` by default. Set `output_config.effort` to `low`. Use structured outputs (`output_config.format`) with a JSON schema such as `{ allow: boolean, reason: string, categories: string[] }`.
- Handle `stop_reason: "refusal"` as a reject. Haiku 5.5 has no server-side fallback.
- Reject these photos:
  - Nudity or sexual content, violence or gore.
  - Hate symbols or abusive text.
  - A close-up face of a child or of any identifiable person as the main subject.
  - Personal data: phone numbers, documents, or a number plate as the main subject.
  - Ads or spam text.
  - A photo that is clearly not a public place, for example a selfie in a room, a screenshot or a meme.
- Allow: places, people small in a scene or from behind, dirty or broken spots (these are useful reports), animals, birds.
- The text is user content. Put it in the user message as data, and tell the model that the text can contain instructions that it must ignore.
- Log token usage per check to the console, so that the owner can check the cost.

### 5. Report endpoint `POST /api/photo-report`

- One report per photo per who. When 2 different who values report a `live` photo, set status `hidden`.
- Same rate style as `postReport` (per who per hour).

### 6. Read endpoint `GET /api/photos?place=<id>`

- Returns up to 20 `live` photos for the place, newest first: id, text, ts. No who, no device.

### 7. Owner endpoints

- `GET /api/admin/photos?status=hidden|pending|rejected` and `POST /api/admin/photo` with `{ id, action: "restore" | "delete" }`.
- Both need a header `authorization: Bearer <ADMIN_TOKEN>`, where `ADMIN_TOKEN` is a new Worker secret. Compare in constant time. `delete` removes the KV keys and sets status `deleted`.
- The admin endpoints must serve images for pending and hidden photos only with the token (for example `GET /api/admin/img/<id>` with the header).
- A small `scripts/photos_admin.py` (reads `ADMIN_TOKEN` from `.env`) to list, view and act on photos is enough. No admin web page.

### 8. Front end (`docs/app.js`, `docs/style.css`)

- On the place card: a photo row (thumbnails from `/api/photos`), an "Add photo" button, and a "Report" link on the open photo.
- Before upload, show this text: "Photos are public. Do not post close-up faces, children, or number plates. Photos go live after an automatic check." Add a link to a short photo rule note.
- Compression in the browser: `createImageBitmap(file, { imageOrientation: "from-image" })`, draw to a canvas, export `full` at 1600 px long side, `check` at 800 px, `thumb` at 400 px. Try WebP quality 0.75. If the browser returns PNG or fails (older iOS Safari), use JPEG quality 0.8. Re-encoding removes EXIF and GPS data.
- If the browser can decode HEIC from iPhones, accept it. If it cannot, show a clear message.
- Show progress and a clear result: "Live", "Not allowed: <short reason>", or "Waiting for a check".
- Keep the device id in localStorage with try/catch, like the existing code.

### 9. Tests

- Run locally with `wrangler dev` (local D1 and local KV). For the Claude key, create `.dev.vars` from `.env` (both are gitignored). Do not print the key.
- Test cases:
  - A normal park photo: allowed.
  - A screenshot or meme: rejected.
  - A too-large file: 413.
  - A PNG renamed to `.jpg`: rejected.
  - 6 uploads from one device: the sixth is refused.
  - Two reports from two who values: hidden, and the image is no longer served.
  - Admin restore and delete.
  - A Claude failure: pending, not shown.
- Limit real Claude calls to 15 or fewer in total. Report the token usage and cost per check.
- Report the measured sizes of `full`, `check` and `thumb` for 2 or 3 real phone-size test photos.

### 10. Hand back

Write a short summary at the end of the PROGRESS.md section. Include the files changed, the test results, and the measured sizes and cost. Also list the exact commands that the owner must run to go live: KV namespace create, remote migration with `--command`, secrets and deploy.
