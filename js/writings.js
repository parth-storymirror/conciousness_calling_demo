// My Writings: draws the blocks saved in the admin. If the server cannot be reached, the page keeps its built-in content.
(function () {
  var host = document.querySelector(".writings");
  if (!host) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function safeSrc(u) { return typeof u === "string" && /^(https?:\/\/|\/(?!\/))/.test(u) ? u : ""; }

  function render(blocks) {
    var stack = el("div", "wr-stack");
    blocks.forEach(function (b) {
      var d = b.data || {};
      if (b.type === "title") {
        var h = el("h2", "", d.text || "");
        if (d.subtitle) h.appendChild(el("span", "bk-sub", d.subtitle));
        stack.appendChild(h);
      } else if (b.type === "text") {
        String(d.text || "").split(/\n{2,}/).forEach(function (para) {
          if (para.trim()) stack.appendChild(el("p", "", para.trim()));
        });
      } else if (b.type === "image") {
        var src = safeSrc(d.url);
        if (!src) return;
        var fig = el("figure", "wr-fig s-" + (["small", "medium", "large"].indexOf(d.size) > -1 ? d.size : "medium"));
        var img = el("img");
        img.src = src;
        img.alt = d.alt || "";
        img.loading = "lazy";
        fig.appendChild(img);
        if (d.caption) fig.appendChild(el("figcaption", "", d.caption));
        stack.appendChild(fig);
      } else if (b.type === "table") {
        if (d.title) stack.appendChild(el("h2", "", d.title));
        var wrap = el("div", "doortable-wrap");
        var table = el("table", "doortable worktable");
        var thead = el("thead");
        var hr = el("tr");
        (d.headers || []).forEach(function (t) { var th = el("th", "", t); th.scope = "col"; hr.appendChild(th); });
        thead.appendChild(hr);
        var tbody = el("tbody");
        (d.rows || []).forEach(function (row) {
          var tr = el("tr");
          row.forEach(function (cell, i) {
            var c;
            if (i === 0 && d.firstColumnBold !== false) { c = el("th", "", cell); c.scope = "row"; }
            else { c = el("td", "", cell); }
            if (d.headers && d.headers[i]) c.setAttribute("data-label", d.headers[i]);
            tr.appendChild(c);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        stack.appendChild(wrap);
      }
    });
    host.replaceWith(stack);
  }

  fetch("/api/writings", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) { if (data && Array.isArray(data.blocks) && data.blocks.length) render(data.blocks); })
    .catch(function () { /* keep the built-in content */ });
})();
