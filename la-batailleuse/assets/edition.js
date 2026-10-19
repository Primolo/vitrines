/* La Batailleuse — mode modification : l'équipe change les textes et les photos directement dans les pages.
   Ouvert depuis l'espace équipe (page ?modifier=1). Chaque bloc de texte (data-ed) et chaque photo (data-ed-img) devient modifiable ;
   tout s'enregistre en quittant le bloc, et c'est en ligne tout de suite. Rien ici ne marche sans le code de l'équipe. */
(function () {
  "use strict";
  var API = "equipe/api.php";
  var C = window.BATA_CONTENUS || {};
  var S = { prenom: "", code: "", enCours: 0 };
  var actif = null, bandeau, barre, toastEl;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lire(k, stockage) { try { var v = (stockage || localStorage).getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ecrire(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* rien */ } }

  /* ---------- Habillage ---------- */
  var css = document.createElement("style");
  css.textContent =
    "body.bata-ed{padding-top:calc(58px + env(safe-area-inset-top,0px))}" +
    ".bata-ed .header{top:58px}" +
    "#bata-ed-bandeau{position:fixed;inset:0 0 auto 0;z-index:100;background:#143321;color:#F2EADA;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;padding:8px 14px calc(8px) 14px;padding-top:calc(8px + env(safe-area-inset-top,0px));font:600 .92rem/1.3 'Source Sans 3',system-ui,sans-serif;min-height:58px}" +
    "#bata-ed-bandeau b{font-family:Fraunces,Georgia,serif;font-size:1.05rem}" +
    "#bata-ed-bandeau span{flex:1;min-width:200px;font-weight:400;opacity:.92}" +
    "#bata-ed-bandeau a,#bata-ed-bandeau button{min-height:40px;padding:0 14px;border-radius:999px;border:0;background:#F1DDB4;color:#2A1E05;font:700 .92rem system-ui;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}" +
    "[data-ed]{outline:2px dashed rgba(200,144,47,.75);outline-offset:3px;cursor:text;min-height:1em}" +
    "[data-ed]:hover{outline-color:#C8902F;background:rgba(241,221,180,.28)}" +
    "[data-ed]:focus{outline:3px solid #7A1F1F;background:rgba(241,221,180,.4)}" +
    "[data-ed].bata-modifie{outline-style:solid;outline-color:#1F4A2E}" +
    ".bata-ed-ailleurs{margin:8px auto;max-width:900px;padding:10px 14px;border-radius:10px;background:#F1DDB4;color:#2A1E05;border:2px solid #C8902F;font:600 .95rem/1.4 system-ui}.bata-ed-ailleurs a{color:#7A1F1F;font-weight:800}" +
    "[data-ed-img]{outline:3px dashed rgba(200,144,47,.9);outline-offset:-3px;cursor:pointer}" +
    "#bata-ed-barre{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:100;background:#211C17;color:#fff;border-radius:999px;padding:6px;display:flex;gap:4px;box-shadow:0 8px 28px rgba(0,0,0,.35)}" +
    "#bata-ed-barre[hidden]{display:none}" +
    "#bata-ed-barre button{min-height:44px;min-width:44px;padding:0 14px;border-radius:999px;border:0;background:transparent;color:#fff;font:700 .95rem system-ui;cursor:pointer}" +
    "#bata-ed-barre button:hover{background:rgba(255,255,255,.15)}" +
    "#bata-ed-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(80px + env(safe-area-inset-bottom,0px));z-index:101;background:#211C17;color:#FFF8EE;padding:12px 18px;border-radius:999px;font:600 .95rem system-ui;max-width:calc(100vw - 32px)}" +
    "#bata-ed-toast.err{background:#5C1414}#bata-ed-toast[hidden]{display:none}" +
    "dialog.bata-ed-dlg{border:0;border-radius:12px;padding:22px;max-width:min(480px,calc(100vw - 32px));box-shadow:0 20px 60px rgba(0,0,0,.35);font:1rem/1.5 'Source Sans 3',system-ui,sans-serif}" +
    "dialog.bata-ed-dlg::backdrop{background:rgba(20,16,12,.55)}" +
    "dialog.bata-ed-dlg h2{font-family:Fraunces,Georgia,serif;font-size:1.4rem;margin:0 0 10px}" +
    "dialog.bata-ed-dlg img{max-height:200px;width:auto;margin:8px 0;border-radius:6px}" +
    "dialog.bata-ed-dlg label{display:block;font-weight:700;margin:12px 0 4px}" +
    "dialog.bata-ed-dlg input[type=text],dialog.bata-ed-dlg input[type=password]{width:100%;min-height:44px;padding:8px 10px;border:1.5px solid #BFAF93;border-radius:6px;font:inherit}" +
    "dialog.bata-ed-dlg .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}" +
    "dialog.bata-ed-dlg button{min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid #BFAF93;background:#fff;font:700 .95rem system-ui;cursor:pointer}" +
    "dialog.bata-ed-dlg button.principal{background:#7A1F1F;border-color:#7A1F1F;color:#fff}";
  document.head.appendChild(css);

  function toast(msg, erreur) {
    toastEl.textContent = msg;
    toastEl.className = erreur ? "err" : "";
    toastEl.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.hidden = true; }, erreur ? 7000 : 3000);
  }

  /* ---------- Serveur ---------- */
  function appel(action, donnees) {
    S.enCours++;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Code-Equipe": S.code, "X-Prenom": encodeURIComponent(S.prenom) },
      body: JSON.stringify(Object.assign({ action: action }, donnees || {}))
    }).then(function (r) {
      return r.json().then(function (j) { return { s: r.status, j: j }; }, function () { return { s: r.status, j: { erreur: "Réponse illisible du serveur. Rien n’a été enregistré." } }; });
    }, function () { return { s: 0, j: { erreur: "Pas de connexion : rien n’a été enregistré." } }; }).then(function (res) { S.enCours--; return res; });
  }

  function majContenus(j) {
    if (!j || !j.contenus) return;
    ["textes", "images", "galerie"].forEach(function (k) { C[k] = j.contenus[k]; });
    window.BATA_CONTENUS = C;
  }

  /* ---------- Connexion (si l'espace équipe n'est pas déjà ouvert sur ce téléphone) ---------- */
  function connexion() {
    var s = lire("bata-equipe") || lire("bata-edition", sessionStorage);
    if (s && s.prenom && s.code) { S.prenom = s.prenom; S.code = s.code; return Promise.resolve(true); }
    return new Promise(function (ok) {
      var d = document.createElement("dialog");
      d.className = "bata-ed-dlg";
      d.innerHTML = "<h2>Modifier le site</h2><p>Entrez votre prénom et le code de l’équipe.</p>" +
        '<label for="bata-ed-p">Votre prénom</label><input id="bata-ed-p" type="text" autocomplete="given-name" maxlength="30">' +
        '<label for="bata-ed-c">Code de l’équipe</label><input id="bata-ed-c" type="password" autocomplete="current-password">' +
        '<p id="bata-ed-e" style="color:#7A1F1F;font-weight:700" hidden></p>' +
        '<div class="actions"><button class="principal" type="button" id="bata-ed-ok">Entrer</button><button type="button" id="bata-ed-non">Annuler</button></div>';
      document.body.appendChild(d);
      d.showModal();
      $("#bata-ed-non", d).onclick = function () { d.close(); ok(false); };
      $("#bata-ed-ok", d).onclick = function () {
        var p = $("#bata-ed-p", d).value.trim(), c = $("#bata-ed-c", d).value;
        if (!p || !c) { $("#bata-ed-e", d).textContent = "Indiquez votre prénom et le code."; $("#bata-ed-e", d).hidden = false; return; }
        S.prenom = p; S.code = c;
        appel("lire").then(function (res) {
          if (res.s === 200 && res.j.ok) { ecrire("bata-edition", { prenom: p, code: c }); d.close(); ok(true); }
          else { $("#bata-ed-e", d).textContent = res.s === 401 ? "Code incorrect." : (res.j.erreur || "Connexion impossible."); $("#bata-ed-e", d).hidden = false; }
        });
      };
    });
  }

  /* ---------- Textes ---------- */
  function normaliser(h) { return window.BATA_PROPRE(h).replace(/\s+/g, " ").trim(); }

  function brancherTexte(n) {
    n.setAttribute("contenteditable", "true");
    n.setAttribute("spellcheck", "true");
    $$("[data-tarif],[data-tarif-min],[data-tarif-plage],[data-sejour-prix],[data-pain-brioche],[data-h]", n).forEach(function (s) { s.setAttribute("contenteditable", "false"); });
    n.__debut = normaliser(n.innerHTML);
    n.addEventListener("focus", function () { actif = n; n.__debut = n.__debut === undefined ? normaliser(n.innerHTML) : n.__debut; barre.hidden = false; });
    n.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
      if (e.key === "Escape") { n.innerHTML = n.__avant || n.innerHTML; n.blur(); }
    });
    n.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t);
    });
    n.addEventListener("blur", function () {
      setTimeout(function () { if (document.activeElement && barre.contains(document.activeElement)) return; if (actif === n) { actif = null; barre.hidden = true; } }, 0);
      enregistrerTexte(n, false);
    });
  }

  function enregistrerTexte(n, forcer) {
    var id = n.dataset.ed, h = normaliser(n.innerHTML);
    if (n.__debut === undefined || h === n.__debut) return;
    if (!h || !h.replace(/<br>/g, "").trim()) { toast("Un texte ne peut pas être vide. Utilisez « Texte d’origine » pour revenir en arrière.", true); n.innerHTML = n.__debut; return; }
    var cur = C.textes && C.textes[id];
    appel("texte_enregistrer", { id: id, html: h, maj_vue: cur ? cur.maj : "", forcer: !!forcer }).then(function (res) {
      if (res.s === 200 && res.j.ok) {
        majContenus(res.j);
        n.__debut = normaliser(n.innerHTML);
        n.classList.add("bata-modifie");
        toast("Enregistré : c’est en ligne.");
      } else if (res.s === 409) {
        var qui = res.j.par || "Quelqu’un";
        if (window.confirm(qui + " vient de modifier ce texte. Mettre le vôtre à la place ?\n\nOK = remplacer par le vôtre · Annuler = garder le sien")) {
          majContenus(res.j);
          enregistrerTexte(n, true);
        } else {
          majContenus(res.j);
          var t = res.j.contenus && res.j.contenus.textes && res.j.contenus.textes[id];
          n.innerHTML = t ? window.BATA_PROPRE(t.h) : (n.__origine || n.innerHTML);
          n.__debut = normaliser(n.innerHTML);
          toast("C’est sa version qui reste en ligne.");
        }
      } else if (res.s === 401) {
        toast("Code incorrect ou changé : reconnectez-vous dans l’espace équipe.", true);
      } else {
        toast(res.j.erreur || "Rien n’a été enregistré.", true);
        n.innerHTML = n.__debut;
      }
    });
  }

  function texteOrigine() {
    if (!actif) return;
    var n = actif, id = n.dataset.ed;
    if (!(C.textes && C.textes[id])) { toast("Ce texte est déjà celui d’origine."); return; }
    if (!window.confirm("Revenir au texte d’origine de ce bloc ?")) return;
    appel("texte_reinitialiser", { id: id }).then(function (res) {
      if (res.s === 200 && res.j.ok) {
        majContenus(res.j);
        n.innerHTML = n.__origine !== undefined ? n.__origine : n.innerHTML;
        n.__debut = normaliser(n.innerHTML);
        n.classList.remove("bata-modifie");
        toast("Texte d’origine rétabli.");
      } else toast(res.j.erreur || "Rien n’a été changé.", true);
    });
  }

  /* ---------- Photos ---------- */
  function reduire(fichier) {
    return new Promise(function (ok, non) {
      var url = URL.createObjectURL(fichier), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); non(new Error("Cette image est illisible.")); };
      img.src = url;
    });
  }

  function dialoguePhoto(img) {
    var id = img.dataset.edImg, cur = C.images && C.images[id], dlg = document.createElement("dialog");
    dlg.className = "bata-ed-dlg";
    dlg.innerHTML = "<h2>Cette photo</h2><img alt=\"\" src=\"" + esc(img.currentSrc || img.src) + "\">" +
      '<label for="bata-ed-f">Choisir une autre photo (facultatif)</label><input id="bata-ed-f" type="file" accept="image/jpeg,image/png,image/webp">' +
      '<label for="bata-ed-a">Description de la photo (pour les personnes qui ne la voient pas)</label><input id="bata-ed-a" type="text" maxlength="200">' +
      '<div class="actions"><button class="principal" type="button" data-a="ok">Enregistrer</button>' + (cur ? '<button type="button" data-a="orig">Photo d’origine</button>' : "") + '<button type="button" data-a="non">Fermer</button></div>';
    document.body.appendChild(dlg);
    $("#bata-ed-a", dlg).value = img.getAttribute("alt") || "";
    dlg.showModal();
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a]");
      if (!b) return;
      if (b.dataset.a === "non") return dlg.close();
      if (b.dataset.a === "orig") {
        appel("image_reinitialiser", { id: id }).then(function (res) {
          if (res.s === 200 && res.j.ok) {
            majContenus(res.j);
            var o = img.__origine;
            if (o) { img.setAttribute("src", o.src); img.setAttribute("alt", o.alt); if (o.w) img.setAttribute("width", o.w); if (o.h) img.setAttribute("height", o.h); }
            toast("Photo d’origine rétablie."); dlg.close();
          } else toast(res.j.erreur || "Rien n’a été changé.", true);
        });
        return;
      }
      var f = $("#bata-ed-f", dlg).files[0], alt = $("#bata-ed-a", dlg).value.trim();
      (f ? reduire(f) : Promise.resolve(null)).then(function (contenu) {
        var corps = { id: id, alt: alt, maj_vue: cur ? cur.maj : "" };
        if (contenu) corps.contenu = contenu;
        function envoyer(forcer) {
          corps.forcer = !!forcer;
          appel("image_enregistrer", corps).then(function (res) {
            if (res.s === 200 && res.j.ok) {
              majContenus(res.j);
              var o = C.images && C.images[id];
              if (o && o.fichier) { img.removeAttribute("srcset"); img.removeAttribute("width"); img.removeAttribute("height"); img.setAttribute("src", o.fichier + "?v=" + Date.now()); }
              if (o && o.alt) img.setAttribute("alt", o.alt);
              toast("Enregistré : c’est en ligne."); dlg.close();
            } else if (res.s === 409) {
              if (window.confirm((res.j.par || "Quelqu’un") + " vient de changer cette photo. Mettre la vôtre à la place ?")) { majContenus(res.j); envoyer(true); } else { majContenus(res.j); dlg.close(); }
            } else toast(res.j.erreur || "Rien n’a été enregistré.", true);
          });
        }
        envoyer(false);
      }, function (err) { toast(err.message, true); });
    });
  }

  /* ---------- Démarrage ---------- */
  function demarrer() {
    document.body.classList.add("bata-ed");
    bandeau = document.createElement("div");
    bandeau.id = "bata-ed-bandeau";
    bandeau.innerHTML = "<b>Mode modification</b><span>Touchez un texte ou une photo pour le changer. Tout s’enregistre en quittant le bloc, et c’est en ligne tout de suite. Pour ajouter un événement, une nouvelle, une offre ou un prix, passez par l’espace équipe.</span><a href=\"equipe/#pages\">Espace équipe</a><button type=\"button\" id=\"bata-ed-fin\">Terminer</button>";
    document.body.appendChild(bandeau);
    // Les zones remplies depuis l'espace équipe ne se modifient pas ici : une étiquette renvoie vers le bon onglet.
    [["[data-agenda]", "agenda", "Les événements se gèrent dans l’onglet Agenda de l’espace équipe."],
     ["[data-actualites]", "agenda", "Les nouvelles se gèrent dans l’onglet Agenda de l’espace équipe."],
     ["[data-affiches]", "agenda", "Les affiches se gèrent dans l’onglet Agenda (Publier une nouvelle) de l’espace équipe."],
     ["[data-offres]", "documents", "Les offres d’emploi se gèrent dans l’onglet Documents de l’espace équipe."],
     ["[data-pain-lignes]", "documents", "Les prix du pain se gèrent dans l’onglet Documents de l’espace équipe."],
     ["[data-galerie]", "pages", "Les photos de la galerie se gèrent dans l’onglet Pages (Galerie photos) de l’espace équipe."],
     ["[data-message-du-jour]", "message", "Le message du jour se gère dans l’onglet Message de l’espace équipe."]
    ].forEach(function (z) {
      $$(z[0]).forEach(function (el) {
        var e = document.createElement("p");
        e.className = "bata-ed-ailleurs";
        e.innerHTML = esc(z[2]) + ' <a href="equipe/#' + z[1] + '">Y aller</a>';
        el.insertAdjacentElement("beforebegin", e);
      });
    });
    barre = document.createElement("div");
    barre.id = "bata-ed-barre"; barre.hidden = true;
    barre.innerHTML = '<button type="button" data-cmd="gras" aria-label="Gras"><b>G</b></button><button type="button" data-cmd="lien">Lien</button><button type="button" data-cmd="delien">Sans lien</button><button type="button" data-cmd="origine">Texte d’origine</button>';
    document.body.appendChild(barre);
    toastEl = document.createElement("div"); toastEl.id = "bata-ed-toast"; toastEl.hidden = true; toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);

    barre.addEventListener("mousedown", function (e) { e.preventDefault(); });
    barre.addEventListener("click", function (e) {
      var b = e.target.closest("[data-cmd]");
      if (!b || !actif) return;
      var c = b.dataset.cmd;
      if (c === "gras") document.execCommand("bold");
      else if (c === "delien") document.execCommand("unlink");
      else if (c === "origine") texteOrigine();
      else if (c === "lien") {
        var u = window.prompt("Adresse du lien (https://… ou une page du site comme contact.html) :", "https://");
        if (u && /^(https?:\/\/|mailto:|tel:|[a-z0-9._-]+\.html)/i.test(u.trim())) document.execCommand("createLink", false, u.trim());
        else if (u) toast("Ce lien n’est pas accepté : il doit commencer par https://", true);
      }
      actif.focus();
    });
    $("#bata-ed-fin").addEventListener("click", function () {
      if (S.enCours && !window.confirm("Un enregistrement est en cours. Quitter quand même ?")) return;
      try { sessionStorage.setItem("bata-onglet", "pages"); } catch (x) { /* rien */ }
      location.href = "equipe/#pages";
    });

    // Les liens et boutons de la page ne naviguent pas pendant la modification (sauf ceux du bandeau).
    document.addEventListener("click", function (e) {
      var img = e.target.closest("[data-ed-img]");
      if (img) { e.preventDefault(); e.stopPropagation(); dialoguePhoto(img); return; }
      if (e.target.closest("#bata-ed-bandeau, #bata-ed-barre, dialog")) return;
      var a = e.target.closest("a[href]");
      if (a) e.preventDefault();
    }, true);
    window.addEventListener("beforeunload", function (e) { if (S.enCours) { e.preventDefault(); e.returnValue = ""; } });

    $$("[data-ed]").forEach(brancherTexte);
    var n = $$("[data-ed]").length, p = $$("[data-ed-img]").length;
    toast(n + " textes et " + p + " photos à modifier sur cette page.");
  }

  function init() {
    if (!window.BATA_PROPRE) { setTimeout(init, 100); return; }
    connexion().then(function (ok) {
      if (ok) demarrer();
      else toast && 0;
    });
  }
  // Le bandeau de toast n'existe qu'une fois le mode lancé ; avant, un échec de connexion revient simplement à la page normale.
  toastEl = { textContent: "", className: "", hidden: true };
  init();
})();
