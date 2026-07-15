import { DEFAULT_EXCLUDED_EXTENSIONS, parseExcludedExtensions } from "./lib/detect.js";

// Tương thích Chrome (chrome.*) và Firefox (browser.*).
const chrome = globalThis.browser ?? globalThis.chrome;

function setStatus(ok) {
  const el = document.getElementById("status");
  el.textContent = ok ? "Đã kết nối" : "Chưa mở app";
  el.className = ok ? "ok" : "off";
}

async function initInterceptToggle() {
  const cb = document.getElementById("interceptAll");
  if (!cb) return;
  try {
    const { interceptAllDownloads } = await chrome.storage.local.get("interceptAllDownloads");
    cb.checked = interceptAllDownloads !== false;
  } catch {
    cb.checked = true;
  }
  cb.addEventListener("change", () => {
    chrome.storage.local.set({ interceptAllDownloads: cb.checked }).catch(() => {});
  });
}

async function initExcludedExtensions() {
  const ta = document.getElementById("excluded");
  if (!ta) return;
  let list;
  try {
    const { excludedExtensions } = await chrome.storage.local.get("excludedExtensions");
    list = Array.isArray(excludedExtensions) ? excludedExtensions : DEFAULT_EXCLUDED_EXTENSIONS;
  } catch {
    list = DEFAULT_EXCLUDED_EXTENSIONS;
  }
  ta.value = list.join(", ");
  const save = () => {
    chrome.storage.local.set({ excludedExtensions: parseExcludedExtensions(ta.value) }).catch(() => {});
  };
  ta.addEventListener("change", save);
  ta.addEventListener("blur", save);
}

async function refreshStatus() {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "ping" });
  } catch {
    res = null;
  }
  setStatus(!!res?.ok);
}

refreshStatus();
initInterceptToggle();
initExcludedExtensions();
