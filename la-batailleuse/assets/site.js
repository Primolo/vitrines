/* La Batailleuse — maquette. Aucun envoi réel : les formulaires affichent
   le récapitulatif que l'équipe recevrait. */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");

  // ?date=2026-10-20&heure=17:30 permet de tester le bandeau à une autre date.
  var params = new URLSearchParams(location.search);
  var NOW = (function () {
    var d = new Date();
    var p = params.get("date");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) {
      var h = (params.get("heure") || "10:00").split(":");
      d = new Date(+p.slice(0, 4), +p.slice(5, 7) - 1, +p.slice(8, 10), +h[0] || 0, +h[1] || 0);
    }
    return d;
  })();

  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parse(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  var TODAY = iso(NOW);
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function longDate(d) { return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- Horaires de la ferme (affiche 2026-2027) ---------- */
  var DAYS = { haute: [2, 3, 4, 5, 6], moyenne: [3, 5, 6], basse: [3] };
  var PERIODS = [
    { type: "basse", from: "2026-01-05", to: "2026-02-07" },
    { type: "haute", from: "2026-02-06", to: "2026-03-07" },
    { type: "moyenne", from: "2026-03-08", to: "2026-04-03" },
    { type: "haute", from: "2026-04-03", to: "2026-04-18" },
    { type: "moyenne", from: "2026-04-19", to: "2026-07-03" },
    { type: "haute", from: "2026-07-04", to: "2026-08-29" },
    { type: "moyenne", from: "2026-08-30", to: "2026-10-17" },
    { type: "haute", from: "2026-10-17", to: "2026-10-31" },
    { type: "basse", from: "2026-11-02", to: "2026-12-19" },
    { type: "haute", from: "2026-12-19", to: "2027-01-02" }
  ];
  var CLOSED = ["2026-12-25", "2027-01-01"];
  var LAST_KNOWN = "2027-01-02";
  // Message du jour, modifiable depuis un téléphone sur le vrai site (fermeture exceptionnelle, neige…).
  var INFO_DU_JOUR = "";

  function isOpen(d) {
    var s = iso(d);
    if (CLOSED.indexOf(s) !== -1) return false;
    return PERIODS.some(function (p) {
      return s >= p.from && s <= p.to && DAYS[p.type].indexOf(d.getDay()) !== -1;
    });
  }
  function nextOpening(from) {
    var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (var i = 1; i <= 60; i++) {
      d.setDate(d.getDate() + 1);
      if (iso(d) > LAST_KNOWN) return null;
      if (isOpen(d)) return d;
    }
    return null;
  }
  function openStatus() {
    var minutes = NOW.getHours() * 60 + NOW.getMinutes();
    var open = isOpen(NOW);
    var next = nextOpening(NOW);
    var nextTxt = next ? "réouverture " + longDate(next) + " à 16h30" : "horaires 2027 bientôt en ligne";
    if (TODAY > LAST_KNOWN) return { open: false, text: "Horaires 2027 bientôt en ligne" };
    if (open && minutes < 16 * 60 + 30) return { open: true, text: "Ferme ouverte aujourd'hui de 16h30 à 19h" };
    if (open && minutes < 19 * 60) return { open: true, text: "Ferme ouverte en ce moment, jusqu'à 19h" };
    if (open) return { open: false, text: "Ferme fermée pour ce soir · " + nextTxt };
    return { open: false, text: "Ferme fermée aujourd'hui · " + nextTxt };
  }

  function renderAlmanach() {
    var el = document.querySelector("[data-almanach]");
    var st = openStatus();
    document.querySelectorAll("[data-open-status]").forEach(function (n) { n.textContent = st.text; });
    if (!el) return;
    var items = [];
    items.push('<span class="almanach__date">' + cap(longDate(NOW)) + "</span>");
    items.push('<span class="almanach__item"><span class="almanach__dot' + (st.open ? "" : " is-closed") + '" aria-hidden="true"></span>' + st.text + "</span>");
    var minutes = NOW.getHours() * 60 + NOW.getMinutes();
    if (isOpen(NOW) && minutes < 18 * 60 + 15) items.push('<span class="almanach__item">Traite 17h45-18h15, lait frais à la boutique</span>');
    if ([1, 3, 5].indexOf(NOW.getDay()) !== -1) items.push('<span class="almanach__item">Jour de fournée au fournil</span>');
    items.push('<a href="visiter.html#horaires">Tous les horaires</a>');
    if (INFO_DU_JOUR) items.push('<span class="almanach__info">' + INFO_DU_JOUR + "</span>");
    (el.querySelector(".wrap") || el).innerHTML = items.join("");
  }

  function markPeriods() {
    document.querySelectorAll("[data-from][data-to]").forEach(function (li) {
      if (TODAY > li.dataset.to) li.classList.add("is-past");
      else if (TODAY >= li.dataset.from) li.classList.add("is-now");
    });
  }

  /* ---------- Agenda : archive seul les dates passées ---------- */
  function renderAgenda() {
    var tomorrow = new Date(NOW); tomorrow.setDate(tomorrow.getDate() + 1);
    var TOMORROW = iso(tomorrow);
    document.querySelectorAll(".agenda").forEach(function (list) {
      var visible = 0;
      list.querySelectorAll(".event[data-date]").forEach(function (ev) {
        var end = ev.dataset.end || ev.dataset.date;
        if (end < TODAY) { ev.classList.add("is-past"); return; }
        visible++;
        var tags = ev.querySelector(".event__tags");
        var label = ev.dataset.date === TODAY ? "Aujourd'hui" : ev.dataset.date === TOMORROW ? "Demain" : "";
        if (label && tags) {
          var b = document.createElement("span");
          b.className = "badge badge--bientot";
          b.textContent = label;
          tags.insertBefore(b, tags.firstChild);
        }
      });
      if (!visible) list.classList.add("is-empty");
    });
    // Badges qui changent seuls une fois la date passée (ex. séjours terminés).
    document.querySelectorAll("[data-until][data-past-text]").forEach(function (b) {
      if (TODAY > b.dataset.until) {
        b.textContent = b.dataset.pastText;
        b.className = "badge badge--passe";
      }
    });
  }

  /* ---------- Menu mobile ---------- */
  function initNav() {
    var btn = document.querySelector(".menu-toggle");
    var nav = document.getElementById("nav");
    if (!btn || !nav) return;
    var scrim = null;
    function close() {
      nav.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      if (scrim) { scrim.remove(); scrim = null; }
      document.body.style.overflow = "";
    }
    function open() {
      nav.classList.add("is-open");
      btn.setAttribute("aria-expanded", "true");
      scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.addEventListener("click", close);
      document.body.appendChild(scrim);
      document.body.style.overflow = "hidden";
      var first = nav.querySelector("a, button");
      if (first) first.focus();
    }
    btn.addEventListener("click", function () { nav.classList.contains("is-open") ? close() : open(); });
    var x = nav.querySelector(".nav__close");
    if (x) x.addEventListener("click", function () { close(); btn.focus(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("is-open")) { close(); btn.focus(); } });
  }

  /* ---------- Apparition douce ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (params.has("capture") || !("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      els.forEach(function (e) { e.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------- Formulaires de demande en étapes ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  function applyConditions(form) {
    form.querySelectorAll("[data-show-if]").forEach(function (block) {
      var rule = block.dataset.showIf.split("=");
      var name = rule[0], wanted = rule[1].split("|");
      var inputs = form.querySelectorAll('[name="' + name + '"]');
      var show = false;
      inputs.forEach(function (i) {
        if ((i.type === "radio" || i.type === "checkbox") ? i.checked && wanted.indexOf(i.value) !== -1 : wanted.indexOf(i.value) !== -1) show = true;
      });
      block.hidden = !show;
      block.querySelectorAll("input, select, textarea").forEach(function (f) { f.disabled = !show; });
    });
  }

  function fieldLabel(el) {
    var field = el.closest(".field");
    if (field) {
      if (field.dataset.label) return field.dataset.label;
      var l = field.querySelector(":scope > label, :scope > .label");
      if (l) return l.textContent.replace("*", "").trim();
    }
    var lab = el.id && el.form.querySelector('label[for="' + el.id + '"]');
    return lab ? lab.textContent.replace("*", "").trim() : el.name;
  }
  function optionText(input) {
    var span = input.nextElementSibling;
    if (!span) return input.value;
    var clone = span.cloneNode(true);
    clone.querySelectorAll("small").forEach(function (s) { s.remove(); });
    return clone.textContent.trim();
  }

  function collect(form) {
    var rows = [], seen = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled || el.type === "submit" || el.type === "button" || el.dataset.skip !== undefined) return;
      if (seen[el.name]) return;
      var value = "";
      if (el.type === "radio" || el.type === "checkbox") {
        seen[el.name] = true;
        var checked = form.querySelectorAll('[name="' + el.name + '"]:checked');
        value = Array.prototype.map.call(checked, optionText).join(", ");
      } else if (el.tagName === "SELECT") {
        value = el.value ? el.options[el.selectedIndex].text : "";
      } else {
        value = el.value.trim();
        if (value && el.type === "date") value = cap(longDate(parse(value))) + " " + value.slice(0, 4);
      }
      if (value) rows.push({ name: el.name, label: fieldLabel(el), value: value });
    });
    return rows;
  }

  function destination(form, rows) {
    if (form.dataset.toField && form.dataset.toMap) {
      var map = JSON.parse(form.dataset.toMap);
      var el = form.querySelector('[name="' + form.dataset.toField + '"]:checked') || form.querySelector('[name="' + form.dataset.toField + '"]');
      if (el && map[el.value]) return map[el.value];
    }
    return form.dataset.to || "contact@claj-batailleuse.fr";
  }

  function subject(form, rows) {
    var tpl = form.dataset.subject || "Nouvelle demande";
    return tpl.replace(/\{(\w+)\}/g, function (_, n) {
      var r = rows.filter(function (x) { return x.name === n; })[0];
      return r ? r.value : "…";
    });
  }

  function showRecap(form) {
    var rows = collect(form);
    var to = destination(form, rows);
    var recap = form.parentNode.querySelector(".recap[data-for='" + form.id + "']");
    if (!recap) {
      recap = document.createElement("div");
      recap.className = "recap demande";
      recap.dataset.for = form.id;
      form.parentNode.insertBefore(recap, form.nextSibling);
    }
    var dl = rows.map(function (r) { return "<dt>" + esc(r.label) + "</dt><dd>" + esc(r.value) + "</dd>"; }).join("");
    recap.innerHTML =
      '<div class="recap__banner" role="note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
      "<div><b>Maquette : rien n'a été envoyé.</b> Sur le vrai site, cette demande partirait directement à <b>" + esc(to) + "</b>, déjà complète et triée. Vous recevriez aussitôt un accusé de réception avec le délai de réponse choisi par l'équipe.</div></div>" +
      '<p class="recap__ok" tabindex="-1">Merci, votre demande est prête.</p>' +
      '<p class="muted">Voici exactement ce que l\'équipe recevrait :</p>' +
      '<div class="mail"><div class="mail__head"><div><b>À</b> ' + esc(to) + "</div><div><b>Objet</b> " + esc(subject(form, rows)) + "</div></div>" +
      '<div class="mail__body"><dl>' + dl + "</dl></div></div>" +
      '<div class="step__nav"><button type="button" class="btn btn--ghost" data-edit>Modifier ma demande</button><a class="btn" href="index.html">Retour à l\'accueil</a></div>';
    form.hidden = true;
    recap.hidden = false;
    recap.querySelector("[data-edit]").addEventListener("click", function () {
      recap.hidden = true;
      form.hidden = false;
      requestAnimationFrame(function () { form.scrollIntoView({ block: "start" }); });
    });
    // Saut direct (sans animation) : le formulaire masqué raccourcit la page, un défilement animé se perdrait.
    requestAnimationFrame(function () {
      recap.scrollIntoView({ block: "start" });
      recap.querySelector(".recap__ok").focus({ preventScroll: true });
    });
  }

  function initForm(form) {
    var steps = Array.prototype.slice.call(form.querySelectorAll(".step"));
    if (!steps.length) return;
    var current = 0;

    var progress = document.createElement("ol");
    progress.className = "progress";
    progress.setAttribute("aria-label", "Étapes de la demande");
    steps.forEach(function (s, i) {
      var li = document.createElement("li");
      var legend = s.querySelector("legend");
      li.innerHTML = (i + 1) + '. <span>' + esc(s.dataset.short || (legend ? legend.textContent : "")) + "</span>";
      progress.appendChild(li);
    });
    form.insertBefore(progress, steps[0]);

    steps.forEach(function (s, i) {
      var nav = document.createElement("div");
      nav.className = "step__nav";
      if (i > 0) nav.innerHTML += '<button type="button" class="btn btn--ghost" data-prev>Retour</button>';
      nav.innerHTML += i < steps.length - 1
        ? '<button type="button" class="btn" data-next>Continuer</button>'
        : '<button type="submit" class="btn">' + esc(form.dataset.submit || "Envoyer ma demande") + "</button>";
      s.appendChild(nav);
    });

    function show(i) {
      current = i;
      steps.forEach(function (s, k) { s.hidden = k !== i; });
      progress.querySelectorAll("li").forEach(function (li, k) {
        li.className = k < i ? "is-done" : k === i ? "is-current" : "";
        if (k === i) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      });
    }
    function valid(i) {
      var fields = steps[i].querySelectorAll("input, select, textarea");
      for (var k = 0; k < fields.length; k++) {
        if (!fields[k].disabled && !fields[k].checkValidity()) { fields[k].reportValidity(); return false; }
      }
      return true;
    }

    form.addEventListener("click", function (e) {
      if (e.target.closest("[data-next]") && valid(current)) {
        show(current + 1);
        form.scrollIntoView({ behavior: "smooth", block: "start" });
        var f = steps[current].querySelector("input, select, textarea");
        if (f) f.focus({ preventScroll: true });
      }
      if (e.target.closest("[data-prev]")) { show(current - 1); form.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    form.addEventListener("change", function () { applyConditions(form); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!valid(current)) return;
      showRecap(form);
    });
    applyConditions(form);
    show(0);
  }

  /* ---------- Estimation du séjour au Chalet du Souleret ---------- */
  // Grille 2026-2027 publiée sur /tarifs-2/ : [semaine, week-end] par personne.
  var GRILLE = {
    pension: { adultes: [50, 54], moins16: [41, 43], moins12: [39, 40], moins6: [34, 35], moins3: [0, 0] },
    demi: { adultes: [41, 45], moins16: [35, 37], moins12: [33, 34], moins6: [29, 29], moins3: [0, 0] },
    nuit: { adultes: [23, 23], moins16: [20, 20], moins12: [18, 18], moins6: [15, 15], moins3: [0, 0] },
    petitdej: { adultes: 7, moins16: 6, moins12: 5, moins6: 4, moins3: 0 }
  };
  var AGES = ["adultes", "moins16", "moins12", "moins6", "moins3"];
  function euros(n) { return Math.round(n).toLocaleString("fr-FR") + " €"; }

  function initEstimate(form) {
    var out = form.querySelector("[data-estimate]");
    if (!out) return;
    function val(name) {
      var el = form.querySelector('[name="' + name + '"]:checked') || form.querySelector('[name="' + name + '"]');
      return el ? el.value : "";
    }
    function num(name) { return Math.max(0, parseInt(val(name), 10) || 0); }
    function update() {
      var formule = val("formule"), nuits = Math.max(1, num("nuits"));
      var we = val("periode") === "weekend" ? 1 : 0;
      var total = 0, gens = 0, detail = [];
      AGES.forEach(function (a) { gens += num(a); });
      if (!formule) { out.innerHTML = "<span>Choisissez une formule pour voir une estimation.</span>"; return; }
      if (formule === "libre") {
        var extra = val("periode") === "speciaux" ? 450 : 300;
        total = 1000 + (nuits - 1) * extra + 50;
        detail.push(nuits + (nuits > 1 ? " nuits" : " nuit"), "gestion libre", "adhésion 50 € incluse", "ménage à votre charge");
      } else {
        if (!gens) { out.innerHTML = "<span>Indiquez le nombre de personnes pour voir une estimation.</span>"; return; }
        AGES.forEach(function (a) { total += num(a) * GRILLE[formule][a][we] * nuits; });
        if (formule === "nuit" && val("petitdej")) AGES.forEach(function (a) { total += num(a) * GRILLE.petitdej[a] * nuits; });
        var adhesion = val("type_sejour") === "famille" ? 5 : gens < 20 ? 25 : 50;
        total += adhesion;
        detail.push(nuits + (nuits > 1 ? " nuits" : " nuit"), gens + " personne" + (gens > 1 ? "s" : ""),
          { pension: "pension complète", demi: "demi-pension", nuit: "nuitée" }[formule] + (formule === "nuit" ? "" : we ? ", tarif week-end" : ", tarif semaine"),
          "adhésion " + adhesion + " € incluse");
      }
      var warn = gens > 62 ? '<span style="color:#F1DDB4;font-weight:700">Le chalet compte 62 places : au-delà, parlons-en avec l\'équipe.</span>' : "";
      out.innerHTML = "<span>Estimation indicative</span><strong>≈ " + euros(total) + "</strong><span>" + detail.join(" · ") +
        " · hors taxe de séjour</span>" + warn +
        "<span>Calculée avec la grille 2026-2027 publiée, par personne et par nuit. Le devis définitif vient de l'équipe.</span>";
    }
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderAlmanach();
    markPeriods();
    renderAgenda();
    initNav();
    initReveal();
    document.querySelectorAll("form.demande").forEach(function (f) { initForm(f); });
    document.querySelectorAll("form[data-estimateur]").forEach(initEstimate);
  });
})();
