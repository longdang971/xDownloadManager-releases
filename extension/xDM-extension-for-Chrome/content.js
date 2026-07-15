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
.xdl-ov{position:absolute;z-index:${Z};display:inline-flex;align-items:stretch;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;pointer-events:none;opacity:.8;transition:opacity .15s;}
.xdl-ov:hover{opacity:1;}
.xdl-close{display:inline-flex;align-items:center;justify-content:center;width:22px;align-self:stretch;
  background:linear-gradient(135deg,#4F6BF0,#8B5CF6);color:#fff;font-size:12px;font-weight:700;line-height:1;
  cursor:pointer;pointer-events:auto;user-select:none;border-left:1px solid rgba(255,255,255,.45);
  box-shadow:0 2px 6px rgba(50,40,120,.4);transition:filter .12s;}
.xdl-close:hover{filter:brightness(1.08);}
.xdl-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 35px 5px 9px;border-radius:0;
  background:linear-gradient(135deg,#4F6BF0,#8B5CF6);color:#fff;font-size:10px;line-height:1;font-weight:700;
  cursor:pointer;pointer-events:auto;user-select:none;box-shadow:0 2px 6px rgba(50,40,120,.4);
  border:none;transition:filter .12s,transform .12s;}
.xdl-btn:hover{filter:brightness(1.08);}
.xdl-btn:active{transform:translateY(1px);}
.xdl-btn img{width:13px;height:13px;display:block;flex:0 0 auto;border-radius:3px;background:#fff;
  box-shadow:0 0 0 1px rgba(255,255,255,.35);}
.xdl-panel{position:absolute;z-index:${Z};margin-top:0;min-width:180px;max-width:360px;
  background:#1c1c1e;color:#fff;border-radius:0;pointer-events:auto;overflow:hidden;
  box-shadow:0 8px 22px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1);
  font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;}
.xdl-row{display:flex;align-items:center;justify-content:space-between;gap:7px;
  padding:6px 9px;font-size:11px;cursor:pointer;border-top:1px solid rgba(255,255,255,.06);transition:background .1s;}
.xdl-row:first-of-type{border-top:none;}
.xdl-row:hover{background:rgba(79,107,240,.22);}
.xdl-namecol{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.xdl-row .xdl-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;}
.xdl-row .xdl-detail{font-size:9px;color:#9aa0b4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xdl-row .xdl-badge{flex:0 0 auto;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:800;
  color:#dfe3ff;background:rgba(79,107,240,.30);}
.xdl-row .xdl-badge.xdl-q{color:#0b1020;background:linear-gradient(135deg,#7fe7c4,#5ec8ff);}
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

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (media.length === 1) {
          sendDownload(media[0]);
        } else if (media.length > 1) {
          togglePanel(video);
        }
      } catch (_) {}
    }, true);

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
    close.title = "Ẩn nút tải video";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissed.add(video);
      removeOverlay(video);
    }, true);
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
