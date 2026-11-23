// RA SOUL page: shows the "Explore the Ra Soul Guide" button only when the guide PDF has been added on the
// Downloads page in the admin (a table whose heading starts with "RA SOUL" and that has a link).
// Until then the button stays hidden, so the page never shows a broken link.
(function () {
  var btn = document.getElementById("rs-guide");
  if (!btn) return;
  var sub = document.querySelector(".rs-guide-sub");
  if (sub) sub.hidden = true;
  fetch("/api/downloads", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var tables = d && Array.isArray(d.tables) ? d.tables : [];
      for (var i = 0; i < tables.length; i++) {
        if (!/^\s*ra soul/i.test(tables[i].title || "")) continue;
        var rows = tables[i].rows || [];
        for (var j = 0; j < rows.length; j++) {
          if (/^(https?:\/\/|\/(?!\/))/.test(rows[j].url || "")) {
            btn.href = rows[j].url; btn.hidden = false; if (sub) sub.hidden = false; return;
          }
        }
      }
    })
    .catch(function () { /* keep the button hidden */ });
})();
