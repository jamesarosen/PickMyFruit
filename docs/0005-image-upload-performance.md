# Performance

Field notes from running this app on Fly.io. Most lessons here come from a multi-week saga of OOM kills during photo uploads. The fixes are scattered across the codebase; this is the map.

## Deployment shape

- **Fly.io** `shared-cpu-1x`, **512 MB** RAM, 1 CPU, single region (sjc).
- Embedded **SQLite** on a Fly volume — no external DB process.
- Photos stored in **Tigris** (S3-compatible) in two prefixes per object: `raw/` (private, full EXIF) and `pub/` (CDN-served, EXIF-stripped, auto-oriented).
- `docker-compose.yml` mirrors the production memory/CPU/env so OOMs reproduce locally on a Mac (caveat: Docker Desktop's Linux VM has a softer cgroup OOM than Fly's bare metal — bugs that manifest on Fly may take longer to surface locally).

Memory and env settings are duplicated in `fly.toml` and `docker-compose.yml` with cross-reference comments. **Keep them in sync.**

## The 512 MB budget

A single 12 MP iPhone JPEG drives RSS up by ~120 MB inside Sharp:

- **Decoded RGBA**: 4032 × 3024 × 4 bytes ≈ 48 MB.
- **libvips intermediate buffers** during rotation/JPEG re-encode: another ~50–70 MB.
- **Output JPEG**: ~1.5 MB encoded.

We started on 256 MB, fought it for two weeks, and finally bumped to 512 MB. The headroom is what made everything else stop being scary. **Don't drop it back below 512 MB without first profiling a real iPhone upload via the `photo.sharp_transform` Sentry span.**

Why 256 MB wasn't enough even with `sequentialRead: true`: libvips buffers internally to perform random-access ops like a 90° rotation regardless of input mode. `sequentialRead` is a small constant-factor savings on the input read; it does not change the rotation step's working-set requirement. The structural fix to push memory back down is **resize before encode** (see below) — that's what cuts the dominant decoded-RGBA cost in half or quarter, by exploiting libvips' JPEG shrink-on-load.

## Memory-pressure controls

These are in `fly.toml [env]` and mirrored in `docker-compose.yml`:

