<?php
declare(strict_types=1);
// Espace équipe : l'équipe met à jour elle-même le message du jour, l'agenda, le statut des séjours
// et les horaires. Chaque action est une petite opération appliquée sous verrou sur data/contenus.json :
// deux personnes qui travaillent en même temps ne s'écrasent jamais sans le savoir (voir conflit()).
require __DIR__ . '/../prive/commun.php';

exiger_post();
$c = config();
$d = corps_json(200000);
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
$prenom = texte(rawurldecode((string) ($_SERVER['HTTP_X_PRENOM'] ?? '')), 30);
if ($prenom === '') {
    repondre(400, ['erreur' => 'Indiquez votre prénom : il apparaît dans l’historique des modifications.']);
}

const STATUTS = ['a-venir' => 'inscriptions bientôt', 'ouvert' => 'inscriptions ouvertes', 'dernieres' => 'dernières places', 'complet' => 'complet', 'termine' => 'terminé'];
const TYPES = ['haute', 'moyenne', 'basse'];

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
            $doc['horaires'] = $h;
            succes(enregistrer($doc, 'horaires', 'Horaires modifiés (' . count($h['periodes']) . ' périodes, ' . count($h['fermetures']) . ' fermetures)', $prenom));
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
    $doc['versions'] = ($doc['versions'] ?? []) + ['message' => 0, 'agenda' => 0, 'horaires' => 0, 'sejours' => 0];
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
    return array_map('basename', array_slice($fichiers, 0, 20));
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
        'contenus' => $doc, 'journal' => array_slice(journal(), 0, 20), 'historique' => historique(),
    ]);
}

function succes(array $doc, string $info = ''): void
{
    repondre(200, ['ok' => true, 'info' => $info, 'contenus' => $doc, 'journal' => array_slice(journal(), 0, 20), 'historique' => historique(), 'reglages' => infos_reglages()]);
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
