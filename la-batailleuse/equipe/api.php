<?php
declare(strict_types=1);
// Espace équipe : l'équipe met à jour elle-même le message du jour, l'agenda, le statut des séjours
// et les horaires. Chaque action est une petite opération appliquée sous verrou sur data/contenus.json :
// deux personnes qui travaillent en même temps ne s'écrasent jamais sans le savoir (voir conflit()).
require __DIR__ . '/../prive/commun.php';

exiger_post();
$c = config();
// Un fichier (PDF, photo) arrive en base64 dans le corps : on ne lit un corps volumineux qu'une fois le code vérifié.
const ACTIONS_FICHIERS = ['document_envoyer', 'actualite_enregistrer', 'offre_enregistrer', 'image_enregistrer', 'photo_ajouter'];
const OCTETS_FICHIER = 5 * 1024 * 1024;
$gros = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 200000;
$d = $gros ? [] : corps_json(200000);
$action = texte($d['action'] ?? '', 30);

if ($action === 'ping') {
    repondre(200, ['ok' => true, 'equipe' => true]);
}

// Code de l'équipe vérifié contre son empreinte ; 8 codes faux en 15 minutes bloquent la connexion.
$cle = 'equipe:' . ip();
if (!limiter($cle, 8, 900, false)) {
    repondre(429, ['erreur' => 'Trop de codes incorrects. Réessayez dans 15 minutes.']);
}
$code = (string) ($_SERVER['HTTP_X_CODE_EQUIPE'] ?? '');
if ($code === '' || $c['code_equipe_hash'] === '' || !password_verify($code, $c['code_equipe_hash'])) {
    limiter($cle, 8, 900, true);
    sleep(1);
    repondre(401, ['erreur' => 'Code incorrect.']);
}
if ($gros) {
    $d = corps_json((int) (OCTETS_FICHIER * 4 / 3) + 300000);
    $action = texte($d['action'] ?? '', 30);
    if (!in_array($action, ACTIONS_FICHIERS, true)) {
        repondre(413, ['erreur' => 'Demande trop volumineuse.']);
    }
}
$prenom = texte(rawurldecode((string) ($_SERVER['HTTP_X_PRENOM'] ?? '')), 30);
if ($prenom === '') {
    repondre(400, ['erreur' => 'Indiquez votre prénom : il apparaît dans l’historique des modifications.']);
}

const STATUTS = ['a-venir' => 'inscriptions bientôt', 'ouvert' => 'inscriptions ouvertes', 'dernieres' => 'dernières places', 'complet' => 'complet', 'termine' => 'terminé'];
const TYPES = ['haute', 'moyenne', 'basse'];

// Pages du site : nom lisible pour l'historique et l'espace équipe.
const PAGES_SITE = ['index' => 'Accueil', 'collectif' => 'La ferme et le collectif', 'pied' => 'Pied de page (toutes les pages)', 'menu' => 'Menu (toutes les pages)', 'ecoles' => 'Écoles et groupes', 'colos' => 'Colos', 'chalet' => 'Le chalet',
    'visiter' => 'Venir à la ferme', 'contact' => 'Contact', 'decouvrir' => 'Découvrir', 'ferme' => 'Agriculture et productions', 'fournil' => 'Le fournil',
    'histoire' => 'Notre histoire', 'hiver' => 'Activités d’hiver', 'photos' => 'Photos'];
const BALISES_DATA = ['data-tarif', 'data-tarif-min', 'data-tarif-plage', 'data-sejour-prix', 'data-pain-brioche', 'data-h'];


// Emplacements de documents : l'équipe remplace le fichier, le lien du site suit tout seul.
const DOCUMENTS = [
    'contrat-pain-mensuel' => ['Contrat pain mensuel', ['pdf']],
    'contrat-pain-semestriel' => ['Contrat pain semestriel', ['pdf']],
    'catalogue-activites' => ['Brochure « Nos activités » (écoles et groupes)', ['pdf']],
    'bulletin-inscription-colos' => ['Bulletin d’inscription aux colos', ['pdf']],
    'projet-educatif' => ['Projet éducatif d’accueil', ['pdf']],
    'catalogue-groupes' => ['Brochure « Nos activités groupes » (journée et demi-journée)', ['pdf']],
    'certificat-bio' => ['Certificat Agriculture biologique', ['pdf']],
    'catalogue-petite-enfance' => ['Brochure « Activités petite enfance » (0-3 ans)', ['pdf']],
    'catalogue-domicile' => ['Brochure « Animations à domicile » (en classe)', ['pdf']],
    'bulletin-adhesion' => ['Bulletin d’adhésion et de soutien', ['pdf', 'png', 'jpg']],
];


