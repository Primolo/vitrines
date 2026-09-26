/* Espace équipe de la Batailleuse.
   Sur l'hébergement (IONOS) : parle à api.php. Sur la maquette sans PHP : mode démonstration,
   les changements restent sur l'appareil et le site les affiche sur ce seul appareil. */
(function () {
  "use strict";

  var API = "api.php";
  var CLE_DEMO = "bata-demo-contenus", CLE_DEMO_J = "bata-demo-journal", CLE_DEMO_H = "bata-demo-historique", CLE_SESSION = "bata-equipe";
  var S = { demo: false, prenom: "", code: "", contenus: null, journal: [], historique: [], brouillon: null, dirty: false };
  var STATUTS = [["a-venir", "Inscriptions bientôt", "pas encore ouvertes"], ["ouvert", "Inscriptions ouvertes", ""], ["dernieres", "Dernières places", ""], ["complet", "Complet", ""], ["termine", "Terminé", "séjour passé"]];
  var TYPES = { haute: ["Haute", "badge--ok", "du mardi au samedi"], moyenne: ["Moyenne", "badge--bientot", "mer., ven., sam."], basse: ["Basse", "", "le mercredi"] };
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parse(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
  function aujourdhui() { return iso(new Date()); }
  function dansJours(n) { var d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
  function jourTxt(d) { return d.getDate() === 1 ? "1er" : String(d.getDate()); }
  function dateTxt(s) { var d = parse(s); return JOURS[d.getDay()] + " " + jourTxt(d) + " " + MOIS[d.getMonth()] + " " + d.getFullYear(); }
  function heureTxt(s) { var p = s.split(":"); return +p[0] + "h" + (p[1] === "00" ? "" : p[1]); }
  function quandTxt(q) {
    if (!q) return "";
    var d = new Date(q), h = d.getHours() + "h" + String(d.getMinutes()).padStart(2, "0");
    if (iso(d) === aujourdhui()) return "aujourd’hui à " + h;
    if (iso(d) === dansJours(-1)) return "hier à " + h;
    return "le " + jourTxt(d) + " " + MOIS[d.getMonth()] + " à " + h;
  }
  function libelleStatut(v) { return (STATUTS.filter(function (s) { return s[0] === v; })[0] || ["", v])[1]; }
  function copie(o) { return JSON.parse(JSON.stringify(o)); }
  function lireLocal(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function ecrireLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué */ } }
  function oublierLocal(k) { try { localStorage.removeItem(k); } catch (e) { /* rien */ } }

  function toast(msg, erreur) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "eq-toast" + (erreur ? " is-err" : "");
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.hidden = true; }, erreur ? 6500 : 3200);
  }

  /* ---------- Serveur ou démonstration ---------- */
  // Démonstration seulement si l'hébergement ne sait pas exécuter api.php (404/405/501 : maquette statique).
  // Une panne du vrai serveur ne doit jamais basculer en démo : l'équipe croirait publier pour rien.
  function detecter() {
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ping" }) })
      .then(function (r) {
        return r.json().then(function (j) { return j && j.equipe ? "serveur" : "panne"; }, function () {
          return [404, 405, 501].indexOf(r.status) !== -1 ? "demo" : "panne";
        });
      }, function () { return "panne"; });
  }

  function appel(action, donnees) {
    document.body.setAttribute("aria-busy", "true");
    return appelBrut(action, donnees).then(function (res) { document.body.removeAttribute("aria-busy"); return res; });
  }

  function appelBrut(action, donnees) {
    if (S.demo) return Promise.resolve(demo(action, donnees || {}));
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Code-Equipe": S.code, "X-Prenom": encodeURIComponent(S.prenom) },
      body: JSON.stringify(Object.assign({ action: action }, donnees || {}))
    }).then(function (r) {
      return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status, j: { erreur: "Réponse illisible du serveur. Rien n’a été enregistré." } }; });
    }, function () {
      return { s: 0, j: { erreur: "Pas de connexion : rien n’a été enregistré. Réessayez dans un instant." } };
    });
  }

  // La démonstration applique les mêmes opérations que le serveur, sur une copie gardée dans ce navigateur.
  function demo(action, d) {
    var c = copie(S.contenus), j = lireLocal(CLE_DEMO_J, []), h = lireLocal(CLE_DEMO_H, []), section = "", resume = "";
    function archiver() { h.unshift({ fichier: "demo-" + Date.now().toString(36), doc: S.contenus }); h = h.slice(0, 20); }
    if (action === "lire") return { s: 200, j: { ok: true, contenus: c, journal: j, historique: h.map(function (x) { return x.fichier; }) } };
    if (action === "message") {
      archiver(); section = "message";
      c.message_du_jour = { texte: d.texte, jusqu_au: d.texte ? d.jusqu_au : "" };
      resume = d.texte ? "Message du jour : « " + d.texte + " »" : "Message du jour retiré";
    } else if (action === "evenement_ajouter") {
      archiver(); section = "agenda";
      var e = Object.assign({ id: "d" + Date.now().toString(36) }, d.evenement);
      c.agenda = (c.agenda || []).concat([e]).sort(function (a, b) { return (a.date + (a.heure || "")) < (b.date + (b.heure || "")) ? -1 : 1; });
      resume = "Date ajoutée : " + e.titre + " (" + e.date.slice(8) + "/" + e.date.slice(5, 7) + ")";
    } else if (action === "evenement_supprimer") {
      var i = (c.agenda || []).map(function (x) { return x.id; }).indexOf(d.id);
      if (i < 0) return { s: 200, j: { ok: true, info: "Cette date avait déjà été retirée.", contenus: c, journal: j, historique: h.map(function (x) { return x.fichier; }) } };
      archiver(); section = "agenda";
      resume = "Date retirée : " + c.agenda[i].titre + " (" + c.agenda[i].date.slice(8) + "/" + c.agenda[i].date.slice(5, 7) + ")";
      c.agenda.splice(i, 1);
    } else if (action === "sejour_statut") {
      archiver(); section = "sejours";
      c.sejours.forEach(function (s) { if (s.id === d.id) { resume = s.nom + " : " + libelleStatut(d.statut).toLowerCase(); s.statut = d.statut; } });
    } else if (action === "horaires") {
      archiver(); section = "horaires";
      c.horaires = d.horaires;
      resume = "Horaires modifiés (" + d.horaires.periodes.length + " périodes, " + d.horaires.fermetures.length + " fermetures)";
    } else if (action === "restaurer") {
      var v = h.filter(function (x) { return x.fichier === d.fichier; })[0];
      if (!v) return { s: 404, j: { erreur: "Version introuvable." } };
      archiver(); section = "tout";
      var versions = c.versions;
      c = copie(v.doc);
      c.versions = versions;
      Object.keys(c.versions).forEach(function (k) { c.versions[k]++; });
      resume = "Retour à une version précédente";
    }
    c.versions = c.versions || {};
    if (section !== "tout") c.versions[section] = (c.versions[section] || 0) + 1;
    c.version = (c.version || 0) + 1;
    c.mis_a_jour = new Date().toISOString();
    c.par = S.prenom;
    j.unshift({ quand: c.mis_a_jour, par: S.prenom, section: section, resume: resume, avant: h[0] ? h[0].fichier : "" });
    j = j.slice(0, 50);
    ecrireLocal(CLE_DEMO, c); ecrireLocal(CLE_DEMO_J, j); ecrireLocal(CLE_DEMO_H, h);
    return { s: 200, j: { ok: true, contenus: c, journal: j, historique: h.map(function (x) { return x.fichier; }) } };
  }

  /* ---------- Résultats, conflits ---------- */
  function maj(j) {
    if (j.reglages) S.reglages = j.reglages;
    S.contenus = j.contenus;
    S.journal = j.journal || [];
    S.historique = j.historique || [];
    if (!S.dirty) S.brouillon = copie(S.contenus.horaires);
    tout();
  }

  // relancer(true) renvoie la même action en forçant, une fois que la personne a choisi « remplacer ».
  function traiter(res, relancer, succes) {
    if (res.s === 200 && res.j.ok) {
      maj(res.j);
      toast(res.j.info || (S.demo ? "Enregistré (démonstration)." : "Enregistré. C’est en ligne."));
      if (succes) succes();
      return;
    }
    if (res.s === 409) return conflit(res.j, relancer, succes);
    if (res.s === 401) return deconnecter("Code incorrect ou changé : reconnectez-vous.");
    toast(res.j.erreur || "Rien n’a été enregistré.", true);
    tout();
  }

  function conflit(j, relancer, succes) {
    var dlg = $("#conflit"), qui = esc(j.par), quand = quandTxt(j.quand), cite = "";
    if (j.section === "message") {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a changé le message du jour " + quand + " :";
      cite = j.actuel && j.actuel.texte ? "« " + esc(j.actuel.texte) + " »" : "(message retiré)";
    } else if (j.section === "horaires") {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a modifié les horaires " + quand + ". Ses horaires :";
      cite = (j.actuel.periodes || []).length + " périodes, " + (j.actuel.fermetures || []).length + " fermetures exceptionnelles.";
    } else {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a changé le statut de ce séjour " + quand + " :";
      cite = esc(libelleStatut(j.actuel && j.actuel.statut));
    }
    $("#conflit-cite").innerHTML = cite;
    dlg.onclick = function (e) {
      var b = e.target.closest("[data-choix]");
      if (!b) return;
      dlg.close();
      if (b.dataset.choix === "remplacer") {
        relancer(true);
      } else {
        if (j.section === "horaires") S.dirty = false;
        maj(j);
        toast("C’est sa version qui reste en ligne.");
      }
    };
    dlg.oncancel = function () {
      if (j.section === "horaires") S.dirty = false;
      maj(j);
      toast("C’est sa version qui reste en ligne.");
    };
    if (dlg.showModal) dlg.showModal(); else if (confirm("Quelqu’un vient de modifier la même chose. Mettre votre version à la place ?")) relancer(true); else maj(j);
  }

  /* ---------- Connexion ---------- */
  function montrer(app) {
    $("#connexion").hidden = app;
    $("#app").hidden = !app;
  }

  function deconnecter(message) {
    oublierLocal(CLE_SESSION);
    S.code = "";
    montrer(false);
    var e = $("#cx-erreur");
    e.textContent = message || "";
    e.hidden = !message;
    $("#cx-prenom").value = S.prenom;
  }

  function entrer(prenom, code, garder) {
    S.prenom = prenom;
    S.code = code;
    return appel("lire").then(function (res) {
      if (res.s === 200 && res.j.ok) {
        if (garder) ecrireLocal(CLE_SESSION, { prenom: prenom, code: code });
        maj(res.j);
        montrer(true);
        return true;
      }
      deconnecter(res.s === 401 ? "Code incorrect." : res.j.erreur || "Connexion impossible.");
      return false;
    });
  }

  /* ---------- Affichage ---------- */
  function tout() {
    if (!S.contenus) return;
    $("#bonjour").textContent = "Bonjour " + S.prenom;
    var dernier = S.journal[0];
    $("#derniere").textContent = dernier ? "Dernière modification : " + dernier.resume + ", par " + dernier.par + " " + quandTxt(dernier.quand) + "." : "";
    afficherMessage();
    afficherAgenda();
    afficherColos();
    afficherHoraires();
    afficherHistorique();
    afficherReglages();
  }

  function afficherReglages() {
    var r = S.reglages || {}, carte = $("#fd");
    carte.hidden = S.demo || !r.interrupteur;
    if (carte.hidden) return;
    $$('[name="fd"]').forEach(function (x) { x.checked = x.value === (r.boites_reelles ? "boites" : "primo"); });
    $("#fd-etat").textContent = r.boites_reelles
      ? "Activé" + (r.par ? " par " + r.par + " " + quandTxt(r.quand) : "") + " : envoyez un formulaire depuis le site, la demande arrive dans la boîte concernée."
      : "";
  }

  function afficherMessage() {
    var m = S.contenus.message_du_jour || {}, actif = m.texte && (!m.jusqu_au || aujourdhui() <= m.jusqu_au);
    var el = $("#msg-actuel");
    var fin = !m.jusqu_au ? "" : m.jusqu_au === aujourdhui() ? " (aujourd’hui seulement)" : " (jusqu’au " + dateTxt(m.jusqu_au) + " inclus)";
    el.textContent = actif ? m.texte + fin : "Aucun message en ce moment.";
    el.className = actif ? "" : "vide";
    $("#msg-retirer").hidden = !actif;
  }

  function afficherAgenda() {
    var tous = S.contenus.agenda || [], a = aujourdhui();
    var avenir = tous.filter(function (e) { return (e.fin || e.date) >= a; });
    var passees = tous.length - avenir.length;
    $("#ag-liste").innerHTML = avenir.length ? avenir.map(function (e) {
      var d = parse(e.date);
      var infos = [e.heure ? heureTxt(e.heure) : "", e.lieu, e.prix].filter(Boolean).join(" · ");
      return '<li class="eq-item"><div class="d"><b>' + d.getDate() + "</b><span>" + MOIS_COURT[d.getMonth()] + "</span></div>" +
        "<div><h3>" + esc(e.titre) + "</h3>" + (infos ? "<p>" + esc(infos) + "</p>" : "") + "</div>" +
        '<button type="button" class="eq-mini" data-retirer="' + esc(e.id) + '" aria-label="Retirer « ' + esc(e.titre) + ' »">Retirer</button></li>';
    }).join("") : '<li class="muted">Aucune date à venir. Ajoutez la prochaine ci-dessous.</li>';
    $("#ag-passees").textContent = passees ? passees + (passees > 1 ? " dates passées ne s’affichent plus" : " date passée ne s’affiche plus") + " sur le site." : "";
  }

  function afficherColos() {
    $("#co-liste").innerHTML = (S.contenus.sejours || []).map(function (s) {
      return '<div class="eq-sejour"><h3>' + esc(s.nom) + '</h3><div class="choices">' + STATUTS.map(function (st) {
        return '<label class="choice"><input type="radio" name="co-' + esc(s.id) + '" value="' + st[0] + '" data-sejour="' + esc(s.id) + '"' + (s.statut === st[0] ? " checked" : "") + "><span>" + st[1] + (st[2] ? "<small>" + st[2] + "</small>" : "") + "</span></label>";
      }).join("") + "</div></div>";
    }).join("");
  }

  function afficherHoraires() {
    var h = S.brouillon;
    if (!h) return;
    $("#ho-acc-de").value = h.accueil.de; $("#ho-acc-a").value = h.accueil.a;
    $("#ho-tr-de").value = h.traite.de; $("#ho-tr-a").value = h.traite.a;
    var a = aujourdhui();
    $("#ho-periodes").innerHTML = h.periodes.slice().sort(function (x, y) { return x.du < y.du ? -1 : 1; }).map(function (p) {
      var t = TYPES[p.type] || ["?", "", ""];
      var etat = p.au < a ? " (passée)" : p.du <= a ? " (en cours)" : "";
      return '<div class="eq-periode"><span class="badge ' + t[1] + '">' + t[0] + "</span><span>" + (p.nom ? "<b>" + esc(p.nom) + "</b> : " : "") +
        "du " + esc(dateTxt(p.du)) + " au " + esc(dateTxt(p.au)) + '<small class="muted">' + etat + "</small></span>" +
        '<button type="button" class="eq-mini" data-periode="' + esc(p.du + "|" + p.au + "|" + p.type) + '">Retirer</button></div>';
    }).join("");
    $("#ho-fermetures").innerHTML = h.fermetures.length ? h.fermetures.map(function (f) {
      return '<button type="button" class="eq-chip" data-fermeture="' + esc(f) + '" aria-label="Retirer la fermeture du ' + esc(dateTxt(f)) + '">' + esc(dateTxt(f)) + " ×</button>";
    }).join("") : '<span class="muted small">Aucune fermeture exceptionnelle.</span>';
    $("#ho-dirty").hidden = !S.dirty;
    var fin = h.periodes.reduce(function (m, p) { return p.au > m ? p.au : m; }, "");
    var alerte = $("#ho-alerte");
    alerte.hidden = !(fin && fin < dansJours(45));
    if (!alerte.hidden) alerte.textContent = (fin < aujourdhui() ? "Les horaires se sont arrêtés le " : "Les horaires s’arrêtent le ") + dateTxt(fin) + " : ajoutez la saison suivante, sinon le site affichera « fermé ».";
  }

  function afficherHistorique() {
    $("#hi-liste").innerHTML = S.journal.length ? S.journal.map(function (e) {
      var possible = e.avant && S.historique.indexOf(e.avant) !== -1;
      return "<li><span><b>" + esc(e.par) + "</b> · " + esc(e.resume) + "</span><small>" + esc(quandTxt(e.quand)) + "</small>" +
        (possible ? '<span><button type="button" class="eq-mini" data-restaurer="' + esc(e.avant) + '">Revenir avant cette modification</button></span>' : "") + "</li>";
    }).join("") : '<li class="muted">Aucune modification pour l’instant.</li>';
  }

  /* ---------- Actions ---------- */
  function envoyerMessage(texte, forcer) {
    var fin = (document.querySelector('[name="msg-fin"]:checked') || {}).value;
    var jusqu = fin === "demain" ? dansJours(1) : fin === "date" ? $("#msg-date").value : aujourdhui();
    if (texte && fin === "date" && (!jusqu || jusqu < aujourdhui())) return toast("Choisissez une date de fin à partir d’aujourd’hui.", true);
    appel("message", { texte: texte, jusqu_au: texte ? jusqu : "", version_vue: S.contenus.versions.message, forcer: !!forcer }).then(function (res) {
      traiter(res, function () { envoyerMessage(texte, true); }, function () { $("#msg-texte").value = ""; $("#msg-n").textContent = "0"; });
    });
  }

  function envoyerHoraires(forcer) {
    var h = S.brouillon;
    h.accueil = { de: $("#ho-acc-de").value, a: $("#ho-acc-a").value };
    h.traite = { de: $("#ho-tr-de").value, a: $("#ho-tr-a").value };
    if (!h.accueil.de || !h.accueil.a || h.accueil.de >= h.accueil.a) return toast("Heures d’accueil : la fin doit suivre le début.", true);
    if (!h.traite.de || !h.traite.a || h.traite.de >= h.traite.a) return toast("Heures de traite : la fin doit suivre le début.", true);
    if (!h.periodes.length) return toast("Il faut au moins une période d’ouverture.", true);
    appel("horaires", { horaires: h, version_vue: S.contenus.versions.horaires, forcer: !!forcer }).then(function (res) {
      if (res.s === 200) S.dirty = false;
      traiter(res, function () { envoyerHoraires(true); });
    });
  }

  function brouillonModifie() {
    S.dirty = true;
    afficherHoraires();
  }

  function onglet(nom) {
    $$("[data-onglet]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.onglet === nom)); });
    $$("[data-panneau]").forEach(function (p) { p.hidden = p.dataset.panneau !== nom; });
    try { sessionStorage.setItem("bata-onglet", nom); } catch (e) { /* rien */ }
    window.scrollTo(0, 0);
  }

  function brancher() {
    $$("[data-onglet]").forEach(function (b) { b.addEventListener("click", function () { onglet(b.dataset.onglet); }); });

    $("#form-cx").addEventListener("submit", function (e) {
      e.preventDefault();
      var prenom = $("#cx-prenom").value.trim(), code = $("#cx-code").value;
      $("#cx-erreur").hidden = true;
      if (!prenom) return $("#cx-prenom").reportValidity();
      if (!code || (S.demo && code.length < 4)) { $("#cx-erreur").textContent = S.demo ? "Démonstration : 4 caractères minimum." : "Entrez le code de l’équipe."; $("#cx-erreur").hidden = false; return; }
      entrer(prenom, code, $("#cx-garder").checked);
    });
    $("#deconnexion").addEventListener("click", function () {
      if (S.dirty && !confirm("Vos horaires modifiés ne sont pas enregistrés. Se déconnecter quand même ?")) return;
      S.dirty = false;
      deconnecter("");
    });

    $("#msg-texte").addEventListener("input", function () { $("#msg-n").textContent = this.value.length; });
    $$("[data-phrase]").forEach(function (b) {
      b.addEventListener("click", function () { $("#msg-texte").value = b.dataset.phrase; $("#msg-n").textContent = b.dataset.phrase.length; $("#msg-texte").focus(); });
    });
    $$('[name="msg-fin"]').forEach(function (r) { r.addEventListener("change", function () { $("#msg-date").hidden = r.value !== "date" || !r.checked; if (!$("#msg-date").hidden) $("#msg-date").min = aujourdhui(); }); });
    $("#form-msg").addEventListener("submit", function (e) {
      e.preventDefault();
      var t = $("#msg-texte").value.trim();
      if (!t) { $("#msg-texte").focus(); return toast("Écrivez d’abord le message.", true); }
      envoyerMessage(t);
    });
    $("#msg-retirer").addEventListener("click", function () { envoyerMessage(""); });

    $("#ag-date").min = aujourdhui();
    $("#form-ag").addEventListener("submit", function (e) {
      e.preventDefault();
      var titre = $("#ag-titre"), date = $("#ag-date");
      if (!titre.value.trim()) return titre.reportValidity();
      if (!date.value) return date.reportValidity();
      var ev = { titre: titre.value.trim(), date: date.value, heure: $("#ag-heure").value, lieu: $("#ag-lieu").value.trim(), prix: $("#ag-prix").value.trim(), texte: $("#ag-texte").value.trim() };
      appel("evenement_ajouter", { evenement: ev }).then(function (res) { traiter(res, null, function () { $("#form-ag").reset(); }); });
    });
    $("#ag-liste").addEventListener("click", function (e) {
      var b = e.target.closest("[data-retirer]");
      if (!b) return;
      var ev = (S.contenus.agenda || []).filter(function (x) { return x.id === b.dataset.retirer; })[0];
      if (ev && confirm("Retirer « " + ev.titre + " » de l’agenda ?")) appel("evenement_supprimer", { id: ev.id }).then(function (res) { traiter(res); });
    });

    $("#co-liste").addEventListener("change", function (e) {
      var r = e.target;
      if (!r.dataset.sejour) return;
      var s = S.contenus.sejours.filter(function (x) { return x.id === r.dataset.sejour; })[0];
      function go(forcer) {
        appel("sejour_statut", { id: s.id, statut: r.value, statut_vu: s.statut, forcer: !!forcer }).then(function (res) { traiter(res, function () { go(true); }); });
      }
      go(false);
    });

    ["#ho-acc-de", "#ho-acc-a", "#ho-tr-de", "#ho-tr-a"].forEach(function (id) { $(id).addEventListener("change", function () { S.dirty = true; $("#ho-dirty").hidden = false; }); });
    $("#ho-ajouter").addEventListener("click", function () {
      var du = $("#ho-du").value, au = $("#ho-au").value, type = (document.querySelector('[name="ho-type"]:checked') || {}).value;
      if (!du || !au) return toast("Indiquez le début et la fin de la période.", true);
      if (du > au) return toast("La période doit commencer avant de finir.", true);
      S.brouillon.periodes.push({ type: type, du: du, au: au, nom: $("#ho-nom").value.trim().slice(0, 30) });
      $("#ho-du").value = ""; $("#ho-au").value = ""; $("#ho-nom").value = "";
      brouillonModifie();
      toast("Période ajoutée. N’oubliez pas « Enregistrer les horaires ».");
    });
    $("#ho-periodes").addEventListener("click", function (e) {
      var b = e.target.closest("[data-periode]");
      if (!b) return;
      var k = b.dataset.periode.split("|");
      S.brouillon.periodes = S.brouillon.periodes.filter(function (p) { return !(p.du === k[0] && p.au === k[1] && p.type === k[2]); });
      brouillonModifie();
    });
    $("#ho-ferm").addEventListener("change", function () {
      var v = this.value;
      if (v && S.brouillon.fermetures.indexOf(v) === -1) { S.brouillon.fermetures.push(v); S.brouillon.fermetures.sort(); brouillonModifie(); }
      this.value = "";
    });
    $("#ho-fermetures").addEventListener("click", function (e) {
      var b = e.target.closest("[data-fermeture]");
      if (!b) return;
      S.brouillon.fermetures = S.brouillon.fermetures.filter(function (f) { return f !== b.dataset.fermeture; });
      brouillonModifie();
    });
    $("#ho-enregistrer").addEventListener("click", function () { envoyerHoraires(false); });
    window.addEventListener("beforeunload", function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

    $("#hi-liste").addEventListener("click", function (e) {
      var b = e.target.closest("[data-restaurer]");
      if (b && confirm("Revenir à l’état d’avant cette modification ? Tout ce qui a été changé depuis sera annulé (et restera dans l’historique).")) {
        appel("restaurer", { fichier: b.dataset.restaurer }).then(function (res) { S.dirty = false; traiter(res); });
      }
    });

    $$('[name="fd"]').forEach(function (x) {
      x.addEventListener("change", function () {
        if (x.checked) appel("boites_reelles", { valeur: x.value === "boites" }).then(function (res) { traiter(res); });
      });
    });

    $("#demo-raz").addEventListener("click", function () {
      [CLE_DEMO, CLE_DEMO_J, CLE_DEMO_H].forEach(oublierLocal);
      location.reload();
    });
  }

  /* ---------- Démarrage ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    brancher();
    var dernierOnglet = "message";
    try { dernierOnglet = sessionStorage.getItem("bata-onglet") || "message"; } catch (e) { /* rien */ }
    onglet(dernierOnglet);
    detecter().then(function (mode) {
      if (mode === "panne") {
        montrer(false);
        $("#form-cx").hidden = true;
        var e = $("#cx-erreur");
        e.textContent = "Le serveur du site ne répond pas correctement. Rien ne peut être modifié pour l’instant : réessayez plus tard, et prévenez Primo si ça dure.";
        e.hidden = false;
        $("#form-cx").parentNode.appendChild(e);
        return;
      }
      S.demo = mode === "demo";
      $("#demo").hidden = !S.demo;
      $("#cx-demo-aide").hidden = !S.demo;
      var depart = S.demo
        ? (lireLocal(CLE_DEMO, null) ? Promise.resolve(lireLocal(CLE_DEMO, null)) : fetch("../data/contenus.json", { cache: "no-store" }).then(function (r) { return r.json(); }))
        : Promise.resolve(null);
      return depart.then(function (c) {
        if (c) S.contenus = c;
        var session = lireLocal(CLE_SESSION, null);
        if (session && session.prenom && session.code) return entrer(session.prenom, session.code, true);
        montrer(false);
      });
    }).catch(function () {
      montrer(false);
      toast("Impossible de charger les contenus du site.", true);
    });
  });
})();
