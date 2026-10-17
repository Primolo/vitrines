/* Espace équipe de la Batailleuse.
   Sur l'hébergement (IONOS) : parle à api.php. Sur la maquette sans PHP : mode démonstration,
   les changements restent sur l'appareil et le site les affiche sur ce seul appareil. */
(function () {
  "use strict";

  var API = "api.php";
  var CLE_DEMO = "bata-demo-contenus", CLE_DEMO_J = "bata-demo-journal", CLE_DEMO_H = "bata-demo-historique", CLE_SESSION = "bata-equipe";
  var S = { infosTimers: {}, ouverts: {}, painTimer: null,  demo: false, prenom: "", code: "", contenus: null, journal: [], historique: [] };
  var STATUTS = [["a-venir", "Inscriptions bientôt", "pas encore ouvertes"], ["ouvert", "Inscriptions ouvertes", ""], ["dernieres", "Dernières places", ""], ["complet", "Complet", ""], ["termine", "Terminé", "séjour passé"]];
  var TYPES = { haute: ["Haute", "badge--ok", "du mardi au samedi"], moyenne: ["Moyenne", "badge--bientot", "mer., ven., sam."], basse: ["Basse", "", "le mercredi"] };
  var JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  var MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
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
    if (["document_envoyer", "actualite_enregistrer", "actualite_supprimer", "offre_enregistrer", "offre_supprimer", "sejour_infos", "pain_prix"].indexOf(action) !== -1) {
      return { s: 400, j: { erreur: "Cette fonction ne marche que sur le vrai site, pas dans la maquette de démonstration." } };
    }
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
    tout();
  }

  // relancer(true, j) renvoie la même action en forçant, une fois que la personne a choisi « remplacer » ;
  // j porte la version la plus récente du serveur, sur laquelle rejouer l'action.
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
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a modifié les horaires " + quand + ". Ses heures :";
      cite = "Accueil de " + esc(heureTxt(j.actuel.accueil.de)) + " à " + esc(heureTxt(j.actuel.accueil.a)) +
        ", traite de " + esc(heureTxt(j.actuel.traite.de)) + " à " + esc(heureTxt(j.actuel.traite.a)) + ".";
    } else if (j.section === "documents") {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a remplacé « " + esc((j.actuel && j.actuel.titre) || "ce document") + " » " + quand + " :";
      cite = esc((j.actuel && j.actuel.nom) || "un nouveau fichier");
    } else if (j.section === "actualites" || j.section === "offres") {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a modifié " + (j.section === "offres" ? "cette offre" : "cette nouvelle") + " " + quand + " :";
      cite = esc((j.actuel && j.actuel.titre) || "");
    } else if (j.section === "pain") {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a modifié les prix du pain " + quand + ".";
      cite = "Ses prix sont en ligne. Gardez-les, ou remplacez-les par ceux que vous venez de saisir.";
    } else if (j.actuel && j.actuel.infos) {
      $("#conflit-texte").innerHTML = "<b>" + qui + "</b> a changé les dates ou le prix de ce séjour " + quand + " :";
      cite = esc(j.actuel.prix || "") + " · " + (j.actuel.semaines || []).length + " session(s)";
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
        relancer(true, j);
      } else {
        maj(j);
        toast("C’est sa version qui reste en ligne.");
      }
    };
    dlg.oncancel = function () {
      maj(j);
      toast("C’est sa version qui reste en ligne.");
    };
    if (dlg.showModal) dlg.showModal(); else if (confirm("Quelqu’un vient de modifier la même chose. Mettre votre version à la place ?")) relancer(true, j); else maj(j);
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
    afficherActualites();
    afficherColos();
    afficherHoraires();
    afficherDocuments();
    afficherPain();
    afficherOffres();
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
    $("#fd-limites").textContent = "Pendant la démo : " + (r.limite ? r.limite + " formulaires par jour au maximum, et " : "") +
      "les emails partent de l’adresse " + (r.expediteur || "de la démo") + " (pensez à regarder dans les indésirables). " +
      "Une fois le site installé chez vous, ils partiront de votre propre adresse" + (r.limite ? ", sans ce plafond." : ".");
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
    // Pas de redessin pendant qu'on saisit des dates ou un prix (ils s'enregistrent tout seuls).
    var actif = document.activeElement;
    if (Object.keys(S.infosTimers).length || (actif && actif.tagName === "INPUT" && actif.closest("#co-liste") && actif.type !== "radio")) return;
    $$("#co-liste details[data-infos]").forEach(function (d) { S.ouverts[d.dataset.infos] = d.open; });
    $("#co-liste").innerHTML = (S.contenus.sejours || []).map(function (s) {
      var id = esc(s.id);
      return '<div class="eq-sejour"><h3>' + esc(s.nom) + '</h3><div class="choices">' + STATUTS.map(function (st) {
        return '<label class="choice"><input type="radio" name="co-' + id + '" value="' + st[0] + '" data-sejour="' + id + '"' + (s.statut === st[0] ? " checked" : "") + "><span>" + st[1] + (st[2] ? "<small>" + st[2] + "</small>" : "") + "</span></label>";
      }).join("") + "</div>" +
        '<details class="eq-details" data-infos="' + id + '"' + (S.ouverts[s.id] ? " open" : "") + "><summary>Dates et prix</summary>" +
        '<div class="field"><label>Prix du séjour</label><input data-si-prix="' + id + '" maxlength="20" value="' + esc(s.prix || "") + '" placeholder="420 €"></div>' +
        '<p class="label" style="margin:12px 0 6px">Sessions</p><div data-si-semaines="' + id + '">' + (s.semaines || []).map(ligneSession).join("") + "</div>" +
        '<button type="button" class="eq-mini" data-si-ajout="' + id + '">Ajouter une session</button>' +
        '<p class="eq-auto" data-si-etat="' + id + '" role="status">Enregistrement automatique.</p></details></div>';
    }).join("");
  }

  function ligneSession(w) {
    return '<div class="eq-sess"><div class="field"><label>Du</label><input type="date" data-si-du value="' + esc(w.du || "") + '"></div>' +
      '<div class="field"><label>Au</label><input type="date" data-si-au value="' + esc(w.au || "") + '"></div>' +
      '<button type="button" class="eq-mini" data-si-retirer aria-label="Retirer cette session">✕</button></div>';
  }

  function afficherHoraires() {
    var h = S.contenus.horaires;
    if (!h) return;
    $("#ho-acc-de").value = h.accueil.de; $("#ho-acc-a").value = h.accueil.a;
    $("#ho-tr-de").value = h.traite.de; $("#ho-tr-a").value = h.traite.a;
    var a = aujourdhui();
    $("#ho-periodes").innerHTML = h.periodes.slice().sort(function (x, y) { return x.du < y.du ? -1 : 1; }).map(function (p) {
      var t = TYPES[p.type] || ["?", "", ""];
      var etat = p.au < a ? " (passée)" : p.du <= a ? " (en cours)" : "";
      return '<div class="eq-periode"><span class="badge ' + t[1] + '">' + t[0] + "</span><span>" + (p.nom ? "<b>" + esc(p.nom) + "</b> : " : "") +
        "du " + esc(dateTxt(p.du)) + " au " + esc(dateTxt(p.au)) + '<small class="muted">' + etat + "</small></span>" +
        '<button type="button" class="eq-mini" data-periode="' + esc(p.du + "|" + p.au + "|" + p.type) + '" aria-label="Retirer la période du ' + esc(dateTxt(p.du)) + '">Retirer</button></div>';
    }).join("");
    $("#ho-fermetures").innerHTML = h.fermetures.length ? h.fermetures.map(function (f) {
      return '<button type="button" class="eq-chip" data-fermeture="' + esc(f) + '" aria-label="Retirer la fermeture du ' + esc(dateTxt(f)) + '">' + esc(dateTxt(f)) + " ×</button>";
    }).join("") : '<span class="muted small">Aucune fermeture exceptionnelle.</span>';
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

  /* ---------- Documents, prix du pain, nouvelles, offres ---------- */
  var DOCS = [
    ["contrat-pain-mensuel", "Contrat pain mensuel", "application/pdf"],
    ["contrat-pain-semestriel", "Contrat pain semestriel", "application/pdf"],
    ["catalogue-activites", "Brochure « Nos activités » (écoles et groupes)", "application/pdf"],
    ["bulletin-adhesion", "Bulletin d’adhésion et de soutien", "application/pdf,image/png,image/jpeg"]
  ];
  function tailleTxt(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(n / 1024)) + " Ko"; }
  function lien(f) { return "../" + esc(f); }

  // Lit un fichier choisi : une photo est réduite (1600 px), un PDF part tel quel (5 Mo maximum).
  function lireFichier(fichier, reduire) {
    return new Promise(function (ok, non) {
      if (!fichier) return ok(null);
      if (reduire && /^image\//.test(fichier.type)) {
        var url = URL.createObjectURL(fichier), img = new Image();
        img.onload = function () {
          var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          ok({ contenu: c.toDataURL("image/jpeg", 0.85).split(",")[1], nom: fichier.name.replace(/\.[^.]+$/, "") + ".jpg" });
        };
        img.onerror = function () { URL.revokeObjectURL(url); non(new Error("Cette image est illisible.")); };
        img.src = url;
        return;
      }
      if (fichier.size > 5 * 1024 * 1024) return non(new Error("Ce fichier est trop lourd (5 Mo au maximum)."));
      var r = new FileReader();
      r.onload = function () { ok({ contenu: String(r.result).split(",")[1], nom: fichier.name }); };
      r.onerror = function () { non(new Error("Ce fichier est illisible.")); };
      r.readAsDataURL(fichier);
    });
  }

  function afficherDocuments() {
    var docs = S.contenus.documents || {};
    $("#do-liste").innerHTML = DOCS.map(function (d) {
      var x = docs[d[0]];
      return '<li class="eq-item eq-item--simple"><div><h3>' + esc(d[1]) + "</h3><p>" +
        (x ? esc(x.nom || "fichier") + " · " + tailleTxt(x.taille || 0) + " · en ligne " + esc(quandTxt(x.maj)) + (x.par ? ", par " + esc(x.par) : "") : "Aucun fichier") + "</p></div>" +
        '<div class="btns">' + (x ? '<a class="eq-mini" href="' + lien(x.fichier) + '" target="_blank" rel="noopener">Voir</a>' : "") +
        '<label class="eq-mini">Remplacer<input type="file" accept="' + d[2] + '" data-doc="' + d[0] + '"></label></div></li>';
    }).join("");
  }

  function envoyerDocument(cle, p, forcer) {
    var x = (S.contenus.documents || {})[cle];
    appel("document_envoyer", { cle: cle, nom: p.nom, contenu: p.contenu, maj_vue: x ? x.maj : "", forcer: !!forcer }).then(function (res) {
      if (res.s === 200 && res.j.ok && !res.j.info) res.j.info = "Nouveau fichier en ligne : le lien du site est à jour.";
      traiter(res, function () { envoyerDocument(cle, p, true); });
    });
  }

  /* Prix du pain : enregistrement tout seul, une seconde après la dernière touche */
  function afficherPain(force) {
    var p = S.contenus.pain;
    if (!p) return;
    var actif = document.activeElement;
    if (!force && (S.painTimer || (actif && actif.tagName === "INPUT" && (actif.dataset.p !== undefined || actif.dataset.pain)))) return;
    var champ = function (k, i, lib, v) { return '<div class="field"><label>' + lib + '</label><input inputmode="decimal" data-p="' + k + '" value="' + esc(v || "") + '"></div>'; };
    $("#pa-lignes").innerHTML = p.lignes.map(function (l, i) {
      return '<div class="eq-pain" data-pl="' + i + '"><div class="top"><div class="field"><label>Pain</label><input data-p="nom" maxlength="40" value="' + esc(l.nom) + '"></div>' +
        '<div class="field"><label>Précision</label><input data-p="note" maxlength="40" value="' + esc(l.note || "") + '"></div>' +
        '<button type="button" class="eq-mini" data-pain-retirer="' + i + '" aria-label="Retirer ' + esc(l.nom) + '">✕</button></div>' +
        '<div class="row2">' + champ("kg_j", i, "Miche 1 kg · juste (€)", l.kg_j) + champ("kg_s", i, "Miche 1 kg · solidaire (€)", l.kg_s) +
        champ("d_j", i, "500 g · juste (€)", l.d_j) + champ("d_s", i, "500 g · solidaire (€)", l.d_s) + "</div></div>";
    }).join("");
    $("#pa-bj").value = p.brioche_j || ""; $("#pa-bs").value = p.brioche_s || "";
  }

  function lirePain() {
    return {
      lignes: $$("#pa-lignes .eq-pain").map(function (r) {
        var o = {};
        $$("[data-p]", r).forEach(function (i) { o[i.dataset.p] = i.value.trim(); });
        return o;
      }),
      brioche_j: $("#pa-bj").value.trim(), brioche_s: $("#pa-bs").value.trim()
    };
  }

  function programmerPain() {
    clearTimeout(S.painTimer);
    $("#pa-etat").textContent = "Modification en cours…";
    S.painTimer = setTimeout(function () { S.painTimer = null; envoyerPain(false); }, 1200);
  }

  function envoyerPain(forcer, pain) {
    pain = pain || lirePain();
    if (pain.lignes.some(function (l) { return !l.nom; })) { $("#pa-etat").textContent = "Donnez un nom au pain pour l’enregistrer."; return; }
    appel("pain_prix", { pain: pain, version_vue: S.contenus.versions.pain, forcer: !!forcer }).then(function (res) {
      if (res.s === 200 && res.j.ok) { res.j.info = "Prix du pain enregistrés : ils sont en ligne."; }
      traiter(res, function () { envoyerPain(true, pain); });
      var n = new Date(), ok = res.s === 200 && res.j.ok;
      $("#pa-etat").textContent = ok ? "Enregistré à " + n.getHours() + "h" + String(n.getMinutes()).padStart(2, "0") + "." : "";
      if (!ok) afficherPain(true);
    });
  }

  /* Nouvelles */
  function afficherActualites() {
    var l = S.contenus.actualites || [];
    $("#ac-liste").innerHTML = l.length ? l.map(function (a) {
      return '<li class="eq-item eq-item--simple"><div><h3>' + esc(a.titre) + "</h3><p>" + esc(dateTxt(a.date)) + (a.photo ? " · photo" : "") + (a.lien ? " · lien" : "") + "</p></div>" +
        '<div class="btns"><button type="button" class="eq-mini" data-ac-modifier="' + esc(a.id) + '">Modifier</button><button type="button" class="eq-mini" data-ac-retirer="' + esc(a.id) + '">Retirer</button></div></li>';
    }).join("") : '<li class="muted">Aucune nouvelle pour l’instant. Publiez la première ci-dessous.</li>';
  }

  function formActualite(a) {
    $("#ac-id").value = a ? a.id : ""; $("#ac-maj").value = a ? a.maj || "" : "";
    $("#ac-titre").value = a ? a.titre : ""; $("#ac-date").value = a ? a.date : aujourdhui();
    $("#ac-texte").value = a ? a.texte || "" : ""; $("#ac-lien").value = a ? a.lien || "" : ""; $("#ac-lien-texte").value = a ? a.lien_texte || "" : "";
    $("#ac-photo").value = ""; $("#ac-photo-retirer").checked = false;
    $("#ac-photo-retirer-l").hidden = !(a && a.photo);
    $("#ac-photo-etat").textContent = a && a.photo ? "Une photo est en ligne. Choisissez-en une autre pour la remplacer." : "Facultative. Elle est réduite automatiquement.";
    $("#ac-titre-form").textContent = a ? "Modifier la nouvelle" : "Publier une nouvelle";
    $("#ac-envoyer").textContent = a ? "Enregistrer les modifications" : "Publier";
    $("#ac-annuler").hidden = !a;
    if (a) $("#form-ac").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function envoyerActualite(data, forcer) {
    appel("actualite_enregistrer", Object.assign({}, data, { forcer: !!forcer })).then(function (res) {
      traiter(res, function () { envoyerActualite(data, true); }, function () { formActualite(null); });
    });
  }

  /* Offres d'emploi */
  function afficherOffres() {
    var l = S.contenus.offres || [], a = aujourdhui();
    $("#of-liste").innerHTML = l.length ? l.map(function (o) {
      var finie = o.jusqu_au && o.jusqu_au < a;
      return '<li class="eq-item eq-item--simple"><div><h3>' + esc(o.titre) + "</h3><p>" +
        (finie ? "Terminée le " + esc(dateTxt(o.jusqu_au)) + " : plus visible sur le site" : o.jusqu_au ? "Visible jusqu’au " + esc(dateTxt(o.jusqu_au)) : "Visible sans date de fin") + (o.pdf ? " · PDF" : "") + "</p></div>" +
        '<div class="btns"><button type="button" class="eq-mini" data-of-modifier="' + esc(o.id) + '">Modifier</button><button type="button" class="eq-mini" data-of-retirer="' + esc(o.id) + '">Retirer</button></div></li>';
    }).join("") : '<li class="muted">Aucune offre : le site invite aux candidatures spontanées.</li>';
  }

  function formOffre(o) {
    $("#of-id").value = o ? o.id : ""; $("#of-maj").value = o ? o.maj || "" : "";
    $("#of-titre").value = o ? o.titre : ""; $("#of-intro").value = o ? o.intro || "" : "";
    $("#of-missions").value = o ? (o.missions || []).join("\n") : "";
    $("#of-details").value = o ? (o.details || []).map(function (x) { return x.label + " : " + x.valeur; }).join("\n") : "";
    $("#of-contact").value = o ? o.contact : ""; $("#of-objet").value = o ? o.objet || "" : ""; $("#of-jusqu").value = o ? o.jusqu_au || "" : "";
    $("#of-pdf").value = ""; $("#of-pdf-retirer").checked = false;
    $("#of-pdf-retirer-l").hidden = !(o && o.pdf);
    $("#of-pdf-etat").textContent = o && o.pdf ? "Un PDF est en ligne. Choisissez-en un autre pour le remplacer." : "Facultatif, 5 Mo maximum.";
    $("#of-titre-form").textContent = o ? "Modifier l’offre" : "Publier une offre";
    $("#of-envoyer").textContent = o ? "Enregistrer les modifications" : "Publier l’offre";
    $("#of-annuler").hidden = !o;
    if (o) $("#form-of").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function envoyerOffre(data, forcer) {
    appel("offre_enregistrer", Object.assign({}, data, { forcer: !!forcer })).then(function (res) {
      traiter(res, function () { envoyerOffre(data, true); }, function () { formOffre(null); });
    });
  }

  /* Colos : dates et prix, enregistrés tout seuls quand tout est rempli */
  function programmerInfos(id) {
    clearTimeout(S.infosTimers[id]);
    var etat = document.querySelector('[data-si-etat="' + id + '"]');
    if (etat) etat.textContent = "Modification en cours…";
    S.infosTimers[id] = setTimeout(function () { delete S.infosTimers[id]; envoyerInfos(id, false); }, 1200);
  }

  function envoyerInfos(id, forcer, donnees) {
    var etat = document.querySelector('[data-si-etat="' + id + '"]'), s = (S.contenus.sejours || []).filter(function (x) { return x.id === id; })[0];
    if (!donnees) {
      var zone = document.querySelector('[data-si-semaines="' + id + '"]');
      donnees = {
        prix: document.querySelector('[data-si-prix="' + id + '"]').value.trim(),
        semaines: $$(".eq-sess", zone).map(function (r) { return { du: $("[data-si-du]", r).value, au: $("[data-si-au]", r).value }; })
      };
      var ko = !donnees.prix ? "Indiquez le prix pour enregistrer."
        : donnees.semaines.some(function (w) { return !w.du || !w.au; }) ? "Remplissez le début et la fin de chaque session pour enregistrer."
        : donnees.semaines.some(function (w) { return w.du > w.au; }) ? "Une session finit avant de commencer : corrigez pour enregistrer." : "";
      if (ko) { if (etat) etat.textContent = ko; return; }
    }
    appel("sejour_infos", { id: id, prix: donnees.prix, semaines: donnees.semaines, maj_vue: s ? s.infos_maj || "" : "", forcer: !!forcer }).then(function (res) {
      if (res.s === 200 && res.j.ok) res.j.info = "Dates et prix enregistrés : ils sont en ligne.";
      traiter(res, function () { envoyerInfos(id, true, donnees); });
      var e2 = document.querySelector('[data-si-etat="' + id + '"]');
      if (e2 && res.s === 200 && res.j.ok) e2.textContent = "Enregistré.";
    });
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

  // Horaires : chaque action part tout de suite, comme l'agenda et les colos (rien à « enregistrer » après coup).
  // operation(h) renvoie les horaires modifiés, ou null si elle n'a plus lieu d'être.
  // Ajouts et retraits sont « rejouables » : si quelqu'un a changé les horaires entre-temps, on rejoue
  // l'action sur sa version, sans rien écraser. Les heures d'accueil et de traite passent par la fenêtre de conflit.
  function changerHoraires(operation, message, rejouable, forcer) {
    var h = operation(copie(S.contenus.horaires));
    if (!h) return tout();
    appel("horaires", { horaires: h, version_vue: S.contenus.versions.horaires, forcer: !!forcer }).then(function (res) {
      if (res.s === 409 && rejouable) {
        var qui = res.j.par || "Quelqu’un";
        var h2 = operation(copie(res.j.contenus.horaires));
        if (!h2) { maj(res.j); return toast(qui + " venait de faire ce changement : rien à ajouter."); }
        return appel("horaires", { horaires: h2, version_vue: res.j.contenus.versions.horaires }).then(function (res2) {
          if (res2.s === 200 && res2.j.ok) res2.j.info = qui + " venait aussi de modifier les horaires : votre changement s’ajoute au sien. C’est en ligne.";
          traiter(res2, rejouer);
        });
      }
      if (res.s === 200 && res.j.ok && !res.j.info) res.j.info = message;
      traiter(res, rejouer);
    });
    // « Mettre la mienne » : seule l'action de la personne remplace, sur la version la plus récente ;
    // le reste des changements de l'autre (périodes, fermetures) est gardé.
    function rejouer(forcer, j) {
      if (j && j.contenus) S.contenus = j.contenus;
      changerHoraires(operation, message, false, true);
    }
  }

  function lireHeures() {
    var acc = { de: $("#ho-acc-de").value, a: $("#ho-acc-a").value }, tr = { de: $("#ho-tr-de").value, a: $("#ho-tr-a").value };
    if (!acc.de || !acc.a || acc.de >= acc.a) { toast("Heures d’accueil : l’heure de fin doit suivre l’heure de début.", true); return null; }
    if (!tr.de || !tr.a || tr.de >= tr.a) { toast("Heures de traite : l’heure de fin doit suivre l’heure de début.", true); return null; }
    return { accueil: acc, traite: tr };
  }

  // Page restée ouverte (téléphone en veille, onglet oublié) : on relit les contenus en revenant dessus.
  function rafraichir() {
    if (S.demo || !S.code || $("#app").hidden || document.visibilityState !== "visible" || document.body.hasAttribute("aria-busy")) return;
    appelBrut("lire").then(function (res) { if (res.s === 200 && res.j.ok) maj(res.j); });
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
    $("#deconnexion").addEventListener("click", function () { deconnecter(""); });
    document.addEventListener("visibilitychange", rafraichir);
    setInterval(rafraichir, 120000);

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

    // Seule l'heure touchée part au serveur : les autres heures, peut-être changées par quelqu'un d'autre, restent.
    [["#ho-acc-de", "accueil", "de"], ["#ho-acc-a", "accueil", "a"], ["#ho-tr-de", "traite", "de"], ["#ho-tr-a", "traite", "a"]].forEach(function (c) {
      $(c[0]).addEventListener("change", function () {
        if (!lireHeures()) return;
        var v = this.value;
        if (S.contenus.horaires[c[1]][c[2]] === v) return;
        changerHoraires(function (x) {
          x[c[1]][c[2]] = v;
          return x[c[1]].de < x[c[1]].a ? x : null;
        }, "Heures enregistrées : elles sont en ligne.", false);
      });
    });
    $("#ho-ajouter").addEventListener("click", function () {
      var du = $("#ho-du").value, au = $("#ho-au").value, type = (document.querySelector('[name="ho-type"]:checked') || {}).value;
      if (!du || !au) return toast("Indiquez le début et la fin de la période.", true);
      if (du > au) return toast("La période doit commencer avant de finir.", true);
      var p = { type: type, du: du, au: au, nom: $("#ho-nom").value.trim().slice(0, 30) };
      changerHoraires(function (x) {
        if (x.periodes.some(function (q) { return q.du === p.du && q.au === p.au && q.type === p.type; })) return null;
        x.periodes.push(p);
        return x;
      }, "Période ajoutée : elle est en ligne.", true);
      $("#ho-du").value = ""; $("#ho-au").value = ""; $("#ho-nom").value = "";
      $("#ho-ajouter").closest("details").open = false;
    });
    $("#ho-periodes").addEventListener("click", function (e) {
      var b = e.target.closest("[data-periode]");
      if (!b) return;
      var k = b.dataset.periode.split("|");
      if (!confirm("Retirer cette période du site ?")) return;
      changerHoraires(function (x) {
        var reste = x.periodes.filter(function (p) { return !(p.du === k[0] && p.au === k[1] && p.type === k[2]); });
        if (reste.length === x.periodes.length) return null;
        x.periodes = reste;
        return x;
      }, "Période retirée du site.", true);
    });
    $("#ho-ferm").addEventListener("change", function () {
      var v = this.value;
      this.value = "";
      if (!v) return;
      changerHoraires(function (x) {
        if (x.fermetures.indexOf(v) !== -1) return null;
        x.fermetures.push(v); x.fermetures.sort();
        return x;
      }, "Fermeture du " + dateTxt(v) + " ajoutée : elle est en ligne.", true);
    });
    $("#ho-fermetures").addEventListener("click", function (e) {
      var b = e.target.closest("[data-fermeture]");
      if (!b) return;
      var v = b.dataset.fermeture;
      changerHoraires(function (x) {
        if (x.fermetures.indexOf(v) === -1) return null;
        x.fermetures = x.fermetures.filter(function (f) { return f !== v; });
        return x;
      }, "Fermeture du " + dateTxt(v) + " retirée.", true);
    });

    /* Documents */
    $("#do-liste").addEventListener("change", function (e) {
      var inp = e.target.closest("[data-doc]");
      if (!inp) return;
      var f = inp.files[0], cle = inp.dataset.doc;
      inp.value = "";
      if (!f) return;
      document.body.setAttribute("aria-busy", "true");
      lireFichier(f, false).then(function (p) { document.body.removeAttribute("aria-busy"); envoyerDocument(cle, p, false); },
        function (err) { document.body.removeAttribute("aria-busy"); toast(err.message, true); });
    });

    /* Prix du pain */
    $("#pa-lignes").addEventListener("input", programmerPain);
    $("#pa-bj").addEventListener("input", programmerPain);
    $("#pa-bs").addEventListener("input", programmerPain);
    $("#pa-lignes").addEventListener("click", function (e) {
      var b = e.target.closest("[data-pain-retirer]");
      if (!b) return;
      var p = lirePain(), i = +b.dataset.painRetirer;
      if (!confirm("Retirer « " + (p.lignes[i] && p.lignes[i].nom) + " » du tableau ?")) return;
      p.lignes.splice(i, 1);
      if (!p.lignes.length) return toast("Gardez au moins un pain.", true);
      clearTimeout(S.painTimer); S.painTimer = null;
      envoyerPain(false, p);
    });
    $("#pa-ajouter").addEventListener("click", function () {
      var p = lirePain();
      if (p.lignes.length >= 12) return toast("12 pains au maximum.", true);
      p.lignes.push({ nom: "", note: "", kg_j: "", kg_s: "", d_j: "", d_s: "" });
      S.contenus.pain = p;
      afficherPain(true);
      var champs = $$("#pa-lignes [data-p=nom]");
      champs[champs.length - 1].focus();
      $("#pa-etat").textContent = "Donnez un nom au nouveau pain pour l’enregistrer.";
    });

    /* Nouvelles */
    $("#form-ac").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!$("#ac-titre").value.trim()) return $("#ac-titre").reportValidity();
      document.body.setAttribute("aria-busy", "true");
      lireFichier($("#ac-photo").files[0], true).then(function (ph) {
        document.body.removeAttribute("aria-busy");
        envoyerActualite({ id: $("#ac-id").value, maj_vue: $("#ac-maj").value, titre: $("#ac-titre").value.trim(), date: $("#ac-date").value, texte: $("#ac-texte").value.trim(),
          lien: $("#ac-lien").value.trim(), lien_texte: $("#ac-lien-texte").value.trim(), photo: ph, retirer_photo: $("#ac-photo-retirer").checked }, false);
      }, function (err) { document.body.removeAttribute("aria-busy"); toast(err.message, true); });
    });
    $("#ac-annuler").addEventListener("click", function () { formActualite(null); });
    $("#ac-liste").addEventListener("click", function (e) {
      var m = e.target.closest("[data-ac-modifier]"), r = e.target.closest("[data-ac-retirer]");
      var id = m ? m.dataset.acModifier : r ? r.dataset.acRetirer : null;
      var a = (S.contenus.actualites || []).filter(function (x) { return x.id === id; })[0];
      if (!a) return;
      if (m) return formActualite(a);
      if (confirm("Retirer « " + a.titre + " » du site ?")) appel("actualite_supprimer", { id: a.id }).then(function (res) { traiter(res); });
    });
    $("#ac-date").value = aujourdhui();

    /* Offres */
    $("#form-of").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!$("#of-titre").value.trim()) return $("#of-titre").reportValidity();
      if (!$("#of-contact").value.trim() || !$("#of-contact").checkValidity()) return $("#of-contact").reportValidity();
      var details = [], mal = null;
      $("#of-details").value.split("\n").forEach(function (l) {
        if (!l.trim()) return;
        var i = l.indexOf(":");
        if (i < 1 || !l.slice(i + 1).trim()) { mal = l; return; }
        details.push({ label: l.slice(0, i).trim(), valeur: l.slice(i + 1).trim() });
      });
      if (mal) return toast("Chaque condition s’écrit « Libellé : valeur ». À corriger : « " + mal.trim().slice(0, 40) + " ».", true);
      document.body.setAttribute("aria-busy", "true");
      lireFichier($("#of-pdf").files[0], false).then(function (pdf) {
        document.body.removeAttribute("aria-busy");
        envoyerOffre({ id: $("#of-id").value, maj_vue: $("#of-maj").value, titre: $("#of-titre").value.trim(), intro: $("#of-intro").value.trim(),
          missions: $("#of-missions").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean), details: details,
          contact: $("#of-contact").value.trim(), objet: $("#of-objet").value.trim(), jusqu_au: $("#of-jusqu").value, pdf: pdf, retirer_pdf: $("#of-pdf-retirer").checked }, false);
      }, function (err) { document.body.removeAttribute("aria-busy"); toast(err.message, true); });
    });
    $("#of-annuler").addEventListener("click", function () { formOffre(null); });
    $("#of-liste").addEventListener("click", function (e) {
      var m = e.target.closest("[data-of-modifier]"), r = e.target.closest("[data-of-retirer]");
      var id = m ? m.dataset.ofModifier : r ? r.dataset.ofRetirer : null;
      var o = (S.contenus.offres || []).filter(function (x) { return x.id === id; })[0];
      if (!o) return;
      if (m) return formOffre(o);
      if (confirm("Retirer l’offre « " + o.titre + " » du site ?")) appel("offre_supprimer", { id: o.id }).then(function (res) { traiter(res); });
    });

    /* Colos : dates et prix */
    function idDe(el) { var z = el.closest("[data-infos]"); return z ? z.dataset.infos : null; }
    $("#co-liste").addEventListener("input", function (e) { var id = idDe(e.target); if (id && e.target.type !== "radio") programmerInfos(id); });
    $("#co-liste").addEventListener("click", function (e) {
      var aj = e.target.closest("[data-si-ajout]"), re = e.target.closest("[data-si-retirer]");
      if (aj) {
        var zone = document.querySelector('[data-si-semaines="' + aj.dataset.siAjout + '"]');
        zone.insertAdjacentHTML("beforeend", ligneSession({}));
        $$("[data-si-du]", zone).pop().focus();
        var etat = document.querySelector('[data-si-etat="' + aj.dataset.siAjout + '"]');
        if (etat) etat.textContent = "Remplissez le début et la fin de la session pour l’enregistrer.";
      } else if (re) {
        var id = idDe(re);
        re.closest(".eq-sess").remove();
        programmerInfos(id);
      }
    });

    $("#hi-liste").addEventListener("click", function (e) {
      var b = e.target.closest("[data-restaurer]");
      if (b && confirm("Revenir à l’état d’avant cette modification ? Tout ce qui a été changé depuis sera annulé (et restera dans l’historique).")) {
        appel("restaurer", { fichier: b.dataset.restaurer }).then(function (res) { traiter(res); });
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
