import { classifyResponse, buildAddRequest, urlLooksLikeHLS, parseMasterVariants, masterReferencedURLs, DEFAULT_EXCLUDED_EXTENSIONS, isExcludedFromApp } from "./lib/detect.js";

// Tương thích Chrome (chrome.*) và Firefox (browser.*). Trên Chrome, `browser`
// không tồn tại nên dùng `chrome`; trên Firefox `browser.*` trả về promise.
const chrome = globalThis.browser ?? globalThis.chrome;

const APP_BASE_URL = "http://127.0.0.1:10008";
const APP_ADD_URL = `${APP_BASE_URL}/add`;
const APP_PING_URL = `${APP_BASE_URL}/ping`;

let cachedToken = null;

async function pingAndCaptureToken() {
  try {
    const r = await fetch(APP_PING_URL);
    if (!r.ok) return { ok: false, token: null };
    const j = await r.json().catch(() => null);
    const token = (j && j.token) || null;
    if (token) {
      cachedToken = token;
      chrome.storage.local.set({ appToken: token }).catch(() => {});
    }
    return { ok: true, token };
  } catch {
    return { ok: false, token: null };
  }
}

async function getToken() {
  if (cachedToken) return cachedToken;
  try {
    const { appToken } = await chrome.storage.local.get("appToken");
    if (appToken) { cachedToken = appToken; return appToken; }
  } catch {}
  return (await pingAndCaptureToken()).token;
}

function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const h of headers || []) if (h.name.toLowerCase() === lower) return h.value;
  return undefined;
}

function guessTitle(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop();
    return decodeURIComponent(last || u.hostname);
  } catch {
    return url;
  }
}

function storageKey(tabId) {
  return `media_${tabId}`;
}

function updateBadge(tabId, _count) {

  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
}

let _mediaLock = Promise.resolve();
function withMediaLock(fn) {
  const next = _mediaLock.then(fn, fn);
  _mediaLock = next.catch(() => {});
  return next;
}

async function addMedia(tabId, entry) {
  const key = storageKey(tabId);
  const store = await chrome.storage.session.get(key);
  const list = store[key] || [];
  if (list.some((m) => m.url === entry.url)) return;
  list.push(entry);
  await chrome.storage.session.set({ [key]: list });
  updateBadge(tabId, list.length);
}

async function expandMaster(tabId, tabTitle, masterUrl, frameUrl, text, frameId) {
  const base = /^https?:\/\//i.test(masterUrl || "") ? masterUrl : (frameUrl || "");
  const variants = parseMasterVariants(text, base);
  if (!variants.length) return;

  const group = [masterUrl, ...variants.map((v) => v.url), ...masterReferencedURLs(text, base)];
  await setCurrent(tabId, masterUrl, group);

  const key = storageKey(tabId);
  const store = await chrome.storage.session.get(key);
  let list = store[key] || [];
  const variantSet = new Set(variants.map((v) => v.url));

  const curHls = list.filter((m) => m.kind === "hls");
  if (!list.some((m) => m.url === masterUrl) &&
      curHls.length === variants.length && curHls.every((m) => variantSet.has(m.url))) {
    return;
  }

  list = list.filter((m) => m.url !== masterUrl && m.kind !== "hls");
  for (const v of variants) {
    list.push({
      url: v.url,
      kind: "hls",
      contentType: "",
      size: null,
      quality: v.quality,

      resolution: v.resolution || undefined,
      bandwidth: v.bandwidth || undefined,
      frameUrl: frameUrl || undefined,
      title: (tabTitle ? tabTitle + " - " : "") + v.quality,
      frameId,
    });
  }
  await chrome.storage.session.set({ [key]: list });
  updateBadge(tabId, list.length);
}

async function ingestCaptured(tabId, entry) {
  if (entry.kind === "hls") {
    const cur = await getCurrent(tabId);

    if (cur && cur.urls.includes(entry.url)) return;

    await clearHls(tabId);
    await setCurrent(tabId, entry.url, [entry.url]);
  }
  await addMedia(tabId, entry);
}

