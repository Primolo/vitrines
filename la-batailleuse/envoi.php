<?php
declare(strict_types=1);
// Réception des formulaires du site : chaque demande part dans la boîte de l'équipe concernée,
// et le demandeur reçoit un accusé de réception. Le destinataire est fixé ici (prive/config.php),
// jamais par le navigateur : le formulaire ne peut pas servir à écrire à n'importe qui.
require __DIR__ . '/prive/commun.php';

exiger_post();
$c = config();
$d = corps_json(40000);

$formulaire = texte($d['formulaire'] ?? '', 60);
$route = $c['routes'][$formulaire] ?? null;
if ($route === null) {
    repondre(400, ['erreur' => 'Formulaire inconnu.']);
}

// Envoi de test de la veille hebdomadaire : jeton secret obligatoire, part vers l'adresse de test uniquement.
$test = is_string($d['test'] ?? null) && $c['jeton_test'] !== '' && hash_equals($c['jeton_test'], $d['test']);

if (!$test) {
    // Pièges à robots : champ invisible rempli, ou formulaire envoyé en moins de 3 secondes. On répond « ok » sans rien envoyer.
    if (texte($d['site_web'] ?? '', 200) !== '' || (int) ($d['duree_ms'] ?? 0) < 3000) {
        repondre(200, ['ok' => true]);
    }
    if (!limiter('envoi:' . ip(), 6, 600)) {
        repondre(429, ['erreur' => 'Trop de demandes envoyées depuis cette connexion. Réessayez dans quelques minutes, ou écrivez-nous directement.']);
    }
}

$lignes = [];
foreach (array_slice(is_array($d['lignes'] ?? null) ? $d['lignes'] : [], 0, 60) as $l) {
    $libelle = texte($l['libelle'] ?? '', 80);
    $valeur = texte($l['valeur'] ?? '', 2000, true);
    if ($libelle !== '' && $valeur !== '') {
        $lignes[] = [$libelle, $valeur];
    }
}
if (!$lignes) {
    repondre(400, ['erreur' => 'Demande vide.']);
}

if (is_array($route)) {
    $choix = texte($d['aiguillage'] ?? '', 40);
    $destinataire = $route['valeurs'][$choix] ?? $route['defaut'];
} else {
    $destinataire = $route;
}
$email = texte($d['email'] ?? '', 200);
$email = adresse_valide($email) ? $email : null;
$titre = texte($d['titre'] ?? '', 120) ?: 'Demande depuis le site';
$objet = texte($d['objet'] ?? '', 150) ?: $titre;
$pages = ['ecoles' => 'Écoles et groupes', 'colos' => 'Colos', 'chalet' => 'Le chalet', 'visiter' => 'Venir à la ferme', 'collectif' => 'La ferme', 'contact' => 'Contact'];
$page = $pages[explode('/', $formulaire)[0]] ?? explode('/', $formulaire)[0];

// Démonstration : tout part vers une seule boîte (rediriger_vers), avec la boîte qui l'aurait reçu en service réel.
$prevu = $destinataire;
$demo = ($c['rediriger_vers'] ?? '') !== '';
if ($demo && ($c['resend_cle'] ?? '') === '') {
    repondre(503, ['erreur' => 'Démonstration : l’envoi des emails n’est pas encore activé sur ce site (clé d’envoi manquante). Rien n’est parti.', 'demo' => true]);
}
// Plafond quotidien pour tout le site (quota d'envoi partagé) ; 0 = sans plafond, le cas chez IONOS.
$limite = (int) ($c['limite_jour'] ?? 0);
if (!$test && $limite > 0 && !limiter('envoi:tous', $limite, 86400)) {
    repondre(429, [
        'erreur' => $demo ? 'La démonstration a atteint son nombre d’envois pour aujourd’hui. Réessayez demain.' : 'Le site a reçu beaucoup de demandes aujourd’hui.',
        'destinataire' => $demo ? null : $prevu, 'demo' => $demo,
    ]);
}
if ($test) {
    $destinataire = $c['adresse_test'];
    $objet = '[TEST de la veille] ' . $objet;
} elseif ($demo) {
    $destinataire = $c['rediriger_vers'];
    $objet = '[Démo] ' . $objet;
}

$ok = envoyer_mail($destinataire, $objet, mail_equipe($titre, $page, $lignes, $email, $test, $demo ? $prevu : null), texte_equipe($titre, $lignes, $email), $email);
if (!$ok) {
    repondre(502, ['erreur' => "L'envoi a échoué : votre demande n'est pas partie.", 'destinataire' => $demo ? null : $prevu, 'demo' => $demo]);
}
if (!$test && $email !== null) {
    if ($demo) {
        envoyer_mail($destinataire, '[Démo] Copie de l’accusé envoyé à ' . $email, mail_accuse($titre, $lignes, $c['contacts'], $email), texte_accuse($titre, $lignes, $c['contacts']), null); // pas de « Répondre » vers la vraie boîte de la ferme
    } else {
        envoyer_mail($email, 'Votre demande à la Batailleuse est bien arrivée', mail_accuse($titre, $lignes, $c['contacts']), texte_accuse($titre, $lignes, $c['contacts']), $destinataire);
    }
}
// Journal minimal, sans donnée personnelle : quand, quel formulaire, quelle boîte.
@file_put_contents(DOSSIER_ETAT . '/envois.log', date('c') . "\t$formulaire\t$prevu" . ($test ? "\ttest" : '') . ($demo ? "\tdemo" : '') . "\n", FILE_APPEND | LOCK_EX);
repondre(200, ['ok' => true, 'destinataire' => $prevu, 'test' => $test, 'demo' => $demo && !$test]);