switch ($action) {
    case 'lire':
        succes(charger());

    case 'message':
        $texte = texte($d['texte'] ?? '', 200);
        $jusqu = (string) ($d['jusqu_au'] ?? '');
        if ($jusqu !== '' && !date_valide($jusqu)) {
            repondre(400, ['erreur' => 'Date de fin du message incorrecte.']);
        }
        avec_verrou('contenus', function () use ($d, $texte, $jusqu, $prenom) {
            $doc = charger();
            verifier_version($doc, 'message', $d, $doc['message_du_jour']);
            $doc['message_du_jour'] = ['texte' => $texte, 'jusqu_au' => $texte === '' ? '' : $jusqu];
            succes(enregistrer($doc, 'message', $texte === '' ? 'Message du jour retiré' : 'Message du jour : « ' . $texte . ' »', $prenom));
        });

    case 'evenement_ajouter':
        $e = valider_evenement($d['evenement'] ?? null);
        avec_verrou('contenus', function () use ($e, $prenom) {
            $doc = charger();
            $limite = date('Y-m-d', strtotime('-60 days'));
            $doc['agenda'] = array_values(array_filter($doc['agenda'] ?? [], fn($x) => ($x['fin'] ?? $x['date']) >= $limite));
            if (count($doc['agenda']) >= 60) {
                repondre(400, ['erreur' => 'L’agenda compte déjà 60 dates : retirez-en avant d’en ajouter.']);
            }
            $e['id'] = 'e' . bin2hex(random_bytes(4));
            $doc['agenda'][] = $e;
            usort($doc['agenda'], fn($a, $b) => strcmp($a['date'] . ($a['heure'] ?? ''), $b['date'] . ($b['heure'] ?? '')));
            succes(enregistrer($doc, 'agenda', 'Date ajoutée : ' . $e['titre'] . ' (' . jour_mois($e['date']) . ')', $prenom));
        });

    case 'evenement_supprimer':
        $id = texte($d['id'] ?? '', 20);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            foreach ($doc['agenda'] ?? [] as $i => $e) {
                if (($e['id'] ?? '') === $id) {
                    array_splice($doc['agenda'], $i, 1);
                    succes(enregistrer($doc, 'agenda', 'Date retirée : ' . $e['titre'] . ' (' . jour_mois($e['date']) . ')', $prenom));
                }
            }
            // Déjà retirée par quelqu'un d'autre : rien à faire, on le dit.
            succes($doc, 'Cette date avait déjà été retirée' . par_qui('agenda') . '.');
        });

    case 'sejour_statut':
        $id = texte($d['id'] ?? '', 40);
        $statut = texte($d['statut'] ?? '', 20);
        if (!isset(STATUTS[$statut])) {
            repondre(400, ['erreur' => 'Statut inconnu.']);
        }
        avec_verrou('contenus', function () use ($d, $id, $statut, $prenom) {
            $doc = charger();
            foreach ($doc['sejours'] ?? [] as $i => $s) {
                if (($s['id'] ?? '') !== $id) {
                    continue;
                }
                // Conflit seulement si CE séjour a changé depuis que la personne l'a vu.
                if (($d['statut_vu'] ?? null) !== $s['statut'] && empty($d['forcer'])) {
                    conflit($doc, 'sejours', ['id' => $id, 'statut' => $s['statut']], $id);
                }
                $doc['sejours'][$i]['statut'] = $statut;
                succes(enregistrer($doc, 'sejours', $s['nom'] . ' : ' . STATUTS[$statut], $prenom, $id));
            }
            repondre(404, ['erreur' => 'Séjour introuvable.']);
        });

    case 'horaires':
        $h = valider_horaires($d['horaires'] ?? null);
        avec_verrou('contenus', function () use ($d, $h, $prenom) {
            $doc = charger();
            verifier_version($doc, 'horaires', $d, $doc['horaires']);
            $resume = resume_horaires($doc['horaires'], $h);
            $doc['horaires'] = $h;
            succes(enregistrer($doc, 'horaires', $resume, $prenom));
        });

    case 'document_envoyer':
        $cle = texte($d['cle'] ?? '', 40);
        if (!isset(DOCUMENTS[$cle])) {
            repondre(400, ['erreur' => 'Emplacement de document inconnu.']);
        }
        $nom_fichier = texte($d['nom'] ?? '', 80);
        avec_verrou('contenus', function () use ($d, $cle, $nom_fichier, $prenom) {
            $doc = charger();
            $actuel = $doc['documents'][$cle] ?? null;
            if (empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($actuel['maj'] ?? '')) {
                conflit($doc, 'documents', $actuel ?? ['titre' => DOCUMENTS[$cle][0]], $cle);
            }
            $f = enregistrer_fichier($cle, $d['contenu'] ?? '', DOCUMENTS[$cle][1]);
            $doc['documents'][$cle] = ['titre' => DOCUMENTS[$cle][0], 'fichier' => $f['fichier'], 'nom' => $nom_fichier, 'taille' => $f['taille'], 'maj' => date('c'), 'par' => $prenom];
            succes(enregistrer($doc, 'documents', DOCUMENTS[$cle][0] . ' : nouveau fichier' . ($nom_fichier !== '' ? ' (' . $nom_fichier . ')' : ''), $prenom, $cle));
        });

    case 'actualite_enregistrer':
        $a = valider_actualite($d);
        avec_verrou('contenus', function () use ($d, $a, $prenom) {
            $doc = charger();
            $liste = $doc['actualites'] ?? [];
            $i = null;
            foreach ($liste as $k => $x) {
                if (($x['id'] ?? '') === $a['id']) {
                    $i = $k;
                }
            }
            if ($i !== null && empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($liste[$i]['maj'] ?? '')) {
                conflit($doc, 'actualites', $liste[$i], $a['id']);
            }
            if ($i === null && count($liste) >= 40) {
                repondre(400, ['erreur' => 'Il y a déjà 40 actualités : retirez les plus anciennes avant d’en ajouter.']);
            }
            $ancien = $i === null ? [] : $liste[$i];
            $photo = $ancien['photo'] ?? null;
            if (!empty($d['retirer_photo'])) {
                $photo = null;
            }
            if (!empty($d['photo']['contenu'])) {
                $f = enregistrer_fichier('actu-' . $a['id'], $d['photo']['contenu'], ['jpg', 'png', 'webp']);
                $photo = ['fichier' => $f['fichier']];
            }
            if ($photo) {
                $photo['alt'] = $a['titre'];
            }
            $a = array_merge($a, ['photo' => $photo, 'maj' => date('c'), 'par' => $prenom]);
            if ($i === null) {
                $liste[] = $a;
            } else {
                $liste[$i] = $a;
            }
            usort($liste, fn($x, $y) => strcmp((string) $y['date'], (string) $x['date']));
            $doc['actualites'] = array_values($liste);
            succes(enregistrer($doc, 'actualites', ($i === null ? 'Actualité publiée : ' : 'Actualité modifiée : ') . $a['titre'], $prenom, $a['id']));
        });

    case 'actualite_supprimer':
        $id = texte($d['id'] ?? '', 20);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            foreach ($doc['actualites'] ?? [] as $i => $x) {
                if (($x['id'] ?? '') === $id) {
                    array_splice($doc['actualites'], $i, 1);
                    succes(enregistrer($doc, 'actualites', 'Actualité retirée : ' . $x['titre'], $prenom, $id));
                }
            }
            succes($doc, 'Cette actualité avait déjà été retirée' . par_qui('actualites') . '.');
        });

    case 'offre_enregistrer':
        $o = valider_offre($d);
        avec_verrou('contenus', function () use ($d, $o, $prenom) {
            $doc = charger();
            $liste = $doc['offres'] ?? [];
            $i = null;
            foreach ($liste as $k => $x) {
                if (($x['id'] ?? '') === $o['id']) {
                    $i = $k;
                }
            }
            if ($i !== null && empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($liste[$i]['maj'] ?? '')) {
                conflit($doc, 'offres', $liste[$i], $o['id']);
            }
            if ($i === null && count($liste) >= 10) {
                repondre(400, ['erreur' => 'Il y a déjà 10 offres : retirez-en avant d’en ajouter.']);
            }
            $pdf = $i === null ? null : ($liste[$i]['pdf'] ?? null);
            if (!empty($d['retirer_pdf'])) {
                $pdf = null;
            }
            if (!empty($d['pdf']['contenu'])) {
                $f = enregistrer_fichier('offre-' . $o['id'], $d['pdf']['contenu'], ['pdf']);
                $pdf = ['fichier' => $f['fichier'], 'taille' => $f['taille'], 'nom' => texte($d['pdf']['nom'] ?? '', 80)];
            }
            $o = array_merge($o, ['pdf' => $pdf, 'maj' => date('c'), 'par' => $prenom]);
            if ($i === null) {
                $liste[] = $o;
            } else {
                $liste[$i] = $o;
            }
            $doc['offres'] = array_values($liste);
            succes(enregistrer($doc, 'offres', ($i === null ? 'Offre publiée : ' : 'Offre modifiée : ') . $o['titre'], $prenom, $o['id']));
        });

    case 'offre_supprimer':
        $id = texte($d['id'] ?? '', 20);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            foreach ($doc['offres'] ?? [] as $i => $x) {
                if (($x['id'] ?? '') === $id) {
                    array_splice($doc['offres'], $i, 1);
                    succes(enregistrer($doc, 'offres', 'Offre retirée : ' . $x['titre'], $prenom, $id));
                }
            }
            succes($doc, 'Cette offre avait déjà été retirée' . par_qui('offres') . '.');
        });

    case 'sejour_infos':
        $id = texte($d['id'] ?? '', 40);
        $infos = valider_infos_sejour($d);
        avec_verrou('contenus', function () use ($d, $id, $infos, $prenom) {
            $doc = charger();
            foreach ($doc['sejours'] ?? [] as $i => $s) {
                if (($s['id'] ?? '') !== $id) {
                    continue;
                }
                if (empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($s['infos_maj'] ?? '')) {
                    conflit($doc, 'sejours', ['id' => $id, 'infos' => true, 'prix' => $s['prix'] ?? '', 'semaines' => $s['semaines'] ?? []], $id);
                }
                $doc['sejours'][$i] = array_merge($s, $infos, ['infos_maj' => date('c')]);
                succes(enregistrer($doc, 'sejours', $s['nom'] . ' : dates et prix modifiés (' . count($infos['semaines']) . ' semaine' . (count($infos['semaines']) > 1 ? 's' : '') . ', ' . $infos['prix'] . ')', $prenom, $id));
            }
            repondre(404, ['erreur' => 'Séjour introuvable.']);
        });

    case 'pain_prix':
        $pain = valider_pain($d['pain'] ?? null);
        avec_verrou('contenus', function () use ($d, $pain, $prenom) {
            $doc = charger();
            verifier_version($doc, 'pain', $d, $doc['pain'] ?? null);
            $doc['pain'] = $pain;
            succes(enregistrer($doc, 'pain', 'Prix du pain modifiés (' . count($pain['lignes']) . ' pains)', $prenom));
        });

    case 'tarifs_modifier':
        $changements = is_array($d['changements'] ?? null) ? $d['changements'] : [];
        if (!$changements || count($changements) > 80) {
            repondre(400, ['erreur' => 'Aucun tarif à enregistrer.']);
        }
        $nouveaux = [];
        foreach ($changements as $k => $c) {
            $v = texte($c['nouveau'] ?? '', 40);
            if ($v === '' || preg_match('/\d/', $v) !== 1) {
                repondre(400, ['erreur' => 'Un tarif doit contenir un chiffre (ex. : 50 €).']);
            }
            $nouveaux[texte($k, 60)] = ['v' => $v, 'vu' => texte($c['vu'] ?? '', 40)];
        }
        avec_verrou('contenus', function () use ($d, $nouveaux, $prenom) {
            $doc = charger();
            $liste = [];
            foreach ($nouveaux as $k => $n) {
                if (!isset($doc['tarifs'][$k])) {
                    repondre(400, ['erreur' => 'Tarif inconnu : ' . $k . '.']);
                }
                $actuel = $doc['tarifs'][$k];
                if (empty($d['forcer']) && $n['vu'] !== $actuel['v']) {
                    conflit($doc, 'tarifs', ['cle' => $k, 'libelle' => $actuel['l'], 'v' => $actuel['v']], $k);
                }
                if ($actuel['v'] !== $n['v']) {
                    $liste[] = $actuel['l'] . ' : ' . $n['v'] . ' (avant ' . $actuel['v'] . ')';
                    $doc['tarifs'][$k]['v'] = $n['v'];
                }
            }
            if (!$liste) {
                succes($doc, 'Rien n’a changé.');
            }
            $resume = 'Tarifs : ' . implode(' ; ', array_slice($liste, 0, 2)) . (count($liste) > 2 ? ' ; + ' . (count($liste) - 2) . ' autres' : '');
            succes(enregistrer($doc, 'tarifs', $resume, $prenom, array_key_first($nouveaux)));
        });

    case 'texte_enregistrer':
        $id = texte($d['id'] ?? '', 40);
        if (!id_bloc_valide($id)) {
            repondre(400, ['erreur' => 'Bloc de texte inconnu.']);
        }
        $h = nettoyer_html((string) ($d['html'] ?? ''));
        if ($h === '') {
            repondre(400, ['erreur' => 'Le texte est vide ou trop long. Pour retirer vos changements, choisissez « Texte d’origine ».']);
        }
        avec_verrou('contenus', function () use ($d, $id, $h, $prenom) {
            $doc = charger();
            $actuel = $doc['textes'][$id] ?? null;
            if (empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($actuel['maj'] ?? '')) {
                conflit($doc, 'textes', ['id' => $id, 'h' => $actuel['h'] ?? null], $id);
            }
            if ($actuel === null && count($doc['textes'] ?? []) >= 2500) {
                repondre(400, ['erreur' => 'Trop de textes modifiés : prévenez Primo.']);
            }
            if (($actuel['h'] ?? null) === $h) {
                succes($doc, 'Rien n’a changé.');
            }
            $doc['textes'][$id] = ['h' => $h, 'maj' => date('c'), 'par' => $prenom];
            succes(enregistrer($doc, 'textes', 'Page « ' . nom_page($id) . ' » : « ' . extrait_texte($h) . ' »', $prenom, $id));
        });

    case 'texte_reinitialiser':
        $id = texte($d['id'] ?? '', 40);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            if (!isset($doc['textes'][$id])) {
                succes($doc, 'Ce texte est déjà celui d’origine.');
            }
            unset($doc['textes'][$id]);
            succes(enregistrer($doc, 'textes', 'Page « ' . nom_page($id) . ' » : retour au texte d’origine', $prenom, $id));
        });

    case 'image_enregistrer':
        $id = texte($d['id'] ?? '', 40);
        if (!id_bloc_valide($id)) {
            repondre(400, ['erreur' => 'Image inconnue.']);
        }
        $alt = texte($d['alt'] ?? '', 200);
        avec_verrou('contenus', function () use ($d, $id, $alt, $prenom) {
            $doc = charger();
            $actuel = $doc['images'][$id] ?? null;
            if (empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($actuel['maj'] ?? '')) {
                conflit($doc, 'images', ['id' => $id], $id);
            }
            $nouveau = ['maj' => date('c'), 'par' => $prenom];
            if (!empty($d['contenu'])) {
                $f = enregistrer_fichier('img-' . $id, $d['contenu'], ['jpg', 'png', 'webp']);
                $nouveau['fichier'] = $f['fichier'];
            } elseif (isset($actuel['fichier'])) {
                $nouveau['fichier'] = $actuel['fichier'];
            }
            if ($alt !== '') {
                $nouveau['alt'] = $alt;
            } elseif (isset($actuel['alt'])) {
                $nouveau['alt'] = $actuel['alt'];
            }
            if (count($nouveau) <= 2) {
                repondre(400, ['erreur' => 'Choisissez une photo ou écrivez sa description.']);
            }
            $doc['images'][$id] = $nouveau;
            succes(enregistrer($doc, 'images', 'Page « ' . nom_page($id) . ' » : ' . (!empty($d['contenu']) ? 'photo remplacée' : 'description de la photo modifiée'), $prenom, $id));
        });

    case 'image_reinitialiser':
        $id = texte($d['id'] ?? '', 40);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            if (!isset($doc['images'][$id])) {
                succes($doc, 'Cette photo est déjà celle d’origine.');
            }
            unset($doc['images'][$id]);
            succes(enregistrer($doc, 'images', 'Page « ' . nom_page($id) . ' » : retour à la photo d’origine', $prenom, $id));
        });

    case 'photo_ajouter':
        $legende = texte($d['legende'] ?? '', 120);
        avec_verrou('contenus', function () use ($d, $legende, $prenom) {
            $doc = charger();
            $liste = $doc['galerie'] ?? [];
            if (count($liste) >= 400) {
                repondre(400, ['erreur' => 'La galerie compte déjà 400 photos : retirez-en avant d’en ajouter.']);
            }
            $id = 'p' . bin2hex(random_bytes(4));
            $f = enregistrer_fichier('photo-' . $id, $d['contenu'] ?? '', ['jpg', 'png', 'webp']);
            array_unshift($liste, ['id' => $id, 'fichier' => $f['fichier'], 'legende' => $legende, 'maj' => date('c'), 'par' => $prenom]);
            $doc['galerie'] = $liste;
            succes(enregistrer($doc, 'galerie', 'Photo ajoutée à la galerie' . ($legende !== '' ? ' : ' . $legende : ''), $prenom, $id));
        });

    case 'photo_modifier':
        $id = texte($d['id'] ?? '', 20);
        $legende = texte($d['legende'] ?? '', 120);
        avec_verrou('contenus', function () use ($d, $id, $legende, $prenom) {
            $doc = charger();
            foreach ($doc['galerie'] ?? [] as $i => $p) {
                if (($p['id'] ?? '') !== $id) {
                    continue;
                }
                if (empty($d['forcer']) && (string) ($d['maj_vue'] ?? '') !== (string) ($p['maj'] ?? '')) {
                    conflit($doc, 'galerie', $p, $id);
                }
                $doc['galerie'][$i]['legende'] = $legende;
                $doc['galerie'][$i]['maj'] = date('c');
                succes(enregistrer($doc, 'galerie', 'Légende de photo modifiée : ' . ($legende !== '' ? $legende : '(vide)'), $prenom, $id));
            }
            succes($doc, 'Cette photo avait déjà été retirée.');
        });

    case 'photo_supprimer':
        $id = texte($d['id'] ?? '', 20);
        avec_verrou('contenus', function () use ($id, $prenom) {
            $doc = charger();
            foreach ($doc['galerie'] ?? [] as $i => $p) {
                if (($p['id'] ?? '') === $id) {
                    array_splice($doc['galerie'], $i, 1);
                    succes(enregistrer($doc, 'galerie', 'Photo retirée de la galerie' . (($p['legende'] ?? '') !== '' ? ' : ' . $p['legende'] : ''), $prenom, $id));
                }
            }
            succes($doc, 'Cette photo avait déjà été retirée.');
        });

    case 'boites_reelles':
        if (!interrupteur_disponible($c)) {
            repondre(400, ['erreur' => 'Ce réglage n’existe que sur la démonstration.']);
        }
        $oui = !empty($d['valeur']);
        avec_verrou('contenus', function () use ($oui, $prenom) {
            ecrire_json(DOSSIER_ETAT . '/reglages.json', ['boites_reelles' => $oui, 'par' => $prenom, 'quand' => date('c')]);
            $j = journal();
            array_unshift($j, ['quand' => date('c'), 'par' => $prenom, 'section' => 'reglages', 'cle' => '',
                'resume' => $oui ? 'Formulaires de la démo : dans vos boîtes mail' : 'Formulaires de la démo : chez Primo', 'avant' => '']);
            ecrire_json(DOSSIER_ETAT . '/journal.json', array_slice($j, 0, 200));
            succes(charger(), $oui ? 'C’est fait : les demandes de la démo arrivent maintenant dans vos boîtes mail. Essayez un formulaire !' : 'Les demandes de la démo arrivent de nouveau chez Primo.');
        });

    case 'restaurer':
        $f = (string) ($d['fichier'] ?? '');
        if (!preg_match('/^\d{8}-\d{6}-[0-9a-f]{4}\.json$/', $f) || !is_file(DOSSIER_ETAT . '/historique/' . $f)) {
            repondre(404, ['erreur' => 'Version introuvable.']);
        }
        avec_verrou('contenus', function () use ($f, $prenom) {
            $ancien = lire_json(DOSSIER_ETAT . '/historique/' . $f, null);
            if (!is_array($ancien) || !isset($ancien['horaires'])) {
                repondre(500, ['erreur' => 'Version illisible.']);
            }
            $actuel = charger();
            foreach (['documents', 'actualites', 'offres', 'pain', 'tarifs', 'textes', 'images', 'galerie'] as $k) {
                if (!isset($ancien[$k]) && isset($actuel[$k])) {
                    $ancien[$k] = $actuel[$k];
                }
            }
            $ancien['versions'] = $actuel['versions'];
            foreach (array_keys($ancien['versions']) as $s) {
                $ancien['versions'][$s]++;
            }
            succes(enregistrer($ancien, 'tout', 'Retour à la version du ' . date('d/m à H:i', strtotime((string) ($ancien['mis_a_jour'] ?? 'now'))), $prenom));
        });

    default:
        repondre(400, ['erreur' => 'Action inconnue.']);
}