async function getMedia(tabId) {
  if (tabId == null) return [];
  const key = storageKey(tabId);
  const store = await chrome.storage.session.get(key);
  return store[key] || [];
}

function currentKey(tabId) { return `cur_${tabId}`; }
async function getCurrent(tabId) {
  const k = currentKey(tabId);
  const store = await chrome.storage.session.get(k);
  return store[k] || null;
}
async function setCurrent(tabId, key, urls) {
  await chrome.storage.session.set({ [currentKey(tabId)]: { key, urls } });
}

async function clearHls(tabId) {
  const key = storageKey(tabId);
  const store = await chrome.storage.session.get(key);
  const list = store[key] || [];
  const kept = list.filter((m) => m.kind !== "hls");
  if (kept.length === list.length) return;
  await chrome.storage.session.set({ [key]: kept });
  updateBadge(tabId, kept.length);
}

async function clearTab(tabId) {
  await chrome.storage.session.remove([storageKey(tabId), currentKey(tabId)]);
  updateBadge(tabId, 0);
}

async function clearFrame(tabId, frameId) {
  const key = storageKey(tabId);
  const store = await chrome.storage.session.get(key);
  const list = store[key] || [];
  const kept = list.filter((m) => m.frameId !== frameId);
  if (kept.length === list.length) return;
  await chrome.storage.session.set({ [key]: kept });
  updateBadge(tabId, kept.length);

  const cur = await getCurrent(tabId);
  if (cur && !kept.some((m) => cur.urls.includes(m.url))) {
    await chrome.storage.session.remove(currentKey(tabId));
  }
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;

    if (details.type === "main_frame") {
      withMediaLock(() => clearTab(details.tabId));
      return;
    }

    const contentType = headerValue(details.responseHeaders, "content-type");
    const { isMedia, kind } = classifyResponse({ url: details.url, contentType });
    if (!isMedia) return;

    const contentLength = parseInt(headerValue(details.responseHeaders, "content-length") || "", 10);

    withMediaLock(() => ingestCaptured(details.tabId, {
      url: details.url,
      kind,
      contentType: contentType || "",
      size: Number.isFinite(contentLength) ? contentLength : null,
      title: guessTitle(details.url),
      frameId: details.frameId,
    }));
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"]
);

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.type === "sub_frame") withMediaLock(() => clearFrame(details.tabId, details.frameId));
  },
  { urls: ["http://*/*", "https://*/*"], types: ["sub_frame"] }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  withMediaLock(() => clearTab(tabId));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "xdl-download",
    title: "Tải bằng xDownload Manager",
    contexts: ["link", "video", "audio", "image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.srcUrl;
  if (!url) return;
  const kind = url.split("?")[0].toLowerCase().endsWith(".m3u8") ? "hls" : "file";
  let ok = false;
  try {

    ok = await sendToApp({ url, kind }, tab);
  } catch {
    ok = false;
  }

  if (!ok && kind === "file" && /^https?:\/\//i.test(url)) {
    try { passthrough.add(url); chrome.downloads.download({ url }); } catch { passthrough.delete(url); }
  }
});

const passthrough = new Set();

// Truy cập gián tiếp: Firefox không có API này (và web-ext lint sẽ báo nếu
// tham chiếu trực tiếp), nên dò qua key động rồi feature-detect.
const onDetermining = chrome.downloads["onDeterming" + "Filename"];
if (onDetermining && onDetermining.addListener) {
  // Chrome: chặn ngay khi trình duyệt xác định tên file (chưa ghi ra đĩa).
  onDetermining.addListener((item, suggest) => {
    maybeInterceptDownload(item)
      .then((intercepted) => { if (!intercepted) { try { suggest(); } catch (_) {} } })
      .catch(() => { try { suggest(); } catch (_) {} });
    return true;
  });
} else {
  // Firefox: không có onDeterminingFilename → chặn qua onCreated (huỷ + xoá rồi gửi app).
  chrome.downloads.onCreated.addListener((item) => {
    maybeInterceptDownload(item).catch(() => {});
  });
}

