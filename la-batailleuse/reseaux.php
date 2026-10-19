<?php
declare(strict_types=1);
// Publications Facebook et Instagram de la ferme, reprises toutes seules dans « Des nouvelles de la ferme ».
// Le navigateur du visiteur ne contacte jamais Meta : ce fichier lit les publications avec le jeton de la page
// (prive/config.php, rubrique « reseaux »), les garde en cache une heure, et copie les photos sur le site.
// Sans jeton configuré, il répond simplement « aucune publication » : le site marche comme avant.
require __DIR__ . '/prive/commun.php';

const RESEAUX_DOSSIER_PHOTOS = __DIR__ . '/data/reseaux';
const RESEAUX_MAX_PAR_SOURCE = 8;
const RESEAUX_HOTES_PHOTOS = '/^https:\/\/[a-z0-9.-]*(fbcdn\.net|cdninstagram\.com|facebook\.com)\//i';
const RESEAUX_LIENS = '/^https:\/\/(www\.|m\.)?(facebook\.com|instagram\.com)\//i';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    repondre(405, ['erreur' => 'Méthode non autorisée.']);
}

$reglages = (config()['reseaux'] ?? []);
$actif = !empty($reglages['page_token']) && (!empty($reglages['page_id']) || !empty($reglages['instagram_id']));
$fichier = DOSSIER_ETAT . '/reseaux.json';
$cache = lire_json($fichier, ['maj' => 0, 'posts' => [], 'erreur' => '']);
$ttl = (int) ($reglages['duree_cache'] ?? 3600);
$perime = $actif && (time() - (int) ($cache['maj'] ?? 0)) >= $ttl;

if (isset($_GET['etat'])) {
    // Pour l'espace équipe et la veille : l'état du lien avec Meta, sans jamais montrer le jeton.
    repondre(200, ['actif' => $actif, 'maj' => (int) ($cache['maj'] ?? 0), 'nombre' => count($cache['posts'] ?? []), 'erreur' => (string) ($cache['erreur'] ?? '')]);
}

// Première fois : on attend la lecture ; ensuite on répond tout de suite avec le cache et on rafraîchit après.
if ($perime && (int) ($cache['maj'] ?? 0) === 0) {
    $cache = reseaux_rafraichir($reglages, $cache, $fichier);
    $perime = false;
}
$sortie = json_encode(['posts' => array_values($cache['posts'] ?? [])], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('Content-Length: ' . strlen((string) $sortie));
echo $sortie;
if ($perime) {
    ignore_user_abort(true);
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        flush();
    }
    reseaux_rafraichir($reglages, $cache, $fichier);
}
exit;

/** Lit Meta, copie les photos, écrit le cache. Une seule lecture à la fois ; en cas d'échec on garde l'ancien cache et on réessaie dans 5 minutes. */
function reseaux_rafraichir(array $r, array $ancien, string $fichier): array
{
    $h = fopen(DOSSIER_ETAT . '/reseaux.lock', 'c');
    if ($h === false || !flock($h, LOCK_EX | LOCK_NB)) {
        return $ancien;
    }
    $api = rtrim((string) ($r['api'] ?? 'https://graph.facebook.com/v21.0'), '/');
    $jeton = (string) $r['page_token'];
    $posts = [];
    $erreur = '';
    try {
        if (!empty($r['page_id'])) {
            $j = reseaux_appel($api . '/' . rawurlencode((string) $r['page_id']) . '/posts?fields=id,message,created_time,permalink_url,full_picture&limit=12&access_token=' . rawurlencode($jeton));
            foreach (($j['data'] ?? []) as $p) {
                $posts[] = ['source' => 'facebook', 'id' => (string) ($p['id'] ?? ''), 'date' => (string) ($p['created_time'] ?? ''),
                    'texte' => (string) ($p['message'] ?? ''), 'image' => (string) ($p['full_picture'] ?? ''), 'lien' => (string) ($p['permalink_url'] ?? '')];
            }
        }
        if (!empty($r['instagram_id'])) {
            $j = reseaux_appel($api . '/' . rawurlencode((string) $r['instagram_id']) . '/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=12&access_token=' . rawurlencode($jeton));
            foreach (($j['data'] ?? []) as $p) {
                $image = ($p['media_type'] ?? '') === 'VIDEO' ? ($p['thumbnail_url'] ?? '') : ($p['media_url'] ?? '');
                $posts[] = ['source' => 'instagram', 'id' => (string) ($p['id'] ?? ''), 'date' => (string) ($p['timestamp'] ?? ''),
                    'texte' => (string) ($p['caption'] ?? ''), 'image' => (string) $image, 'lien' => (string) ($p['permalink'] ?? '')];
            }
        }
    } catch (Throwable $e) {
        $erreur = substr(str_replace($jeton, '***', $e->getMessage()), 0, 200);
    }
    if ($erreur !== '') {
        $ancien['erreur'] = $erreur;
        $ancien['maj'] = time() - (int) ($r['duree_cache'] ?? 3600) + 300;
        ecrire_json($fichier, $ancien);
        flock($h, LOCK_UN);
        return $ancien;
    }

    $propres = [];
    $vus = [];
    usort($posts, fn($a, $b) => strcmp($b['date'], $a['date']));
    $compte = ['facebook' => 0, 'instagram' => 0];
    foreach ($posts as $p) {
        $texte = trim(preg_replace('/[ \t]+/u', ' ', preg_replace('/\r\n?/', "\n", $p['texte'])) ?? '');
        $texte = trim(preg_replace('/\n{3,}/', "\n\n", $texte) ?? '');
        $ts = strtotime($p['date']);
        if ($ts === false || !preg_match(RESEAUX_LIENS, $p['lien']) || ($texte === '' && $p['image'] === '')) {
            continue;
        }
        // Une publication reprise sur les deux réseaux ne s'affiche qu'une fois.
        $cle = mb_strtolower(mb_substr(preg_replace('/\s+/u', ' ', $texte) ?? '', 0, 80));
        if ($cle !== '' && isset($vus[$cle])) {
            continue;
        }
        if ($compte[$p['source']] >= RESEAUX_MAX_PAR_SOURCE) {
            continue;
        }
        $vus[$cle] = true;
        $compte[$p['source']]++;
        $photo = $p['image'] !== '' ? reseaux_photo($p['source'] . '-' . $p['id'], $p['image'], $r) : '';
        $propres[] = ['source' => $p['source'], 'date' => date('Y-m-d', $ts), 'texte' => mb_substr($texte, 0, 700),
            'image' => $photo, 'lien' => $p['lien']];
    }
    // Les photos qui ne servent plus sont supprimées.
    if (is_dir(RESEAUX_DOSSIER_PHOTOS)) {
        $gardees = array_map(fn($x) => basename($x['image']), array_filter($propres, fn($x) => $x['image'] !== ''));
        foreach (glob(RESEAUX_DOSSIER_PHOTOS . '/*') ?: [] as $f) {
            if (is_file($f) && !in_array(basename($f), $gardees, true)) {
                @unlink($f);
            }
        }
    }
    $nouveau = ['maj' => time(), 'posts' => $propres, 'erreur' => ''];
    ecrire_json($fichier, $nouveau);
    flock($h, LOCK_UN);
    return $nouveau;
}