function jour_mois(string $iso): string
{
    return substr($iso, 8, 2) . '/' . substr($iso, 5, 2);
}

function charger(): array
{
    $doc = lire_json(FICHIER_CONTENUS, null);
    if (!is_array($doc)) {
        repondre(500, ['erreur' => 'Le fichier des contenus est illisible. Prévenez Primo.']);
    }
    $doc['versions'] = ($doc['versions'] ?? []) + ['message' => 0, 'agenda' => 0, 'horaires' => 0, 'sejours' => 0, 'documents' => 0, 'actualites' => 0, 'offres' => 0, 'pain' => 0, 'tarifs' => 0, 'textes' => 0, 'images' => 0, 'galerie' => 0];
    return $doc;
}

function journal(): array
{
    return lire_json(DOSSIER_ETAT . '/journal.json', []);
}

function historique(): array
{
    $fichiers = glob(DOSSIER_ETAT . '/historique/*.json') ?: [];
    rsort($fichiers);
    return array_map('basename', array_slice($fichiers, 0, 60));
}

/** Archive l'état actuel, écrit le nouveau, note qui a fait quoi. */
function enregistrer(array $doc, string $section, string $resume, string $prenom, string $cle = ''): array
{
    $dossier = DOSSIER_ETAT . '/historique';
    if (!is_dir($dossier)) {
        mkdir($dossier, 0750, true);
    }
    $avant = date('Ymd-His') . '-' . bin2hex(random_bytes(2)) . '.json';
    copy(FICHIER_CONTENUS, $dossier . '/' . $avant);
    $anciens = glob($dossier . '/*.json') ?: [];
    sort($anciens);
    foreach (array_slice($anciens, 0, max(0, count($anciens) - 60)) as $f) {
        unlink($f);
    }
    if ($section !== 'tout') {
        $doc['versions'][$section] = ($doc['versions'][$section] ?? 0) + 1;
    }
    $doc['version'] = ($doc['version'] ?? 0) + 1;
    $doc['mis_a_jour'] = date('c');
    $doc['par'] = $prenom;
    ecrire_json(FICHIER_CONTENUS, $doc);
    $j = journal();
    array_unshift($j, ['quand' => date('c'), 'par' => $prenom, 'section' => $section, 'cle' => $cle, 'resume' => mb_substr($resume, 0, 240), 'avant' => $avant]);
    ecrire_json(DOSSIER_ETAT . '/journal.json', array_slice($j, 0, 200));
    return $doc;
}