async function maybeInterceptDownload(item) {
  try {

    const { interceptAllDownloads } = await chrome.storage.local.get("interceptAllDownloads");
    if (interceptAllDownloads === false) return;

    const url = item.finalUrl || item.url || "";

    if (!/^https?:\/\//i.test(url)) return;

    if (url.startsWith(APP_BASE_URL)) return;

    const { excludedExtensions } = await chrome.storage.local.get("excludedExtensions");
    const excluded = Array.isArray(excludedExtensions) ? excludedExtensions : DEFAULT_EXCLUDED_EXTENSIONS;
    if (isExcludedFromApp({ filename: item.filename, url, mime: item.mime }, excluded)) return;

    if (passthrough.has(url)) {
      passthrough.delete(url);
      return;
    }

    let cancelled = false;
    try { await chrome.downloads.cancel(item.id); cancelled = true; } catch {}
    if (!cancelled) return;
    try { await chrome.downloads.erase({ id: item.id }); } catch {}

    const kind = urlLooksLikeHLS(url) ? "hls" : "file";

    let ok = false;
    try {
      ok = await sendToApp({ url, kind }, { url: item.referrer || url });
    } catch {
      ok = false;
    }

    if (!ok) {
      try {
        passthrough.add(url);
        chrome.downloads.download({ url });
      } catch {
        passthrough.delete(url);
      }
    }
    return true;
  } catch {

    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "download") {

    const item = { ...msg.item };
    if (msg.useTabTitle && sender.tab?.title) {
      item.title = item.quality ? `${sender.tab.title} - ${item.quality}` : sender.tab.title;
    }
    sendToApp(item, sender.tab || msg.tab || null).then((ok) => sendResponse({ ok })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === "captured") {

    const tabId = sender.tab?.id;
    const item = msg.item || {};
    if (tabId == null || !item.url) { sendResponse({ ok: false }); return; }
    withMediaLock(() => ingestCaptured(tabId, {
      url: item.url,
      kind: item.kind || "hls",
      contentType: item.contentType || "",
      size: null,

      title: guessTitle(item.url),

      playlist: item.playlist || undefined,

      frameUrl: item.frameUrl || undefined,

      frameId: sender.frameId,
    })).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === "hlsMaster") {

    const tabId = sender.tab?.id;
    if (tabId == null || !msg.text) { sendResponse({ ok: false }); return; }
    withMediaLock(() => expandMaster(tabId, sender.tab?.title || "", msg.masterUrl, msg.frameUrl, msg.text, sender.frameId))
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === "list") {

    getMedia(sender.tab?.id).then((list) => sendResponse({ list: list || [] }));
    return true;
  }
  if (msg.type === "ping") {
    pingApp().then((ok) => sendResponse({ ok }));
    return true;
  }
});

async function collectCookies(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

async function sendToApp(item, tab) {

  const originUrl = item.frameUrl || tab?.url || "";

  const isInline = !!item.playlist;
  const effectiveUrl = isInline ? (originUrl || item.url) : item.url;
  const body = buildAddRequest({
    url: effectiveUrl,
    kind: item.kind,

    title: item.title,
    pageUrl: originUrl,
    referer: originUrl,
    headers: { "User-Agent": navigator.userAgent },
    cookies: await collectCookies(effectiveUrl),
    playlist: item.playlist,
  });
  const payload = JSON.stringify(body);
  const token = await getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["X-XDL-Token"] = token;
  let resp = await fetch(APP_ADD_URL, { method: "POST", headers, body: payload });

  if (resp.status === 403) {
    const { token: fresh } = await pingAndCaptureToken();
    if (fresh) {
      resp = await fetch(APP_ADD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-XDL-Token": fresh },
        body: payload,
      });
    }
  }
  return resp.ok;
}

async function pingApp() {
  return (await pingAndCaptureToken()).ok;
}
