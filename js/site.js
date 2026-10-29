(function () {
  var pages = [
    ["index.html", "Home"],
    ["about.html", "About"],
    ["book.html", "Book One"],
    ["explore.html", "Explore Consciousness Calling"],
    ["inner-sun.html", "Inner Sun"],
    ["connect.html", "Connect"]
  ];
  var here = location.pathname.split("/").pop() || "index.html";
  if (here === "vision.html") here = "about.html";

  var links = pages.map(function (p) {
    var cur = p[0] === here ? ' aria-current="page"' : "";
    return '<a href="' + p[0] + '"' + cur + ">" + p[1] + "</a>";
  }).join("");

  var header =
    '<div class="preview-bar">Layout preview for author review — not the final website. Copy and artwork are pending author approval.</div>' +
    '<header class="site-header"><div class="wrap">' +
    '<a class="brand" href="index.html"><img src="assets/img/img-02-emblem.png" alt="Heart Awakening emblem"><span>CONSCIOUSNESS CALLING</span></a>' +
    '<button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>' +
    '<nav class="nav" id="nav" aria-label="Main">' + links + "</nav>" +
    "</div></header>";

  // About and the Vision page are one section: show a sub-nav so the current page is obvious.
  var onVision = location.pathname.split("/").pop() === "vision.html";
  var onAbout = here === "about.html";
  var subnav = "";
  if (onAbout) {
    subnav =
      '<nav class="subnav" aria-label="About section"><div class="wrap">' +
      '<a href="about.html"' + (onVision ? "" : ' aria-current="page"') + ">About the Author</a>" +
      '<a href="vision.html"' + (onVision ? ' aria-current="page"' : "") + ">Consciousness Calling Vision</a>" +
      "</div></nav>";
  }
  header += subnav;

  document.body.insertAdjacentHTML("afterbegin", header);

  var btn = document.querySelector(".menu-btn");
  var nav = document.getElementById("nav");
  btn.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
  });

  // Demo only: forms do not send anything yet.
  document.querySelectorAll("form[data-demo]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      f.querySelector(".form-msg").textContent =
        "Preview only — this form is not connected yet. Mailing tool to be confirmed.";
    });
  });
})();
