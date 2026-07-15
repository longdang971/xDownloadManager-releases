(() => {
  "use strict";
  const W = window;
  try {
    if (W.__xdlHookInstalled) return;
    W.__xdlHookInstalled = true;
  } catch (_) { return; }

  try {
    W.addEventListener("unhandledrejection", (e) => {
      try {
        const r = e && e.reason;
        if (r instanceof TypeError && /failed to fetch|networkerror|load failed|network connection|fetch/i.test(String(r.message || ""))) {
          e.preventDefault();
        }
      } catch (_) {}
    }, false);
  } catch (_) {}

  const SRC = "xdl-hook";
  const SRC_MASTER = "xdl-hook-master";
  const PEEK_BYTES = 65536;
  const reported = new Set();
  const sniffed = new Set();

  const NON_PLAYLIST_EXT =
    /\.(js|mjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|json|map|wasm|mp4|m4v|webm|mkv|mov|ts|m4s|mp3|m4a|aac|wav|flac|ogg|oga)(\?|#|$)/i;

  function urlLooksLikeHLS(u) {
    return String(u || "").toLowerCase().split("#")[0].includes(".m3u8");
  }
  function shouldSniff(url, contentType, contentLength) {
    if (urlLooksLikeHLS(url)) return true;
    const path = String(url || "").split("#")[0];
    if (NON_PLAYLIST_EXT.test(path)) return false;
    const ct = (contentType || "").split(";")[0].trim().toLowerCase();
    if (/^(video|audio|image|font)\//.test(ct)) return false;
    if (contentLength != null && Number.isFinite(contentLength) && contentLength > 3 * 1024 * 1024) return false;
    return true;
  }
  function bodyIsM3U8(text) {
    return typeof text === "string" && text.trimStart().startsWith("#EXTM3U");
  }
  function isMaster(text) {
    return /#EXT-X-STREAM-INF/i.test(text);
  }

  function absolutize(url) {
    try { return new URL(url, W.location.href).href; } catch (_) { return String(url || ""); }
  }

  function frameHref() { try { return W.location.href; } catch (_) { return ""; } }

  function emit(payload) {
    try { W.postMessage(payload, "*"); } catch (_) {}
  }

  function report(rawUrl, kind) {
    const url = absolutize(rawUrl);
    if (!/^https?:\/\//i.test(url)) return;
    if (reported.has(url)) return;
    reported.add(url);
    emit({ source: SRC, item: { url, kind: kind || "hls", frameUrl: frameHref() } });
  }

  function reportPlaylist(rawUrl, playlist) {
    const url = String(rawUrl || "");
    if (!url || reported.has(url)) return;
    reported.add(url);
    emit({ source: SRC, item: { url, kind: "hls", playlist, frameUrl: frameHref() } });
  }

  function reportMaster(rawUrl, text) {
    const key = absolutize(rawUrl);
    if (reported.has(key)) return;
    reported.add(key);

    emit({ source: SRC_MASTER, masterUrl: key, text, frameUrl: frameHref() });
  }

  function handleHLSText(url, text, inline) {
    if (!bodyIsM3U8(text)) {

      if (!inline) { try { sniffed.add(absolutize(url)); } catch (_) {} }
      return;
    }
    if (isMaster(text)) { reportMaster(url, text); return; }
    if (inline) reportPlaylist(url, text);
    else report(url, "hls");
  }

  function peekResponse(resp, cb) {
    try {
      if (resp.body && resp.body.getReader) {
        const reader = resp.body.getReader();
        let buf = new Uint8Array(0);
        const step = () => reader.read().then(({ done, value }) => {
          if (value && value.length) {
            const merged = new Uint8Array(buf.length + value.length);
            merged.set(buf); merged.set(value, buf.length); buf = merged;
          }
          if (buf.length >= PEEK_BYTES || done) {
            try { reader.cancel(); } catch (_) {}
            try { cb(new TextDecoder("utf-8").decode(buf.subarray(0, PEEK_BYTES))); } catch (_) {}
            return;
          }
          return step();
        }).catch(() => {});
        step();
        return;
      }
    } catch (_) {}
    try { resp.text().then((t) => cb(String(t || "").slice(0, PEEK_BYTES))).catch(() => {}); } catch (_) {}
  }

  try {
    const origCreate = URL.createObjectURL;
    if (typeof origCreate === "function") {
      URL.createObjectURL = function (obj) {
        const objUrl = origCreate.apply(this, arguments);
        try {
          if (obj && typeof Blob !== "undefined" && obj instanceof Blob && typeof obj.text === "function"
              && (!obj.size || obj.size <= 3 * 1024 * 1024)) {
            obj.text().then((t) => { try { handleHLSText(objUrl, t, true); } catch (_) {} }).catch(() => {});
          }
        } catch (_) {}
        return objUrl;
      };
    }
  } catch (_) {}

  try {
    const origFetch = W.fetch;
    if (typeof origFetch === "function") {
      W.fetch = function (input, init) {
        let url = "";
        try { url = typeof input === "string" ? input : (input && input.url) || ""; } catch (_) {}
        const p = origFetch.apply(this, arguments);
        try {
          if (url && p && typeof p.then === "function") {
            p.then((resp) => {
              try {
                if (!resp) return;
                const _abs = absolutize(url); if (reported.has(_abs) || sniffed.has(_abs)) return;
                const h = resp.headers;
                const ct = h && h.get ? h.get("content-type") : "";
                const cl = h && h.get ? parseInt(h.get("content-length") || "", 10) : NaN;
                if (!(urlLooksLikeHLS(url) || shouldSniff(url, ct, Number.isFinite(cl) ? cl : null))) return;
                peekResponse(resp.clone(), (text) => handleHLSText(url, text, false));
              } catch (_) {}
            }).catch(() => {});
          }
        } catch (_) {}
        return p;
      };
    }
  } catch (_) {}

  try {
    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const origOpen = XHR.prototype.open;
      const origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        try { this.__xdlUrl = url; } catch (_) {}
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        try {
          const xhr = this;
          const url = xhr.__xdlUrl || "";
          xhr.addEventListener("load", () => {
            try {
              if (!url) return;
              const _abs = absolutize(url); if (reported.has(_abs) || sniffed.has(_abs)) return;
              const ct = xhr.getResponseHeader ? xhr.getResponseHeader("content-type") : "";
              const cl = xhr.getResponseHeader ? parseInt(xhr.getResponseHeader("content-length") || "", 10) : NaN;
              if (!(urlLooksLikeHLS(url) || shouldSniff(url, ct, Number.isFinite(cl) ? cl : null))) return;
              const rt = xhr.responseType;
              let text = "";
              if (rt === "" || rt === "text") text = String(xhr.responseText || "").slice(0, PEEK_BYTES);
              else if (rt === "arraybuffer" && xhr.response) text = new TextDecoder("utf-8").decode(new Uint8Array(xhr.response, 0, Math.min(PEEK_BYTES, xhr.response.byteLength)));
              else return;
              handleHLSText(url, text, false);
            } catch (_) {}
          });
        } catch (_) {}
        return origSend.apply(this, arguments);
      };
    }
  } catch (_) {}
})();
