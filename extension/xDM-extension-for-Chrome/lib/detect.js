const MEDIA_EXTENSIONS = new Set([
  "mp4", "m4v", "mkv", "webm", "mov", "avi", "flv", "m2ts", "wmv",
  "mpg", "mpeg", "3gp", "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga",
  "opus", "wma",
]);

const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "video/x-mpegurl",
  "vnd.apple.mpegurl",
]);

export function urlLooksLikeHLS(url) {
  return String(url || "").toLowerCase().split("#")[0].includes(".m3u8");
}

export const DEFAULT_EXCLUDED_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "heic", "heif", "avif",
];

export function mimeToExtension(mime) {
  const m = String(mime || "").toLowerCase().split(";")[0].trim();
  if (!m.includes("/")) return "";
  const map = {
    "image/jpeg": "jpeg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
    "image/webp": "webp", "image/bmp": "bmp", "image/svg+xml": "svg", "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico", "image/tiff": "tiff", "image/heic": "heic",
    "image/heif": "heif", "image/avif": "avif",
  };
  if (map[m]) return map[m];
  return (m.split("/")[1] || "").replace(/^x-/, "").replace(/\+.*$/, "");
}

export function downloadExtension({ filename, url, mime } = {}) {
  const base = String(filename || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot >= 0 && dot < base.length - 1) return base.slice(dot + 1).toLowerCase();
  return urlExtension(url) || mimeToExtension(mime);
}

export function isExcludedFromApp({ filename, url, mime } = {}, excluded) {
  const ext = downloadExtension({ filename, url, mime });
  if (!ext) return false;
  const set = (Array.isArray(excluded) ? excluded : [])
    .map((e) => String(e).trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
  return set.includes(ext);
}

export function parseExcludedExtensions(text) {
  return String(text || "")
    .split(/[\s,]+/)
    .map((e) => e.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
}

export function urlExtension(url) {
  try {
    const path = new URL(url).pathname;
    const dot = path.lastIndexOf(".");
    return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  } catch {
    return "";
  }
}

function normalizeContentType(contentType) {
  return contentType ? contentType.split(";")[0].trim().toLowerCase() : "";
}

export function classifyResponse({ url, contentType }) {
  const ct = normalizeContentType(contentType);
  const ext = urlExtension(url);

  if (HLS_CONTENT_TYPES.has(ct) || ext === "m3u8" || urlLooksLikeHLS(url)) {
    return { isMedia: true, kind: "hls" };
  }
  if (ct.startsWith("video/") || ct.startsWith("audio/") || MEDIA_EXTENSIONS.has(ext)) {
    return { isMedia: true, kind: "file" };
  }
  return { isMedia: false, kind: null };
}

const NON_PLAYLIST_EXT =
  /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|json|map|wasm|mp4|m4v|webm|mkv|mov|ts|m4s|mp3|m4a|aac|wav|flac|ogg|oga)(\?|#|$)/i;

export function shouldSniffForHLS({ url, contentType, contentLength }) {
  if (urlLooksLikeHLS(url)) return true;
  const path = String(url || "").split("#")[0];
  if (NON_PLAYLIST_EXT.test(path)) return false;
  const ct = normalizeContentType(contentType);
  if (/^(video|audio|image|font)\//.test(ct)) return false;
  if (contentLength != null && Number.isFinite(contentLength) && contentLength > 3 * 1024 * 1024) return false;
  return true;
}

export function looksLikeM3U8Body(text) {
  if (typeof text !== "string") return false;
  return text.trimStart().startsWith("#EXTM3U");
}

export function parseMasterVariants(text, base) {
  if (typeof text !== "string") return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^#EXT-X-STREAM-INF:/i.test(lines[i].trim())) continue;
    const attrs = lines[i].trim().replace(/^#EXT-X-STREAM-INF:/i, "");
    const bwM = /BANDWIDTH=\s*(\d+)/i.exec(attrs);
    const bandwidth = bwM ? parseInt(bwM[1], 10) : 0;
    const resM = /RESOLUTION=\s*(\d+)x(\d+)/i.exec(attrs);
    const resolution = resM ? resM[1] + "x" + resM[2] : "";
    const quality = resM ? resM[2] + "p" : (bandwidth ? Math.round(bandwidth / 1000) + "kbps" : "?");

    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith("#")) { if (/^#EXT-X-STREAM-INF:/i.test(l)) break; continue; }
      uri = l; i = j; break;
    }
    if (!uri) continue;
    let abs;
    try { abs = new URL(uri, base).href; } catch { abs = uri; }
    if (!/^https?:\/\//i.test(abs)) continue;
    out.push({ url: abs, quality, bandwidth, resolution });
  }
  out.sort((a, b) => b.bandwidth - a.bandwidth);
  return out;
}

export function isMasterPlaylist(text) {
  return typeof text === "string" && /#EXT-X-STREAM-INF/i.test(text);
}

export function masterReferencedURLs(text, base) {
  if (typeof text !== "string") return [];
  const urls = new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const uriAttr = /URI="([^"]+)"/i.exec(line);
    if (uriAttr) { try { urls.add(new URL(uriAttr[1], base).href); } catch {  } }
    if (/^#EXT-X-STREAM-INF:/i.test(line)) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l) continue;
        if (l.startsWith("#")) { if (/^#EXT-X-STREAM-INF:/i.test(l)) break; continue; }
        try { urls.add(new URL(l, base).href); } catch {  }
        break;
      }
    }
  }
  return [...urls];
}

export function buildAddRequest({ url, kind, title, pageUrl, referer, headers, cookies, playlist }) {
  const req = { url, kind };
  if (title != null && title !== "") req.title = title;
  if (pageUrl != null && pageUrl !== "") req.pageUrl = pageUrl;
  if (referer != null && referer !== "") req.referer = referer;
  if (cookies != null && cookies !== "") req.cookies = cookies;
  if (headers != null && Object.keys(headers).length > 0) req.headers = headers;

  if (playlist != null && playlist !== "") req.playlist = playlist;
  return req;
}
