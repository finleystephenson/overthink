// Brand motion shared by every page. None of this touches business logic (that lives in app.js and the engine).
// One motion language: springs for things you touch, a long ease for things that arrive.
// Everything here checks prefers-reduced-motion and leaves the page fully usable without it.
const root = document.documentElement;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;

// 1. The logo turns as you scroll: the O that goes round once more than it needs to.
let ticking = false;
addEventListener("scroll", () => {
  if (ticking || calm) return;
  ticking = true;
  requestAnimationFrame(() => { root.style.setProperty("--turn", (scrollY * 0.35).toFixed(1) + "deg"); ticking = false; });
}, { passive: true });

// 2. Sections and cards rise in as they reach the screen.
// Hiding only starts once we know the observer can show them again (.can-rise on <html>).
const risers = document.querySelectorAll("[data-rise]");
if (!calm && "IntersectionObserver" in window && risers.length) {
  root.classList.add("can-rise");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
  risers.forEach((el) => io.observe(el));
}

// 3. Pictures tilt gently towards the pointer (mouse and trackpad only).
if (!calm && fine) {
  document.querySelectorAll("[data-tilt]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty("--rx", (-y * 7).toFixed(2) + "deg");
      el.style.setProperty("--ry", (x * 9).toFixed(2) + "deg");
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
  });
}

// 4. The home stage: one product at a time, and the whole page takes that product's colour.
// The dots are a progress bar; hovering or focusing the stage pauses it.
const stage = document.querySelector("[data-stage]");
if (stage) {
  const slides = [...stage.querySelectorAll(".slide")], caps = [...stage.querySelectorAll(".cap")], dots = [...stage.querySelectorAll(".dots button")];
  const DUR = 4200;
  let i = 0, timer = null;
  stage.style.setProperty("--dur", DUR + "ms");
  if (calm) stage.classList.add("still");
  const show = (n) => {
    const prev = i;
    i = (n + slides.length) % slides.length;
    const mark = (list) => list.forEach((el, k) => {
      el.classList.toggle("on", k === i);
      el.classList.toggle("out", k === prev && prev !== i);
      el.setAttribute("aria-hidden", String(k !== i));
      el.tabIndex = k === i ? 0 : -1;
    });
    mark(slides); mark(caps);
    dots.forEach((d, k) => { d.classList.remove("on"); d.setAttribute("aria-pressed", String(k === i)); });
    void stage.offsetWidth; // restart the progress fill
    dots[i].classList.add("on");
    document.body.style.setProperty("--ground", slides[i].dataset.ground);
  };
  const play = () => {
    clearTimeout(timer); stage.classList.remove("paused");
    if (calm) return;
    timer = setTimeout(() => { show(i + 1); play(); }, DUR);
  };
  const pause = () => { clearTimeout(timer); stage.classList.add("paused"); };
  dots.forEach((d, k) => d.addEventListener("click", () => { show(k); play(); }));
  const pics = stage.querySelector(".stage-pics");
  pics.addEventListener("pointerenter", pause);
  pics.addEventListener("pointerleave", () => { show(i); play(); });
  stage.addEventListener("focusin", pause);
  stage.addEventListener("focusout", (e) => { if (!stage.contains(e.relatedTarget)) { show(i); play(); } });
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
  // Swipe on touch screens.
  let x0 = null;
  pics.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
  pics.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) { show(i + (dx < 0 ? 1 : -1)); play(); }
  });
  // Fit each product to the stage. The cut-outs have different amounts of empty space around them, so each one is
  // scaled from its own opaque pixels to fill the stage box (with room for the float) and centred in it, never larger.
  // The picture therefore stays inside its own grid cell and cannot reach the headline or the caption, whatever the
  // window size. If a picture can't be measured (opened from disk), it simply shows whole at its natural size.
  const inkOf = (img) => {
    try {
      const c = document.createElement("canvas"); c.width = 160; c.height = 90;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 160, 90);
      const d = x.getImageData(0, 0, 160, 90).data; let l = 160, t = 90, r = -1, b = -1;
      for (let y = 0; y < 90; y++) for (let X = 0; X < 160; X++) if (d[(y * 160 + X) * 4 + 3] > 40) { if (X < l) l = X; if (X > r) r = X; if (y < t) t = y; if (y > b) b = y; }
      return r < 0 ? null : { l: l / 160, t: t / 90, r: (r + 1) / 160, b: (b + 1) / 90 };
    } catch { return null; }
  };
  const fit = (img) => {
    const W = pics.clientWidth, H = pics.clientHeight, ink = img._ink;
    if (!ink || !W || !H || !img.naturalWidth) return;
    const ar = img.naturalWidth / img.naturalHeight; let cw = W, ch = W / ar; if (ch > H) { ch = H; cw = H * ar; }
    const k = Math.min((W * 0.92) / ((ink.r - ink.l) * cw), (H * 0.9) / ((ink.b - ink.t) * ch), 1.7);
    const dx = ((ink.l + ink.r) / 2 - 0.5) * cw * k, dy = ((ink.t + ink.b) / 2 - 0.5) * ch * k;
    img.style.scale = k.toFixed(3); img.style.translate = `${(-dx).toFixed(1)}px ${(-dy).toFixed(1)}px`;
  };
  const stageImgs = slides.map((s) => s.querySelector("img")).filter((img) => img && img.classList.contains("cut"));
  const measure = (img) => { img._ink = inkOf(img); fit(img); };
  stageImgs.forEach((img) => (img.complete && img.naturalWidth ? measure(img) : img.addEventListener("load", () => measure(img), { once: true })));
  new ResizeObserver(() => stageImgs.forEach(fit)).observe(pics);
  show(0); play();
}

