/* global exifr */
importScripts('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js');

const EXIF_OPTS = {
  tiff: true,
  ifd0: true,
  exif: true,
  gps: true,
  xmp: true,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: true,
  mergeOutput: true,
  sanitize: true,
};

self.onmessage = async (event) => {
  const { id, file, path } = event.data;
  try {
    const exif = await exifr.parse(file, EXIF_OPTS).catch(() => null);
    const item = normalize(file, path, exif || {});
    self.postMessage({ id, ok: true, item });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err), item: fallback(file, path) });
  }
};

function normalize(file, path, e) {
  const dt = bestDate(e, file);
  const lat = num(e.latitude ?? e.GPSLatitude);
  const lon = num(e.longitude ?? e.GPSLongitude);
  return {
    id: stableId(path, file.size, file.lastModified),
    name: file.name,
    path,
    type: file.type || guessType(file.name),
    size: file.size,
    lastModified: file.lastModified,
    date: dt ? dt.toISOString() : null,
    year: dt ? dt.getFullYear() : null,
    month: dt ? dt.getMonth() + 1 : null,
    hour: dt ? dt.getHours() : null,
    latitude: validCoord(lat, 90) ? lat : null,
    longitude: validCoord(lon, 180) ? lon : null,
    make: clean(e.Make),
    model: clean(e.Model),
    lens: clean(e.LensModel || e.Lens || e.LensInfo),
    iso: num(e.ISO),
    focalLength: num(e.FocalLength),
    exposureTime: e.ExposureTime ?? null,
    fNumber: num(e.FNumber),
    width: num(e.ImageWidth || e.ExifImageWidth || e.PixelXDimension),
    height: num(e.ImageHeight || e.ExifImageHeight || e.PixelYDimension),
    isScreenshot: isScreenshot(file.name, e),
    hasExif: Object.keys(e).length > 0,
  };
}

function fallback(file, path) {
  return normalize(file, path, {});
}
function bestDate(e, file) {
  const raw = e.DateTimeOriginal || e.CreateDate || e.ModifyDate || e.DateTime || e.OffsetTimeOriginal;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'string') {
    const s = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (file.lastModified) return new Date(file.lastModified);
  return null;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function validCoord(v, max) { return Number.isFinite(v) && Math.abs(v) <= max; }
function clean(v) { return v == null ? '' : String(v).trim().replace(/\s+/g, ' '); }
function guessType(name) { return name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'; }
function isScreenshot(name, e) {
  const n = name.toLowerCase();
  if (/(screenshot|screen shot|capture d.e.cran|bildschirmfoto)/.test(n)) return true;
  const make = clean(e.Make).toLowerCase();
  const model = clean(e.Model).toLowerCase();
  return !make && !model && (n.endsWith('.png') || n.endsWith('.webp'));
}
function stableId(path, size, modified) {
  let h = 2166136261;
  const s = `${path}|${size}|${modified}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
