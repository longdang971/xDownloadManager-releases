(() => {
  "use strict";
  // Tương thích Chrome (chrome.*) và Firefox (browser.*).
  const chrome = globalThis.browser ?? globalThis.chrome;
  try {
    window.addEventListener("message", (e) => {
      try {
        if (e.source !== window) return;
        const d = e.data;
        if (!d) return;
        if (d.source === "xdl-hook" && d.item && d.item.url) {

          const p = chrome.runtime.sendMessage({ type: "captured", item: d.item });
          if (p && p.catch) p.catch(() => {});
        } else if (d.source === "xdl-hook-master" && d.masterUrl && d.text) {

          const p = chrome.runtime.sendMessage({ type: "hlsMaster", masterUrl: d.masterUrl, text: d.text, frameUrl: d.frameUrl });
          if (p && p.catch) p.catch(() => {});
        }
      } catch (_) {}
    }, false);
  } catch (_) {}
})();