| Setting | Value | Why |
|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=384` | ~75% of VM | Forces V8 to GC before the OS OOM-kills. Without it, Node defaults to ~1.5 GB and grows past Fly's hard limit. |
| `SHARP_CONCURRENCY=1` | 1 | 1 CPU. Parallel libvips work just multiplexes onto one core and bloats RSS. |
| `MALLOC_ARENA_MAX=2` | 2 | glibc default is up to 8 arenas/CPU, each reserving ~64 MB. Native-binary workloads (libvips, AWS SDK threads) hold onto arena memory long after `free()`. Capping at 2 reliably drops 30–60 MB of RSS. |
| `UV_THREADPOOL_SIZE=2` | 2 | libuv default is 4 (fs / DNS / crypto / Sharp dispatch). On 1 shared CPU the extra threads are memory pressure with no parallelism gain. `=1` is too aggressive (TLS handshakes can stall behind fs). |

Plus, in code (`apps/www/src/lib/listing-photo-upload.server.ts`):

- **`sharp.cache(false)` at module load** — libvips' tile/operation cache fights V8 for RAM. Disable it.
- **`sequentialRead: true`** in the Sharp constructor — modest hint to libvips. We briefly removed it after seeing rotation drop on Linux uploads, but the regression was a stale Docker image; a `docker compose build --no-cache` followed by a fresh upload restored correct rotation. Real savings are small (low single-digit MB) because libvips still buffers internally for the rotation step itself.
- **Resize before encode** — the pub pipeline includes `.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })` after rotation. For JPEG inputs, libvips uses shrink-on-load to decode at 1/2, 1/4, or 1/8 — a 12 MP iPhone JPEG drops from ~48 MB decoded RGBA to ~12 MB. Listing photos don't need full sensor resolution; this is the dominant memory win in the pipeline.
- **In-process upload mutex** — wraps `uploadListingPhoto` so only one runs at a time across the process. Two simultaneous uploads would otherwise hold two staged temp files plus two libvips pixel sets.
- **`limitInputPixels: 16_000_000`** in the Sharp constructor — rejects images at the JPEG/PNG/WebP header before any pixel decode. Surfaced as `UserError('IMAGE_TOO_LARGE', …)`. 16 MP covers iPhone main camera and most Android flagships.

## The temp-file pipeline (issue #222)

The original upload route did:

```ts
const rawBuffer = Buffer.from(await file.arrayBuffer())
```

That holds the file three times simultaneously: the Web `File` object (in parsed FormData), the `ArrayBuffer` from `.arrayBuffer()`, and the `Buffer` copy. On a small VM that allocation alone can OOM the request.

Current pipeline (`apps/www/src/lib/listing-photo-upload.server.ts`, `apps/www/src/api/listing-photos.ts`):

1. **Stage to disk**: `pipeline(file.stream(), createWriteStream(tempPath))` — request body streams to a uniquely-named temp file (`os.tmpdir()/pmf-upload-<uuid>`). Body never sits in memory as a `Buffer`.
2. **Validate by prefix**: open the temp file, read first 4 KB, run magic-byte detection (`mime-bytes`). Reject HEIC/non-image with a helpful `UserError`.
3. **Two read streams**: one `createReadStream(tempPath)` → S3 `raw/`, another `createReadStream(tempPath).pipe(sharp(...).autoOrient().resize(...).jpeg())` → S3 `pub/`.
4. **`try/finally` unlink**: temp file removed even on error or client disconnect.

`StorageAdapter.upload` is narrowed to `Readable`-only — no `Buffer | Readable` union — so any future buffering is forced to be explicit at the call site.

## S3 / Tigris uploads

`TigrisStorageAdapter.upload` uses `@aws-sdk/lib-storage`'s `Upload` (multipart) for streaming bodies:

- `queueSize: 1` — one 5 MB part in flight at a time. Keeps memory bounded.
- `partSize: 5 * 1024 * 1024` — minimum allowed by S3 multipart.
- `requestChecksumCalculation: 'WHEN_REQUIRED'` on the `S3Client` — needed because the SDK v3 default ('WHEN_SUPPORTED') requires `x-amz-decoded-content-length`, which is undefined for `pipe()`-based streams. Without this override, streaming uploads fail signing.

Fly + Tigris is the same datacenter; intra-region transfer is essentially free. No CDN proxy in front of `pub/` — Tigris serves directly via `https://<bucket>.fly.storage.tigris.dev/pub/...`.

## Image processing — auto-orient

EXIF orientation is a long-standing source of bugs. iPhones store the sensor's native orientation in pixels and indicate display orientation via the EXIF `Orientation` tag (1–8). Browsers honor that tag for the original JPEG, but our re-encoded `pub/` copy strips EXIF, so the rotation must be **baked into the pixel grid** before we drop the tag.

Current chain: `sharp({sequentialRead, limitInputPixels}).autoOrient().resize(...).jpeg(...)`.

**One historical false alarm**: a Linux deploy briefly looked like it was silently skipping rotation. The fix turned out to be `docker compose build --no-cache` — the running image had a stale build of `apps/www/src/lib/listing-photo-upload.server.ts`. Both `sequentialRead: true` and `sequentialRead: false` rotate correctly on `@img/sharp-linux-*` once the image is current. Keep the canary tests in `tests/listing-photo-exif.server.test.ts` — they would catch a real regression — and prefer `docker compose build --no-cache` as the first move when "this used to work" claims appear.

**Defense in depth**: if libvips' `.autoOrient()` (or `.rotate()` with no args) ever does break on a future build, the explicit fallback is to read EXIF orientation via `metadata()` and apply `.rotate(angle) / .flip() / .flop()` based on the EXIF 1–8 value yourself. That implementation existed briefly on this branch; consult `git log` for the exact commit if you need to resurrect it.

## Observability

We instrument the photo path heavily because OOM regressions are non-obvious in logs and the only way to catch a memory regression early is to watch the trend.

### Sentry / OTel spans

Tracing wraps the expensive parts of the upload pipeline. Filter on `op:image.process` or `op:storage.upload` in Sentry Performance.

**`photo.sharp_transform`** (`op: image.process`) — set inside `uploadListingPhoto`:

