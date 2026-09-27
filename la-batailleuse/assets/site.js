/* La Batailleuse — site. Les contenus (horaires, agenda, colos, message du jour) viennent de data/contenus.json,
   tenu à jour par l'équipe ; les formulaires partent par envoi.php (ou affichent un récapitulatif sans serveur). */
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

  /* ---------- Contenus tenus à jour par l'équipe (data/contenus.json) ---------- */
  // Valeurs de secours = l'affiche horaires 2026-2027, utilisées si le fichier ne répond pas.
  var DAYS = { haute: [2, 3, 4, 5, 6], moyenne: [3, 5, 6], basse: [3] };
  var DAYS_TXT = { haute: "Du mardi au samedi", moyenne: "Mercredi, vendredi et samedi", basse: "Le mercredi" };
  var TYPE_TXT = { haute: ["Période haute", "vacances scolaires"], moyenne: ["Période moyenne", "entre les vacances"], basse: ["Période basse", "de novembre à février, hors vacances"] };
  var C = {
    message_du_jour: { texte: "", jusqu_au: "" },
    horaires: {
      accueil: { de: "16:30", a: "19:00" },
      traite: { de: "17:45", a: "18:15" },
      periodes: [
        { type: "basse", du: "2026-01-05", au: "2026-02-07" }, { type: "haute", du: "2026-02-06", au: "2026-03-07" },
        { type: "moyenne", du: "2026-03-08", au: "2026-04-03" }, { type: "haute", du: "2026-04-03", au: "2026-04-18" },
        { type: "moyenne", du: "2026-04-19", au: "2026-07-03" }, { type: "haute", du: "2026-07-04", au: "2026-08-29" },
        { type: "moyenne", du: "2026-08-30", au: "2026-10-17" }, { type: "haute", du: "2026-10-17", au: "2026-10-31" },
        { type: "basse", du: "2026-11-02", au: "2026-12-19" }, { type: "haute", du: "2026-12-19", au: "2027-01-02" }
      ],
      fermetures: ["2026-12-25", "2027-01-01"]
    },
    agenda: null,
    sejours: null
  };
  var DEMO_KEY = "bata-demo-contenus";
  var DEMO = false;
  var MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  function minutesDe(s) { var p = s.split(":"); return +p[0] * 60 + +p[1]; }
  function heureTxt(s) { var p = s.split(":"); return +p[0] + "h" + (p[1] === "00" ? "" : p[1]); }
  function jourTxt(d) { return d.getDate() === 1 ? "1er" : String(d.getDate()); }
  function lastKnown() { return C.horaires.periodes.reduce(function (m, p) { return p.au > m ? p.au : m; }, ""); }
  function plageTxt(a, b) {
    var A = parse(a), B = parse(b);
    if (A.getFullYear() !== B.getFullYear()) return "du " + jourTxt(A) + " " + MOIS[A.getMonth()] + " " + A.getFullYear() + " au " + jourTxt(B) + " " + MOIS[B.getMonth()] + " " + B.getFullYear();
    if (A.getMonth() !== B.getMonth()) return "du " + jourTxt(A) + " " + MOIS[A.getMonth()] + " au " + jourTxt(B) + " " + MOIS[B.getMonth()] + " " + B.getFullYear();
    return "du " + jourTxt(A) + " au " + jourTxt(B) + " " + MOIS[B.getMonth()] + " " + B.getFullYear();
  }

  function charger() {
    try {
      var demo = localStorage.getItem(DEMO_KEY);
      if (demo) { DEMO = true; return Promise.resolve(JSON.parse(demo)); }
    } catch (e) { /* stockage indisponible : on lit le vrai fichier */ }
    var delai = new Promise(function (_, non) { setTimeout(non, 3000); });
    return Promise.race([fetch("data/contenus.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("contenus " + r.status);
      return r.json();
    }), delai]);
  }
  function fusionner(d) {
    if (!d || typeof d !== "object") return;
    if (d.message_du_jour) C.message_du_jour = d.message_du_jour;
    var h = d.horaires;
    if (h && Array.isArray(h.periodes) && h.periodes.length) C.horaires = h;
    if (Array.isArray(d.agenda)) C.agenda = d.agenda;
    if (Array.isArray(d.sejours)) C.sejours = d.sejours;
  }

  function isOpen(d) {
    var s = iso(d);
    if ((C.horaires.fermetures || []).indexOf(s) !== -1) return false;
    return C.horaires.periodes.some(function (p) {
      return s >= p.du && s <= p.au && DAYS[p.type] && DAYS[p.type].indexOf(d.getDay()) !== -1;
    });
  }
  function nextOpening(from) {
    var fin = lastKnown();
    var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    for (var i = 1; i <= 60; i++) {
      d.setDate(d.getDate() + 1);
      if (iso(d) > fin) return null;
      if (isOpen(d)) return d;
    }
    return null;
  }
  function openStatus() {
    var a = C.horaires.accueil, minutes = NOW.getHours() * 60 + NOW.getMinutes();
    var open = isOpen(NOW);
    var next = nextOpening(NOW);
    var nextTxt = next ? "réouverture " + longDate(next) + " à " + heureTxt(a.de) : "prochains horaires bientôt en ligne";
    if (TODAY > lastKnown()) return { open: false, text: "Prochains horaires bientôt en ligne" };
    if (open && minutes < minutesDe(a.de)) return { open: true, text: "Ferme ouverte aujourd'hui de " + heureTxt(a.de) + " à " + heureTxt(a.a) };
    if (open && minutes < minutesDe(a.a)) return { open: true, text: "Ferme ouverte en ce moment, jusqu'à " + heureTxt(a.a) };
    if (open) return { open: false, text: "Ferme fermée pour ce soir · " + nextTxt };
    return { open: false, text: "Ferme fermée aujourd'hui · " + nextTxt };
  }
  function messageDuJour() {
    var m = C.message_du_jour || {};
    return m.texte && (!m.jusqu_au || TODAY <= m.jusqu_au) ? m.texte : "";
  }

  function renderAlmanach() {
    var el = document.querySelector("[data-almanach]");
    var st = openStatus();
    document.querySelectorAll("[data-open-status]").forEach(function (n) { n.textContent = st.text; });
    var msg = messageDuJour();
    document.querySelectorAll("[data-message-du-jour]").forEach(function (n) { n.textContent = msg; n.hidden = !msg; });
    if (!el) return;
    var t = C.horaires.traite, items = [];
    items.push('<span class="almanach__date">' + cap(longDate(NOW)) + "</span>");
    items.push('<span class="almanach__item"><span class="almanach__dot' + (st.open ? "" : " is-closed") + '" aria-hidden="true"></span>' + esc(st.text) + "</span>");
    var minutes = NOW.getHours() * 60 + NOW.getMinutes();
    if (isOpen(NOW) && minutes < minutesDe(t.a)) items.push('<span class="almanach__item">Traite ' + heureTxt(t.de) + "-" + heureTxt(t.a) + ", lait frais à la boutique</span>");
    if ([1, 3, 5].indexOf(NOW.getDay()) !== -1) items.push('<span class="almanach__item">Jour de fournée au fournil</span>');
    items.push('<a href="visiter.html#horaires">Tous les horaires</a>');
    if (msg) items.push('<span class="almanach__info">' + esc(msg) + "</span>");
    (el.querySelector(".wrap") || el).innerHTML = items.join("");
  }

  // Heures écrites dans les textes (accueil, traite) : suivent celles de l'espace équipe.
  function renderHeures() {
    document.querySelectorAll("[data-h]").forEach(function (n) {
      var k = n.dataset.h.split("."), h = C.horaires[k[0]];
      if (h && h[k[1]]) n.textContent = heureTxt(h[k[1]]);
    });
  }

  // Données lues par Google (JSON-LD) : jours et heures d'ouverture recalculés depuis les contenus.
  var JOURS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function renderDonneesGoogle() {
    var a = C.horaires.accueil;
    var spec = C.horaires.periodes.filter(function (p) { return p.au >= TODAY; }).map(function (p) {
      return { "@type": "OpeningHoursSpecification", dayOfWeek: (DAYS[p.type] || []).map(function (j) { return JOURS_EN[j]; }), opens: a.de, closes: a.a, validFrom: p.du, validThrough: p.au };
    }).concat((C.horaires.fermetures || []).filter(function (f) { return f >= TODAY; }).map(function (f) {
      return { "@type": "OpeningHoursSpecification", opens: "00:00", closes: "00:00", validFrom: f, validThrough: f };
    }));
    function remplacer(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(remplacer); return; }
      if (o.openingHoursSpecification) o.openingHoursSpecification = spec;
      Object.keys(o).forEach(function (k) { if (k !== "openingHoursSpecification") remplacer(o[k]); });
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (sc) {
      if (sc.textContent.indexOf("openingHoursSpecification") === -1) return;
      try { var d = JSON.parse(sc.textContent); remplacer(d); sc.textContent = JSON.stringify(d); } catch (e) { /* on garde la version écrite */ }
    });
  }

  // Page « Venir à la ferme » : les trois périodes et les fermetures, regénérées depuis les contenus.
  function renderPeriodes() {
    document.querySelectorAll("[data-periodes]").forEach(function (box) {
      box.innerHTML = ["haute", "moyenne", "basse"].map(function (type) {
        // Les périodes terminées disparaissent : le visiteur ne voit que ce qui l'attend.
        var ps = C.horaires.periodes.filter(function (p) { return p.type === type && p.au >= TODAY; })
          .sort(function (a, b) { return a.du < b.du ? -1 : 1; });
        if (!ps.length) return "";
        return '<div class="period"><h3>' + TYPE_TXT[type][0] + " <small>" + TYPE_TXT[type][1] + '</small></h3><p class="days">' + DAYS_TXT[type] + "</p><ul>" +
          ps.map(function (p) {
            return '<li data-from="' + esc(p.du) + '" data-to="' + esc(p.au) + '">' + (p.nom ? "<b>" + esc(p.nom) + "</b> : " : "") + plageTxt(p.du, p.au) + "</li>";
          }).join("") + "</ul></div>";
      }).join("") || '<p class="muted">Les horaires de la saison prochaine arrivent bientôt.</p>';
    });
    var f = (C.horaires.fermetures || []).filter(function (s) { return s >= TODAY; }).sort();
    document.querySelectorAll("[data-fermetures]").forEach(function (n) {
      if (!f.length) { n.textContent = "Aucune fermeture exceptionnelle annoncée."; return; }
      var l = f.map(function (s) { var d = parse(s); return JOURS[d.getDay()] + " " + jourTxt(d) + " " + MOIS[d.getMonth()] + " " + d.getFullYear(); });
      n.textContent = cap("le " + (l.length > 1 ? l.slice(0, -1).join(", le ") + " et le " + l[l.length - 1] : l[0])) + ".";
    });
  }

  function markPeriods() {
    document.querySelectorAll("[data-from][data-to]").forEach(function (li) {
      if (TODAY > li.dataset.to) li.classList.add("is-past");
      else if (TODAY >= li.dataset.from) li.classList.add("is-now");
    });
  }

  // Accueil : l'agenda publié par l'équipe remplace la liste écrite dans la page.
  function renderAgendaData() {
    if (!C.agenda) return;
    document.querySelectorAll("[data-agenda]").forEach(function (list) {
      list.classList.remove("is-empty");
      list.innerHTML = C.agenda.slice().sort(function (a, b) {
        return (a.date + (a.heure || "")) < (b.date + (b.heure || "")) ? -1 : 1;
      }).map(function (e) {
        var d = parse(e.date);
        var infos = [e.heure ? "À " + heureTxt(e.heure) : "", e.lieu || ""].filter(Boolean).join(" · ");
        var texte = infos + (infos && e.texte ? ". " : "") + (e.texte || "");
        return '<li class="event" data-date="' + esc(e.date) + '"' + (e.fin ? ' data-end="' + esc(e.fin) + '"' : "") + ">" +
          '<div class="event__date"><b>' + d.getDate() + "</b><span>" + MOIS_COURT[d.getMonth()] + "</span></div>" +
          "<div><h3>" + esc(e.titre) + "</h3>" + (texte ? "<p>" + esc(texte) + "</p>" : "") +
          '<div class="event__tags">' + (e.prix ? '<span class="badge">' + esc(e.prix) + "</span>" : "") + "</div></div></li>";
      }).join("");
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

  // Colos : le statut choisi par l'équipe l'emporte sur les dates écrites dans la page.
  var STATUTS = {
    "a-venir": ["Inscriptions bientôt", "badge--bientot"], ouvert: ["Inscriptions ouvertes", "badge--ok"],
    dernieres: ["Dernières places", "badge--bientot"], complet: ["Complet", "badge--complet"], termine: ["Terminé", "badge--passe"]
  };
  function renderSejours() {
    if (!C.sejours) return;
    C.sejours.forEach(function (s) {
      var st = STATUTS[s.statut];
      if (!st) return;
      document.querySelectorAll('[data-sejour="' + s.id + '"]').forEach(function (b) { b.textContent = st[0]; b.className = "badge " + st[1]; });
    });
    var ss = C.sejours.map(function (s) { return s.statut; });
    var resume = ss.some(function (x) { return x === "ouvert" || x === "dernieres"; }) ? STATUTS.ouvert
      : ss.indexOf("a-venir") !== -1 ? STATUTS["a-venir"]
      : ss.every(function (x) { return x === "complet"; }) ? STATUTS.complet : null;
    if (resume) document.querySelectorAll("[data-colos-resume]").forEach(function (b) { b.textContent = resume[0]; b.className = "badge " + resume[1]; });
  }

  function bandeauDemo() {
    if (!DEMO) return;
    var n = document.createElement("div");
    n.className = "mockup-note";
    n.style.background = "#1F4A2E";
    n.style.color = "#FFF8EE";
    n.innerHTML = "Aperçu de démonstration : les modifications faites dans l’espace équipe ne s’affichent que sur cet appareil. " +
      '<button type="button" style="font:inherit;font-weight:700;background:none;border:0;color:#F1DDB4;text-decoration:underline;cursor:pointer">Revenir au site réel</button>';
    n.querySelector("button").addEventListener("click", function () {
      try { localStorage.removeItem(DEMO_KEY); } catch (e) {}
      location.reload();
    });
    document.body.insertBefore(n, document.body.firstChild);
  }

  // Tableau plus large que l'écran (téléphone) : on dit qu'il se fait glisser.
  function indiquerTableaux() {
    document.querySelectorAll(".table-wrap").forEach(function (w) {
      var deborde = w.scrollWidth > w.clientWidth + 2, aide = w.previousElementSibling;
      var existe = aide && aide.classList.contains("table-hint");
      if (deborde && !existe) {
        var p = document.createElement("p");
        p.className = "table-hint";
        p.textContent = "Faites glisser le tableau pour voir toutes les colonnes →";
        w.parentNode.insertBefore(p, w);
      } else if (!deborde && existe) {
        aide.remove();
      }
    });
  }
  window.addEventListener("resize", indiquerTableaux);
  document.addEventListener("DOMContentLoaded", indiquerTableaux);

  function toutAfficher() {
    renderAlmanach();
    renderPeriodes();
    renderHeures();
    renderDonneesGoogle();
    markPeriods();
    renderAgendaData();
    renderAgenda();
    renderSejours();
    bandeauDemo();
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

  var PAGE = (location.pathname.split("/").pop() || "index.html").replace(/\.html?$/, "") || "index";

  // mode "envoye" : la demande est vraiment partie ; mode "demo" : maquette sans serveur d'envoi.
  function showRecap(form, mode, info) {
    var rows = collect(form);
    var to = (info && info.to) || destination(form, rows);
    var recap = form.parentNode.querySelector(".recap[data-for='" + form.id + "']");
    if (!recap) {
      recap = document.createElement("div");
      recap.className = "recap demande";
      recap.dataset.for = form.id;
      form.parentNode.insertBefore(recap, form.nextSibling);
    }
    var dl = rows.map(function (r) { return "<dt>" + esc(r.label) + "</dt><dd>" + esc(r.value) + "</dd>"; }).join("");
    var mail = '<div class="mail"><div class="mail__head"><div><b>À</b> ' + esc(to) + "</div><div><b>Objet</b> " + esc(subject(form, rows)) + "</div></div>" +
      '<div class="mail__body"><dl>' + dl + "</dl></div></div>";
    if (mode === "envoye" && info.demo) {
      recap.innerHTML =
        '<div class="recap__banner recap__banner--ok" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>' +
        "<div><b>C’est vraiment parti.</b> Démonstration : la demande et l’accusé de réception sont arrivés dans la boîte de démonstration. Sur le site en service, la demande arriverait chez <b>" + esc(to) + "</b>" +
        (info.email ? " et l’accusé de réception partirait à <b>" + esc(info.email) + "</b>" : "") + ".</div></div>" +
        '<p class="recap__ok" tabindex="-1">Merci, l’équipe vous répond dès que possible.</p>' +
        '<p class="muted">Voici ce que vous nous avez envoyé :</p>' + mail +
        '<div class="step__nav"><button type="button" class="btn btn--ghost" data-autre>Faire une autre demande</button><a class="btn" href="index.html">Retour à l’accueil</a></div>';
    } else if (mode === "envoye") {
      recap.innerHTML =
        '<div class="recap__banner recap__banner--ok" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>' +
        "<div><b>C’est envoyé.</b> Votre demande est arrivée chez <b>" + esc(to) + "</b>." +
        (info.email ? " Un accusé de réception vient de partir à <b>" + esc(info.email) + "</b>." : "") + "</div></div>" +
        '<p class="recap__ok" tabindex="-1">Merci, l’équipe vous répond dès que possible.</p>' +
        '<p class="muted">Voici ce que vous nous avez envoyé :</p>' + mail +
        '<div class="step__nav"><button type="button" class="btn btn--ghost" data-autre>Faire une autre demande</button><a class="btn" href="index.html">Retour à l’accueil</a></div>';
    } else {
      recap.innerHTML =
        '<div class="recap__banner" role="note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
        "<div><b>Maquette : rien n'a été envoyé.</b> Sur le vrai site, cette demande partirait directement à <b>" + esc(to) + "</b>, déjà complète et triée, et vous recevriez aussitôt un accusé de réception.</div></div>" +
        '<p class="recap__ok" tabindex="-1">Merci, votre demande est prête.</p>' +
        '<p class="muted">Voici exactement ce que l\'équipe recevrait :</p>' + mail +
        '<div class="step__nav"><button type="button" class="btn btn--ghost" data-edit>Modifier ma demande</button><a class="btn" href="index.html">Retour à l\'accueil</a></div>';
    }
    form.hidden = true;
    recap.hidden = false;
    var retour = recap.querySelector("[data-edit], [data-autre]");
    retour.addEventListener("click", function () {
      if (retour.hasAttribute("data-autre")) { form.reset(); form._debut = Date.now(); form._montrer(0); applyConditions(form); }
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

  function erreurEnvoi(form, bouton, message, to) {
    var p = document.createElement("p");
    p.className = "demande__erreur";
    p.setAttribute("role", "alert");
    p.innerHTML = esc(message) + (to ? ' Vous pouvez aussi écrire directement à <a href="mailto:' + esc(to) + '">' + esc(to) + "</a>." : "");
    bouton.closest(".step__nav").insertAdjacentElement("beforebegin", p);
  }

  function envoyer(form) {
    var rows = collect(form);
    var bouton = form.querySelector('.step:not([hidden]) button[type="submit"]');
    var ancien = form.querySelector(".demande__erreur");
    if (ancien) ancien.remove();
    var libelle = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = "Envoi en cours…";
    var champ = form.dataset.toField ? (form.querySelector('[name="' + form.dataset.toField + '"]:checked') || form.querySelector('[name="' + form.dataset.toField + '"]')) : null;
    var email = form.querySelector('input[type="email"]');
    var pot = form.querySelector('[name="site_web"]');
    var titre = form.querySelector(".demande__head h3");
    var corps = {
      formulaire: PAGE + "/" + form.id,
      titre: titre ? titre.textContent.trim() : "",
      objet: subject(form, rows),
      aiguillage: champ ? champ.value : "",
      email: email ? email.value.trim() : "",
      lignes: rows.map(function (r) { return { libelle: r.label, valeur: r.value }; }),
      site_web: pot ? pot.value : "",
      duree_ms: Date.now() - (form._debut || Date.now())
    };
    function fin() { bouton.disabled = false; bouton.textContent = libelle; }
    fetch("envoi.php", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corps) })
      .then(function (r) {
        return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status, j: null }; });
      })
      .then(function (res) {
        fin();
        if (res.s === 200 && res.j && res.j.ok) return showRecap(form, "envoye", { to: res.j.destinataire, email: corps.email, demo: !!res.j.demo });
        // Pas de serveur d'envoi (maquette statique) : le serveur ne sait pas traiter la demande.
        if (!res.j && [404, 405, 501].indexOf(res.s) !== -1) return showRecap(form, "demo");
        // En démonstration, jamais de lien vers la vraie boîte de la ferme.
        erreurEnvoi(form, bouton, (res.j && res.j.erreur) || "L’envoi n’a pas abouti.", res.j && res.j.demo ? null : (res.j && res.j.destinataire) || destination(form, rows));
      }, function () {
        fin();
        erreurEnvoi(form, bouton, "Pas de connexion : votre demande n’est pas partie. Réessayez dans un instant.", destination(form, rows));
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
      envoyer(form);
    });
    // Piège à robots : un champ invisible que seuls les robots remplissent.
    var pot = document.createElement("div");
    pot.setAttribute("aria-hidden", "true");
    pot.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
    pot.innerHTML = '<label>Site web <input type="text" name="site_web" tabindex="-1" autocomplete="off" data-skip></label>';
    form.appendChild(pot);
    form._debut = Date.now();
    form._montrer = show;
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
    charger().then(fusionner, function () { /* hors ligne ou fichier absent : valeurs de secours */ }).then(toutAfficher);
    initNav();
    initReveal();
    document.querySelectorAll("form.demande").forEach(function (f) { initForm(f); });
    document.querySelectorAll("form[data-estimateur]").forEach(initEstimate);
  });
})();
