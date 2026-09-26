<?php
declare(strict_types=1);
// Fonctions communes à envoi.php (formulaires) et equipe/api.php (espace équipe).
// Ce dossier est interdit d'accès depuis le web (.htaccess) : rien ici n'est servi aux visiteurs.

date_default_timezone_set('Europe/Paris');
mb_internal_encoding('UTF-8');

const DOSSIER_PRIVE = __DIR__;
const FICHIER_CONTENUS = __DIR__ . '/../data/contenus.json';
// Journal, historique, verrous, limites : dans prive/ chez IONOS, sur le disque persistant ailleurs (variable DOSSIER_ETAT).
define('DOSSIER_ETAT', rtrim(getenv('DOSSIER_ETAT') ?: __DIR__, '/'));

function config(): array
{
    static $c = null;
    if ($c === null) {
        $f = DOSSIER_PRIVE . '/config.php';
        if (!is_file($f)) {
            repondre(500, ['erreur' => 'Configuration absente : copier prive/config.exemple.php en prive/config.php.']);
        }
        $c = require $f;
    }
    return $c;
}

function repondre(int $code, array $donnees): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function exiger_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        repondre(405, ['erreur' => 'Méthode non autorisée.']);
    }
}

function corps_json(int $max): array
{
    $brut = file_get_contents('php://input', false, null, 0, $max + 1);
    if ($brut === false || strlen($brut) > $max) {
        repondre(413, ['erreur' => 'Demande trop volumineuse.']);
    }
    $d = json_decode($brut, true);
    if (!is_array($d)) {
        repondre(400, ['erreur' => 'Demande illisible.']);
    }
    return $d;
}

function ip(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'inconnue');
    // Derrière le proxy de Railway : il écrit lui-même X-Real-IP (le visiteur ne peut pas le falsifier, vérifié le 26/09/2026).
    if (getenv('DERRIERE_PROXY')) {
        $reel = trim((string) ($_SERVER['HTTP_X_REAL_IP'] ?? ''));
        if ($reel === '' && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $reel = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        }
        if ($reel !== '') {
            $ip = $reel;
        }
    }
    return substr($ip, 0, 45);
}

/** Texte nettoyé : caractères de contrôle retirés, longueur bornée, une seule ligne sauf demande contraire. */
function texte($v, int $max, bool $multiligne = false): string
{
    $s = is_scalar($v) ? (string) $v : '';
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s) ?? '';
    $s = $multiligne ? str_replace("\r\n", "\n", $s) : (preg_replace('/\s+/u', ' ', $s) ?? '');
    return mb_substr(trim($s), 0, $max);
}

function date_valide($s): bool
{
    return is_string($s) && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

function heure_valide($s): bool
{
    return is_string($s) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $s) === 1;
}

function adresse_valide($e): bool
{
    return is_string($e) && !preg_match('/[\r\n]/', $e) && filter_var($e, FILTER_VALIDATE_EMAIL) !== false;
}

function lire_json(string $f, $defaut)
{
    if (!is_file($f)) {
        return $defaut;
    }
    $d = json_decode((string) file_get_contents($f), true);
    return is_array($d) ? $d : $defaut;
}

/** Écriture atomique : fichier temporaire puis renommage, jamais de fichier à moitié écrit. */
function ecrire_json(string $f, array $d): void
{
    $tmp = $f . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false || file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !rename($tmp, $f)) {
        @unlink($tmp);
        repondre(500, ['erreur' => "Écriture impossible sur le serveur. Rien n'a été modifié."]);
    }
}

/** Verrou exclusif : deux enregistrements simultanés passent l'un après l'autre, jamais en même temps. */
function avec_verrou(string $nom, callable $f)
{
    $h = fopen(DOSSIER_ETAT . '/' . $nom . '.lock', 'c');
    if ($h === false || !flock($h, LOCK_EX)) {
        repondre(503, ['erreur' => 'Serveur occupé, réessayez dans un instant.']);
    }
    try {
        return $f();
    } finally {
        flock($h, LOCK_UN);
        fclose($h);
    }
}

/** Au plus $max événements par clé sur $fenetre secondes. $compter = false : vérifie sans compter. */
function limiter(string $cle, int $max, int $fenetre, bool $compter = true): bool
{
    return avec_verrou('limites', function () use ($cle, $max, $fenetre, $compter) {
        $f = DOSSIER_ETAT . '/limites.json';
        $t = time();
        $d = lire_json($f, []);
        foreach ($d as $k => $liste) {
            $d[$k] = array_values(array_filter((array) $liste, fn($x) => $x > $t - 86400));
            if (!$d[$k]) {
                unset($d[$k]);
            }
        }
        $recents = array_filter($d[$cle] ?? [], fn($x) => $x > $t - $fenetre);
        $libre = count($recents) < $max;
        if ($libre && $compter) {
            $d[$cle][] = $t;
        }
        ecrire_json($f, $d);
        return $libre;
    });
}

function entete_mime(string $s): string
{
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

/** Email texte + HTML, envoyé par la messagerie de l'hébergement (IONOS), depuis l'adresse du site. */
function envoyer_mail(string $a, string $objet, string $html, string $texte, ?string $repondre_a = null): bool
{
    $c = config();
    if (($c['resend_cle'] ?? '') !== '') {
        return envoyer_par_resend($c, $a, $objet, $html, $texte, $repondre_a);
    }
    $de = $c['expediteur'];
    $frontiere = 'bata-' . bin2hex(random_bytes(8));
    $entetes = [
        'From: ' . entete_mime($c['nom_expediteur']) . ' <' . $de . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $frontiere . '"',
        'X-Mailer: site-la-batailleuse',
    ];
    if ($repondre_a !== null && adresse_valide($repondre_a)) {
        $entetes[] = 'Reply-To: ' . $repondre_a;
    }
    $corps = "--$frontiere\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($texte))
        . "--$frontiere\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($html))
        . "--$frontiere--\r\n";
    return mail($a, entete_mime(texte($objet, 180)), $corps, implode("\r\n", $entetes), '-f' . $de);
}

/** Hébergeurs sans SMTP (Railway) : envoi par l'API HTTP de Resend. */
function envoyer_par_resend(array $c, string $a, string $objet, string $html, string $texte, ?string $repondre_a): bool
{
    $corps = [
        'from' => $c['nom_expediteur'] . ' <' . $c['expediteur'] . '>',
        'to' => [$a],
        'subject' => texte($objet, 180),
        'html' => $html,
        'text' => $texte,
    ];
    if ($repondre_a !== null && adresse_valide($repondre_a)) {
        $corps['reply_to'] = $repondre_a;
    }
    $ch = curl_init(getenv('RESEND_URL') ?: 'https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $c['resend_cle'], 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($corps, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $reponse = curl_exec($ch);
    $statut = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($statut < 200 || $statut >= 300) {
        error_log('Envoi Resend refusé (' . $statut . ') : ' . substr((string) $reponse, 0, 300));
        return false;
    }
    return true;
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
