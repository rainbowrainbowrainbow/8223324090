# Catalog card thumbnails

`/uploads/catalog-images/cards/:width/:filename` accepts only 384/768 pixel
profiles and an existing public catalog-image filename. It reads the same
`catalog_image_blobs` source as `/uploads/catalog-images/items/:filename`.
There is no remote URL fetching, database/schema write, image generation,
approval change or original replacement. Legacy filesystem-only or external
images retain their original fallback path.

Cards use WebP `srcset`; Studio review previews, detail viewers and the full-photo
button retain original URLs. If thumbnail delivery fails, the image removes its
`srcset` and tries the original once. A second failure preserves the existing
unavailable-image state. Approval and operation identities are unchanged.

Encoding uses pinned `sharp` 0.35.5 in a short-lived local Node process. The web
process does not import sharp/libvips. Only runtime/temp/module-search environment
keys reach the codec; database/provider secrets are unnecessary and excluded.
One source read/encode runs at a time per web process, with at most 32 distinct
flights. Duplicate source/profile requests share a flight before loading a blob.
There is no always-on worker or new Railway service.

Inputs are at most 12 MiB, raster PNG/JPEG/WebP with matching magic/type, at most
16 megapixels and one page. The codec has one native thread, disabled native
cache, a 64 MiB V8 heap and an 8-second processing timeout; the parent kills it
after 12 seconds. Native memory is additional to the V8 heap, so 64 MiB is not a
total process-memory guarantee. Output is at most 512 KiB. The image is oriented
and resized inside its bounds without cropping/upscaling, then encoded at WebP
quality 75/effort 3. Corrupt inputs fail without provider retries; a bounded
64-key/30-second failure cache avoids repeatedly decoding the same failed hash.

Derivative files live under `os.tmpdir()/eventgenix-catalog-thumbnails-v1`, not an
uploads directory or paid persistent volume. Local verification sets TEMP/TMP on
D. Cache keys contain the profile version, width and original-content SHA256.
Content changes invalidate the derivative. Storage is bounded to 16 MiB/256 owned
files, including interrupted-write temporary files, with atomic replacement and
regular-file-only eviction; no recursive deletion or original-file eviction.
There is no TTL cleanup timer. A cold container can regenerate copies on demand.
Public one-hour caching and content-derived ETags support conditional GET/HEAD.

Local codec tests cover dimensions, immutable originals, cache reuse, duplicate
and parallel requests, queue bounds, corruption, pixel bombs, failures, safe
eviction and HTTP caching. Real Chrome tests cover 390/1440 light/dark, original
viewing and both fallback states. The browser test uses synthetic data and a
local provider-free HTTP server. Linux native compatibility remains an exact-SHA
CI gate; Windows measurements do not prove Railway billing savings.

Rollback switches card display back to original URLs and removes the isolated
thumbnail route/codec. Existing originals, drafts, receipts and approval history
need no rollback. The temporary derivative cache may be discarded independently;
it is not business-data storage.