// A side panel (order summary, help actions, policy links, product picture) sticks while you scroll only if it fits on
// the screen; a taller one scrolls with the page, so its bottom (the Place order button, the last links) never hides.
{
  const fitSticky = (el) => { el.classList.remove("unstick"); if (getComputedStyle(el).position === "sticky") el.classList.toggle("unstick", el.offsetHeight > innerHeight - (parseFloat(getComputedStyle(el).top) || 0) - 16); };
  const watch = (el) => { const ro = new ResizeObserver(() => fitSticky(el)); ro.observe(el); addEventListener("resize", () => fitSticky(el)); };
  const found = new Set();
  const scan = () => document.querySelectorAll("aside.panel, .help-side, .doc aside, .pdp-pic").forEach((el) => { if (!found.has(el)) { found.add(el); watch(el); } });
  scan(); new MutationObserver(scan).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
}

// 5. The picture on a product page. Two things can change it: choosing an option (the sandwich by filling) and
// the thumbnails under it when there is more than one picture. Both use one swap: the new picture is loaded first,
// then fades and settles in over the old one; the frame never changes size, and the page colour eases to the new
// picture's backdrop so no seam shows. Thumbnails also answer the arrow keys, and the picture swipes on phones.
const frame = document.querySelector(".pdp-pic .pic");
if (frame && frame.querySelector("img")) {
  const box = frame.closest(".pdp-pic");
  const prod = document.querySelector("[data-variant-images]");
  const map = prod ? JSON.parse(prod.dataset.variantImages) : null;
  const group = map && prod.querySelector(`[data-option="${CSS.escape(map.option)}"]`);
  const thumbs = [...box.querySelectorAll(".thumb")];
  let want = frame.querySelector("img").getAttribute("src");

  // A picture: { src, srcset, cut, ground } (from the option map or a thumbnail's data attributes).
  const fromThumb = (t) => ({ src: t.dataset.src, srcset: t.dataset.srcset, cut: t.dataset.cut !== "false", ground: t.dataset.ground });
  // Warm the cache so a click swaps at once.
  const warm = () => [...(map ? Object.values(map.images) : []), ...thumbs.map(fromThumb)].forEach(({ src }) => { const i = new Image(); i.src = src; });
  if (map || thumbs.length) "requestIdleCallback" in window ? requestIdleCallback(warm) : setTimeout(warm, 1200);

  const show = async (pic) => {
    if (!pic?.src || pic.src === want) return;
    const { src, srcset, ground } = pic;
    want = src;
    const old = [...frame.querySelectorAll("img")], img = new Image();
    if (srcset) { img.sizes = old[0]?.sizes || "100vw"; img.srcset = srcset; }
    img.src = src; img.alt = old[0]?.alt || ""; img.width = 1280; img.height = 720;
    img.className = pic.cut === false ? "framed" : "cut";
    try { await img.decode(); } catch { /* show it anyway */ }
    if (want !== src) return; // a later click won
    if (ground) { frame.style.setProperty("--c", ground); document.body.style.setProperty("--ground", ground); }
    if (calm) { old.forEach((o) => o.remove()); frame.append(img); return; }
    // The old picture drops away first; the new one pops in only once it has gone (site.css .incoming waits .2s).
    img.classList.add("incoming"); frame.append(img);
    old.forEach((o) => { o.classList.add("leaving"); setTimeout(() => o.remove(), 260); });
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add("in")));
    setTimeout(() => img.classList.remove("incoming", "in"), 1000);
  };
  const mark = (k) => thumbs.forEach((t, j) => { t.classList.toggle("on", j === k); t.setAttribute("aria-pressed", String(j === k)); });
  const current = () => thumbs.findIndex((t) => t.classList.contains("on"));
  const go = (k, focus) => {
    if (!thumbs.length) return;
    k = (k + thumbs.length) % thumbs.length;
    mark(k); show(fromThumb(thumbs[k]));
    if (focus) thumbs[k].focus();
  };

  thumbs.forEach((t, k) => t.addEventListener("click", () => go(k)));
  // Arrow keys: anywhere on the page except while typing or choosing in a form control.
  if (thumbs.length > 1) document.addEventListener("keydown", (e) => {
    if (!/^Arrow(Left|Right)$/.test(e.key) || e.altKey || e.metaKey || e.ctrlKey || e.target.closest?.("input, select, textarea, [contenteditable]")) return;
    e.preventDefault();
    go(Math.max(0, current()) + (e.key === "ArrowRight" ? 1 : -1), box.contains(document.activeElement));
  });
  // Swipe on touch screens.
  let x0 = null, y0 = null;
  if (thumbs.length > 1) {
    frame.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    frame.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(Math.max(0, current()) + (dx < 0 ? 1 : -1));
    });
  }
  // Choosing an option shows that option's picture. If the same picture is a thumbnail, that thumbnail is selected;
  // if not, the first thumbnail (the "chosen option" picture) takes it, so the row always matches what is shown.
  group?.addEventListener("click", () => setTimeout(() => {
    const on = group.querySelector('[aria-pressed="true"]'), next = on && map.images[on.dataset.value];
    if (!next) return;
    if (thumbs.length) {
      let k = thumbs.findIndex((t) => t.dataset.src === next.src);
      if (k < 0) {
        k = 0; Object.assign(thumbs[0].dataset, { src: next.src, srcset: next.srcset || "", cut: String(next.cut !== false), ground: next.ground });
        thumbs[0].style.setProperty("--c", next.ground);
        const ti = thumbs[0].querySelector("img"); ti.srcset = ""; ti.src = (next.srcset || "").split(" ")[0] || next.src; ti.className = next.cut === false ? "framed" : "cut";
      }
      mark(k);
    }
    show(next);
  }, 0));
}
