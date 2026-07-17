(() => {
  "use strict";

  // Tương thích Chrome (chrome.*) và Firefox (browser.*).
  const chrome = globalThis.browser ?? globalThis.chrome;

  const Z = 2147483000;
  const POLL_MS = 1500;
  const MIN_W = 200;
  const MIN_H = 150;

  const ICON_URL = (() => { try { return chrome.runtime.getURL("icons/icon48.png"); } catch (_) { return ""; } })();

  let media = [];

  const overlays = new WeakMap();

  let tracked = new Set();

  const dismissed = new WeakSet();

  function truncate(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function itemKind(item) {
    return (item && item.kind ? String(item.kind) : "file").toUpperCase();
  }

  function mediaName(item) {
    if (item && item.title) return truncate(String(item.title), 60);
    try {
      const u = new URL(item.url);
      const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
      return truncate(last, 60);
    } catch (_) {
      return truncate(String((item && item.url) || "video"), 60);
    }
  }

  function buttonLabel() {
    return "Tải xuống " + media.length + (media.length >= 2 ? " files" : " file");
  }

  function qualityDetail(item) {
    const parts = [];
    if (item && item.bandwidth) parts.push(Math.round(item.bandwidth / 1000) + " Kbps");
    if (item && item.resolution) parts.push(String(item.resolution));
    return parts.join(" ");
  }

  function displayBaseName(item) {
    let base = item && item.title ? String(item.title) : "";
    if (base && item && item.quality) {
      const suffix = " - " + item.quality;
      if (base.endsWith(suffix)) base = base.slice(0, base.length - suffix.length);
    }
    if (base) return truncate(base, 90);
    return mediaName(item);
  }

  function injectStyle() {
    try {
      if (document.getElementById("xdl-overlay-style")) return;
      const st = document.createElement("style");
      st.id = "xdl-overlay-style";
      st.textContent = `
.xdl-ov{position:absolute;z-index:${Z};display:inline-flex;align-items:stretch;isolation:isolate;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  pointer-events:none;opacity:.92;border-radius:0;overflow:hidden;border:1px solid transparent;
  background:linear-gradient(135deg,rgba(26,24,40,.82),rgba(15,17,25,.86)) padding-box,
             linear-gradient(135deg,#c631ff,#4dc4fe) border-box;
  -webkit-backdrop-filter:blur(12px) saturate(160%);backdrop-filter:blur(12px) saturate(160%);
  box-shadow:0 5px 16px rgba(8,6,26,.42),0 0 11px rgba(160,70,240,.18);
  transition:opacity .18s ease,box-shadow .18s ease;}
.xdl-ov:hover{opacity:1;box-shadow:0 7px 20px rgba(10,6,30,.5),0 0 16px rgba(198,49,255,.32);}
.xdl-btn{display:inline-flex;align-items:center;gap:6px;padding:4px 13px 4px 6px;
  background:transparent;
  color:#fff;font-size:11px;line-height:1;font-weight:600;letter-spacing:.01em;
  cursor:pointer;pointer-events:auto;user-select:none;border:none;transition:background .15s ease;}
.xdl-btn:hover{background:transparent;}
.xdl-btn:focus-visible{outline:2px solid #8fe3ff;outline-offset:-2px;}
.xdl-btn img{width:15px;height:15px;display:block;flex:0 0 auto;border-radius:4px;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));}
.xdl-label{white-space:nowrap;}
.xdl-close{display:inline-flex;align-items:center;justify-content:center;align-self:center;
  width:16px;height:16px;margin:0 5px 0 5px;border-radius:5px;
  background:rgba(255,255,255,.14);color:rgba(255,255,255,.82);
  cursor:pointer;pointer-events:auto;user-select:none;
  transition:color .15s ease,background .15s ease;}
.xdl-close:hover{color:#fff;background:#f43f5e;}
.xdl-close:focus-visible{outline:2px solid #8fe3ff;outline-offset:1px;}
.xdl-close svg{display:block;width:9px;height:9px;}
.xdl-panel{position:absolute;z-index:${Z};margin-top:0;min-width:190px;max-width:360px;
  color:#fff;border-radius:0;pointer-events:auto;overflow:hidden;border:1px solid transparent;
  background:linear-gradient(135deg,rgba(24,22,38,.93),rgba(14,16,24,.95)) padding-box,
             linear-gradient(135deg,rgba(198,49,255,.55),rgba(77,196,254,.55)) border-box;
  -webkit-backdrop-filter:blur(16px) saturate(160%);backdrop-filter:blur(16px) saturate(160%);
  box-shadow:0 12px 32px rgba(6,4,22,.55),0 0 16px rgba(150,60,230,.14);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}
.xdl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:7px 10px;font-size:11px;cursor:pointer;border-top:1px solid rgba(255,255,255,.06);transition:background .12s ease;}
.xdl-row:first-of-type{border-top:none;}
.xdl-row:hover{background:linear-gradient(90deg,rgba(198,49,255,.20),rgba(77,196,254,.12));}
.xdl-namecol{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.xdl-row .xdl-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font-weight:500;}
.xdl-row .xdl-detail{font-size:9px;color:#9aa0b4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xdl-row .xdl-badge{flex:0 0 auto;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:800;letter-spacing:.03em;
  color:#d7e2ff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);}
.xdl-row .xdl-badge.xdl-q{color:#08131f;border-color:transparent;background:#4dc4fe;}
@media (prefers-reduced-motion:reduce){
  .xdl-ov,.xdl-btn,.xdl-close,.xdl-row{transition:none;}
}
`;
      (document.head || document.documentElement).appendChild(st);
    } catch (_) {  }
  }

  function sendDownload(item) {

    try {
      const p = chrome.runtime.sendMessage(
        { type: "download", item, tab: { url: location.href }, useTabTitle: true }
      );
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  }

  function refreshMedia() {
    try {
      const p = chrome.runtime.sendMessage({ type: "list" });
      if (p && p.then) {
        p.then((resp) => {
          media = (resp && resp.list) || [];
          render();
        }).catch(() => {});
      }
    } catch (_) {

    }
  }

  function buildButton(video) {
    const btn = document.createElement("div");
    btn.className = "xdl-btn";
    btn.setAttribute("role", "button");
    btn.title = "Tải video này bằng xDownload Manager";
    if (ICON_URL) {
      const img = document.createElement("img");
      img.src = ICON_URL;
      img.alt = "";
      btn.appendChild(img);
    }
    const label = document.createElement("span");
    label.className = "xdl-label";
    label.textContent = buttonLabel();
    btn.appendChild(label);

    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (media.length === 1) {
          sendDownload(media[0]);
        } else if (media.length > 1) {
          togglePanel(video);
        }
      } catch (_) {}
    };
    btn.tabIndex = 0;
    btn.setAttribute("aria-label", buttonLabel());
    btn.addEventListener("click", activate, true);
    btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") activate(e); }, true);

    for (const ev of ["mousedown", "mouseup", "dblclick", "pointerdown"]) {
      btn.addEventListener(ev, (e) => e.stopPropagation(), true);
    }
    return btn;
  }

  function togglePanel(video) {
    const ov = overlays.get(video);
    if (!ov) return;
    if (ov.panel) { removePanel(ov); return; }

    const panel = document.createElement("div");
    panel.className = "xdl-panel";
    for (const item of media) {
      const row = document.createElement("div");
      row.className = "xdl-row";
      row.setAttribute("role", "button");
      row.title = "Tải: " + mediaName(item);
      const namecol = document.createElement("span");
      namecol.className = "xdl-namecol";
      const name = document.createElement("span");
      name.className = "xdl-name";
      name.textContent = displayBaseName(item);
      namecol.append(name);

      const detailText = qualityDetail(item);
      if (detailText) {
        const detail = document.createElement("span");
        detail.className = "xdl-detail";
        detail.textContent = detailText;
        namecol.append(detail);
      }
      const badge = document.createElement("span");
      badge.className = "xdl-badge";

      if (item.quality) {
        badge.textContent = String(item.quality).toUpperCase();
        badge.classList.add("xdl-q");
      } else {
        badge.textContent = itemKind(item);
      }

      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sendDownload(item);
        removePanel(ov);
      }, true);
      row.append(namecol, badge);
      panel.append(row);
    }
    (ov.anchor || document.body).appendChild(panel);
    ov.panel = panel;
    positionOne(video, ov);

    const onDoc = (e) => {
      try {
        if (ov.panel && !ov.panel.contains(e.target) && !ov.wrap.contains(e.target)) {
          removePanel(ov);
        }
      } catch (_) { removePanel(ov); }
    };
    ov._onDoc = onDoc;
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
  }

  function removePanel(ov) {
    try {
      if (ov._onDoc) document.removeEventListener("click", ov._onDoc, true);
      ov._onDoc = null;
      if (ov.panel) { ov.panel.remove(); ov.panel = null; }
    } catch (_) {}
  }

  function ensureOverlay(video) {
    let ov = overlays.get(video);
    if (ov && ov.wrap.isConnected) return ov;

    const wrap = document.createElement("div");
    wrap.className = "xdl-ov";
    const btn = buildButton(video);

    const close = document.createElement("div");
    close.className = "xdl-close";
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "Ẩn nút tải video");
    close.tabIndex = 0;
    close.title = "Ẩn nút tải video";
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
    const closeAct = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissed.add(video);
      removeOverlay(video);
    };
    close.addEventListener("click", closeAct, true);
    close.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") closeAct(e); }, true);
    for (const ev of ["mousedown", "mouseup", "dblclick", "pointerdown"]) {
      close.addEventListener(ev, (e) => e.stopPropagation(), true);
    }
    wrap.appendChild(btn);
    wrap.appendChild(close);

    // Neo nút vào chính khung chứa video để nó luôn dính theo player,
    // không trượt theo màn hình khi cuộn. Nếu không có parent thì fallback về body.
    const parent = video.parentElement;
    let anchor, anchoredToParent = false, restorePos = null;
    if (parent) {
      try {
        const cs = window.getComputedStyle(parent);
        if (cs.position === "static") {
          restorePos = parent.style.position; // '' hoặc giá trị inline cũ
          parent.style.position = "relative";
        }
      } catch (_) {}
      anchor = parent;
      anchoredToParent = true;
    } else {
      anchor = document.body;
    }
    anchor.appendChild(wrap);

    ov = { wrap, btn, panel: null, _onDoc: null, anchor, anchoredToParent, restorePos };
    overlays.set(video, ov);
    tracked.add(video);
    return ov;
  }

  function positionOne(video, ov) {
    try {
      const bh = ov.wrap.offsetHeight || 22;
      const INSET = 0;

      if (ov.anchoredToParent && ov.anchor && ov.anchor.isConnected) {
        // Toạ độ của video so với khung neo (đã được đặt position:relative),
        // không phụ thuộc scroll cửa sổ => nút dính chặt vào player, không trượt.
        const vr = video.getBoundingClientRect();
        const ar = ov.anchor.getBoundingClientRect();
        const sl = ov.anchor.scrollLeft || 0;
        const stp = ov.anchor.scrollTop || 0;
        const left = (vr.left - ar.left) + sl + INSET;
        const top = (vr.top - ar.top) + stp + INSET;
        ov.wrap.style.left = left + "px";
        ov.wrap.style.top = top + "px";
        if (ov.panel) {
          ov.panel.style.top = (top + bh) + "px";
          ov.panel.style.left = left + "px";
        }
        return;
      }

      // Fallback: neo theo document khi video không có parent hợp lệ.
      const r = video.getBoundingClientRect();
      const sx = window.scrollX || window.pageXOffset || 0;
      const sy = window.scrollY || window.pageYOffset || 0;
      const left = Math.max(sx, r.left + sx) + INSET;
      const btnTop = Math.max(sy, r.top + sy) + INSET;
      ov.wrap.style.left = left + "px";
      ov.wrap.style.top = btnTop + "px";
      if (ov.panel) {
        ov.panel.style.top = (btnTop + bh) + "px";
        ov.panel.style.left = left + "px";
      }
    } catch (_) {}
  }

  function removeOverlay(video) {
    const ov = overlays.get(video);
    if (!ov) return;
    try {
      removePanel(ov);
      ov.wrap.remove();
      // Trả lại position của khung nếu ta đã đổi thành relative.
      if (ov.anchoredToParent && ov.anchor && ov.restorePos !== null && ov.restorePos !== undefined) {
        ov.anchor.style.position = ov.restorePos;
      }
    } catch (_) {}
    overlays.delete(video);
    tracked.delete(video);
  }

  function isVisible(video) {
    try {
      const r = video.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) return false;
      const st = window.getComputedStyle(video);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function render() {
    try {
      injectStyle();
      const videos = Array.from(document.querySelectorAll("video"));
      const seen = new Set();

      for (const video of videos) {
        seen.add(video);
        const wantButton = media.length > 0 && video.isConnected && isVisible(video) && !dismissed.has(video);
        if (wantButton) {
          const ov = ensureOverlay(video);
          ov.wrap.style.display = "";

          try {
            const lbl = ov.btn.querySelector(".xdl-label");
            if (lbl) lbl.textContent = buttonLabel();
          } catch (_) {}
          positionOne(video, ov);
        } else if (overlays.has(video)) {
          removeOverlay(video);
        }
      }

      for (const video of Array.from(tracked)) {
        if (!seen.has(video) || !video.isConnected) removeOverlay(video);
      }
    } catch (_) {  }
  }

  function reposition() {
    try {
      for (const video of Array.from(tracked)) {
        const ov = overlays.get(video);
        if (ov) positionOne(video, ov);
      }
    } catch (_) {}
  }

  function frameHasPlayer() {
    try { return !!document.querySelector("video") || tracked.size > 0; } catch (_) { return false; }
  }

  let renderScheduled = false;
  try {
    const obs = new MutationObserver(() => {
      if (renderScheduled) return;
      renderScheduled = true;
      setTimeout(() => { renderScheduled = false; if (frameHasPlayer()) { try { render(); } catch (_) {} } }, 200);
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (_) {}

  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition, true);

  setInterval(() => {
    if (!frameHasPlayer()) return;
    refreshMedia();
    reposition();
  }, POLL_MS);

  refreshMedia();
  render();
})();
