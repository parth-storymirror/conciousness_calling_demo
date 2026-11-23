(function () {
  var pages = [
    ["index.html", "Home"],
    ["about.html", "About"],
    ["book.html", "Book One"],
    ["explore.html", "Explore Consciousness Calling"],
    ["inner-sun.html", "Inner Sun"],
    ["light-code.html", "Light Codes"],
    ["my-writing.html", "Future Writings"],
    ["faqs.html", "FAQs"],
    ["downloads.html", "Downloads"],
    ["connect.html", "Connect"]
  ];
  var here = location.pathname.split("/").pop() || "index.html";
  var aboutPages = ["about.html", "ra-soul.html", "vision.html", "mission.html", "great-transition.html", "master-light.html"];
  if (aboutPages.indexOf(here) > -1) here = "about.html";

  var links = pages.map(function (p) {
    var cur = p[0] === here ? ' aria-current="page"' : "";
    return '<a href="' + (p[0] === "index.html" ? "/" : p[0]) + '"' + cur + ">" + p[1] + "</a>";
  }).join("");

  var header =
    '<header class="site-header"><div class="wrap">' +
    '<a class="brand" href="/"><img src="assets/img/img-02-emblem-transparent.png" alt="Heart Awakening emblem"><span>CONSCIOUSNESS CALLING</span></a>' +
    '<button class="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span></button>' +
    '<nav class="nav" id="nav" aria-label="Main">' + links + "</nav>" +
    "</div></header>";

  // About and the Vision page are one section: show a sub-nav so the current page is obvious.
  // About is one section with five pages: show a sub-nav so the current page is obvious.
  var cur = location.pathname.split("/").pop() || "index.html";
  var subnav = "";
  if (aboutPages.indexOf(cur) > -1) {
    var sub = [
      ["about.html", "About the Author"],
      ["ra-soul.html", "RA SOUL"],
      ["vision.html", "The Consciousness Calling Vision"],
      ["mission.html", "Our Mission"],
      ["great-transition.html", "The Great Transition"],
      ["master-light.html", "The Master Light"]
    ];
    subnav =
      '<nav class="subnav" aria-label="About section"><div class="wrap">' +
      sub.map(function (p) {
        return '<a href="' + p[0] + '"' + (p[0] === cur ? ' aria-current="page"' : "") + ">" + p[1] + "</a>";
      }).join("") +
      "</div></nav>";
  }
  header += subnav;

  document.body.insertAdjacentHTML("afterbegin", header);

  var footer =
    '<footer class="site-footer"><div class="wrap">' +
    '<div class="foot-grid">' +
    '<div><a class="foot-brand" href="/"><img src="assets/img/img-02-emblem-transparent.png" alt=""><span>CONSCIOUSNESS CALLING</span></a>' +
    '<p class="foot-line">One Heart. One Consciousness. One Living Field.</p></div>' +
    '<div><h4>Explore</h4><ul>' +
    '<li><a href="/">Home</a></li>' +
    '<li><a href="book.html">Book One</a></li>' +
    '<li><a href="explore.html">Explore Consciousness Calling</a></li>' +
    '<li><a href="inner-sun.html">Inner Sun</a></li>' +
    '<li><a href="light-code.html">Light Codes</a></li>' +
    '<li><a href="my-writing.html">Future Writings</a></li>' +
    '<li><a href="faqs.html">FAQs</a></li>' +
    '<li><a href="downloads.html">Downloads</a></li></ul></div>' +
    '<div><h4>About</h4><ul>' +
    '<li><a href="about.html">About the Author</a></li>' +
    '<li><a href="ra-soul.html">RA SOUL</a></li>' +
    '<li><a href="vision.html">The Consciousness Calling Vision</a></li>' +
    '<li><a href="mission.html">Our Mission</a></li>' +
    '<li><a href="great-transition.html">The Great Transition</a></li>' +
    '<li><a href="master-light.html">The Master Light</a></li></ul></div>' +
    '<div><h4>Connect</h4><ul>' +
    '<li><a href="connect.html#updates">Subscribe</a></li>' +
    '<li><a href="connect.html#contact">Contact the Author</a></li>' +
    '<li><a href="connect.html#follow">Follow RaSoul</a></li>' +
    '<li><a href="connect.html#inner-sun">Join Inner Sun</a></li>' +
    '</ul></div>' +
    '</div>' +
    '<p class="foot-base">Recognize the Presence within. Live Light &amp; Love.</p>' +
    '</div></footer>';
  document.body.insertAdjacentHTML("beforeend", footer);

  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("nav");
  btn.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });

  // Follow Book Updates: saves the address on the server. It does not send any email.
  document.querySelectorAll("form[data-subscribe]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = f.querySelector(".form-msg");
      var submit = f.querySelector("button[type=submit]");
      var field = function (n) { return f.elements[n] ? f.elements[n].value : ""; };
      submit.disabled = true;
      msg.textContent = "Please wait…";
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: field("name"), email: field("email"), hp_trap: field("hp_trap") })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok, d: d }; });
      }).then(function (r) {
        if (r.ok) { msg.textContent = "Thank you for subscribing."; f.reset(); }
        else msg.textContent = r.d.error || "Something went wrong. Please try again.";
      }).catch(function () {
        msg.textContent = "Sign-up is not available right now. Please try again later.";
      }).then(function () { submit.disabled = false; });
    });
  });

  // Scrolling announcement bar under the menu on the home page (messages and their buttons are set from the admin).
  if (here === "index.html") {
    fetch("/api/banner", { headers: { Accept: "application/json" } }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (b) {
      if (!b || !b.enabled || !b.items || !b.items.length) return;
      var header = document.querySelector(".site-header");
      if (!header) return;
      var bar = document.createElement("div");
      bar.className = "top-banner";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Announcements");
      var view = document.createElement("div");
      view.className = "tb-marquee";
      var track = document.createElement("div");
      track.className = "tb-track";
      var copies = b.items.length < 3 ? 3 : 2; // enough content to fill wide screens
      for (var i = 0; i < 2; i++) {
        var group = document.createElement("div");
        group.className = "tb-group";
        if (i === 1) group.setAttribute("aria-hidden", "true");
        for (var rep = 0; rep < copies; rep++) {
          b.items.forEach(function (it) {
            var item = document.createElement("span");
            item.className = "tb-item";
            var text = document.createElement("span");
            text.className = "tb-text";
            text.textContent = it.text;
            item.appendChild(text);
            if (it.link && /^(https?:)?\//.test(it.link.url)) {
              var a = document.createElement("a");
              a.className = "tb-link";
              a.href = it.link.url;
              a.target = "_blank";
              a.rel = "noopener noreferrer";
              a.textContent = it.link.label || "Open";
              if (i === 1) a.tabIndex = -1;
              // After the link opens, drop focus so the scrolling carries on when the visitor comes back.
              a.addEventListener("click", function () { var el = this; setTimeout(function () { el.blur(); }, 0); });
              item.appendChild(a);
            }
            group.appendChild(item);
          });
        }
        track.appendChild(group);
      }
      view.appendChild(track);
      bar.appendChild(view);
      header.insertAdjacentElement("afterend", bar);
      var perSecond = { slow: 35, normal: 60, fast: 100 }[b.speed] || 60;
      var width = track.firstChild.getBoundingClientRect().width;
      if (width) track.style.animationDuration = Math.max(8, width / perSecond) + "s";
    }).catch(function () { /* no banner when the API is not reachable */ });
  }

  // Preview only: forms marked data-demo do not send anything.
  document.querySelectorAll("form[data-demo]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      f.querySelector(".form-msg").textContent =
        "Preview only — this form is not connected yet. Mailing tool to be confirmed.";
    });
  });

  // Content protection: text can't be selected or copied; a short notice appears instead.
  // This is a deterrent only (it cannot stop screenshots or view-source).
  var toast, toastTimer, lastToast = 0;
  var pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  function track(e) {
    var p = (e.touches && e.touches[0]) || e;
    if (p && typeof p.clientX === "number") pos = { x: p.clientX, y: p.clientY };
  }
  document.addEventListener("mousemove", track, { passive: true });
  document.addEventListener("mousedown", track, { passive: true });
  document.addEventListener("mouseup", track, { passive: true });
  document.addEventListener("touchstart", track, { passive: true });
  document.addEventListener("touchmove", track, { passive: true });
  function notify() {
    var now = Date.now();
    if (now - lastToast < 1200) return;
    lastToast = now;
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "copy-toast";
      toast.setAttribute("role", "alert");
      toast.innerHTML =
        '<svg class="copy-toast-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5 1.8 20.5h20.4L12 2.5z" fill="#fff" stroke="#b3261e" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.2" stroke="#b3261e" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.3" fill="#b3261e"/></svg>' +
        '<strong>ALERT:</strong><span>Content is protected. Copying is not allowed.</span>';
      document.body.appendChild(toast);
    }
    // Show the notice right where the visitor tried to select or copy.
    toast.classList.add("show");
    var w = toast.offsetWidth, h = toast.offsetHeight, m = 8;
    var left = Math.min(Math.max(pos.x - w / 2, m), window.innerWidth - w - m);
    var top = pos.y - h - 18;
    if (top < m) top = pos.y + 22;
    toast.style.left = left + "px";
    toast.style.top = Math.min(top, window.innerHeight - h - m) + "px";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2200);
  }
  function inField(el) {
    return el && el.closest && el.closest("input, textarea, select, [contenteditable='true'], .allow-copy");
  }
  ["copy", "cut", "dragstart", "contextmenu"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (inField(e.target)) return;
      e.preventDefault();
      notify();
    });
  });
  document.addEventListener("selectstart", function (e) {
    if (!inField(e.target)) e.preventDefault();
  });
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || inField(e.target)) return;
    var k = (e.key || "").toLowerCase();
    if (k === "c" || k === "x" || k === "a" || k === "u" || k === "s") {
      e.preventDefault();
      notify();
    }
  });
  var downAt = null;
  document.addEventListener("mousedown", function (e) {
    downAt = inField(e.target) ? null : { x: e.clientX, y: e.clientY };
  });
  document.addEventListener("mouseup", function (e) {
    if (downAt && Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y) > 12) notify();
    downAt = null;
  });
  document.addEventListener("dblclick", function (e) {
    if (!inField(e.target) && !(e.target.closest && e.target.closest("a, button"))) notify();
  });

  // Text beside an image: make the text end where the image ends.
  //  - text shorter than the image: grow the paragraph size (up to 1.3x) and spread the paragraphs evenly;
  //  - text taller than the image: shrink slightly, then give the image column more width (never beyond the image's own size).
  function fitBlock(block) {
    var text = block.querySelector("[data-fit-text]");
    var media = block.querySelector("[data-fit-media]");
    if (!text || !media) return;
    var paras = [].slice.call(text.querySelectorAll("p:not(.lead):not(.subtitle):not(.eyebrow):not(.btns):not(.lightcode)"));
    // reset to the natural layout first
    text.style.removeProperty("--fit");
    paras.forEach(function (p) { p.style.removeProperty("padding-top"); });
    block.style.removeProperty("grid-template-columns");
    media.style.removeProperty("max-width");
    if (getComputedStyle(block).gridTemplateColumns.split(" ").length < 2) return; // stacked on phones
    var mh = function () { return media.getBoundingClientRect().height; };
    var th = function () {
      var kids = [].slice.call(text.children).filter(function (e) { return e.getBoundingClientRect().height > 0; });
      var last = kids[kids.length - 1];
      return last ? last.getBoundingClientRect().bottom - text.getBoundingClientRect().top : 0;
    };
    if (!mh()) return;

    // find the largest font scale (0.85-1.3) at which the text still fits inside the image height
    function fitFont() {
      var lo = 0.9, hi = 1.3, best = lo, i;
      for (i = 0; i < 12; i++) {
        var mid = (lo + hi) / 2;
        text.style.setProperty("--fit", mid);
        if (th() <= mh()) { best = mid; lo = mid; } else { hi = mid; }
      }
      text.style.setProperty("--fit", best);
      return best;
    }
    var f0 = fitFont();
    var img = media.querySelector("img");
    // text cannot be made to fit by font size alone (or sits at an extreme): also try wider image columns
    if (block.hasAttribute("data-fit-widen") && img && img.naturalWidth && (f0 < 0.97 || f0 > 1.2 || th() > mh() + 4)) {
      var bs = getComputedStyle(block);
      var total = block.clientWidth - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight);
      var min = media.getBoundingClientRect().width;
      var max = Math.min(img.naturalWidth, total * 0.7, min * 1.4);
      var lowest = min * 0.85;
      media.style.maxWidth = "none";
      var bestM = min, bestScore = Infinity;
      for (var s = 0; s <= 16; s++) {
        var cand = lowest + ((max - lowest) * s) / 16;
        block.style.gridTemplateColumns = "minmax(0, 1fr) " + cand + "px";
        var f = fitFont();
        var score = Math.max(0, th() - mh()) * 10 + Math.abs(f - 1) * 100 + Math.abs(cand / min - 1) * 40;
        if (score < bestScore) { bestScore = score; bestM = cand; }
      }
      block.style.gridTemplateColumns = "minmax(0, 1fr) " + bestM + "px";
      fitFont();
    }

    // text still shorter than the image: spread the paragraphs down to the image's bottom edge
    var short = mh() - th();
    if (short > 4 && paras.length > 1) {
      var extra = short / (paras.length - 1);
      paras.slice(1).forEach(function (p) {
        p.style.paddingTop = extra + "px"; // padding (not margin) so neighbouring margins cannot swallow it
      });
    }
  }
  function fitAll() { document.querySelectorAll("[data-fit]").forEach(fitBlock); }
  var fitTimer;
  window.addEventListener("resize", function () { clearTimeout(fitTimer); fitTimer = setTimeout(fitAll, 120); });
  window.addEventListener("load", fitAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);
  fitAll();
})();