function derniere_modif(string $section, string $cle = ''): ?array
{
    foreach (journal() as $e) {
        if ((($e['section'] ?? '') === $section && ($cle === '' || ($e['cle'] ?? '') === $cle)) || ($e['section'] ?? '') === 'tout') {
            return $e;
        }
    }
    return null;
}

function par_qui(string $section): string
{
    $m = derniere_modif($section);
    return $m ? ' par ' . $m['par'] . ' à ' . date('H\hi', strtotime($m['quand'])) : '';
}

function verifier_version(array $doc, string $section, array $d, $actuel): void
{
    if (empty($d['forcer']) && (int) ($d['version_vue'] ?? -1) !== (int) $doc['versions'][$section]) {
        conflit($doc, $section, $actuel);
    }
}

/** Quelqu'un a modifié la même chose entre-temps : on n'écrase rien, on montre sa version. */
function conflit(array $doc, string $section, $actuel, string $cle = ''): void
{
    $m = derniere_modif($section, $cle);
    repondre(409, [
        'erreur' => 'conflit', 'section' => $section, 'actuel' => $actuel,
        'par' => $m['par'] ?? 'quelqu’un de l’équipe', 'quand' => $m['quand'] ?? null,
        'contenus' => $doc, 'journal' => array_slice(journal(), 0, 60), 'historique' => historique(),
    ]);
}

