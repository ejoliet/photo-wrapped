# Photo Metadata Wrapped

Static, client-only photo metadata dashboard. Host it on GitHub Pages, Netlify, Cloudflare Pages, Box preview, Dropbox static export, or any plain HTTPS file host.

## What works now

- Folder picker with `webkitdirectory`.
- EXIF/GPS parsing in `exif-worker.js` using Exifr.
- Leaflet + OpenStreetMap geotag map.
- Timeline by month, time-of-day heatmap.
- Camera/lens/focal length/ISO stats.
- Hygiene panel: screenshots, biggest files, missing date/GPS.
- IndexedDB metadata cache.
- DuckDB-WASM lazy SQL table for the EXIF rows.
- Pro demo hooks: Transformers.js worker, semantic search vector bootstrap, exact-metadata duplicate grouping, burst grouping by timestamp.

## Run locally

Because module workers and CDN WASM are involved, serve over HTTP instead of opening the file directly:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

## Deploy to GitHub Pages

Copy these files to a repo root and enable Pages from the default branch:

- `index.html`
- `styles.css`
- `app.js`
- `exif-worker.js`
- `ml-worker.js`

## Product notes

Free cap is enforced in `app.js` with `FREE_CAP = 500`. The current Pro unlock button is intentionally a local demo flag. For a sellable plugin, replace it with a license check that still keeps all photo processing local.

## Production hardening path

1. Add OPFS thumbnail cache keyed by stable file identity.
2. Persist CLIP image embeddings in IndexedDB with model version and quantization metadata.
3. Add cosine ANN index for duplicate and semantic search.
4. Add Laplacian sharpness scoring in a worker for burst best-shot picking.
5. Add File System Access API directory handles where available for one-click reopen.
6. Package adapters for Immich, Dropbox, Box, and local folder mode.
