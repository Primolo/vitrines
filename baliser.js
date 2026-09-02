#!/usr/bin/env node
/**
 * Ajoute les données structurées (schema.org JSON-LD) aux maquettes.
 * Objectif : rendre chaque établissement lisible et citable par Google
 * et par les IA (ChatGPT, Perplexity, Gemini) — qui, contrairement à
 * Facebook, savent lire un site web.
 *
 * Usage : node baliser.js [slug…]   (sans argument : tous les sites)
 * Idempotent : relancer le script remplace le balisage précédent.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://primolo.github.io/vitrines/';

// Chaque fiche : type schema.org, coordonnées vérifiées, et questions
// fréquentes rédigées à partir de faits réels uniquement.
const FICHES = {
  'auberge-des-montagnards': {
    type: ['Restaurant'], nom: "L'Auberge des Montagnards", ville: 'Montperreux', cp: '25160',
    desc: "Auberge de village au-dessus du lac de Saint-Point, cuisine franc-comtoise, halte des randonneurs du tour du lac.",
    cuisine: ['Française', 'Franc-comtoise'], gamme: '€€',
    faq: [
      ["Où se trouve l'Auberge des Montagnards ?", "À Montperreux, au-dessus du lac de Saint-Point, dans le Haut-Doubs. L'auberge est une halte sur le sentier du tour du lac."],
      ["Quelle cuisine sert l'Auberge des Montagnards ?", "Une cuisine franc-comtoise de village, avec les spécialités de la région selon la saison."],
      ["Faut-il réserver ?", "La réservation est conseillée le week-end et pendant les vacances scolaires."]
    ]
  },
  'chez-jp': {
    type: ['Restaurant', 'BarOrPub'], nom: 'Chez JP', rue: '74 Grande Rue', ville: 'Les Fourgs', cp: '25300',
    tel: '+33381694196',
    desc: "Restaurant, bar et tabac au cœur du village des Fourgs. La table de midi et du soir, le café du matin, le dépannage tabac.",
    cuisine: ['Française', 'Franc-comtoise'], gamme: '€€',
    ferme: ['lundi', 'mercredi'],
    faq: [
      ["Chez JP est-il ouvert tous les jours ?", "L'établissement est fermé le lundi et le mercredi. Les horaires sont à confirmer directement au 03 81 69 41 96."],
      ["Chez JP fait-il aussi bar et tabac ?", "Oui. Chez JP réunit trois activités dans le village des Fourgs : le restaurant, le bar et le tabac."],
      ["Où se trouve Chez JP ?", "Au 74 Grande Rue, aux Fourgs (25300), dans le Haut-Doubs."]
    ]
  },
  'restaurant-a-la-ferme': {
    type: ['Restaurant'], nom: 'Restaurant à la Ferme', ville: 'Les Fourgs', cp: '25300',
    desc: "Cuisine fermière du Haut-Doubs : boîte chaude, fondue, salade de röstis au jambon, filet de truite au vin d'Arbois.",
    cuisine: ['Française', 'Franc-comtoise'], gamme: '€€',
    faq: [
      ["Quelles sont les spécialités du Restaurant à la Ferme ?", "La boîte chaude, la fondue, la salade de röstis au jambon et le filet de truite au vin d'Arbois font partie des spécialités de la maison."],
      ["Le restaurant est-il ouvert l'hiver ?", "Les Fourgs est un village de ski nordique très fréquenté l'hiver. Les horaires de saison sont à confirmer directement auprès du restaurant."]
    ]
  },
  'la-fontaine-ronde': {
    type: ['Restaurant'], nom: 'La Fontaine Ronde', ville: 'La Cluse-et-Mijoux', cp: '25300',
    desc: "Restaurant d'étape sur la route du château de Joux et de la frontière suisse, entre Pontarlier et Vallorbe.",
    cuisine: ['Française'], gamme: '€€',
    faq: [
      ["Où se trouve La Fontaine Ronde ?", "À La Cluse-et-Mijoux, sur l'axe Pontarlier – Vallorbe, au passage de la cluse et à proximité du château de Joux."],
      ["Le restaurant est-il proche du château de Joux ?", "Oui, La Fontaine Ronde se trouve à quelques minutes du château de Joux, sur la route qui mène à la Suisse."]
    ]
  },
  'auberge-du-vourbey': {
    type: ['Restaurant'], nom: "L'Auberge du Vourbey", rue: 'Lieu-dit Le Vourbey', ville: 'Les Fourgs', cp: '25300',
    tel: '+33770913333', email: 'aubergeduvourbey@outlook.com',
    desc: "Chalet d'alpage au cœur des pistes nordiques des Fourgs, accessible l'hiver uniquement à ski ou en raquettes. Cuisine franc-comtoise, salle pour les fêtes de famille.",
    cuisine: ['Française', 'Franc-comtoise'], gamme: '€€',
    faq: [
      ["Comment accède-t-on à l'Auberge du Vourbey en hiver ?", "L'hiver, l'auberge n'est accessible qu'à ski de fond ou en raquettes : aucune route n'est déneigée jusqu'au chalet."],
      ["Peut-on venir à l'Auberge du Vourbey l'été ?", "Oui, l'été l'auberge accueille les groupes à partir de 8 personnes, sur réservation."],
      ["L'auberge accueille-t-elle les repas de famille ?", "Oui, une salle est disponible pour les mariages, baptêmes et anniversaires. Les conditions se calent par téléphone au 07 70 91 33 33."]
    ]
  },
  'le-tremplin': {
    type: ['Restaurant'], nom: 'Le Tremplin', ville: 'Métabief', cp: '25370',
    tel: '+33381491066', email: 'restoletremplin@gmail.com',
    desc: "Restaurant au pied des pistes de Métabief : burgers maison, pizzas et spécialités comtoises. Skieurs l'hiver, vététistes l'été.",
    cuisine: ['Française', 'Pizza', 'Burger'], gamme: '€€',
    faq: [
      ["Le Tremplin est-il au pied des pistes de Métabief ?", "Oui, le restaurant se situe au pied des pistes de la station de Métabief."],
      ["Que sert Le Tremplin ?", "Des burgers maison, des pizzas et des spécialités comtoises, avec une terrasse."],
      ["Le restaurant est-il ouvert en été ?", "Oui. L'été, Le Tremplin accueille notamment les vététistes du bike park de Métabief."]
    ]
  },
  'auberge-du-chateau-de-joux': {
    type: ['Hotel', 'Restaurant'], nom: "L'Auberge du Château de Joux", ville: 'La Cluse-et-Mijoux', cp: '25300',
    tel: '+33381694041', email: 'aubergeduchateaudejoux@gmail.com',
    desc: "Hôtel-restaurant au pied du château de Joux, dans la cluse de Pontarlier. Quinze chambres et une cuisine régionale franc-comtoise.",
    cuisine: ['Française', 'Franc-comtoise'], gamme: '€€', chambres: 15,
    faq: [
      ["L'auberge est-elle proche du château de Joux ?", "Oui, l'auberge se trouve au pied de l'éperon rocheux qui porte le château de Joux, à quelques minutes à pied."],
      ["Combien de chambres compte l'Auberge du Château de Joux ?", "L'établissement dispose de quinze chambres."],
      ["Peut-on réserver en direct ?", "Oui, par téléphone au 03 81 69 40 41 ou par courriel — sans commission de plateforme."]
    ]
  },
  'cafe-fleurs': {
    type: ['CafeOrCoffeeShop', 'Florist'], nom: 'Café Fleurs', ville: 'Malbuisson', cp: '25160',
    tel: '+33381397026',
    desc: "Fleuriste et salon de thé sur la rue principale de Malbuisson, au bord du lac de Saint-Point : créations florales, thés bio, chocolat viennois et crêpes.",
    gamme: '€',
    faq: [
      ["Le Café Fleurs est-il un fleuriste ou un salon de thé ?", "Les deux : c'est un fleuriste doublé d'un salon de thé, sur la rue principale de Malbuisson."],
      ["Que peut-on boire au Café Fleurs ?", "Une large sélection de thés bio, du chocolat viennois, et des crêpes à la carte."],
      ["Où se trouve le Café Fleurs ?", "À Malbuisson (25160), sur la rue principale qui descend vers le lac de Saint-Point."]
    ]
  },
  'chalet-du-lac': {
    type: ['LodgingBusiness'], nom: 'Chalet du Lac', ville: 'Les Grangettes', cp: '25160',
    desc: "Maison d'hôtes quatre étoiles aux Grangettes, avec plage privée sur le lac de Saint-Point.",
    gamme: '€€€', etoiles: 4,
    faq: [
      ["Le Chalet du Lac a-t-il un accès direct au lac ?", "Oui, l'établissement dispose d'une plage privée sur le lac de Saint-Point, à cinquante mètres de la rive."],
      ["Peut-on réserver sans passer par une plateforme ?", "Oui. La réservation en direct est possible et évite les commissions de plateforme."],
      ["Quel est le classement du Chalet du Lac ?", "Il s'agit d'un hébergement classé quatre étoiles."]
    ]
  },
  'ecrin-du-lac': {
    type: ['BedAndBreakfast'], nom: "L'Écrin du Lac", ville: 'Saint-Point-Lac', cp: '25160',
    desc: "Chambres d'hôtes dans une ancienne ferme comtoise rénovée, au bord du lac de Saint-Point. Quatre chambres et un gîte indépendant.",
    gamme: '€€',
    faq: [
      ["Combien de chambres compte L'Écrin du Lac ?", "Quatre chambres d'hôtes, auxquelles s'ajoute un gîte indépendant pour les séjours plus longs."],
      ["L'Écrin du Lac est-il proche du lac ?", "Oui, la maison se trouve au cœur du village de Saint-Point-Lac, sur la rive du lac de Saint-Point."],
      ["Le petit-déjeuner est-il compris ?", "Le petit-déjeuner fait partie de la formule chambre d'hôtes. Les détails sont à préciser lors de la réservation."]
    ]
  },
  'la-petite-forge': {
    type: ['BedAndBreakfast'], nom: 'La Petite Forge', ville: 'Oye-et-Pallet', cp: '25160',
    desc: "Maison d'hôtes à Oye-et-Pallet, dans un hameau calme du Haut-Doubs, à cinq minutes du lac de Saint-Point.",
    gamme: '€€',
    faq: [
      ["Où se trouve La Petite Forge ?", "Dans un hameau d'Oye-et-Pallet, à cinq minutes en voiture du lac de Saint-Point."],
      ["Peut-on réserver en direct ?", "Oui, la réservation directe est possible et évite les commissions de plateforme."]
    ]
  },
  'gite-musical': {
    type: ['LodgingBusiness'], nom: 'Le Gîte musical', ville: 'Métabief', cp: '25370',
    desc: "Gîte dans le secteur de Métabief, entre les monts du Haut-Doubs et le lac de Saint-Point.",
    gamme: '€€',
    faq: [
      ["Où se situe Le Gîte musical ?", "Dans le secteur de Métabief, entre les monts du Haut-Doubs et le lac de Saint-Point."],
      ["Peut-on réserver sans plateforme ?", "Oui, la réservation en direct est possible, sans commission d'intermédiaire."]
    ]
  },
  'toit-du-doubs': {
    type: ['Store'], nom: 'Fruitière le Toit du Doubs', rue: '2B Grande Rue', ville: 'Les Fourgs', cp: '25300',
    tel: '+33381395424',
    desc: "Fromagerie coopérative des Fourgs, réunissant onze fermes depuis 2017. Comté en trois affinages, mont d'or de saison, fabrication visible depuis le magasin.",
    gamme: '€€',
    horaires: [['Mo','Sa','10:00','12:00'], ['Mo','Sa','14:30','18:00'], ['Su','Su','10:00','12:00']],
    faq: [
      ["Quels sont les horaires de la fruitière le Toit du Doubs ?", "Du lundi au samedi de 10 h à 12 h et de 14 h 30 à 18 h, et les dimanches et jours fériés de 10 h à 12 h."],
      ["Peut-on voir fabriquer le comté aux Fourgs ?", "Oui, la fabrication est visible depuis le magasin à travers de grandes baies vitrées."],
      ["Combien de fermes composent la coopérative ?", "Onze fermes se sont réunies en coopérative en 2017 pour fabriquer leur comté au village."],
      ["Où se trouve la fruitière ?", "Au 2B Grande Rue, aux Fourgs (25300), le village le plus haut du Doubs, à environ 1 100 mètres d'altitude."]
    ]
  },
  'fromagerie-saint-antoine': {
    type: ['Store'], nom: 'Fromagerie Saint-Antoine', ville: 'Les Hôpitaux-Vieux', cp: '25370',
    desc: "Fruitière de Saint-Antoine – Les Hôpitaux-Vieux : le lait de treize fermes d'altitude transformé en comté AOP, en vente directe au magasin.",
    gamme: '€€',
    faq: [
      ["Combien de fermes livrent la fruitière Saint-Antoine ?", "Treize fermes d'altitude, situées entre 860 et 1 300 mètres."],
      ["Peut-on acheter du comté directement à la fromagerie ?", "Oui, la fruitière vend en direct au magasin, du producteur au consommateur."]
    ]
  },
  'fromagerie-vaux-et-chantegrue': {
    type: ['Store'], nom: 'Fromagerie de Vaux-et-Chantegrue', ville: 'Vaux-et-Chantegrue', cp: '25160',
    desc: "Coopérative fromagère de village dans le Haut-Doubs : comté, morbier et mont d'or de saison, en vente directe au magasin.",
    gamme: '€€',
    faq: [
      ["Que vend la fromagerie de Vaux-et-Chantegrue ?", "Du comté, du morbier et, à la saison froide, du mont d'or — des fromages d'appellation vendus directement au magasin de la coopérative."],
      ["Quels sont les horaires du magasin ?", "Les horaires sont à confirmer directement auprès de la fromagerie."]
    ]
  },
  'cave-robbe': {
    type: ['Store'], nom: 'Cave Robbe', rue: '16 rue de Damvauthier', ville: 'Saint-Point-Lac', cp: '25160',
    desc: "Caviste familial à Saint-Point-Lac depuis 1936 : vins du Jura, arbois, vin jaune et sélection de la cave.",
    gamme: '€€', fondee: '1936',
    faq: [
      ["Depuis quand existe la Cave Robbe ?", "La famille Robbe tient cave à Saint-Point-Lac depuis 1936."],
      ["Quels vins trouve-t-on à la Cave Robbe ?", "Des vins du Jura, notamment d'Arbois et du vin jaune, ainsi qu'une sélection plus large et des conseils."],
      ["Où se trouve la Cave Robbe ?", "Au 16 rue de Damvauthier, à Saint-Point-Lac (25160), sur les rives du lac."]
    ]
  },
  'la-semilla': {
    type: ['Store'], nom: 'La Semilla — Distillerie Aymonier', ville: 'Les Fourgs', cp: '25300',
    desc: "Distillerie artisanale biologique aux Fourgs, dans la zone historique de l'absinthe : plantes cultivées à 1 100 mètres d'altitude et distillées à l'alambic de cuivre.",
    gamme: '€€',
    faq: [
      ["Où se trouve la distillerie La Semilla ?", "Aux Fourgs (25300), dans le Haut-Doubs, au cœur de la zone historique de l'absinthe du pays de Pontarlier."],
      ["Les plantes sont-elles cultivées sur place ?", "Oui, les plantes sont cultivées à environ 1 100 mètres d'altitude, en agriculture biologique."],
      ["Peut-on visiter la distillerie ?", "Les conditions de visite sont à convenir directement avec la distillerie."]
    ]
  },
  'chalet-jacquet': {
    type: ['Store'], nom: 'Le Chalet Jacquet', ville: 'La Cluse-et-Mijoux', cp: '25300',
    tel: '+33381397540',
    desc: "Épicerie fine de terroir à La Cluse-et-Mijoux : fromages affinés, salaisons fumées au tuyé, vins du Jura et paniers garnis. Ouvert sept jours sur sept.",
    gamme: '€€',
    horaires: [['Mo','Su','09:00','19:00']],
    faq: [
      ["Le Chalet Jacquet est-il ouvert tous les jours ?", "Oui, la boutique est ouverte sept jours sur sept. Les horaires précis sont à confirmer au 03 81 39 75 40."],
      ["Que vend le Chalet Jacquet ?", "Des produits du terroir franc-comtois : fromages affinés, salaisons fumées au tuyé, vins du Jura et paniers garnis."],
      ["Peut-on composer un panier cadeau ?", "Oui, la boutique propose des paniers garnis. Les compositions se calent directement en magasin ou par téléphone."]
    ]
  },
  'fonderie-obertino': {
    type: ['Store', 'TouristAttraction'], nom: 'Fonderie de cloches Obertino', rue: '15 rue de Mouthe',
    ville: 'Labergement-Sainte-Marie', cp: '25160', tel: '+33381693072', email: 'cloches.obertino.c@orange.fr',
    desc: "Fonderie de cloches artisanale fondée en 1834 à Labergement-Sainte-Marie, l'une des dernières de France. Entreprise du Patrimoine Vivant depuis 2011. Cloches de vaches, sonnailles, cloches de table. Visites gratuites de l'atelier.",
    gamme: '€€', fondee: '1834',
    horaires: [['Mo','Sa','09:30','12:00'], ['Mo','Sa','14:30','18:30']],
    faq: [
      ["Depuis quand existe la fonderie Obertino ?", "La fonderie de cloches Obertino a été fondée en 1834 à Labergement-Sainte-Marie. C'est l'une des dernières fonderies de cloches artisanales de France."],
      ["Peut-on visiter la fonderie de cloches ?", "Oui. Des visites gratuites d'une vingtaine de minutes permettent d'assister à la coulée et au démoulage. En juillet et août, des visites guidées ont lieu le vendredi à 16 h 30."],
      ["Quels sont les horaires de la boutique Obertino ?", "La boutique est ouverte tous les jours sauf les dimanches et jours fériés, de 9 h 30 à 12 h et de 14 h 30 à 18 h 30."],
      ["Que fabrique la fonderie Obertino ?", "Des cloches de vaches et sonnailles, des cloches de table et des souvenirs, coulés et décorés à la main en bronze."],
      ["Qu'est-ce que le label Entreprise du Patrimoine Vivant ?", "C'est une distinction de l'État français qui reconnaît un savoir-faire artisanal rare. La fonderie Obertino la détient depuis 2011."]
    ]
  },
  'o-delices-du-larmont': {
    type: ['FoodEstablishment'], nom: 'Ô Délices du Larmont', ville: 'Malbuisson', cp: '25160',
    tel: '+33381387977',
    desc: "Traiteur du Haut-Doubs à Malbuisson : vins d'honneur, buffets et repas servis à table pour mariages, fêtes de famille et entreprises. Épicerie fine en complément.",
    gamme: '€€',
    faq: [
      ["Ô Délices du Larmont fait-il les mariages ?", "Oui, le traiteur compose vins d'honneur, buffets et repas servis à table pour les mariages, les fêtes de famille et les événements d'entreprise."],
      ["Comment demander un devis ?", "Par téléphone au 03 81 38 79 77, en précisant la date, le nombre de convives et le type de réception souhaité."],
      ["Où se trouve Ô Délices du Larmont ?", "À Malbuisson (25160), dans le Haut-Doubs, près du lac de Saint-Point."]
    ]
  },
  'ruch-bio': {
    type: ['GroceryStore'], nom: "La Ruch'Bio", rue: '1 place du Tunnel', ville: 'Jougne', cp: '25370',
    desc: "Épicerie biologique à Jougne, sur la route du col vers la Suisse : fruits et légumes frais, vrac, crèmerie, pain et cosmétiques, avec les producteurs locaux mis en avant.",
    gamme: '€€',
    horaires: [['Mo','Sa','09:00','19:00']],
    faq: [
      ["Que trouve-t-on à La Ruch'Bio ?", "Des fruits et légumes frais, du vrac, de la crèmerie, du pain et des cosmétiques, tous certifiés biologiques, avec une place particulière donnée aux producteurs locaux."],
      ["Où se trouve La Ruch'Bio ?", "Au 1 place du Tunnel, à Jougne (25370), sur la route du col qui mène à la Suisse."],
      ["Quels sont les horaires du magasin ?", "Du lundi au samedi, de 9 h à 19 h. Les horaires sont à confirmer directement auprès du magasin."]
    ]
  },
};

function jsonld(slug, f) {
  const url = BASE + slug + '/';
  const fiche = {
    '@context': 'https://schema.org',
    '@type': f.type.length === 1 ? f.type[0] : f.type,
    '@id': url + '#etablissement',
    name: f.nom,
    description: f.desc,
    url,
    address: {
      '@type': 'PostalAddress',
      ...(f.rue ? { streetAddress: f.rue } : {}),
      addressLocality: f.ville,
      postalCode: f.cp,
      addressRegion: 'Bourgogne-Franche-Comté',
      addressCountry: 'FR'
    },
    areaServed: [{ '@type': 'Place', name: f.ville }, { '@type': 'Place', name: 'Haut-Doubs' }],
    ...(f.tel ? { telephone: f.tel } : {}),
    ...(f.email ? { email: f.email } : {}),
    ...(f.cuisine ? { servesCuisine: f.cuisine } : {}),
    ...(f.fondee ? { foundingDate: f.fondee } : {}),
    ...(f.etoiles ? { starRating: { '@type': 'Rating', ratingValue: f.etoiles } } : {}),
    ...(f.chambres ? { numberOfRooms: f.chambres } : {}),
    currenciesAccepted: 'EUR',
    knowsLanguage: 'fr',
  };
  if (f.horaires) {
    fiche.openingHoursSpecification = f.horaires.map(([d1, d2, o, c]) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: d1 === d2 ? [jour(d1)] : plage(d1, d2),
      opens: o, closes: c
    }));
  }
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: f.faq.map(([q, r]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: r }
    }))
  };
  return [fiche, faq];
}

const NOMS = { Mo:'Monday', Tu:'Tuesday', We:'Wednesday', Th:'Thursday', Fr:'Friday', Sa:'Saturday', Su:'Sunday' };
const ORDRE = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const jour = c => 'https://schema.org/' + NOMS[c];
const plage = (a, b) => ORDRE.slice(ORDRE.indexOf(a), ORDRE.indexOf(b) + 1).map(jour);

const MARQUE_DEBUT = '<!-- donnees-structurees:debut -->';
const MARQUE_FIN = '<!-- donnees-structurees:fin -->';

function appliquer(slug) {
  const f = FICHES[slug];
  if (!f) return { slug, statut: 'pas de fiche définie' };
  const fichier = path.join(__dirname, slug, 'index.html');
  if (!fs.existsSync(fichier)) return { slug, statut: 'fichier introuvable' };

  let html = fs.readFileSync(fichier, 'utf8');

  // retirer un balisage précédent (le script est rejouable sans dégât)
  const re = new RegExp(MARQUE_DEBUT + '[\\s\\S]*?' + MARQUE_FIN + '\\n?', 'g');
  html = html.replace(re, '');

  const [fiche, faq] = jsonld(slug, f);
  const bloc = MARQUE_DEBUT + '\n' +
    '<script type="application/ld+json">\n' + JSON.stringify(fiche, null, 2) + '\n</script>\n' +
    '<script type="application/ld+json">\n' + JSON.stringify(faq, null, 2) + '\n</script>\n' +
    MARQUE_FIN + '\n';

  // insertion juste avant </head>, ou avant <style> à défaut
  if (html.includes('</head>')) html = html.replace('</head>', bloc + '</head>');
  else if (html.includes('<style>')) html = html.replace('<style>', bloc + '<style>');
  else return { slug, statut: 'ni </head> ni <style> — insertion impossible' };

  fs.writeFileSync(fichier, html);
  return { slug, statut: 'ok', type: f.type.join('+'), questions: f.faq.length };
}

const cibles = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FICHES);
let ok = 0;
for (const slug of cibles) {
  const r = appliquer(slug);
  if (r.statut === 'ok') { ok++; console.log(`✓ ${r.slug.padEnd(32)} ${r.type.padEnd(28)} ${r.questions} questions`); }
  else console.log(`✗ ${r.slug.padEnd(32)} ${r.statut}`);
}
console.log(`\n${ok}/${cibles.length} sites balisés.`);
