import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyResponse, buildAddRequest, urlExtension, looksLikeM3U8Body, shouldSniffForHLS, parseMasterVariants, isMasterPlaylist, masterReferencedURLs, DEFAULT_EXCLUDED_EXTENSIONS, isExcludedFromApp, parseExcludedExtensions } from "./detect.js";

test("DEFAULT_EXCLUDED_EXTENSIONS: covers common image formats", () => {
  for (const ext of ["jpg", "jpeg", "png", "gif", "webp", "svg"]) {
    assert.ok(DEFAULT_EXCLUDED_EXTENSIONS.includes(ext), `default excludes ${ext}`);
  }
  assert.ok(!DEFAULT_EXCLUDED_EXTENSIONS.includes("mp4"), "video is NOT excluded by default");
});

test("isExcludedFromApp: image ext excluded, video ext not (default list)", () => {
  assert.equal(isExcludedFromApp({ filename: "photo.jpg", url: "https://x.com/photo.jpg" }, DEFAULT_EXCLUDED_EXTENSIONS), true);
  assert.equal(isExcludedFromApp({ filename: "a.PNG", url: "https://x.com/a.PNG" }, DEFAULT_EXCLUDED_EXTENSIONS), true);
  assert.equal(isExcludedFromApp({ filename: "movie.mp4", url: "https://x.com/movie.mp4" }, DEFAULT_EXCLUDED_EXTENSIONS), false);
});

test("isExcludedFromApp: filename ext > URL ext > MIME type", () => {

  assert.equal(isExcludedFromApp({ filename: "pic.webp", url: "https://cdn/xyz?token=1" }, DEFAULT_EXCLUDED_EXTENSIONS), true);

  assert.equal(isExcludedFromApp({ filename: "", url: "https://x.com/pic.gif" }, DEFAULT_EXCLUDED_EXTENSIONS), true);
  assert.equal(isExcludedFromApp({ filename: "", url: "https://x.com/file" }, DEFAULT_EXCLUDED_EXTENSIONS), false);

  assert.equal(isExcludedFromApp({ filename: "photo.jpg", url: "https://x.com/photo.jpg" }, []), false);
});

test("isExcludedFromApp: an extension-less image is caught by its MIME type", () => {

  assert.equal(isExcludedFromApp({ filename: "download", url: "https://cdn/opaque?tok=1", mime: "image/jpeg" }, DEFAULT_EXCLUDED_EXTENSIONS), true);
  assert.equal(isExcludedFromApp({ filename: "", url: "https://cdn/x", mime: "image/png" }, DEFAULT_EXCLUDED_EXTENSIONS), true);
  assert.equal(isExcludedFromApp({ filename: "", url: "https://cdn/x", mime: "image/svg+xml" }, DEFAULT_EXCLUDED_EXTENSIONS), true);

  assert.equal(isExcludedFromApp({ filename: "clip.mp4", url: "https://cdn/x", mime: "image/jpeg" }, DEFAULT_EXCLUDED_EXTENSIONS), false);

  assert.equal(isExcludedFromApp({ filename: "", url: "https://cdn/x", mime: "video/mp4" }, DEFAULT_EXCLUDED_EXTENSIONS), false);
});

test("parseExcludedExtensions: splits on commas/whitespace, strips dots, lowercases", () => {
  assert.deepEqual(parseExcludedExtensions(".JPG, png\n gif  mp4"), ["jpg", "png", "gif", "mp4"]);
  assert.deepEqual(parseExcludedExtensions(""), []);
  assert.deepEqual(parseExcludedExtensions("   "), []);
});

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=1205600,RESOLUTION=854x480,CODECS="avc1.64001f,mp4a.40.2"
sample-3920-480.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=2890800,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
sample-3920-720.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=5781600,RESOLUTION=1920x1080,CODECS="avc1.640032,mp4a.40.2"
sample-3920-1080.m3u8
`;

test("isMasterPlaylist: master vs media", () => {
  assert.equal(isMasterPlaylist(MASTER), true);
  assert.equal(isMasterPlaylist("#EXTM3U\n#EXTINF:10,\nseg0.ts\n"), false);
  assert.equal(isMasterPlaylist(null), false);
});

test("parseMasterVariants: relative variants resolve against master base, sorted best-first", () => {
  const base = "https://cdn.example.com/stream/26ff/sample-3920-playlist.m3u8";
  const v = parseMasterVariants(MASTER, base);
  assert.equal(v.length, 3);
  assert.deepEqual(v.map((x) => x.quality), ["1080p", "720p", "480p"]);
  assert.equal(v[0].url, "https://cdn.example.com/stream/26ff/sample-3920-1080.m3u8");
  assert.equal(v[2].url, "https://cdn.example.com/stream/26ff/sample-3920-480.m3u8");
  assert.equal(v[0].bandwidth, 5781600);
});

test("parseMasterVariants: absolute variant URLs kept as-is", () => {
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
https://cdn.example/v/360.m3u8`;
  const v = parseMasterVariants(master, "https://ignored/base.m3u8");
  assert.equal(v[0].url, "https://cdn.example/v/360.m3u8");
  assert.equal(v[0].quality, "360p");
});