function tableau_html(array $lignes): string
{
    $html = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;line-height:1.45;font-family:Arial,Helvetica,sans-serif">';
    foreach ($lignes as [$l, $v]) {
        $html .= '<tr><td style="padding:9px 14px 9px 0;border-bottom:1px solid #EDE4D3;color:#6B6155;width:38%;vertical-align:top">' . h($l)
            . '</td><td style="padding:9px 0;border-bottom:1px solid #EDE4D3;vertical-align:top;color:#211C17">' . nl2br(h($v)) . '</td></tr>';
    }
    return $html . '</table>';
}

function cadre(string $bandeau, string $contenu, string $pied): string
{
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>'
        . '<body style="margin:0;background:#F5EFE3;font-family:Arial,Helvetica,sans-serif;color:#211C17">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE3;padding:24px 10px;font-family:Arial,Helvetica,sans-serif;color:#211C17"><tr><td align="center" style="font-family:Arial,Helvetica,sans-serif">'
        . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFDF8;border:1px solid #D8CCB6;border-radius:10px;font-family:Arial,Helvetica,sans-serif">'
        . '<tr><td style="background:#143321;color:#F1DDB4;padding:16px 24px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-radius:10px 10px 0 0">' . $bandeau . '</td></tr>'
        . $contenu
        . '<tr><td style="padding:14px 24px;background:#EDE4D3;color:#6B6155;font-size:12px;line-height:1.5;border-radius:0 0 10px 10px">' . $pied . '</td></tr>'
        . '</table></td></tr></table></body></html>';
}

function bandeau_demo(string $texte): string
{
    return '<p style="margin:0 0 14px;padding:10px 12px;background:#F1DDB4;border-radius:6px;font-size:13px;line-height:1.45;color:#4A3309">' . $texte . '</p>';
}

function mail_equipe(string $titre, string $page, array $lignes, ?string $email, bool $test, ?string $prevu = null): string
{
    $reponse = $email !== null
        ? 'Pour répondre, faites simplement <b>« Répondre »</b> : votre message partira à <b>' . h($email) . '</b>.'
        : "Le demandeur n'a pas laissé d'adresse email : utilisez le téléphone indiqué ci-dessous.";
    $contenu = '<tr><td style="padding:24px 24px 6px">'
        . ($test ? bandeau_demo('<b>Envoi de test</b> de la veille hebdomadaire : le formulaire fonctionne.') : '')
        . ($prevu !== null ? bandeau_demo('<b>Démonstration.</b> Sur le site en service, cette demande arriverait directement dans la boîte <b>' . h($prevu) . '</b>.') : '')
        . '<h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px;font-weight:normal;color:#7A1F1F">' . h($titre) . '</h1>'
        . '<p style="margin:0;color:#4F463C;font-size:14px;line-height:1.5">Reçue le ' . date('d/m/Y') . ' à ' . date('H\hi') . '. ' . $reponse . '</p></td></tr>'
        . '<tr><td style="padding:14px 24px 24px">' . tableau_html($lignes) . '</td></tr>';
    $pied = 'Envoyé par le formulaire « ' . h($titre) . ' » de la page « ' . h($page) . ' » du site claj-batailleuse.fr.'
        . ($email !== null ? ' Le demandeur a reçu un accusé de réception.' : '');
    return cadre('Nouvelle demande · site de la Batailleuse', $contenu, $pied);
}

function texte_equipe(string $titre, array $lignes, ?string $email): string
{
    $t = "$titre\nReçue le " . date('d/m/Y à H\hi') . "\n"
        . ($email !== null ? "Pour répondre : « Répondre » (vers $email)\n" : "Pas d'adresse email : utilisez le téléphone indiqué.\n") . "\n";
    foreach ($lignes as [$l, $v]) {
        $t .= "$l : $v\n";
    }
    return $t;
}

function mail_accuse(string $titre, array $lignes, string $contacts, ?string $copie_de = null): string
{
    $contenu = '<tr><td style="padding:24px 24px 6px">'
        . ($copie_de !== null ? bandeau_demo('<b>Copie de démonstration.</b> Sur le site en service, cet accusé de réception partirait à <b>' . h($copie_de) . '</b>, la personne qui a rempli le formulaire.') : '')
        . '<h1 style="margin:0 0 10px;font-family:Georgia,serif;font-size:22px;font-weight:normal;color:#1F4A2E">Votre demande est bien arrivée</h1>'
        . '<p style="margin:0 0 10px;color:#4F463C;font-size:15px;line-height:1.55">Bonjour,<br>merci pour votre message. Il est arrivé directement à la bonne personne de l’équipe de la Batailleuse, qui vous répondra dès que possible.</p>'
        . '<p style="margin:0;color:#4F463C;font-size:15px;line-height:1.55">Pour compléter votre demande, répondez simplement à cet email. Pour rappel, voici ce que vous nous avez envoyé :</p></td></tr>'
        . '<tr><td style="padding:14px 24px 24px">' . tableau_html($lignes) . '</td></tr>';
    return cadre('La Batailleuse · Rochejean', $contenu, h($contacts));
}

function texte_accuse(string $titre, array $lignes, string $contacts): string
{
    $t = "Bonjour,\nmerci pour votre message. Il est arrivé directement à la bonne personne de l'équipe de la Batailleuse, qui vous répondra dès que possible.\nPour compléter votre demande, répondez simplement à cet email.\n\nVotre demande : $titre\n";
    foreach ($lignes as [$l, $v]) {
        $t .= "$l : $v\n";
    }
    return $t . "\n$contacts\n";
}