function succes(array $doc, string $info = ''): void
{
    repondre(200, ['ok' => true, 'info' => $info, 'contenus' => $doc, 'journal' => array_slice(journal(), 0, 60), 'historique' => historique(), 'reglages' => infos_reglages()]);
}

function infos_reglages(): array
{
    if (!interrupteur_disponible(config())) {
        return ['interrupteur' => false];
    }
    $c = config();
    $r = reglages();
    return ['interrupteur' => true, 'boites_reelles' => !empty($r['boites_reelles']), 'par' => $r['par'] ?? '', 'quand' => $r['quand'] ?? '',
        'limite' => (int) ($c['limite_jour'] ?? 0), 'expediteur' => (string) $c['expediteur']];
}

/** Ce qui a changé dans les horaires, en clair, pour l'historique. */
function resume_horaires(array $avant, array $apres): string
{
    $cle = fn(array $p): string => $p['type'] . '|' . $p['du'] . '|' . $p['au'];
    $jm = fn(string $d): string => substr($d, 8, 2) . '/' . substr($d, 5, 2);
    $jma = fn(string $d): string => $jm($d) . '/' . substr($d, 0, 4);
    $h = fn(string $t): string => (int) substr($t, 0, 2) . 'h' . (substr($t, 3, 2) === '00' ? '' : substr($t, 3, 2));
    $txt = fn(array $p): string => ($p['nom'] !== '' ? $p['nom'] . ', ' : '') . 'du ' . $jma($p['du']) . ' au ' . $jma($p['au']);
    $av = $ap = [];
    foreach ($avant['periodes'] ?? [] as $p) {
        $av[$cle($p)] = $p + ['nom' => ''];
    }
    foreach ($apres['periodes'] as $p) {
        $ap[$cle($p)] = $p;
    }
    $parts = [];
    foreach (array_diff_key($ap, $av) as $p) {
        $parts[] = 'période ajoutée : ' . $txt($p);
    }
    foreach (array_diff_key($av, $ap) as $p) {
        $parts[] = 'période retirée : ' . $txt($p);
    }
    foreach (array_diff($apres['fermetures'], $avant['fermetures'] ?? []) as $f) {
        $parts[] = 'fermeture ajoutée le ' . $jma($f);
    }
    foreach (array_diff($avant['fermetures'] ?? [], $apres['fermetures']) as $f) {
        $parts[] = 'fermeture retirée le ' . $jma($f);
    }
    foreach (['accueil' => 'accueil', 'traite' => 'traite'] as $k => $nom) {
        if (($avant[$k] ?? null) != $apres[$k]) {
            $parts[] = $nom . ' de ' . $h($apres[$k]['de']) . ' à ' . $h($apres[$k]['a']);
        }
    }
    return 'Horaires : ' . ($parts ? implode(' ; ', $parts) : 'aucun changement');
}

