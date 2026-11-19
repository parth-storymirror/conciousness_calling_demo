// Downloads page: draws the tables saved in the admin (one or more). If the server cannot be
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

  function renderTable(t) {
    var box = el("div", "dl-table");
    if (t.title) box.appendChild(el("h2", "", t.title));
    if (t.description) box.appendChild(el("p", "dl-desc", t.description));
    var wrap = el("div", "doortable-wrap");
    var table = el("table", "doortable worktable sampletable");
    var head = el("tr");
    [t.nameHeader, t.linkHeader].forEach(function (x) { var th = el("th", "", x); th.scope = "col"; head.appendChild(th); });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    t.rows.forEach(function (row) {
      var tr = el("tr");
      var c0 = el("th", "", row.name || ""); c0.scope = "row"; c0.setAttribute("data-label", t.nameHeader); tr.appendChild(c0);
      var c1 = el("td"); c1.setAttribute("data-label", t.linkHeader);
      var u = safeSrc(row.url);
      if (u) { var a = el("a", "btn ghost", t.buttonLabel); a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer"; c1.appendChild(a); }
      tr.appendChild(c1);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    return box;
  }

  function render(tables) {
    var stack = el("div", "dl-stack");
    tables.forEach(function (t) { stack.appendChild(renderTable(t)); });
    host.replaceWith(stack);
  }

  fetch("/api/downloads", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var tables = d && Array.isArray(d.tables) ? d.tables.filter(function (t) { return t.rows && t.rows.length; }) : [];
      if (tables.length) render(tables);
    })
    .catch(function () { /* keep the built-in "nothing here yet" message */ });
})();
