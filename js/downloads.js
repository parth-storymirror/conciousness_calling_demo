// Downloads page: draws the Free Sample Books table saved in the admin. If the server cannot be
// reached, or nothing has been added yet, the page keeps its built-in "nothing here yet" message.
(function () {
  var host = document.querySelector(".downloads-table");
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function safeSrc(u) { return typeof u === "string" && /^(https?:\/\/|\/(?!\/))/.test(u) ? u : ""; }

  function render(d) {
    var stack = el("div");
    if (d.title) stack.appendChild(el("h2", "", d.title));
    var wrap = el("div", "doortable-wrap");
    var table = el("table", "doortable worktable sampletable");
    var head = el("tr");
    ["Book", "Free sample"].forEach(function (t) { var th = el("th", "", t); th.scope = "col"; head.appendChild(th); });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    d.rows.forEach(function (row) {
      var tr = el("tr");
      var c0 = el("th", "", row.name || ""); c0.scope = "row"; c0.setAttribute("data-label", "Book"); tr.appendChild(c0);
      var c1 = el("td"); c1.setAttribute("data-label", "Free sample");
      var u = safeSrc(row.url);
      if (u) { var a = el("a", "btn ghost", "Read free sample"); a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer"; c1.appendChild(a); }
      tr.appendChild(c1);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    stack.appendChild(wrap);
    host.replaceWith(stack);
  }

  fetch("/api/downloads", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && Array.isArray(d.rows) && d.rows.length) render(d); })
    .catch(function () { /* keep the built-in "nothing here yet" message */ });
})();
