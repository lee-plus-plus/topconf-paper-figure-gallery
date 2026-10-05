/* ===== Top-Conf Figure Gallery: filtering, search, infinite scroll, lightbox ===== */
(function () {
  "use strict";

  const VENUES = {
    iclr:    { name: "ICLR",    cn: "ICLR" },
    icml:    { name: "ICML",    cn: "ICML" },
    neurips: { name: "NeurIPS", cn: "NeurIPS" },
    cvpr:    { name: "CVPR", cn: "CVPR" },
    acl:     { name: "ACL", cn: "ACL" },
    aaai:    { name: "AAAI", cn: "AAAI" },
  };
  const PATTERNS = {
    teaser:       "Teaser",
    conceptual:   "Conceptual",
    framework:    "Framework",
    pipeline:     "Pipeline",
    architecture: "Architecture",
    taxonomy:     "Taxonomy / Benchmark",
    results:      "Results",
    comparison:   "Comparison",
  };
  const PATTERN_ORDER = ["teaser", "conceptual", "framework", "pipeline", "architecture", "taxonomy", "results", "comparison"];
  const TIERS = { best: "Best Paper", oral: "Oral", spotlight: "Spotlight" };
  const PAGE = 60;

  /* ---------- i18n: dynamic labels ---------- */
  GAL_I18N.register({
    en: {
      "layout.columns": "Columns",
      "brand.description": "Figure inspiration from top conferences",
      "layout.display": "Display", "layout.full": "Images and text", "layout.images": "Images only",
      "count.base": "<b>{n}</b> / {m} figures",
      "chip.all": "All",
      "pat.teaser": "Teaser", "pat.conceptual": "Conceptual", "pat.framework": "Framework",
      "pat.pipeline": "Pipeline", "pat.architecture": "Architecture",
      "pat.taxonomy": "Taxonomy / Benchmark", "pat.results": "Results", "pat.comparison": "Comparison",
      "tier.best": "Best Paper", "tier.oral": "Oral", "tier.spotlight": "Spotlight",
      "rib.best": "★ Best Paper", "rib.honor": "Honorable Mention",
      "rib.oral": "Oral", "rib.spot": "Spotlight",
      "card.viewImage": "Details", "card.openImage": "Image ↗", "card.paper": "paper ↗",
      "card.aria": "View {t}",
      "end": "— End · {n} figures —",
    },
    zh: {
      "layout.columns": "列数",
      "brand.description": "顶会论文主图灵感画廊",
      "layout.display": "展示信息", "layout.full": "图片和文字", "layout.images": "仅图片",
      "count.base": "<b>{n}</b> / {m} 张",
      "chip.all": "全部",
      "pat.teaser": "主视觉", "pat.conceptual": "概念图", "pat.framework": "框架总览",
      "pat.pipeline": "流程图", "pat.architecture": "架构图",
      "pat.taxonomy": "全景 / 基准", "pat.results": "结果", "pat.comparison": "对比",
      "tier.best": "最佳论文", "tier.oral": "口头报告", "tier.spotlight": "焦点论文",
      "rib.best": "★ 最佳论文", "rib.honor": "荣誉提名",
      "rib.oral": "口头报告", "rib.spot": "焦点论文",
      "card.viewImage": "详情", "card.openImage": "图片 ↗", "card.paper": "论文 ↗",
      "card.aria": "查看 {t}",
      "end": "— 已加载全部 · 共 {n} 张 —",
    },
  });
  const patLabel = (p) => GAL_I18N.t("pat." + p);
  const tierLabel = (v) => GAL_I18N.t("tier." + v);

  const state = { venue: "all", year: "all", tier: "all", pattern: "all", q: "", sort: "venue" };
  const figures = (window.FIGURES || []).slice();
  let filtered = [];
  let shown = 0;

  const $ = (s) => document.querySelector(s);
  const gallery = $("#gallery");
  const countEl = $("#result-count");
  $("#display-mode").addEventListener("change", (e) => {
    gallery.classList.toggle("images-only", e.target.value === "images");
  });
  const empty = $("#empty");
  $("#column-count").addEventListener("change", (e) => {
    const columns = Number(e.target.value);
    if ([2, 3, 4, 5].includes(columns)) gallery.style.setProperty("--gallery-columns", columns);
  });
  const sentinel = $("#sentinel");
  const endHint = $("#end-hint");
  const nBest = figures.filter((f) => f.award).length;
  const nOral = figures.filter((f) => (f.award ? false : f.tier === "oral")).length;
  const nSpot = figures.filter((f) => (!f.award && f.tier === "spotlight")).length;

  /* ---------- filter dropdowns ---------- */
  const filterBoxes = [];
  function makeFilter(containerId, key, values, labelKeyFor, counts) {
    const box = $(containerId);
    ["all", ...values].forEach((v) => {
      const option = document.createElement("option");
      option.value = String(v);
      const lk = v === "all" ? "chip.all" : labelKeyFor(v);
      if (lk && lk.startsWith("static:")) option.dataset.static = lk.slice(7);
      else if (lk) option.dataset.lk = lk;
      else option.dataset.static = String(v);
      box.appendChild(option);
    });
    filterBoxes.push({ box, key, counts });
    box.addEventListener("change", () => {
      state[key] = box.value;
      render();
    });
  }

  const years = [...new Set(figures.map((f) => f.year))].sort();
  const usedPatterns = PATTERN_ORDER.filter((p) => figures.some((f) => f.pattern === p));

  makeFilter("#venue-filter", "venue", Object.keys(VENUES), (v) => "static:" + VENUES[v].name,
    Object.fromEntries(Object.keys(VENUES).map((v) => [v, figures.filter((f) => f.venue === v).length])));
  makeFilter("#year-filter", "year", years, () => null);
  makeFilter("#tier-filter", "tier", ["best", "oral", "spotlight"], (v) => "tier." + v,
    { best: nBest, oral: nOral, spotlight: nSpot });
  makeFilter("#pattern-filter", "pattern", usedPatterns, (v) => "pat." + v);

  function relabelFilters() {
    filterBoxes.forEach(({ box, counts }) => {
      [...box.options].forEach((option) => {
        const label = option.dataset.lk ? GAL_I18N.t(option.dataset.lk) : option.dataset.static;
        const n = counts?.[option.value];
        option.textContent = label + (n ? ` (${n})` : "");
      });
    });
  }
  relabelFilters();

  /* ---------- search ---------- */
  const searchInput = $("#search");
  const clearBtn = $("#clear-search");
  let qTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = searchInput.value.trim().toLowerCase();
      clearBtn.hidden = !state.q;
      render();
    }, 150);
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = ""; state.q = ""; clearBtn.hidden = true; render();
  });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
  $("#reset-all").addEventListener("click", () => {
    state.venue = state.year = state.tier = state.pattern = "all"; state.q = "";
    searchInput.value = ""; clearBtn.hidden = true;
    filterBoxes.forEach(({ box }) => { box.value = "all"; });
    render();
  });

  /* ---------- filtering / sorting ---------- */
  function matches(f) {
    if (state.venue !== "all" && f.venue !== state.venue) return false;
    if (state.year !== "all" && String(f.year) !== String(state.year)) return false;
    if (state.pattern !== "all" && f.pattern !== state.pattern) return false;
    if (state.tier === "best") { if (!f.award) return false; }
    else if (state.tier === "oral") { if (f.award || f.tier !== "oral") return false; }
    else if (state.tier === "spotlight") { if (f.award || f.tier !== "spotlight") return false; }
    if (state.q) {
      const hay = [f.title, (f.authors || []).join(" "), VENUES[f.venue].name,
                   f.year, f.pattern, PATTERNS[f.pattern] || "", patLabel(f.pattern),
                   f.tier ? TIERS[f.tier] : "", f.tier ? tierLabel(f.tier) : "",
                   f.award ? "best paper award outstanding 最佳论文" : ""]
        .join(" ").toLowerCase();
      if (!state.q.split(/\s+/).every((tok) => hay.includes(tok))) return false;
    }
    return true;
  }

  function sorted(list) {
    const venueRank = { iclr: 0, icml: 1, neurips: 2, cvpr: 3, acl: 4, aaai: 5 };
    const l = list.slice();
    if (state.sort === "year") l.sort((a, b) => a.year - b.year || venueRank[a.venue] - venueRank[b.venue] || a.id.localeCompare(b.id));
    else if (state.sort === "title") l.sort((a, b) => a.title.localeCompare(b.title));
    else l.sort((a, b) => venueRank[a.venue] - venueRank[b.venue] || a.year - b.year || a.id.localeCompare(b.id));
    return l;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function authorsText(f) {
    const a = f.authors || [];
    if (!a.length) return "";
    return a.length > 5 ? a.slice(0, 5).join(", ") + " et al." : a.join(", ");
  }

  /* ---------- chunked render ---------- */
  function ribbonInfo(f) {
    if (f.award === "best") return { className: "rb-best", key: "rib.best" };
    if (f.award === "honorable") return { className: "rb-honor", key: "rib.honor" };
    if (f.tier === "oral") return { className: "rb-oral", key: "rib.oral" };
    if (f.tier === "spotlight") return { className: "rb-spotlight", key: "rib.spot" };
    return null;
  }
  function ribbonHtml(f) {
    const info = ribbonInfo(f);
    return info ? `<span class="badge tier-badge ${info.className}">${GAL_I18N.t(info.key)}</span>` : "";
  }
  function cardHtml(f, idx) {
    const ratio = (f.w && f.h) ? `aspect-ratio:${f.w} / ${f.h};` : "min-height:170px;";
    const eager = idx < 24;
    const imgAttrs = eager ? `src="${f.image}"` : `data-src="${f.image}"`;
    return `
    <article class="card${f.award ? " is-award" : f.tier ? " is-" + f.tier : ""}" data-id="${f.id}">
      <button type="button" class="img-slot" style="${ratio}" aria-label="${GAL_I18N.t("card.aria", { t: escapeHtml(f.title) })}">
        <img class="card-img${eager ? " loaded" : ""}" ${imgAttrs} alt="${escapeHtml(f.title)} Figure 1" decoding="async">
      </button>
      <div class="card-body">
        <div class="card-badges">
          <span class="card-meta-text">${VENUES[f.venue].name}</span>
          <span class="card-meta-text">${f.year}</span>
          <span class="card-meta-text">${patLabel(f.pattern)}</span>
          ${ribbonHtml(f)}
        </div>
        <h3 class="card-title">${escapeHtml(f.title)}</h3>
        <p class="card-authors">${escapeHtml(authorsText(f))}</p>
        <span class="card-link"><button class="card-link-image" type="button" aria-label="${GAL_I18N.t("card.aria", { t: escapeHtml(f.title) })}">${GAL_I18N.t("card.viewImage")}</button><span class="card-link-separator">/</span><a class="card-link-open" href="${escapeHtml(f.image)}" target="_blank" rel="noopener noreferrer">${GAL_I18N.t("card.openImage")}</a>${f.paper ? `<span class="card-link-separator">/</span><a class="card-link-paper" href="${escapeHtml(f.paper)}" target="_blank" rel="noopener noreferrer">${GAL_I18N.t("card.paper")}</a>` : ""}</span>
      </div>
    </article>`;
  }

  /* ---------- custom lazy loading (preloads ~2 screens ahead) ---------- */
  let lazyIO = null;
  const wiredImages = new WeakSet();
  function wireImg(img) {
    if (wiredImages.has(img)) return;
    wiredImages.add(img);
    const slot = img.parentElement;
    function markLoaded() { img.classList.add("loaded"); slot.classList.add("loaded"); }
    if (img.complete && img.naturalWidth > 0) { markLoaded(); return; }
    img.addEventListener("load", markLoaded, { once: true });
    img.addEventListener("error", () => {
      if (img.dataset.src && !img.dataset.retried) {
        img.dataset.retried = "1";
        setTimeout(() => { img.src = img.dataset.src + "?retry=1"; }, 1200);
      } else if (img.dataset.src) {
        slot.classList.add("img-failed");
        slot.addEventListener("click", function once() {
          slot.classList.remove("img-failed");
          img.dataset.retried = "";
          img.src = img.dataset.src;
        }, { once: true });
      } else {
        slot.classList.add("img-failed");
      }
    });
    if ("IntersectionObserver" in window) {
      if (!lazyIO) {
        lazyIO = new IntersectionObserver((entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              const im = en.target;
              if (im.dataset.src && !im.src) im.src = im.dataset.src;
              lazyIO.unobserve(im);
            }
          });
        }, { rootMargin: "1800px 0px" });
      }
      lazyIO.observe(img);
    } else if (img.dataset.src) {
      img.src = img.dataset.src;
    }
  }
  function appendChunk() {
    const slice = filtered.slice(shown, shown + PAGE);
    const template = document.createElement("template");
    template.innerHTML = slice.map((f, i) => cardHtml(f, shown + i)).join("");
    const newImages = template.content.querySelectorAll(".card-img");
    gallery.appendChild(template.content);
    newImages.forEach(wireImg);
    // IntersectionObserver also detects cards moved into view by column reflow.
    // Do not rescan old cards or alternate geometry reads with src writes here.
    shown += slice.length;
    if (shown >= filtered.length) {
      sentinel.hidden = true;
      endHint.hidden = filtered.length <= PAGE;
      endHint.textContent = GAL_I18N.t("end", { n: filtered.length.toLocaleString() });
    } else {
      sentinel.hidden = false;
      endHint.hidden = true;
    }
  }

  function render() {
    filtered = sorted(figures.filter(matches));
    // Filter/sort/search changes rewrite the query only; the figure hash, if the
    // lightbox happens to be open, is carried through untouched.
    writeUrl("replaceState", location.hash);
    if (lazyIO) lazyIO.disconnect();
    gallery.innerHTML = "";
    shown = 0;
    empty.hidden = filtered.length > 0;
    appendChunk();
    countEl.innerHTML = GAL_I18N.t("count.base", {
      n: filtered.length.toLocaleString(), m: figures.length.toLocaleString(),
    });

  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !sentinel.hidden) appendChunk();
    }, { rootMargin: "1400px" });
    io.observe(sentinel);
  } else {
    window.addEventListener("scroll", () => {
      const r = sentinel.getBoundingClientRect();
      if (!sentinel.hidden && r.top < window.innerHeight + 1400) appendChunk();
    }, { passive: true });
  }

  /* ---------- shareable URL state (filters in the query, figure in the hash) ----------
     Filters and the search box live in ?v=&y=&t=&p=&q=&s=, the open figure lives in
     #f=<id>. Hash-only writes never reload GitHub Pages, so switching figures or
     clearing the hash costs nothing. */
  const URL_KEYS = ["v", "y", "t", "p", "q", "s"];
  let internalUrlWrite = false;

  function validFilter(key, value) {
    if (key === "v") return value === "all" || Object.prototype.hasOwnProperty.call(VENUES, value);
    if (key === "y") return value === "all" || years.some((x) => String(x) === value);
    if (key === "t") return value === "all" || Object.prototype.hasOwnProperty.call(TIERS, value);
    if (key === "p") return value === "all" || Object.prototype.hasOwnProperty.call(PATTERNS, value);
    if (key === "s") return ["venue", "year", "title"].indexOf(value) !== -1;
    if (key === "q") return true;
    return false;
  }

  // Unknown params are preserved so this never strips somebody else's tracking
  // link (?utm_source=…) off a shared URL.
  function queryString() {
    const params = new URLSearchParams(location.search);
    URL_KEYS.forEach((key) => params.delete(key));
    if (state.venue !== "all") params.set("v", state.venue);
    if (state.year !== "all") params.set("y", state.year);
    if (state.tier !== "all") params.set("t", state.tier);
    if (state.pattern !== "all") params.set("p", state.pattern);
    if (state.q) params.set("q", state.q);
    if (state.sort !== "venue") params.set("s", state.sort);
    return params.toString();
  }

  function writeUrl(method, hash) {
    const query = queryString();
    const url = location.pathname + (query ? "?" + query : "") + (hash || "");
    internalUrlWrite = true;
    try {
      history[method](history.state, "", url);
    } catch (_) {
      location.hash = hash || "";
    } finally {
      internalUrlWrite = false;
    }
  }

  function figureHash() {
    const match = /^#f=([A-Za-z0-9._-]+)$/.exec(location.hash);
    return match ? match[1] : null;
  }

  /* ---------- lightbox with prev/next over the filtered list ---------- */
  const lb = $("#lightbox");
  const lbImg = $("#lb-img");
  const lbClose = $("#lb-close");
  const lbDialog = lb.querySelector(".lightbox-dialog");
  const lbContent = lb.querySelector(".lightbox-content");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentId = null;
  let lightboxBusy = false;
  let opener = null;
  // Set while a router-driven open/close runs, so the transition's own state
  // changes are not mistaken for a user navigation.
  let routerBusy = false;

  function currentIndex() { return filtered.findIndex((x) => x.id === currentId); }

  function lightboxControls() {
    return Array.from(lbDialog.querySelectorAll("a[href], button:not([disabled])"))
      .filter((element) => getComputedStyle(element).visibility !== "hidden");
  }

  function trapLightboxFocus(e) {
    if (e.key !== "Tab" || lb.hidden) return;
    const controls = lightboxControls();
    if (!controls.length) { e.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  function positionLightboxNav() {
    const imageRect = lb.querySelector(".lightbox-img-wrap").getBoundingClientRect();
    if (!imageRect.height) return;
    const center = `${imageRect.top + imageRect.height / 2}px`;
    $("#lb-prev").style.top = center;
    $("#lb-next").style.top = center;
  }

  function setFigureContent(f) {
    currentId = f.id;
    // Reserve the final aspect ratio even when the full image has not decoded.
    if (f.w && f.h) {
      lbImg.width = f.w;
      lbImg.height = f.h;
    } else {
      lbImg.removeAttribute("width");
      lbImg.removeAttribute("height");
    }
    lbImg.src = f.image;
    lbImg.alt = f.title;
    const aBadge = $("#lb-award");
    if (f.award) {
      aBadge.hidden = false;
      aBadge.textContent = GAL_I18N.t(f.award === "best" ? "rib.best" : "rib.honor");
      aBadge.className = "badge tier-badge " + (f.award === "best" ? "rb-best" : "rb-honor");
    } else aBadge.hidden = true;
    const tBadge = $("#lb-tier");
    if (f.tier) {
      tBadge.hidden = false;
      tBadge.textContent = tierLabel(f.tier);
      tBadge.className = "badge tier-badge " + (f.tier === "oral" ? "rb-oral" : "rb-spotlight");
    } else tBadge.hidden = true;
    const vBadge = $("#lb-venue");
    vBadge.textContent = VENUES[f.venue].name;
    vBadge.className = "badge " + f.venue;
    $("#lb-year").textContent = f.year;
    const pBadge = $("#lb-pattern");
    pBadge.textContent = patLabel(f.pattern);
    $("#lb-title").textContent = f.title;
    $("#lb-authors").textContent = (f.authors || []).join(", ");
    $("#lb-paper").href = f.paper || "#";
    $("#lb-image").href = f.image;
    const i = currentIndex();
    $("#lb-prev").style.visibility = i > 0 ? "visible" : "hidden";
    $("#lb-next").style.visibility = i < filtered.length - 1 ? "visible" : "hidden";
  }

  function cardFor(id) {
    return Array.from(gallery.querySelectorAll(".card")).find((card) => card.dataset.id === id) || null;
  }

  function canTransition() {
    return typeof lbDialog.animate === "function" && !reducedMotion.matches;
  }

  async function prepareLightboxImage(f) {
    // Prepare the next image without changing the currently visible image.
    // A slow/failed request must never freeze rendering or lock navigation.
    const image = new Image();
    image.src = f.image;
    if (typeof image.decode !== "function") return false;
    let timer;
    try {
      return await Promise.race([
        image.decode().then(() => true, () => false),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), 200); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function transitionLightbox(update, options) {
    const { direction, card, animate = true } = options;
    if (!animate || !canTransition()) {
      update();
      return;
    }

    // Animate live elements with transform/opacity only. View Transition groups
    // interpolate width/height and capture the entire gallery plus every part.
    const closing = direction === "closing";
    const switching = direction.startsWith("switch-");
    const candidate = card && card.getBoundingClientRect();
    const cardRect = candidate && candidate.width > 0 && candidate.height > 0
      && candidate.bottom > 0 && candidate.right > 0
      && candidate.top < window.innerHeight && candidate.left < window.innerWidth
      ? candidate : null;
    document.documentElement.dataset.figureTransition = direction;
    const animations = [];
    try {
      if (!closing) update();
      if (switching) {
        const x = direction === "switch-next" ? 24 : -24;
        animations.push(lbContent.animate([
          { transform: `translateX(${x}px)`, opacity: 0 },
          { transform: "translateX(0)", opacity: 1 },
        ], { duration: 180, easing: "ease-out", fill: "both" }));
      } else {
        const rect = lbDialog.getBoundingClientRect();
        // Keep the panel close to its final raster size. A full card-to-dialog
        // zoom moves hundreds of pixels in a few frames, making uneven frame
        // delivery more noticeable. Hint at the card direction with
        // bounded movement, while keeping the image/text at nearly full size.
        const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
        const x = cardRect ? clamp(cardRect.left + cardRect.width / 2 - rect.left - rect.width / 2, 16) : 0;
        const y = cardRect ? clamp(cardRect.top + cardRect.height / 2 - rect.top - rect.height / 2, 12) : 12;
        const from = `translate(${x}px, ${y}px) scale(.97)`;
        const small = { transform: from, opacity: 0 };
        const full = { transform: "translate(0, 0) scale(1)", opacity: 1 };
        animations.push(lbDialog.animate(closing ? [full, small] : [small, full], {
          duration: closing ? 160 : 200,
          easing: closing ? "ease-in" : "cubic-bezier(.22,.61,.36,1)",
          fill: "both",
        }));
        animations.push(lb.querySelector(".lightbox-backdrop").animate(
          closing ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }],
          { duration: closing ? 160 : 200, easing: "ease-out", fill: "both" },
        ));
      }
      await Promise.allSettled(animations.map(animation => animation.finished));
    } finally {
      if (closing) update();
      // Release temporary compositor layers and inline animation effects.
      animations.forEach(animation => animation.cancel());
      delete document.documentElement.dataset.figureTransition;
    }
  }

  async function openFigure(f, card) {
    if (lightboxBusy || !lb.hidden) return;
    // Written before the transition so a share taken mid-animation already has
    // the right URL. pushState keeps one history entry so Back returns to the grid.
    if (!card) writeUrl("replaceState", "#f=" + f.id);
    else writeUrl("pushState", "#f=" + f.id);
    lightboxBusy = true;
    opener = card || document.activeElement;
    lbDialog.style.height = "";
    try {
      // The clicked card already requested this image. Show the live preview
      // immediately rather than waiting for another image.decode().
      setFigureContent(f);
      await transitionLightbox(() => {
        lb.hidden = false;
        document.body.style.overflow = "hidden";
      }, {
        card,
        direction: "opening",
      });
      positionLightboxNav();
      lbClose.focus({ preventScroll: true });
    } finally {
      lightboxBusy = false;
    }
  }

  async function step(d) {
    if (lightboxBusy) return;
    const i = currentIndex();
    const j = i + d;
    if (j < 0 || j >= filtered.length) return;

    lightboxBusy = true;
    // Stepping replaces the entry instead of stacking one per figure, so Back
    // always returns to the grid rather than walking through the whole list.
    writeUrl("replaceState", "#f=" + filtered[j].id);
    if (!lbDialog.style.height) {
      lbDialog.style.height = `${lbDialog.getBoundingClientRect().height}px`;
    }
    try {
      const imageReady = await prepareLightboxImage(filtered[j]);
      await transitionLightbox(() => {
        setFigureContent(filtered[j]);
      }, {
        direction: d > 0 ? "switch-next" : "switch-prev",
        animate: imageReady,
      });
      positionLightboxNav();
    } finally {
      lightboxBusy = false;
    }
  }

  async function closeLb() {
    if (lightboxBusy || lb.hidden) return;
    lightboxBusy = true;
    const targetCard = cardFor(currentId);
    const returnFocus = targetCard?.querySelector(gallery.classList.contains("images-only") ? ".img-slot" : ".card-link-image") || opener;

    try {
      await transitionLightbox(() => {
        lb.hidden = true;
        document.body.style.overflow = "";
      }, {
        card: targetCard,
        direction: "closing",
      });
      if (returnFocus && typeof returnFocus.focus === "function") {
        returnFocus.focus({ preventScroll: true });
      }
    } finally {
      lbDialog.style.height = "";
      lightboxBusy = false;
    }
    // After the flags are cleared so the URL write cannot race the close.
    writeUrl("replaceState", "");
  }

  /* ---------- URL -> UI ---------- */
  function syncUiFromState() {
    filterBoxes.forEach(({ box, key }) => { box.value = state[key]; });
    searchInput.value = state.q;
    clearBtn.hidden = !state.q;
    $("#sort").value = state.sort;
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    ["v", "y", "t", "p", "s", "q"].forEach((key) => {
      if (!params.has(key)) return;
      const value = params.get(key);
      if (!validFilter(key, value)) return;
      if (key === "v") state.venue = value;
      else if (key === "y") state.year = value;
      else if (key === "t") state.tier = value;
      else if (key === "p") state.pattern = value;
      else if (key === "s") state.sort = value;
      else if (key === "q") state.q = value.trim().toLowerCase();
    });
  }

  // The only place the lightbox is opened or closed without a click.
  async function applyHashToLightbox() {
    const id = figureHash();
    if (id === currentId) return;
    if (id === null) {
      if (!lb.hidden) await closeLb();
      return;
    }
    if (!lb.hidden) {
      // Another entry for a figure already on screen (Back/Forward): swap in place.
      const openF = filtered.find((x) => x.id === id);
      if (openF) {
        setFigureContent(openF);
        positionLightboxNav();
      }
      return;
    }
    const f = figures.find((x) => x.id === id);
    if (!f) return; // unknown or stale id: leave the grid alone
    if (!filtered.some((x) => x.id === id)) {
      // The link carries filters that hide its own target — drop only what gets
      // in the way, then re-render, so a shared figure is actually visible.
      if (state.venue !== "all" && f.venue !== state.venue) state.venue = "all";
      if (state.year !== "all" && String(f.year) !== String(state.year)) state.year = "all";
      if (state.tier !== "all" && !matches(f)) state.tier = "all";
      if (state.pattern !== "all" && f.pattern !== state.pattern) state.pattern = "all";
      if (state.q && !matches(f)) state.q = "";
      syncUiFromState();
      render();
    }
    await openFigure(f, null);
  }

  async function runUrlChange() {
    const before = JSON.stringify(state);
    readUrlState();
    if (JSON.stringify(state) !== before) {
      syncUiFromState();
      render();
    }
    await applyHashToLightbox();
  }

  function handleUrlChange() {
    if (internalUrlWrite) return;
    routerBusy = true;
    const attempt = (tries) => {
      // Opening and closing run a short panel animation, so
      // lightboxBusy can still be set when Back arrives. Returning immediately
      // used to drop the navigation entirely: the hash cleared but the dialog
      // stayed open and the page stayed scroll-locked, which reads as "Back does
      // nothing". Wait for the in-flight transition instead of discarding it.
      if (lightboxBusy && tries < 40) {
        setTimeout(() => attempt(tries + 1), 120);
        return;
      }
      if (lightboxBusy) { routerBusy = false; return; }
      runUrlChange()
        .catch(() => { /* keep the grid usable if a transition fails */ })
        .then(() => { routerBusy = false; });
    };
    attempt(0);
  }

  window.addEventListener("popstate", handleUrlChange);
  // hashchange is a backstop for engines where a hash-only popstate does not
  // fire; applyHashToLightbox is a no-op when the id already matches.
  window.addEventListener("hashchange", handleUrlChange);

  gallery.addEventListener("click", (e) => {
    if (!e.target.closest(".img-slot, .card-link-image")) return;
    const card = e.target.closest(".card");
    if (card) {
      const f = figures.find((x) => x.id === card.dataset.id);
      if (f) openFigure(f, card);
    }
  });
  lbClose.addEventListener("click", closeLb);
  lbImg.addEventListener("load", () => {
    if (!lb.hidden && !lightboxBusy) {
      positionLightboxNav();
    }
  });
  $("#lb-prev").addEventListener("click", () => step(-1));
  $("#lb-next").addEventListener("click", () => step(1));
  lb.querySelector(".lightbox-backdrop").addEventListener("click", closeLb);
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    trapLightboxFocus(e);
    if (e.key === "Escape") closeLb();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  window.addEventListener("resize", () => {
    if (!lb.hidden && !lightboxBusy) {
      positionLightboxNav();
    }
  });

  /* ---------- language toggle ---------- */
  const langToggle = $("#lang-toggle");
  function syncToggle() {
    langToggle.textContent = GAL_I18N.lang === "zh" ? "EN" : "中";
    langToggle.title = GAL_I18N.t("toggle.title");
  }
  langToggle.addEventListener("click", () => {
    GAL_I18N.setLang(GAL_I18N.lang === "zh" ? "en" : "zh");
  });
  document.addEventListener("langchange", () => {
    syncToggle();
    relabelFilters();
    if (!lb.hidden && currentId) {
      const f = figures.find((x) => x.id === currentId);
      if (f) setFigureContent(f);
    }
    render();
  });

  syncToggle();
  GAL_I18N.apply();
  // Filters from the URL must be in state before the first render, otherwise the
  // grid paints the unfiltered list for one frame.
  readUrlState();
  syncUiFromState();
  render();
  // Cold start: `#f=<id>` from a shared link opens that figure, which also warms
  // the 60-card chunk it lives in whenever the filters still include it.
  // `window.__tcLastError` records a failed cold start for debugging; it is never
  // user-visible and never blocks the grid.
  applyHashToLightbox().catch((err) => { window.__tcLastError = String((err && err.stack) || err); });
})();