test("parseMasterVariants: exposes full WxH resolution + bandwidth (NDM-style display)", () => {
  const v = parseMasterVariants(MASTER, "https://cdn/playlist.m3u8");
  assert.equal(v[0].resolution, "1920x1080");
  assert.equal(v[0].bandwidth, 5781600);
  assert.equal(v[2].resolution, "854x480");
  assert.equal(v[2].bandwidth, 1205600);
});
test("parseMasterVariants: no RESOLUTION -> empty resolution string", () => {
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\nhttps://cdn/x.m3u8";
  assert.equal(parseMasterVariants(master, "https://cdn/")[0].resolution, "");
});
test("parseMasterVariants: no RESOLUTION -> bandwidth label", () => {
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\nhttps://cdn/x.m3u8";
  assert.equal(parseMasterVariants(master, "https://cdn/")[0].quality, "1500kbps");
});

test("parseMasterVariants: relative variants against a blob: base are dropped (non-http)", () => {

  const v = parseMasterVariants(MASTER, "blob:https://stream.example.com/uuid");
  assert.equal(v.length, 0);
});

test("parseMasterVariants: media playlist (no STREAM-INF) -> empty", () => {
  assert.deepEqual(parseMasterVariants("#EXTM3U\n#EXTINF:10,\nseg0.ts\n", "https://x/"), []);
});

test("masterReferencedURLs: variants + EXT-X-MEDIA audio, resolved", () => {
  const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"
v/360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,AUDIO="aud"
https://cdn2.example/v/720.m3u8`;
  const urls = masterReferencedURLs(master, "https://cdn.example/stream/master.m3u8");
  assert.ok(urls.includes("https://cdn.example/stream/audio/en.m3u8"), "audio rendition included");
  assert.ok(urls.includes("https://cdn.example/stream/v/360.m3u8"), "relative variant resolved");
  assert.ok(urls.includes("https://cdn2.example/v/720.m3u8"), "absolute variant kept");
  assert.equal(urls.length, 3);
});
test("masterReferencedURLs: media playlist -> empty", () => {
  assert.deepEqual(masterReferencedURLs("#EXTM3U\n#EXTINF:10,\nseg.ts\n", "https://x/"), []);
});

