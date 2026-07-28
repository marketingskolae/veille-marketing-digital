#!/usr/bin/env node
// Génère la veille marketing digital du jour et l'insère dans index.html.
// Aucune dépendance npm : Node 20+ (fetch natif).
//
// Principe : les articles proviennent exclusivement des flux RSS déclarés dans
// feeds.mjs. Le modèle ne cherche rien — il trie, hiérarchise et rédige. Il ne
// manipule jamais d'URL : il désigne les articles par leur numéro, et le script
// recompose les liens depuis la collecte. Une source inventée est donc
// impossible par construction, pas seulement improbable.
//
// Variables d'environnement :
//   GITHUB_TOKEN     fourni automatiquement par GitHub Actions (gratuit)
//   GEMINI_API_KEY   alternative si PROVIDER=gemini
//   PROVIDER         'github' (défaut) ou 'gemini'
//   DRY_RUN=1        n'écrit pas index.html, affiche le résultat
//   DEBUG_RAW=1      écrit la réponse brute du modèle dans debug-response.json

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collecter, normaliser } from './feeds.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');

const PROVIDER = process.env.PROVIDER || (process.env.GEMINI_API_KEY && !process.env.GITHUB_TOKEN ? 'gemini' : 'github');
const DRY_RUN = process.env.DRY_RUN === '1';
const DEBUG_RAW = process.env.DEBUG_RAW === '1';
const MAX_DAYS = 14;
const MAX_CANDIDATS = 55;

const THEMES = [
  { cle: 'seo', titre: 'SEO / GEO' },
  { cle: 'ia', titre: 'IA appliquée au marketing digital' },
  { cle: 'sea', titre: 'SEA / Social Ads' },
  { cle: 'ga4', titre: 'Google Analytics / GTM' },
  { cle: 'ux', titre: 'UX Design / CRO' },
];

// ---------------------------------------------------------------------------
// Date du jour, heure de Paris
// ---------------------------------------------------------------------------
function parisDate() {
  const now = new Date();
  const iso = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const label = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);
  return { iso, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

function dateCourte(d) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'long',
  }).format(d);
}

function echapper(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Appel du modèle
// ---------------------------------------------------------------------------
async function appelerModele(prompt) {
  if (PROVIDER === 'gemini') {
    const cle = process.env.GEMINI_API_KEY;
    if (!cle) throw new Error('PROVIDER=gemini mais GEMINI_API_KEY est absente.');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': cle, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.GEMINI_MODEL || 'gemini-3.6-flash', input: prompt }),
    });
    const corps = await res.text();
    if (!res.ok) throw new Error(`Gemini ${res.status} : ${corps.slice(0, 500)}`);
    return extraireTexte(JSON.parse(corps));
  }

  const jeton = process.env.GITHUB_TOKEN;
  if (!jeton) {
    throw new Error(
      'GITHUB_TOKEN absent. Dans GitHub Actions il est fourni automatiquement ; ' +
        'en local, exportez-en un ou utilisez PROVIDER=gemini.'
    );
  }
  const res = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jeton}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GITHUB_MODEL || 'openai/gpt-4.1',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  const corps = await res.text();
  if (!res.ok) throw new Error(`GitHub Models ${res.status} : ${corps.slice(0, 500)}`);
  const json = JSON.parse(corps);
  if (DEBUG_RAW) writeFileSync(join(ROOT, 'debug-response.json'), JSON.stringify(json, null, 2));
  return json?.choices?.[0]?.message?.content || '';
}