function valider_evenement($e): array
{
    if (!is_array($e)) {
        repondre(400, ['erreur' => 'Date illisible.']);
    }
    $v = [
        'date' => (string) ($e['date'] ?? ''),
        'heure' => (string) ($e['heure'] ?? ''),
        'titre' => texte($e['titre'] ?? '', 90),
        'texte' => texte($e['texte'] ?? '', 300),
        'lieu' => texte($e['lieu'] ?? '', 60),
        'prix' => texte($e['prix'] ?? '', 40),
    ];
    if (!date_valide($v['date'])) {
        repondre(400, ['erreur' => 'La date est incorrecte.']);
    }
    if ($v['heure'] !== '' && !heure_valide($v['heure'])) {
        repondre(400, ['erreur' => 'L’heure est incorrecte.']);
    }
    if ($v['titre'] === '') {
        repondre(400, ['erreur' => 'Donnez un titre à cette date.']);
    }
    return $v;
}

function valider_horaires($h): array
{
    if (!is_array($h)) {
        repondre(400, ['erreur' => 'Horaires illisibles.']);
    }
    $plages = [];
    foreach (['accueil' => 'd’accueil', 'traite' => 'de la traite'] as $k => $nom) {
        $de = $h[$k]['de'] ?? '';
        $a = $h[$k]['a'] ?? '';
        if (!heure_valide($de) || !heure_valide($a) || $de >= $a) {
            repondre(400, ['erreur' => "Les heures $nom sont incorrectes (l’heure de fin doit suivre l’heure de début)."]);
        }
        $plages[$k] = ['de' => $de, 'a' => $a];
    }
    $periodes = [];
    foreach (array_slice(is_array($h['periodes'] ?? null) ? $h['periodes'] : [], 0, 40) as $p) {
        $t = $p['type'] ?? '';
        $du = $p['du'] ?? '';
        $au = $p['au'] ?? '';
        if (!in_array($t, TYPES, true) || !date_valide($du) || !date_valide($au) || $du > $au) {
            repondre(400, ['erreur' => 'Une période est incorrecte : vérifiez son type et ses dates (le début doit précéder la fin).']);
        }
        $periodes[] = ['type' => $t, 'du' => $du, 'au' => $au, 'nom' => texte($p['nom'] ?? '', 30)];
    }
    if (!$periodes) {
        repondre(400, ['erreur' => 'Il faut au moins une période d’ouverture.']);
    }
    usort($periodes, fn($a, $b) => strcmp($a['du'], $b['du']));
    $fermetures = [];
    foreach (array_slice(is_array($h['fermetures'] ?? null) ? $h['fermetures'] : [], 0, 40) as $f) {
        if (!date_valide($f)) {
            repondre(400, ['erreur' => 'Une date de fermeture est incorrecte.']);
        }
        $fermetures[] = $f;
    }
    $fermetures = array_values(array_unique($fermetures));
    sort($fermetures);
    return $plages + ['periodes' => $periodes, 'fermetures' => $fermetures];
}