test("mp4 by content-type -> file", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/v", contentType: "video/mp4", contentLength: 1000000 }),
    { isMedia: true, kind: "file" });
});
test("mkv by extension -> file (generic content-type)", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/movie.mkv?a=1", contentType: "application/octet-stream" }),
    { isMedia: true, kind: "file" });
});
test("m3u8 by content-type -> hls", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/master", contentType: "application/vnd.apple.mpegurl" }),
    { isMedia: true, kind: "hls" });
});
test("m3u8 by URL with query -> hls", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/hls/index.m3u8?token=abc", contentType: "" }),
    { isMedia: true, kind: "hls" });
});
test("ts segment without media content-type -> not a file (avoids HLS flood)", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/hls/segment123.ts", contentType: "application/octet-stream" }),
    { isMedia: false, kind: null });
});
test("html rejected", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/page", contentType: "text/html; charset=utf-8" }),
    { isMedia: false, kind: null });
});
test("image rejected", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://x.com/a.png", contentType: "image/png" }),
    { isMedia: false, kind: null });
});
test("buildAddRequest matches Plan 3 field names + omits empty optionals", () => {
  const r = buildAddRequest({
    url: "https://x.com/v.mp4", kind: "file", title: "V",
    pageUrl: "https://x.com/watch", referer: "https://x.com/watch",
    headers: { "User-Agent": "UA" }, cookies: "",
  });
  assert.deepEqual(r, {
    url: "https://x.com/v.mp4", kind: "file", title: "V",
    pageUrl: "https://x.com/watch", referer: "https://x.com/watch",
    headers: { "User-Agent": "UA" },
  });
  assert.ok(!("cookies" in r), "empty cookies omitted");
});
test("buildAddRequest with only required fields", () => {
  assert.deepEqual(buildAddRequest({ url: "u", kind: "hls" }), { url: "u", kind: "hls" });
});
test("buildAddRequest carries inline playlist; omits when empty", () => {
  const r = buildAddRequest({ url: "https://stream.example.com/embed/x", kind: "hls", playlist: "#EXTM3U\n#EXTINF:10,\nhttps://cdn/seg1.ts\n" });
  assert.equal(r.playlist, "#EXTM3U\n#EXTINF:10,\nhttps://cdn/seg1.ts\n");
  assert.equal(r.url, "https://stream.example.com/embed/x");
  assert.ok(!("playlist" in buildAddRequest({ url: "u", kind: "hls", playlist: "" })), "empty playlist omitted");
  assert.ok(!("playlist" in buildAddRequest({ url: "u", kind: "file" })), "no playlist omitted");
});
test("urlExtension strips query and lowercases", () => {
  assert.equal(urlExtension("https://x.com/a/b.MP4?x=1"), "mp4");
});

test("tokenized m3u8 URL without path extension -> hls", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://stream.example.com/get?file=stream.m3u8&token=abc", contentType: "application/octet-stream" }),
    { isMedia: true, kind: "hls" });
});
test("application/mpegurl content-type -> hls", () => {
  assert.deepEqual(
    classifyResponse({ url: "https://cdn/x", contentType: "application/mpegurl" }),
    { isMedia: true, kind: "hls" });
});

test("looksLikeM3U8Body: plain #EXTM3U", () => {
  assert.equal(looksLikeM3U8Body("#EXTM3U\n#EXT-X-VERSION:3\n"), true);
});
test("looksLikeM3U8Body: leading BOM + whitespace tolerated", () => {
  assert.equal(looksLikeM3U8Body("\uFEFF  \n#EXTM3U\n"), true);
});
test("looksLikeM3U8Body: HTML/JSON/other rejected", () => {
  assert.equal(looksLikeM3U8Body("<!DOCTYPE html>"), false);
  assert.equal(looksLikeM3U8Body('{"url":"x"}'), false);
  assert.equal(looksLikeM3U8Body(""), false);
  assert.equal(looksLikeM3U8Body(null), false);
  assert.equal(looksLikeM3U8Body("EXTM3U without hash"), false);
});
test("shouldSniffForHLS: opaque URL + generic content-type -> sniff", () => {

  assert.equal(shouldSniffForHLS({ url: "https://stream.example.com/7f23c78a-078f", contentType: "application/octet-stream" }), true);
  assert.equal(shouldSniffForHLS({ url: "https://stream.example.com/get?id=abc", contentType: "text/plain" }), true);
  assert.equal(shouldSniffForHLS({ url: "https://stream.example.com/pl", contentType: "" }), true);
});
test("shouldSniffForHLS: .m3u8 in URL -> always true", () => {
  assert.equal(shouldSniffForHLS({ url: "https://x/get?file=a.m3u8&t=1", contentType: "text/html" }), true);
});
test("shouldSniffForHLS: known asset extensions / binary media -> skip", () => {
  for (const u of ["https://x/app.js", "https://x/s.css", "https://x/a.png", "https://x/seg1.ts", "https://x/seg1.m4s", "https://x/d.json", "https://x/f.woff2"]) {
    assert.equal(shouldSniffForHLS({ url: u, contentType: "" }), false, u);
  }
  assert.equal(shouldSniffForHLS({ url: "https://x/stream", contentType: "video/mp4" }), false);
  assert.equal(shouldSniffForHLS({ url: "https://x/a", contentType: "image/png" }), false);
});
test("shouldSniffForHLS: huge body skipped", () => {
  assert.equal(shouldSniffForHLS({ url: "https://x/blob", contentType: "application/octet-stream", contentLength: 50 * 1024 * 1024 }), false);
});