- `photo.id`, `photo.mime_type`
- `photo.input_bytes`, `photo.input_orientation`, `photo.input_width`, `photo.input_height`
- `photo.output_width`, `photo.output_height`, `photo.output_bytes` (from Sharp's `info` event)
- `photo.rss_before`, `photo.rss_after`, `photo.rss_delta`
- `sharp.cache_memory_current`, `sharp.cache_memory_high`, `sharp.cache_files_current`, `sharp.cache_items_current` — process-global libvips cache snapshot. `_current` should always be 0 (we disable the cache); `_high` should also stay 0 unless `sharp.cache(false)` is broken on a given build.

**`storage.upload.tigris`** / **`storage.upload.local`** (`op: storage.upload`) — set inside each `StorageAdapter.upload`:

- `storage.provider` (`tigris` | `local`), `storage.dir` (`raw` | `pub`), `storage.key`
- `storage.mime_type`, `storage.streaming` (always `true`)
- `storage.bytes_written` — counted via a `Transform` tap (no backpressure interference)
- `photo.id` — propagated from the caller for cross-correlation with `photo.sharp_transform`

Tigris-specific:
- `storage.bucket`, `storage.upload_strategy: 'multipart'`, `storage.part_size_bytes`, `storage.queue_size`
- `storage.acl: 'public-read' | 'private'`
- `storage.etag` (from `Upload.done()` result)

### Pino logs

`logger.info` in `uploadListingPhoto` emits two log lines per upload with:

- `phase: 'start' | 'end'`
- `listingPhotoId`, `rssBytes` (from `process.memoryUsage().rss`)

These show up in `fly logs --no-tail` even if Sentry is sampling out the trace. Useful for retrospectively reading "did RSS climb during this upload?" without leaving the terminal.

### Sentry exception capture

Per project convention (CLAUDE.md), all error paths use `Sentry.captureException` from `@/lib/sentry`. Don't add separate `console.error` calls — `sentry.ts` is the designated handler. The wrapper logs to console when Sentry is disabled (dev/test), so you don't lose visibility locally.

## Diagnostic playbook

When a photo upload fails or feels slow:

1. **Check `fly logs --no-tail`** — look for `Killed process` or `oom_score_adj` lines (kernel OOM) and the structured `phase: 'start' / 'end'` lines around the time of failure. The `rssBytes` delta tells you whether memory was the cause.
2. **Find the trace in Sentry** — filter by `op:image.process` and the affected user/photo. The `photo.rss_*` and `storage.bytes_written` attributes show the entire pipeline at a glance.
3. **Repro locally with the same constraints** — `docker compose up --build` runs against the 512 MB / `MALLOC_ARENA_MAX=2` / `UV_THREADPOOL_SIZE=2` settings. Upload the iPhone fixture (`apps/www/tests/fixtures/artichoke-90cw.jpg`) or your own photo via `/listings/new`.
4. **Run the integration test inside Docker** for Linux-binary issues:
   ```bash
   docker compose run --rm web pnpm --filter @pickmyfruit/www test:run tests/listing-photo-exif.server.test.ts
   ```
   Bugs that manifest only on `@img/sharp-linux-*` will surface here even when the macOS test passes.

## Things we tried and rolled back

For the next person who's tempted:

- **Briefly removed `sequentialRead: true`** — re-instated in commit `7b097f8` after confirming the apparent regression was a stale Docker image, not a real bug. `docker compose build --no-cache` would have saved the detour.
- **Buffering raw upload before staging** — doubled allocation under any concurrency. Replaced with the temp-file pipeline.
- **`PutObjectAclCommand` after `Upload.done()`** — tried briefly to set ACL post-upload, but `Upload` already honors `ACL` in its params. The extra round-trip is pure latency.
- **Tighter `--max-old-space-size`** at 160 MB — was right for the 256 MB VM but starves V8 unnecessarily on 512 MB. Now 384 MB.

## Things still on the wishlist

- **Image-processing worker**. The web tier and the image processor have different memory profiles, scaling shapes, and failure tolerances. Even with resize-before-encode, a single upload still peaks ~50 MB RSS. A separate worker container — sized for libvips, scaled horizontally for throughput — would let the web tier shed its 384 MB heap cap and serve listing pages on a much smaller VM.
- **Client-side downscale before upload**. We currently accept full-resolution photos and do all the heavy lifting server-side. A pre-upload resize to ~12 MP via `<canvas>` would cut server peak memory and make the upload step instant on slow connections. Not yet built.
- **`UPLOAD_MAX_CONCURRENT_REQUESTS` at the Fly proxy** — we serialize uploads in-process via the mutex, but inbound requests still queue inside Node. A Fly-level concurrency cap would shed load earlier.