/** Enregistre un fichier envoyé en base64 : type reconnu à son contenu (pas à son nom), nom généré. */
function enregistrer_fichier(string $cle, $b64, array $types): array
{
    if (!is_string($b64) || $b64 === '') {
        repondre(400, ['erreur' => 'Aucun fichier reçu.']);
    }
    $bin = base64_decode($b64, true);
    if ($bin === false || $bin === '') {
        repondre(400, ['erreur' => 'Fichier illisible.']);
    }
    if (strlen($bin) > OCTETS_FICHIER) {
        repondre(413, ['erreur' => 'Ce fichier est trop lourd (5 Mo au maximum).']);
    }
    $ext = null;
    if (strncmp($bin, '%PDF-', 5) === 0) {
        $ext = 'pdf';
    } elseif (strncmp($bin, "\x89PNG\r\n\x1a\n", 8) === 0) {
        $ext = 'png';
    } elseif (strncmp($bin, "\xFF\xD8\xFF", 3) === 0) {
        $ext = 'jpg';
    } elseif (strncmp($bin, 'RIFF', 4) === 0 && substr($bin, 8, 4) === 'WEBP') {
        $ext = 'webp';
    }
    if ($ext === null || !in_array($ext, $types, true)) {
        repondre(400, ['erreur' => 'Format non accepté ici. Formats possibles : ' . strtoupper(implode(', ', $types)) . '.']);
    }
    if ($ext !== 'pdf' && @getimagesizefromstring($bin) === false) {
        repondre(400, ['erreur' => 'Cette image est illisible.']);
    }
    $dossier = dirname(FICHIER_CONTENUS) . '/docs';
    if (!is_dir($dossier) && !mkdir($dossier, 0755, true) && !is_dir($dossier)) {
        repondre(500, ['erreur' => 'Impossible de créer le dossier des documents. Prévenez Primo.']);
    }
    $slug = preg_replace('/[^a-z0-9-]/', '', strtolower($cle));
    $nom = $slug . '-' . date('Ymd') . '-' . bin2hex(random_bytes(3)) . '.' . $ext;
    if (file_put_contents($dossier . '/' . $nom, $bin, LOCK_EX) === false) {
        repondre(500, ['erreur' => 'Le fichier n’a pas pu être enregistré. Prévenez Primo.']);
    }
    @chmod($dossier . '/' . $nom, 0644);
    // On garde les 5 versions les plus récentes de cet emplacement (la restauration de l'historique peut en avoir besoin).
    $anciens = array_filter(glob($dossier . '/' . $slug . '-[0-9]*-*.*') ?: [], fn($f) => basename($f) !== $nom);
    usort($anciens, fn($a, $b) => filemtime($b) <=> filemtime($a) ?: strcmp($b, $a));
    foreach (array_slice($anciens, 4) as $f) {   // le nouveau + les 4 plus récents
        @unlink($f);
    }
    return ['fichier' => 'data/docs/' . $nom, 'ext' => $ext, 'taille' => strlen($bin)];
}

function lien_valide(string $u): bool
{
    return $u !== '' && strlen($u) <= 300 && preg_match('#^https?://[^\s<>"\']+$#i', $u) === 1 && filter_var($u, FILTER_VALIDATE_URL) !== false;
}

function valider_actualite(array $d): array
{
    $titre = texte($d['titre'] ?? '', 100);
    if ($titre === '') {
        repondre(400, ['erreur' => 'Donnez un titre à cette actualité.']);
    }
    $date = (string) ($d['date'] ?? '');
    if ($date === '') {
        $date = date('Y-m-d');
    }
    if (!date_valide($date)) {
        repondre(400, ['erreur' => 'La date est incorrecte.']);
    }
    $lien = texte($d['lien'] ?? '', 300);
    if ($lien !== '' && !lien_valide($lien)) {
        repondre(400, ['erreur' => 'Le lien doit commencer par https:// (copiez-le depuis la barre d’adresse).']);
    }
    $id = texte($d['id'] ?? '', 20);
    return [
        'id' => $id !== '' ? $id : 'a' . bin2hex(random_bytes(4)),
        'titre' => $titre,
        'date' => $date,
        'texte' => texte($d['texte'] ?? '', 1500, true),
        'lien' => $lien,
        'lien_texte' => $lien === '' ? '' : (texte($d['lien_texte'] ?? '', 40) ?: 'En savoir plus'),
    ];
}

function lignes_texte($v, int $max_lignes, int $max_car): array
{
    $sortie = [];
    foreach (is_array($v) ? $v : [] as $l) {
        $s = texte($l, $max_car);
        if ($s !== '') {
            $sortie[] = $s;
        }
    }
    return array_slice($sortie, 0, $max_lignes);
}

function valider_offre(array $d): array
{
    $titre = texte($d['titre'] ?? '', 100);
    if ($titre === '') {
        repondre(400, ['erreur' => 'Donnez un titre à cette offre.']);
    }
    $contact = texte($d['contact'] ?? '', 120);
    if (!adresse_valide($contact)) {
        repondre(400, ['erreur' => 'Indiquez l’adresse e-mail où envoyer les candidatures.']);
    }
    $jusqu = (string) ($d['jusqu_au'] ?? '');
    if ($jusqu !== '' && !date_valide($jusqu)) {
        repondre(400, ['erreur' => 'La date de fin de l’offre est incorrecte.']);
    }
    $details = [];
    foreach (is_array($d['details'] ?? null) ? $d['details'] : [] as $l) {
        $label = texte($l['label'] ?? '', 40);
        $valeur = texte($l['valeur'] ?? '', 300);
        if ($label !== '' && $valeur !== '') {
            $details[] = ['label' => $label, 'valeur' => $valeur];
        }
    }
    $id = texte($d['id'] ?? '', 20);
    return [
        'id' => $id !== '' ? $id : 'o' . bin2hex(random_bytes(4)),
        'titre' => $titre,
        'intro' => texte($d['intro'] ?? '', 600, true),
        'missions' => lignes_texte($d['missions'] ?? [], 8, 220),
        'details' => array_slice($details, 0, 12),
        'contact' => $contact,
        'objet' => texte($d['objet'] ?? '', 100),
        'jusqu_au' => $jusqu,
    ];
}

function valider_infos_sejour(array $d): array
{
    $prix = texte($d['prix'] ?? '', 20);
    if ($prix === '') {
        repondre(400, ['erreur' => 'Indiquez le prix du séjour (ex. : 420 €).']);
    }
    $semaines = [];
    foreach (is_array($d['semaines'] ?? null) ? $d['semaines'] : [] as $s) {
        $du = (string) ($s['du'] ?? '');
        $au = (string) ($s['au'] ?? '');
        if (!date_valide($du) || !date_valide($au) || $du > $au) {
            repondre(400, ['erreur' => 'Une des dates est incorrecte : la fin doit suivre le début.']);
        }
        $semaines[] = ['du' => $du, 'au' => $au];
    }
    if (count($semaines) > 8) {
        repondre(400, ['erreur' => '8 sessions au maximum.']);
    }
    usort($semaines, fn($a, $b) => strcmp($a['du'], $b['du']));
    return ['prix' => $prix, 'semaines' => $semaines];
}

