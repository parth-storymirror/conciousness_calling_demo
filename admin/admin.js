// Site admin (single page). Plain JavaScript, no inline code. All text is inserted with textContent,
// never as HTML, so nothing typed into the admin or by a visitor can run as script.
(function () {
  "use strict";

  var BASE = location.pathname.replace(/\/+$/, "");
  var API = BASE + "/api";
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var state = { csrf: "", username: "", view: "subscribers", status: null };

  // ---- tiny DOM helper ----------------------------------------------------------------------
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var toastTimer;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = "toast show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = "toast"; }, isError ? 5000 : 2600);
  }

  // ---- API ------------------------------------------------------------------------------------
  function api(method, url, body) {
    var opts = { method: method, headers: {}, credentials: "same-origin" };
    if (state.csrf && method !== "GET") opts.headers["x-csrf-token"] = state.csrf;
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
    return fetch(API + url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && url !== "/login") { state.csrf = ""; renderLogin(); }
        if (!res.ok) { var e = new Error(data.error || "Something went wrong."); e.status = res.status; throw e; }
        return data;
      });
    });
  }
  function fail(e) { if (e && e.status !== 401) toast(e.message || "Something went wrong.", true); }
  function date(s) { return s ? new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""; }

  // ---- login ---------------------------------------------------------------------------------------
  function renderLogin() {
    clear(app);
    var user = h("input", { type: "text", autocomplete: "username", required: true, autofocus: true });
    var pass = h("input", { type: "password", autocomplete: "current-password", required: true });
    var err = h("p", { class: "hint", style: "color:#b3261e;min-height:1.2em" });
    var btn = h("button", { class: "btn", type: "submit", text: "Sign in", style: "width:100%;margin-top:16px" });
    var form = h("form", { class: "card", onsubmit: function (e) {
      e.preventDefault();
      btn.disabled = true; err.textContent = "";
      api("POST", "/login", { username: user.value, password: pass.value }).then(function (r) {
        state.csrf = r.csrf; state.username = r.username; start();
      }).catch(function (x) { err.textContent = x.message; pass.value = ""; }).then(function () { btn.disabled = false; });
    } },
      h("h1", { text: "Site admin" }),
      h("label", { class: "f", text: "Username" }), user,
      h("label", { class: "f", text: "Password" }), pass, err, btn
    );
    app.appendChild(h("div", { class: "login" }, h("div", { style: "width:100%;max-width:380px" }, form, h("p", { class: "note", text: "Authorised use only." }))));
  }

  // ---- shell -----------------------------------------------------------------------------------------
  var VIEWS = [
    { id: "subscribers", label: "Subscribers", render: viewSubscribers },
    { id: "email", label: "Send email", render: viewEmail },
    { id: "banner", label: "Top banner", render: viewBanner },
    { id: "writings", label: "My Writings", render: viewWritings },
    { id: "downloads", label: "Downloads", render: viewDownloads },
    { id: "account", label: "Account", render: viewAccount },
  ];

  function renderShell() {
    clear(app);
    var main = h("div", { class: "main", id: "main" });
    var nav = VIEWS.map(function (v) {
      return h("button", { class: "nav" + (state.view === v.id ? " active" : ""), type: "button", text: v.label, onclick: function () { state.view = v.id; renderShell(); } });
    });
    var side = h("nav", { class: "side", "aria-label": "Admin sections" },
      h("div", { class: "brand" }, "Consciousness Calling", h("small", { text: "Site admin" })),
      nav, h("div", { class: "spacer" }),
      h("div", { class: "who", text: "Signed in as " + state.username }),
      h("button", { class: "nav", type: "button", text: "Sign out", onclick: function () {
        api("POST", "/logout").catch(function () {}).then(function () { state.csrf = ""; renderLogin(); });
      } })
    );
    app.appendChild(h("div", { class: "shell" }, side, main));
    var active = side.querySelector(".active");
    if (active && active.scrollIntoView) active.scrollIntoView({ inline: "center", block: "nearest" }); // keep the current tab visible in the one-row phone menu
    var current = VIEWS.filter(function (v) { return v.id === state.view; })[0];
    current.render(main);
  }

  function start() {
    api("GET", "/status").then(function (s) { state.status = s; renderShell(); }).catch(fail);
  }

  // =====================================================================================================
  // Subscribers
  // =====================================================================================================
  function viewSubscribers(main) {
    var q = { page: 1, search: "", status: "" };
    var listBox = h("div");
    var statsBox = h("div", { class: "stats" });

    function load() {
      var qs = "?page=" + q.page + "&q=" + encodeURIComponent(q.search) + "&status=" + encodeURIComponent(q.status);
      api("GET", "/subscribers" + qs).then(function (r) {
        clear(statsBox);
        [["Active", r.counts.active], ["Unsubscribed", r.counts.unsubscribed], ["Total", r.counts.total]].forEach(function (s) {
          statsBox.appendChild(h("div", { class: "stat" }, h("b", { text: String(s[1]) }), s[0]));
        });
        clear(listBox);
        if (!r.rows.length) { listBox.appendChild(h("div", { class: "empty", text: "No subscribers found." })); return; }
        var rows = r.rows.map(function (s) {
          return h("tr", null,
            h("td", { text: s.email }), h("td", { text: s.name }),
            h("td", null, h("span", { class: "chip " + (s.status === "active" ? "ok" : "off"), text: s.status })),
            h("td", { text: date(s.createdAt) }),
            h("td", null, h("div", { class: "actions" },
              h("button", { class: "btn ghost small", type: "button", text: s.status === "active" ? "Unsubscribe" : "Resubscribe", onclick: function () {
                api("PATCH", "/subscribers/" + s.id, { status: s.status === "active" ? "unsubscribed" : "active" }).then(load).catch(fail);
              } }),
              h("button", { class: "btn danger small", type: "button", text: "Delete", onclick: function () {
                if (confirm("Delete " + s.email + " permanently?")) api("DELETE", "/subscribers/" + s.id).then(function () { toast("Deleted."); load(); }).catch(fail);
              } })
            ))
          );
        });
        listBox.appendChild(h("div", { class: "tablewrap" }, h("table", null,
          h("thead", null, h("tr", null, ["Email", "Name", "Status", "Subscribed", ""].map(function (t) { return h("th", { text: t }); }))),
          h("tbody", null, rows))));
        var pages = Math.max(1, Math.ceil(r.total / r.perPage));
        listBox.appendChild(h("div", { class: "pager" },
          h("button", { class: "btn ghost small", type: "button", text: "Previous", disabled: q.page <= 1, onclick: function () { q.page--; load(); } }),
          h("span", { text: "Page " + r.page + " of " + pages + " (" + r.total + ")" }),
          h("button", { class: "btn ghost small", type: "button", text: "Next", disabled: q.page >= pages, onclick: function () { q.page++; load(); } })));
      }).catch(fail);
    }

    var search = h("input", { type: "search", placeholder: "Search email or name", "aria-label": "Search subscribers" });
    var status = h("select", { "aria-label": "Filter by status" },
      h("option", { value: "", text: "All" }), h("option", { value: "active", text: "Active" }), h("option", { value: "unsubscribed", text: "Unsubscribed" }));
    var timer;
    search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { q.search = search.value.trim(); q.page = 1; load(); }, 300); });
    status.addEventListener("change", function () { q.status = status.value; q.page = 1; load(); });

    var newEmail = h("input", { type: "email", placeholder: "email@example.com", "aria-label": "New subscriber email" });
    var newName = h("input", { type: "text", placeholder: "Name (optional)", "aria-label": "New subscriber name" });

    main.appendChild(h("h1", { text: "Subscribers" }));
    main.appendChild(statsBox);
    main.appendChild(h("div", { class: "card" },
      h("div", { class: "row" },
        h("div", { class: "grow" }, search), h("div", { style: "width:170px" }, status),
        h("a", { class: "btn ghost", href: API + "/subscribers.csv", text: "Export CSV" })),
      h("div", { style: "height:14px" }), listBox));
    main.appendChild(h("form", { class: "card", onsubmit: function (e) {
      e.preventDefault();
      api("POST", "/subscribers", { email: newEmail.value, name: newName.value }).then(function (r) {
        toast(r.created ? "Subscriber added." : "That address is already subscribed."); newEmail.value = ""; newName.value = ""; load();
      }).catch(fail);
    } }, h("h3", { text: "Add a subscriber" }), h("div", { class: "row" }, h("div", { class: "grow" }, newEmail), h("div", { class: "grow" }, newName), h("button", { class: "btn", type: "submit", text: "Add" })),
      h("p", { class: "hint", text: "Adding a subscriber does not send them any email." })));
    load();
  }

  // =====================================================================================================
  // Send email
  // =====================================================================================================
  function paragraphsOf(text) {
    return String(text).trim().split(/\n{2,}/).map(function (p) { return h("p", { style: "margin:0 0 12px;white-space:pre-wrap", text: p }); });
  }

  function viewEmail(main) {
    var s = state.status || {};
    var subject = h("input", { type: "text", maxlength: "150", placeholder: "Subject" });
    var body = h("textarea", { placeholder: "Write your message. Leave a blank line between paragraphs.", style: "min-height:200px" });
    var previewBox = h("div");
    var confirmInput = h("input", { type: "text", placeholder: "Type SEND", autocomplete: "off", "aria-label": "Type SEND to confirm" });
    var sendBtn = h("button", { class: "btn", type: "button", text: "Send to all subscribers", disabled: true });
    var historyBox = h("div");
    var recipients = null;
    var pollTimer = null;

    var banner = !s.emailSendingEnabled
      ? h("div", { class: "notice warn" }, h("b", { text: "Sending is turned off on this server. " }), "You can write and preview messages, but nothing will be sent until the server setting EMAIL_SENDING_ENABLED is set to true.")
      : h("div", { class: "notice info", text: "Messages go out one by one to active subscribers only, each with its own unsubscribe link." });

    function refreshSendState() {
      sendBtn.disabled = !(recipients && s.emailSendingEnabled && confirmInput.value === "SEND" && subject.value.trim() && body.value.trim());
    }
    [subject, body, confirmInput].forEach(function (el) { el.addEventListener("input", function () { recipients = el === confirmInput ? recipients : null; if (el !== confirmInput) clear(previewBox); refreshSendState(); }); });

    function preview() {
      api("POST", "/campaigns/preview", { subject: subject.value, body: body.value }).then(function (r) {
        recipients = r.recipients;
        clear(previewBox);
        previewBox.appendChild(h("div", { class: "preview-box" },
          r.logoUrl ? h("img", { class: "mail-logo", src: r.logoUrl, alt: "Logo", width: "64", height: "64" }) : null,
          h("h3", { text: subject.value }), paragraphsOf(body.value),
          h("div", { class: "foot", text: "You are receiving this because you subscribed. Unsubscribe" })));
        previewBox.appendChild(h("p", { class: "hint", text: "This message would go to " + r.recipients + " active subscriber" + (r.recipients === 1 ? "" : "s") + ". Preview only: nothing has been sent." }));
        sendBtn.textContent = "Send to " + r.recipients + " subscriber" + (r.recipients === 1 ? "" : "s");
        refreshSendState();
      }).catch(fail);
    }

    sendBtn.addEventListener("click", function () {
      if (!confirm("Send this message to " + recipients + " subscribers now? This cannot be undone.")) return;
      sendBtn.disabled = true;
      api("POST", "/campaigns/send", { subject: subject.value, body: body.value, confirm: confirmInput.value }).then(function () {
        toast("Sending started."); subject.value = ""; body.value = ""; confirmInput.value = ""; recipients = null; clear(previewBox); loadHistory();
      }).catch(function (e) { fail(e); refreshSendState(); });
    });

    function loadHistory() {
      api("GET", "/campaigns").then(function (r) {
        clear(historyBox);
        if (!r.campaigns.length) { historyBox.appendChild(h("div", { class: "empty", text: "No messages sent yet." })); return; }
        var rows = r.campaigns.map(function (c) {
          var cls = c.status === "completed" ? "ok" : (c.status === "sending" || c.status === "queued") ? "" : "bad";
          var actions = [];
          if (c.status === "stopped" || c.status === "interrupted") {
            actions.push(h("button", { class: "btn ghost small", type: "button", text: "Resume", disabled: !s.emailSendingEnabled, onclick: function () {
              if (prompt("Type SEND to resume sending the remaining recipients.") !== "SEND") return;
              api("POST", "/campaigns/" + c.id + "/resume", { confirm: "SEND" }).then(function () { toast("Resumed."); loadHistory(); }).catch(fail);
            } }));
          }
          return h("tr", null, h("td", { text: date(c.createdAt) }), h("td", { text: c.subject }),
            h("td", null, h("span", { class: "chip " + cls, text: c.status.replace(/_/g, " ") })),
            h("td", { text: c.sent + " / " + c.total + (c.failed ? " (" + c.failed + " failed)" : "") }),
            h("td", null, h("div", { class: "actions" }, actions)));
        });
        historyBox.appendChild(h("div", { class: "tablewrap" }, h("table", null,
          h("thead", null, h("tr", null, ["Sent", "Subject", "Status", "Delivered", ""].map(function (t) { return h("th", { text: t }); }))),
          h("tbody", null, rows))));
        clearTimeout(pollTimer);
        if (r.sending || r.campaigns.some(function (c) { return c.status === "sending" || c.status === "queued"; })) pollTimer = setTimeout(loadHistory, 3000);
      }).catch(fail);
    }

    main.appendChild(h("h1", { text: "Send email to subscribers" }));
    main.appendChild(banner);
    main.appendChild(h("div", { class: "card" },
      h("label", { class: "f", text: "Subject" }), subject,
      h("label", { class: "f", text: "Message" }), body,
      h("p", { class: "hint", text: "Plain text. Links you type are shown as text. An unsubscribe link is added to every email automatically." }),
      h("div", { class: "row", style: "margin-top:14px" }, h("button", { class: "btn ghost", type: "button", text: "Preview", onclick: preview })),
      previewBox,
      h("div", { class: "confirm" }, confirmInput, sendBtn)));
    main.appendChild(h("h2", { text: "Sent messages" }));
    main.appendChild(historyBox);
    loadHistory();
  }

  // =====================================================================================================
  // Top banner (scrolling text bar on the home page) + file uploads
  // =====================================================================================================
  function viewBanner(main) {
    var data = { enabled: false, speed: "normal", items: [], files: [] };
    var box = h("div");

    function blank() { return { text: "", linkType: "none", fileId: null, linkUrl: "", linkLabel: "" }; }

    function loadAll() {
      return Promise.all([api("GET", "/banner"), api("GET", "/files?kind=file")]).then(function (r) {
        data.enabled = !!r[0].banner.enabled; data.speed = r[0].banner.speed || "normal";
        data.items = r[0].banner.items.length ? r[0].banner.items : [blank()];
        data.files = r[1].files; draw();
      }).catch(fail);
    }

    // One row of controls for uploading: [Choose file] file name [Upload]
    function uploadRow(onDone) {
      var input = h("input", { type: "file", class: "visually-hidden", accept: ".pdf,.epub,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,image/*" });
      var name = h("span", { class: "filename", text: "No file chosen" });
      var choose = h("button", { class: "btn ghost small", type: "button", text: "Choose file", onclick: function () { input.click(); } });
      var go = h("button", { class: "btn small", type: "button", text: "Upload", disabled: true, onclick: function () {
        var fd = new FormData(); fd.append("kind", "file"); fd.append("file", input.files[0]);
        go.disabled = true; go.textContent = "Uploading…";
        api("POST", "/files", fd).then(function (r) { toast("Uploaded."); onDone(r.file); })
          .catch(function (e) { fail(e); go.disabled = false; go.textContent = "Upload"; });
      } });
      input.addEventListener("change", function () {
        name.textContent = input.files[0] ? input.files[0].name : "No file chosen";
        go.disabled = !input.files[0];
      });
      return h("div", { class: "filepick" }, choose, name, go, input);
    }

    function itemCard(item, i) {
      var text = h("textarea", { maxlength: "300", class: "msg", placeholder: "Message that scrolls across the banner" });
      text.value = item.text;
      text.addEventListener("input", function () { item.text = text.value; sync(); });
      var type = h("select", null,
        h("option", { value: "none", text: "No button", selected: item.linkType === "none" }),
        h("option", { value: "file", text: "Button to download an uploaded file", selected: item.linkType === "file" }),
        h("option", { value: "url", text: "Button to a web address", selected: item.linkType === "url" }));
      var label = h("input", { type: "text", maxlength: "40", value: item.linkLabel, placeholder: item.linkType === "url" ? "Open" : "Download" });
      var fileSel = h("select", null, h("option", { value: "", text: "Choose an uploaded file" }),
        data.files.map(function (f) { return h("option", { value: String(f.id), text: f.name, selected: item.fileId === f.id }); }));
      var url = h("input", { type: "url", placeholder: "https://example.com/page", value: item.linkUrl });
      var fileBox = h("div", { class: "linkbox" },
        h("label", { class: "f", text: "File" }), fileSel,
        h("label", { class: "f", text: "…or upload a new one" }),
        uploadRow(function (file) { item.fileId = file.id; data.files.unshift(file); draw(); }));
      var urlBox = h("div", { class: "linkbox" }, h("label", { class: "f", text: "Web address" }), url);
      var labelBox = h("div", { class: "linkbox" }, h("label", { class: "f", text: "Button text" }), label);

      function show() {
        fileBox.classList.toggle("hidden", item.linkType !== "file");
        urlBox.classList.toggle("hidden", item.linkType !== "url");
        labelBox.classList.toggle("hidden", item.linkType === "none");
      }
      type.addEventListener("change", function () { item.linkType = type.value; show(); sync(); });
      fileSel.addEventListener("change", function () { item.fileId = fileSel.value ? Number(fileSel.value) : null; });
      url.addEventListener("input", function () { item.linkUrl = url.value; });
      label.addEventListener("input", function () { item.linkLabel = label.value; sync(); });
      show();

      return h("div", { class: "block" },
        h("div", { class: "block-head" }, h("span", { class: "type", text: "Message " + (i + 1) }),
          h("button", { class: "btn ghost small", type: "button", text: "Move up", disabled: i === 0, onclick: function () { data.items.splice(i - 1, 0, data.items.splice(i, 1)[0]); draw(); } }),
          h("button", { class: "btn ghost small", type: "button", text: "Move down", disabled: i === data.items.length - 1, onclick: function () { data.items.splice(i + 1, 0, data.items.splice(i, 1)[0]); draw(); } }),
          h("button", { class: "btn danger small", type: "button", text: "Remove", onclick: function () { data.items.splice(i, 1); if (!data.items.length) data.items.push(blank()); draw(); } })),
        h("div", { class: "block-body" },
          h("label", { class: "f", text: "Message" }), text,
          h("label", { class: "f", text: "Button" }), h("div", { style: "max-width:360px" }, type),
          fileBox, urlBox, labelBox));
    }

    var prevWrap = h("div");
    function sync() {
      clear(prevWrap);
      var shown = data.items.filter(function (it) { return it.text.trim(); });
      if (!shown.length) return;
      var track = h("div", { class: "track" });
      shown.forEach(function (it) {
        track.appendChild(h("span", { text: it.text.trim() }));
        if (it.linkType !== "none") track.appendChild(h("span", { class: "chip-btn", text: it.linkLabel || (it.linkType === "url" ? "Open" : "Download") }));
        track.appendChild(h("span", { class: "dot", text: "•" }));
      });
      prevWrap.appendChild(h("div", { class: "marquee-preview " + data.speed, "aria-label": "Banner preview" }, track));
    }

    function draw() {
      clear(box);
      var enabled = h("input", { type: "checkbox", id: "b-on", checked: data.enabled });
      enabled.addEventListener("change", function () { data.enabled = enabled.checked; });
      var speed = h("select", null, ["slow", "normal", "fast"].map(function (v) { return h("option", { value: v, text: v[0].toUpperCase() + v.slice(1), selected: data.speed === v }); }));
      speed.addEventListener("change", function () { data.speed = speed.value; sync(); });

      box.appendChild(h("div", { class: "card" },
        h("label", { class: "row", for: "b-on", style: "gap:8px;font-weight:600" }, enabled, "Show the scrolling banner on the home page"),
        h("label", { class: "f", text: "Scrolling speed" }), h("div", { style: "max-width:200px" }, speed)));

      data.items.forEach(function (it, i) { box.appendChild(itemCard(it, i)); });

      box.appendChild(h("div", { class: "row", style: "margin:4px 0 18px" },
        h("button", { class: "btn ghost", type: "button", text: "+ Add another message", disabled: data.items.length >= 10, onclick: function () { data.items.push(blank()); draw(); } })));

      box.appendChild(h("div", { class: "card" }, h("h3", { text: "Preview" }), prevWrap,
        h("div", { style: "margin-top:16px" }, h("button", { class: "btn", type: "button", text: "Save banner", onclick: function () {
          api("PUT", "/banner", { enabled: data.enabled, speed: data.speed, items: data.items }).then(function (r) {
            data.items = r.banner.items.length ? r.banner.items : [blank()];
            toast(data.enabled ? "Banner saved and visible on the home page." : "Banner saved (hidden)."); draw();
          }).catch(fail);
        } }))));

      box.appendChild(h("div", { class: "card" },
        h("h3", { text: "Upload a file for visitors to download" }),
        h("p", { class: "hint", text: "PDF, EPUB, Word, Excel, PowerPoint, ZIP, text or images up to 25 MB, stored in the website's folder in the CDN bucket. After uploading, pick it from any message above." }),
        uploadRow(function () { loadAll(); })));

      var rows = data.files.map(function (f) {
        return h("tr", null, h("td", null, h("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", text: f.name })),
          h("td", { text: Math.max(1, Math.round(f.size / 1024)) + " KB" }), h("td", { text: date(f.createdAt) }),
          h("td", null, h("button", { class: "btn danger small", type: "button", text: "Delete", onclick: function () {
            if (confirm("Delete " + f.name + "? Its download link will stop working.")) api("DELETE", "/files/" + f.id).then(function () { toast("Deleted."); loadAll(); }).catch(fail);
          } })));
      });
      box.appendChild(h("h3", { text: "Uploaded files" }));
      box.appendChild(rows.length
        ? h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, ["File", "Size", "Uploaded", ""].map(function (t) { return h("th", { text: t }); }))), h("tbody", null, rows)))
        : h("div", { class: "empty", text: "No files uploaded yet." }));
      sync();
    }

    main.appendChild(h("h1", { text: "Top banner" }));
    main.appendChild(h("p", { class: "hint", text: "A thin bar under the menu on the home page with scrolling messages. Each message can have its own button: a file to download or a web address." }));
    main.appendChild(box);
    loadAll();
  }

  // =====================================================================================================
  // Downloads page: a single Free Sample Books table (its own page and nav link, not a My Writings block)
  // =====================================================================================================
  function viewDownloads(main) {
    var data = { title: "My Resources", rows: [] };

    function blankRow() { return { name: "", url: "", fileId: null }; }

    function load() {
      return api("GET", "/downloads").then(function (r) {
        data.title = r.downloads.title || "My Resources";
        data.rows = r.downloads.rows.length ? r.downloads.rows : [blankRow()];
        draw();
      }).catch(fail);
    }

    var box = h("div");

    function draw() {
      clear(box);
      var stt = h("input", { type: "text", maxlength: "200", value: data.title, placeholder: "Heading above the table" });
      stt.addEventListener("input", function () { data.title = stt.value; });
      var host = h("div");

      function drawRows() {
        clear(host);
        var body = data.rows.map(function (row, i) {
          function inp(key, max, ph) { var el = h("input", { type: "text", maxlength: String(max), value: row[key] || "", placeholder: ph, "aria-label": ph }); el.addEventListener("input", function () { row[key] = el.value; }); return el; }
          var file = h("input", { type: "file", accept: ".pdf,.epub,.doc,.docx,.zip,.txt" });
          var link = inp("url", 1000, "https://… or upload a file");
          var up = h("button", { class: "btn ghost small", type: "button", text: "Upload file", onclick: function () {
            if (!file.files[0]) { toast("Choose a file first.", true); return; }
            var fd = new FormData(); fd.append("kind", "file"); fd.append("file", file.files[0]);
            up.disabled = true; up.textContent = "Uploading…";
            api("POST", "/files", fd).then(function (res) { row.url = res.file.url; row.fileId = res.file.id; toast("Uploaded. Save to keep it."); drawRows(); })
              .catch(fail).then(function () { up.disabled = false; up.textContent = "Upload file"; });
          } });
          return h("tr", null, h("td", null, inp("name", 200, "Book title")),
            h("td", null, link, h("div", { class: "row", style: "margin-top:4px" }, file, up)),
            h("td", null, h("button", { class: "btn danger small", type: "button", text: "Remove", onclick: function () { data.rows.splice(i, 1); if (!data.rows.length) data.rows.push(blankRow()); drawRows(); } })));
        });
        host.appendChild(h("div", { class: "tbl-editor" }, h("table", { style: "min-width:560px" }, h("thead", null, h("tr", null, ["Book title", "Sample link (web address or uploaded file)", ""].map(function (t) { return h("th", { text: t }); }))), h("tbody", null, body))));
        host.appendChild(h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "btn ghost small", type: "button", text: "Add a sample book", disabled: data.rows.length >= 100, onclick: function () { data.rows.push(blankRow()); drawRows(); } })));
      }
      drawRows();

      box.appendChild(h("div", { class: "card" },
        h("label", { class: "f", text: "Table heading" }), stt, host,
        h("p", { class: "hint", text: "Each row shows a \"Read free sample\" button. Paste a web address, or upload a PDF/EPUB (stored in the CDN bucket)." }),
        h("div", { style: "margin-top:16px" }, h("button", { class: "btn", type: "button", text: "Save Downloads page", onclick: function () {
          api("PUT", "/downloads", { title: data.title, rows: data.rows }).then(function (r) {
            data.title = r.downloads.title; data.rows = r.downloads.rows.length ? r.downloads.rows : [blankRow()];
            toast("Saved."); draw();
          }).catch(fail);
        } }))));
    }

    main.appendChild(h("h1", { text: "Downloads" }));
    main.appendChild(h("p", { class: "hint" }, "A free sample books table on its own \"Downloads\" page, linked in the main menu after FAQs. ",
      h("a", { href: "/downloads.html", target: "_blank", rel: "noopener", text: "View the page" }), "."));
    main.appendChild(box);
    load();
  }

  // =====================================================================================================
  // My Writings: block editor (title, body text, image, table)
  // =====================================================================================================
  var TYPE_LABEL = { title: "Title", text: "Body text", image: "Image", table: "Table" };

  function newDraft(type) {
    var d = { title: { text: "", subtitle: "" }, text: { text: "" }, image: { url: "", alt: "", caption: "", size: "medium", fileId: null },
      table: { title: "", headers: ["Column 1", "Column 2"], rows: [["", ""]], firstColumnBold: true } }[type];
    return { id: null, type: type, data: JSON.parse(JSON.stringify(d)) };
  }

  function viewWritings(main) {
    var blocks = [];
    var list = h("div");

    function load() { api("GET", "/writings").then(function (r) { blocks = r.blocks; draw(); }).catch(fail); }

    function saved() { return blocks.filter(function (b) { return b.id !== null; }); }

    function move(block, dir) {
      var ids = saved().map(function (b) { return b.id; });
      var i = ids.indexOf(block.id), j = i + dir;
      if (j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      api("POST", "/writings/reorder", { ids: ids }).then(load).catch(fail);
    }

    function editorFor(block) {
      var d = block.data;
      if (block.type === "title") {
        var t = h("input", { type: "text", maxlength: "200", value: d.text }); var st = h("input", { type: "text", maxlength: "200", value: d.subtitle });
        t.addEventListener("input", function () { d.text = t.value; }); st.addEventListener("input", function () { d.subtitle = st.value; });
        return h("div", null, h("label", { class: "f", text: "Title" }), t, h("label", { class: "f", text: "Subtitle (optional)" }), st);
      }
      if (block.type === "text") {
        var ta = h("textarea", { maxlength: "20000", style: "min-height:160px" }); ta.value = d.text;
        ta.addEventListener("input", function () { d.text = ta.value; });
        return h("div", null, h("label", { class: "f", text: "Body text" }), ta, h("p", { class: "hint", text: "Leave a blank line between paragraphs." }));
      }
      if (block.type === "image") {
        var prev = h("div");
        function drawPrev() { clear(prev); if (d.url) prev.appendChild(h("img", { class: "imgprev", src: d.url, alt: "" })); }
        var file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
        var up = h("button", { class: "btn ghost small", type: "button", text: d.url ? "Replace image" : "Upload image", onclick: function () {
          if (!file.files[0]) { toast("Choose an image first.", true); return; }
          var fd = new FormData(); fd.append("kind", "image"); fd.append("file", file.files[0]);
          up.disabled = true; up.textContent = "Uploading…";
          api("POST", "/files", fd).then(function (r) { d.url = r.file.url; d.fileId = r.file.id; drawPrev(); toast("Image uploaded. Save the block to keep it."); })
            .catch(fail).then(function () { up.disabled = false; up.textContent = "Replace image"; });
        } });
        var alt = h("input", { type: "text", maxlength: "300", value: d.alt, placeholder: "Describe the image for people who cannot see it" });
        var cap = h("input", { type: "text", maxlength: "300", value: d.caption, placeholder: "Caption (optional)" });
        var size = h("select", null, ["small", "medium", "large"].map(function (v) { return h("option", { value: v, text: v[0].toUpperCase() + v.slice(1), selected: d.size === v }); }));
        alt.addEventListener("input", function () { d.alt = alt.value; }); cap.addEventListener("input", function () { d.caption = cap.value; }); size.addEventListener("change", function () { d.size = size.value; });
        drawPrev();
        return h("div", null, prev, h("div", { class: "row" }, file, up), h("p", { class: "hint", text: "PNG, JPG, WEBP or GIF, up to 8 MB. Stored in the CDN bucket." }),
          h("label", { class: "f", text: "Description (alt text)" }), alt, h("label", { class: "f", text: "Caption" }), cap,
          h("label", { class: "f", text: "Size" }), h("div", { style: "max-width:200px" }, size));
      }
      // table
      var host = h("div", { class: "tbl-editor" });
      var tt = h("input", { type: "text", maxlength: "200", value: d.title, placeholder: "Heading above the table (optional)" });
      tt.addEventListener("input", function () { d.title = tt.value; });
      var bold = h("input", { type: "checkbox", checked: d.firstColumnBold !== false });
      bold.addEventListener("change", function () { d.firstColumnBold = bold.checked; });
      function drawTable() {
        clear(host);
        var cols = d.headers.length;
        var head = h("tr", null, d.headers.map(function (hd, c) {
          var i = h("input", { type: "text", maxlength: "120", value: hd, "aria-label": "Column " + (c + 1) + " heading" });
          i.addEventListener("input", function () { d.headers[c] = i.value; });
          return h("th", null, i, cols > 1 ? h("button", { class: "btn danger small", type: "button", text: "Remove column", style: "margin-top:4px", onclick: function () { d.headers.splice(c, 1); d.rows.forEach(function (r) { r.splice(c, 1); }); drawTable(); } }) : null);
        }), h("th"));
        var body = d.rows.map(function (row, r) {
          return h("tr", null, row.map(function (cell, c) {
            var i = h("input", { type: "text", maxlength: "1000", value: cell, "aria-label": "Row " + (r + 1) + " column " + (c + 1) });
            i.addEventListener("input", function () { d.rows[r][c] = i.value; });
            return h("td", null, i);
          }), h("td", null, h("button", { class: "btn danger small", type: "button", text: "Remove row", onclick: function () { d.rows.splice(r, 1); drawTable(); } })));
        });
        host.appendChild(h("table", null, h("thead", null, head), h("tbody", null, body)));
        host.appendChild(h("div", { class: "row", style: "margin-top:8px" },
          h("button", { class: "btn ghost small", type: "button", text: "Add row", onclick: function () { d.rows.push(d.headers.map(function () { return ""; })); drawTable(); } }),
          h("button", { class: "btn ghost small", type: "button", text: "Add column", disabled: cols >= 8, onclick: function () { d.headers.push("Column " + (cols + 1)); d.rows.forEach(function (r) { r.push(""); }); drawTable(); } })));
      }
      drawTable();
      return h("div", null, h("label", { class: "f", text: "Table heading" }), tt,
        h("label", { class: "row", style: "gap:8px;margin-top:12px" }, bold, "Make the first column bold"), host);
    }

    function draw() {
      clear(list);
      var sv = saved();
      if (!blocks.length) list.appendChild(h("div", { class: "empty", text: "No content yet. Add a block below." }));
      blocks.forEach(function (b) {
        var idx = sv.indexOf(b);
        var head = h("div", { class: "block-head" }, h("span", { class: "type", text: TYPE_LABEL[b.type] + (b.id === null ? " (not saved yet)" : "") }));
        if (b.id !== null) {
          head.appendChild(h("button", { class: "btn ghost small", type: "button", text: "Move up", disabled: idx <= 0, onclick: function () { move(b, -1); } }));
          head.appendChild(h("button", { class: "btn ghost small", type: "button", text: "Move down", disabled: idx >= sv.length - 1, onclick: function () { move(b, 1); } }));
        }
        var saveBtn = h("button", { class: "btn small", type: "button", text: "Save", onclick: function () {
          var req = b.id === null ? api("POST", "/writings", { type: b.type, data: b.data }) : api("PUT", "/writings/" + b.id, { data: b.data });
          req.then(function () { toast("Saved."); load(); }).catch(fail);
        } });
        head.appendChild(saveBtn);
        head.appendChild(h("button", { class: "btn danger small", type: "button", text: "Delete", onclick: function () {
          if (b.id === null) { blocks.splice(blocks.indexOf(b), 1); draw(); return; }
          if (confirm("Delete this block from My Writings?")) api("DELETE", "/writings/" + b.id).then(function () { toast("Deleted."); load(); }).catch(fail);
        } }));
        list.appendChild(h("div", { class: "block" + (b.id === null ? " draft" : "") }, head, h("div", { class: "block-body" }, editorFor(b))));
      });
    }

    var addBar = h("div", { class: "addbar" }, ["title", "text", "image", "table"].map(function (t) {
      return h("button", { class: "btn ghost", type: "button", text: "+ " + TYPE_LABEL[t], onclick: function () { blocks.push(newDraft(t)); draw(); window.scrollTo(0, document.body.scrollHeight); } });
    }));

    main.appendChild(h("h1", { text: "My Writings" }));
    main.appendChild(h("p", { class: "hint" }, "Everything on the My Writings page is built from the blocks below, in this order. Save each block after editing it. ",
      h("a", { href: "/my-writing.html", target: "_blank", rel: "noopener", text: "View the page" }), "."));
    main.appendChild(list);
    main.appendChild(h("h3", { text: "Add a block" }));
    main.appendChild(addBar);
    load();
  }

  // =====================================================================================================
  // Account
  // =====================================================================================================
  function viewAccount(main) {
    var cur = h("input", { type: "password", autocomplete: "current-password" });
    var n1 = h("input", { type: "password", autocomplete: "new-password" });
    var n2 = h("input", { type: "password", autocomplete: "new-password" });
    var s = state.status || {};
    main.appendChild(h("h1", { text: "Account" }));
    main.appendChild(h("form", { class: "card", onsubmit: function (e) {
      e.preventDefault();
      if (n1.value !== n2.value) { toast("The new passwords do not match.", true); return; }
      api("POST", "/password", { current: cur.value, next: n1.value }).then(function () { toast("Password changed."); cur.value = n1.value = n2.value = ""; }).catch(fail);
    } }, h("h3", { text: "Change password" }),
      h("label", { class: "f", text: "Current password" }), cur,
      h("label", { class: "f", text: "New password" }), n1, h("p", { class: "hint", text: "At least 10 characters, with letters and a number." }),
      h("label", { class: "f", text: "Repeat new password" }), n2,
      h("div", { style: "margin-top:14px" }, h("button", { class: "btn", type: "submit", text: "Change password" }))));
    main.appendChild(h("div", { class: "card" }, h("h3", { text: "Server status" }),
      h("p", null, "Email sending: ", h("span", { class: "chip " + (s.emailSendingEnabled ? "ok" : "off"), text: s.emailSendingEnabled ? "enabled" : "turned off" })),
      h("p", null, "File storage: ", h("span", { class: "chip", text: s.storageDriver === "s3" ? "CDN bucket" : "local disk (testing)" })),
      s.localMode ? h("p", { class: "hint", text: "Local test mode: data is temporary and emails can never be sent." }) : null));
  }

  // ---- boot -----------------------------------------------------------------------------------------------
  api("GET", "/me").then(function (r) { state.csrf = r.csrf; state.username = r.username; start(); }).catch(function () { renderLogin(); });
})();
