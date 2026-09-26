<?php
// Modèle de configuration. À copier en prive/config.php sur l'hébergement, puis à remplir.
// prive/config.php ne doit JAMAIS être publié (il est exclu du dépôt git).
return [
    // Empreinte du code de l'espace équipe. Pour la créer : php -r 'echo password_hash("LE-CODE", PASSWORD_DEFAULT), "\n";'
    'code_equipe_hash' => '',

    // Adresse qui envoie les emails : une boîte existante du domaine, chez IONOS.
    'expediteur' => 'contact@claj-batailleuse.fr',
    'nom_expediteur' => 'Site de la Batailleuse',

    // Test hebdomadaire de la veille : un envoi portant ce jeton part vers adresse_test, jamais vers l'équipe.
    'jeton_test' => '',
    'adresse_test' => '',

    // Chaque formulaire (page/identifiant) et la boîte qui reçoit ses demandes.
    'routes' => [
        'ecoles/demande' => 'animation@claj-batailleuse.fr',
        'colos/demande' => 'animation@claj-batailleuse.fr',
        'chalet/demande' => 'hebergement@claj-batailleuse.fr',
        'visiter/precommande' => 'ferme@claj-batailleuse.fr',
        'visiter/animation' => 'animation@claj-batailleuse.fr',
        'collectif/demande' => 'contact@claj-batailleuse.fr',
        // Le formulaire de contact aiguille selon le sujet choisi.
        'contact/demande' => [
            'valeurs' => [
                'classe' => 'animation@claj-batailleuse.fr',
                'colo' => 'animation@claj-batailleuse.fr',
                'anniversaire' => 'animation@claj-batailleuse.fr',
                'chalet' => 'hebergement@claj-batailleuse.fr',
                'visite' => 'ferme@claj-batailleuse.fr',
                'boutique' => 'ferme@claj-batailleuse.fr',
                'pain' => 'ferme@claj-batailleuse.fr',
                'facture' => 'facturation@claj-batailleuse.fr',
                'benevolat' => 'contact@claj-batailleuse.fr',
                'autre' => 'contact@claj-batailleuse.fr',
            ],
            'defaut' => 'contact@claj-batailleuse.fr',
        ],
    ],

    // Hébergeur sans SMTP (Railway…) : clé de l'API Resend. Vide chez IONOS, qui envoie lui-même.
    'resend_cle' => '',

    // Démonstration seulement : si rempli, TOUS les emails partent vers cette adresse (au plus limite_jour par jour).
    'rediriger_vers' => '',
    'limite_jour' => 40,

    // Pied de l'accusé de réception envoyé au demandeur.
    'contacts' => 'La ferme : 03 81 49 91 15 · Le Chalet du Souleret : 03 81 49 91 84 · Le fournil : 07 81 42 48 30',
];