function prix_pain($v): string
{
    $s = trim(str_replace(['€', ' ', "\u{00A0}"], '', (string) $v));
    if ($s === '' || $s === '-' || $s === '—') {
        return '';
    }
    if (preg_match('/^\d{1,3}([.,]\d{1,2})?$/', $s) !== 1) {
        repondre(400, ['erreur' => 'Un prix n’est pas valide : écrivez par exemple 5,10.']);
    }
    $n = (float) str_replace(',', '.', $s);
    return number_format($n, 2, ',', '');
}

function valider_pain($p): array
{
    if (!is_array($p) || !is_array($p['lignes'] ?? null)) {
        repondre(400, ['erreur' => 'Prix illisibles.']);
    }
    $lignes = [];
    foreach ($p['lignes'] as $l) {
        $nom = texte($l['nom'] ?? '', 40);
        if ($nom === '') {
            repondre(400, ['erreur' => 'Chaque pain doit avoir un nom.']);
        }
        $lignes[] = ['nom' => $nom, 'note' => texte($l['note'] ?? '', 40),
            'kg_j' => prix_pain($l['kg_j'] ?? ''), 'kg_s' => prix_pain($l['kg_s'] ?? ''),
            'd_j' => prix_pain($l['d_j'] ?? ''), 'd_s' => prix_pain($l['d_s'] ?? '')];
    }
    if (!$lignes || count($lignes) > 12) {
        repondre(400, ['erreur' => 'Entre 1 et 12 pains.']);
    }
    return ['lignes' => $lignes, 'brioche_j' => prix_pain($p['brioche_j'] ?? ''), 'brioche_s' => prix_pain($p['brioche_s'] ?? '')];
}


function id_bloc_valide(string $id): bool
{
    return preg_match('/^([a-z]{3,12})\.([0-9]{1,4})$/', $id, $m) === 1 && isset(PAGES_SITE[$m[1]]);
}

function nom_page(string $id): string
{
    return PAGES_SITE[explode('.', $id)[0]] ?? $id;
}

function extrait_texte(string $h): string
{
    $s = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags(str_replace('<br>', ' ', $h)), ENT_QUOTES, 'UTF-8')) ?? '');
    return mb_strlen($s) > 70 ? mb_substr($s, 0, 70) . '…' : $s;
}

function lien_autorise(string $u): bool
{
    return preg_match('~^(https?://[^\s"\'<>]{3,300}|mailto:[^\s"\'<>]{3,200}|tel:\+?[0-9 ]{6,20}|[a-z0-9._-]+\.html(#[a-z0-9_-]+)?|#[a-z0-9_-]+|data/docs/[A-Za-z0-9._-]+)$~', $u) === 1;
}

/** Ne garde que gras, italique, retours à la ligne, liens sûrs et les petites balises de prix/horaires reliées au site. Tout le reste devient du texte simple. */
function nettoyer_html(string $h): string
{
    $h = trim(str_replace(["\r\n", "\r"], "\n", $h));
    if ($h === '' || strlen($h) > 8000) {
        return '';
    }
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8"?><body><div id="r">' . $h . '</div></body>', LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    $racine = $dom->getElementById('r');
    if (!$racine) {
        return '';
    }
    $s = enfants_propres($racine);
    $s = preg_replace('/[ \t\n]+/u', ' ', $s) ?? '';
    $s = preg_replace('/(<br>\s*){3,}/', '<br><br>', $s) ?? '';
    $s = trim(preg_replace('/^(\s|<br>)+|(\s|<br>)+$/', '', $s) ?? '');
    return strlen(strip_tags($s)) === 0 ? '' : $s;
}

function enfants_propres(DOMNode $n): string
{
    $s = '';
    foreach ($n->childNodes as $c) {
        if ($c instanceof DOMText) {
            $s .= htmlspecialchars(str_replace("\u{00A0}", ' ', $c->nodeValue), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        } elseif ($c instanceof DOMElement) {
            $s .= balise_propre($c);
        }
    }
    return $s;
}

function classe_propre(DOMElement $e): string
{
    $c = trim($e->getAttribute('class'));
    return $c !== '' && preg_match('/^[A-Za-z0-9_ -]{1,60}$/', $c) === 1 ? ' class="' . $c . '"' : '';
}

function balise_propre(DOMElement $e): string
{
    $t = strtolower($e->nodeName);
    if (in_array($t, ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'form', 'input', 'textarea', 'select', 'button'], true)) {
        return '';
    }
    $dedans = enfants_propres($e);
    switch ($t) {
        case 'b':
        case 'strong':
            return $dedans === '' ? '' : '<b' . classe_propre($e) . '>' . $dedans . '</b>';
        case 'small':
            return $dedans === '' ? '' : '<small' . classe_propre($e) . '>' . $dedans . '</small>';
        case 'i':
        case 'em':
            return $dedans === '' ? '' : '<i' . classe_propre($e) . '>' . $dedans . '</i>';
        case 'br':
            return '<br>';
        case 'a':
            $href = trim($e->getAttribute('href'));
            if (!lien_autorise($href) || $dedans === '') {
                return $dedans;
            }
            $doc = $e->getAttribute('data-doc');
            return '<a href="' . htmlspecialchars($href, ENT_QUOTES) . '" rel="noopener"' . classe_propre($e) . (preg_match('/^[a-z0-9-]{2,40}$/', $doc) === 1 ? ' data-doc="' . $doc . '"' : '') . '>' . $dedans . '</a>';
        case 'span':
            foreach (BALISES_DATA as $a) {
                $v = $e->getAttribute($a);
                if ($e->hasAttribute($a) && preg_match('/^[A-Za-z0-9._:-]{1,60}$/', $v) === 1) {
                    return '<span ' . $a . '="' . $v . '"' . classe_propre($e) . '>' . $dedans . '</span>';
                }
            }
            return $e->getAttribute('class') !== '' ? '<span' . classe_propre($e) . '>' . $dedans . '</span>' : $dedans;
        case 'div':
        case 'p':
            return $dedans . ($e->nextSibling ? '<br>' : '');
        default:
            return $dedans;
    }
}