// L'API Gemini Interactions renvoie une arborescence d'étapes ; on récupère les
// fragments de texte en écartant les blocs de raisonnement.
function extraireTexte(json) {
  if (DEBUG_RAW) writeFileSync(join(ROOT, 'debug-response.json'), JSON.stringify(json, null, 2));
  const morceaux = [];
  const parcourir = (n) => {
    if (n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(parcourir);
    if (n.thought === true) return;
    if (typeof n.text === 'string' && n.text.trim()) morceaux.push(n.text);
    for (const v of Object.values(n)) parcourir(v);
  };
  parcourir(json?.candidates?.[0]?.content?.parts ?? json);
  return morceaux.join('').trim();
}

// ---------------------------------------------------------------------------
// Prompt : compact, car GitHub Models plafonne à 8 000 tokens en entrée
// ---------------------------------------------------------------------------
function construirePrompt(date, candidats) {
  // Les candidats sont regroupés par thème pressenti (déduit du flux d'origine).
  // À plat, le modèle ne voyait que le haut de la liste — dominé par les médias
  // SEO qui publient le plus — et laissait les autres thèmes vides.
  const groupes = [
    { cle: 'seo', libelle: 'Pistes SEO / GEO' },
    { cle: 'sea', libelle: 'Pistes SEA / Social Ads' },
    { cle: 'ga4', libelle: 'Pistes Analytics / GTM' },
    { cle: 'ux', libelle: 'Pistes UX / CRO' },
    { cle: 'mixte', libelle: 'Divers — à répartir selon leur sujet réel (souvent IA marketing)' },
  ];

  const liste = groupes
    .map(({ cle, libelle }) => {
      const lot = candidats.filter((c) => c.theme === cle);
      if (!lot.length) return null;
      const lignes = lot
        .map((c) => `[${c.id}] ${c.source} (${dateCourte(c.date)}) — ${c.titre}\n    ${c.resume.slice(0, 190)}`)
        .join('\n');
      return `### ${libelle} (${lot.length})\n${lignes}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `Tu es le coach expert marketing digital d'une équipe marketing de l'enseignement supérieur privé (écoles en informatique, commerce, immobilier, communication, journalisme, cinéma, design — BTS, Bachelor, Mastère). Nous sommes le ${date.label}.

Voici les articles publiés récemment par les sources de référence du secteur, regroupés par thème pressenti. Aucun n'a encore été traité dans les éditions précédentes.

${liste}

Sélectionne les plus pertinents et rédige la veille du jour.

MÉTHODE — traite les 5 thèmes un par un, dans cet ordre : SEO/GEO, IA marketing, SEA/Social Ads, Analytics/GTM, UX/CRO. Pour chacun, examine les pistes du groupe correspondant ET celles du groupe « Divers ». Le regroupement ci-dessus est indicatif : un article classé en SEO peut relever de l'IA, et inversement — c'est à toi de trancher selon son sujet réel.

RÈGLES
- Vise 2 à 4 articles par thème quand la matière existe. Ne laisse un thème vide que si rien ne s'en approche vraiment : c'est alors un résultat honnête, mais vérifie d'abord le groupe « Divers ».
- Écarte ce qui n'a pas d'application marketing concrète (actualité tech générale, cybersécurité, levées de fonds, faits divers).
- Un même article ne peut apparaître que dans un seul thème.
- Rédige 2 à 3 phrases factuelles par article, à partir du titre et du résumé fournis. N'invente aucun chiffre, aucune date, aucun fait absent du résumé. Si le résumé est trop maigre pour être factuel, n'utilise pas cet article.
- Traduis les titres anglais en français.
- Ton informatif et pragmatique, sans superlatifs.

SYNTHÈSE : 4 à 6 puces courtes couvrant l'ensemble des thèmes retenus, en priorisant SEO/GEO et IA, puis le marché francophone.

ACTIONS : 3 à 5 actions contextualisées pour l'enseignement supérieur privé (funnel étudiant, Parcoursup, journées portes ouvertes, fiches Google Business Profile des campus, refontes de site, campagnes de rentrée). Chaque action doit découler d'un article que tu as retenu. Commence chaque action par un verbe à l'infinitif : « Auditer… », « Vérifier… », « Planifier… ».

FORMAT — réponds uniquement par ce JSON, sans texte autour ni bloc de code :
{"synthese":["..."],"themes":{"seo":[{"id":12,"titre":"Titre court","texte":"2-3 phrases."}],"ia":[],"sea":[],"ga4":[],"ux":[]},"actions":["..."]}

Le champ "id" doit reprendre exactement le numéro entre crochets de l'article. N'écris jamais d'URL : les liens sont ajoutés automatiquement.`;
}

// ---------------------------------------------------------------------------
// Rendu HTML : la structure est produite ici, jamais par le modèle
// ---------------------------------------------------------------------------
function rendre(date, plan, parId) {
  const utilises = new Set();
  let retenus = 0;

  const blocsThemes = THEMES.map(({ cle, titre }) => {
    const items = (plan.themes?.[cle] || [])
      .map((it) => {
        const src = parId.get(Number(it.id));
        // Un id inconnu ou déjà placé ailleurs est écarté : le modèle ne peut
        // pas faire apparaître un article qui n'était pas dans la collecte.
        if (!src || utilises.has(src.url) || !it.titre || !it.texte) return null;
        utilises.add(src.url);
        retenus += 1;
        return `        <div class="item">
          <p class="item-title">${echapper(it.titre)}</p>
          <p class="item-text">${echapper(it.texte)}</p>
          <p class="item-source">Source : <a href="${echapper(src.url)}" target="_blank" rel="noopener">${echapper(src.source)}, ${dateCourte(src.date)}</a></p>
        </div>`;
      })
      .filter(Boolean);

    const corps = items.length
      ? items.join('\n')
      : `        <p class="empty-theme">Rien de significatif aujourd'hui</p>`;

    return `      <div class="theme-block">
        <p class="theme-title">${titre}</p>
${corps}
      </div>`;
  }).join('\n');

  const puces = (plan.synthese || [])
    .slice(0, 6)
    .map((p) => `          <li>${echapper(p)}</li>`)
    .join('\n');
  const actions = (plan.actions || [])
    .slice(0, 5)
    .map((a) => `          <li>${echapper(a)}</li>`)
    .join('\n');

  const html = `<div class="day-entry" data-date="${date.iso}" data-label="${date.label}">
    <div class="day-banner">${date.label}</div>
    <div class="day-body">

      <div class="synthesis-block">
        <p class="synthesis-title">Synthèse du jour</p>
        <ul class="synthesis-list">
${puces}
        </ul>
      </div>

${blocsThemes}

      <div class="actions-block">
        <p class="actions-title">Actions potentielles à réaliser</p>
        <ul class="actions-list">
${actions}
        </ul>
      </div>

    </div>
  </div>`;

  return { html, retenus };
}

// ---------------------------------------------------------------------------
// Lecture de l'historique et insertion
// ---------------------------------------------------------------------------
function urlsDejaPubliees(html) {
  return new Set(
    [...html.matchAll(/<p class="item-source">[\s\S]*?href="([^"]+)"/g)].map((m) => normaliser(m[1]))
  );
}

function inserer(html, fragment, iso) {
  const balise = '<div class="entries">';
  const debut = html.indexOf(balise);
  const pied = html.indexOf('<p class="footer-note">');
  if (debut < 0 || pied < 0) throw new Error('Marqueurs .entries / .footer-note introuvables.');

  const tete = html.slice(0, debut + balise.length);
  const queue = html.slice(pied);
  const corps = html.slice(debut + balise.length, pied);

  const existantes = corps
    .split(/(?=<div class="day-entry")/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('<div class="day-entry"'))
    .map((s) => s.replace(/<\/div>\s*$/, '').trimEnd() + '\n  </div>');

  const autres = existantes.filter((e) => !e.includes(`data-date="${iso}"`)).slice(0, MAX_DAYS - 1);
  const entrees = [fragment, ...autres].map((e) => '\n  ' + e.trim()).join('\n');
  return tete + entrees + '\n</div>\n\n' + queue;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
try {
  const date = parisDate();
  const courant = readFileSync(INDEX, 'utf8');
  const dejaVues = urlsDejaPubliees(courant);

  console.log(`Veille du ${date.label} — fournisseur : ${PROVIDER}\n`);
  console.log('Collecte des flux :');
  const articles = await collecter();

  const nouveaux = articles.filter((a) => !dejaVues.has(normaliser(a.url)));
  console.log(
    `\n${articles.length} article(s) collecté(s), ${articles.length - nouveaux.length} déjà publié(s), ` +
      `${nouveaux.length} nouveau(x).`
  );

  if (nouveaux.length < 3) {
    console.log("Trop peu de nouveautés pour justifier une édition. index.html inchangé.");
    process.exitCode = 0;
  } else {
    const candidats = nouveaux.slice(0, MAX_CANDIDATS).map((a, i) => ({ ...a, id: i + 1 }));
    const parId = new Map(candidats.map((c) => [c.id, c]));

    const prompt = construirePrompt(date, candidats);
    console.log(`Prompt : ~${Math.round(prompt.length / 4)} tokens pour ${candidats.length} candidats.`);

    const reponse = await appelerModele(prompt);
    const brut = reponse.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let plan;
    try {
      plan = JSON.parse(brut);
    } catch {
      throw new Error(
        'Réponse illisible : le modèle n\'a pas renvoyé de JSON valide. ' +
          'Relancez avec DEBUG_RAW=1 pour inspecter debug-response.json.\n' +
          brut.slice(0, 300)
      );
    }

    const { html: fragment, retenus } = rendre(date, plan, parId);
    console.log(`\n${retenus} article(s) retenu(s) par le modèle.`);

    if (retenus < 3) {
      console.error(
        `Seulement ${retenus} article(s) exploitable(s) — publication annulée pour ne pas ` +
          "dégrader le site. index.html n'a pas été modifié."
      );
      process.exitCode = 1;
    } else if (DRY_RUN) {
      console.log('\n--- DRY RUN, index.html non modifié ---\n');
      console.log(fragment);
    } else {
      const maj = inserer(courant, fragment, date.iso);
      writeFileSync(INDEX, maj, 'utf8');
      console.log(
        `index.html mis à jour — ${(maj.match(/class="day-entry"/g) || []).length} jour(s) d'historique.`
      );
    }
  }
} catch (err) {
  console.error('\nÉchec : ' + (err?.message || err));
  // exitCode plutôt que process.exit() : couper le processus pendant que les
  // sockets HTTP sont ouvertes déclenche une assertion libuv sur Windows.
  process.exitCode = 1;
}