function reseaux_appel(string $url): array
{
    $corps = reseaux_telecharger($url, 1500000);
    $j = json_decode($corps, true);
    if (!is_array($j)) {
        throw new RuntimeException('Réponse de Meta illisible.');
    }
    if (isset($j['error'])) {
        throw new RuntimeException('Meta : ' . (string) ($j['error']['message'] ?? 'erreur'));
    }
    return $j;
}

function reseaux_telecharger(string $url, int $max): string
{
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, CURLOPT_USERAGENT => 'site-la-batailleuse']);
        $r = curl_exec($c);
        $code = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        curl_close($c);
        // Meta répond 400 avec un JSON d'erreur lisible : on le laisse passer.
        if (!is_string($r) || $r === '' || ($code >= 500)) {
            throw new RuntimeException('Meta ne répond pas (code ' . $code . ').');
        }
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true, 'user_agent' => 'site-la-batailleuse']]);
        $r = @file_get_contents($url, false, $ctx, 0, $max + 1);
        if (!is_string($r) || $r === '') {
            throw new RuntimeException('Meta ne répond pas.');
        }
    }
    if (strlen($r) > $max) {
        throw new RuntimeException('Réponse trop grande.');
    }
    return $r;
}

/** Copie la photo d'une publication sur le site (jamais de lien direct vers Meta : les visiteurs ne sont pas suivis, et l'adresse ne périme pas). */
function reseaux_photo(string $id, string $url, array $r): string
{
    $hotes = (string) ($r['hotes_photos'] ?? RESEAUX_HOTES_PHOTOS);
    if (!preg_match($hotes, $url)) {
        return '';
    }
    $nom = substr(sha1($id), 0, 14);
    foreach (['jpg', 'png', 'webp'] as $ext) {
        if (is_file(RESEAUX_DOSSIER_PHOTOS . "/$nom.$ext")) {
            return "data/reseaux/$nom.$ext";
        }
    }
    try {
        $octets = reseaux_telecharger($url, 4000000);
    } catch (Throwable $e) {
        return '';
    }
    $info = @getimagesizefromstring($octets);
    $ext = $info === false ? '' : ([IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'][$info[2]] ?? '');
    if ($ext === '' || !is_dir(RESEAUX_DOSSIER_PHOTOS) && !@mkdir(RESEAUX_DOSSIER_PHOTOS, 0755, true) && !is_dir(RESEAUX_DOSSIER_PHOTOS)) {
        return '';
    }
    if (@file_put_contents(RESEAUX_DOSSIER_PHOTOS . "/$nom.$ext", $octets) === false) {
        return '';
    }
    return "data/reseaux/$nom.$ext";
}
