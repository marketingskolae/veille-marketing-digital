#!/usr/bin/env node
// Génère la veille marketing digital du jour et l'insère dans index.html.
// Aucune dépendance npm : Node 20+ (fetch natif).
//
// Variables d'environnement :
//   GEMINI_API_KEY  (obligatoire)
//   GEMINI_MODEL    (optionnel, défaut gemini-3.6-flash)
//   DEBUG_RAW=1     écrit la réponse brute de l'API dans debug-response.json
//   DRY_RUN=1       n'écrit pas index.html, affiche seulement le résultat

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRUSTED_DOMAINS, classify } from './sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(ROOT, 'index.html');
const CANDIDATES = join(ROOT, 'sources-candidates.md');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const DRY_RUN = process.env.DRY_RUN === '1';
const DEBUG_RAW = process.env.DEBUG_RAW === '1';
const MAX_DAYS = 14;

if (!API_KEY) {
  console.error('GEMINI_API_KEY manquante.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Date du jour, heure de Paris
// ---------------------------------------------------------------------------
function parisDate() {
  const now = new Date();
  const iso = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  const label = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now);

  return {
    iso,
    label: label.charAt(0).toUpperCase() + label.slice(1),
    fr: iso.split('-').reverse().join('/'),
  };
}

// ---------------------------------------------------------------------------
// Mémoire des jours précédents — base de l'anti-doublon
// ---------------------------------------------------------------------------
function readHistory(html) {
  const urls = new Set(
    [...html.matchAll(/<p class="item-source">[\s\S]*?href="([^"]+)"/g)].map((m) => m[1])
  );
  const titles = [...html.matchAll(/<p class="item-title">([\s\S]*?)<\/p>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim()
  );
  // Normalisation d'URL : on compare sans paramètres ni slash final, pour qu'un
  // même article référencé différemment soit bien vu comme un doublon.
  const norm = new Set(
    [...urls].map((u) => {
      try {
        const p = new URL(u);
        return (p.hostname.replace(/^www\./, '') + p.pathname).replace(/\/$/, '').toLowerCase();
      } catch {
        return u.toLowerCase();
      }
    })
  );
  return { urls: norm, titles };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
function buildPrompt({ iso, label }, history) {
  const covered = history.titles.length
    ? history.titles.slice(0, 60).map((t) => `- ${t}`).join('\n')
    : '(aucun historique, première édition)';

  return `Tu es le coach expert marketing digital de Jean-Aurélien Berthaud, Responsable Marketing Digital depuis 10 ans dans l'enseignement supérieur privé (écoles en informatique, commerce, immobilier, communication, journalisme, cinéma, design — BTS, Bachelor, Mastère).

Nous sommes le ${label}. Produis la veille marketing digital du jour.

═══ ÉTAPE 1 — RECHERCHE ═══
Recherche sur Google les actualités des dernières 24 à 48 heures pour ces 5 thèmes, dans cet ordre de priorité strict :
1. SEO technique/on-page et GEO/AISEO (visibilité dans ChatGPT, Perplexity, Gemini, AI Overviews)
2. IA appliquée au marketing digital
3. SEA / Social Ads (Google Ads, Meta Ads, LinkedIn Ads, TikTok Ads, Microsoft Ads)
4. Google Analytics / GTM / tracking / attribution
5. UX design / CRO

Ignore les actualités trop générales sans application marketing concrète.

═══ EXIGENCE DE QUALITÉ DES SOURCES ═══
Le critère n'est pas une liste fermée, c'est la réputation réelle auprès des praticiens du secteur. Une source est acceptable si un Responsable Marketing Digital expérimenté la citerait sans hésiter en réunion.

Sont acceptables : la documentation et les blogs officiels des plateformes ; les médias spécialisés de référence ; les études méthodologiquement sérieuses d'éditeurs d'outils ; les experts individuels faisant autorité sur leur domaine.

Sont exclus sans exception : les fils de communiqués de presse, les contenus sponsorisés ou publi-rédactionnels, les agrégateurs, les réseaux sociaux et forums, les blogs d'agence à visée commerciale, tout contenu manifestement produit en masse par IA.

Voici le référentiel actuellement approuvé — c'est ton point de départ, pas ta limite :
${TRUSTED_DOMAINS.map((d) => `- ${d}`).join('\n')}

Si tu identifies une source hors de ce référentiel qui satisfait réellement le critère de réputation, cite-la : elle sera soumise à validation humaine. Mais en cas de doute sur la fiabilité, exclus l'information plutôt que de l'inclure. Une veille courte et sûre vaut mieux qu'une veille fournie et douteuse.

═══ INTERDICTION DE DOUBLON ═══
Ces sujets ont déjà été traités dans les éditions précédentes. Tu ne dois PAS les reprendre :
${covered}

Un sujet est un doublon s'il porte sur la même annonce, la même étude ou le même fait, même reformulé ou vu par une autre source. Un vrai développement nouveau sur un sujet déjà traité est en revanche légitime : dans ce cas, dis explicitement ce qui est nouveau depuis la dernière fois.

═══ ÉTAPE 2 — RÉDACTION ═══
Pour chaque thème ayant au moins une actualité pertinente : 2 à 4 items maximum. Chacun : titre court, 2-3 phrases factuelles (chiffres, dates et noms exacts), source avec lien direct vers l'article précis (jamais vers une page d'accueil ou de catégorie).
Ton informatif, pragmatique, sans superlatifs. Aucune information incertaine ou spéculative. Aucune URL inventée : chaque lien doit provenir de tes résultats de recherche.
Si un thème n'a rien de pertinent et non-doublon, mets exactement : <p class="empty-theme">Rien de significatif aujourd'hui</p>

Synthèse : 4 à 6 puces courtes, priorisant SEO/GEO et IA à information équivalente, avec priorité additionnelle au marché francophone.

Actions : 3 à 5 actions concrètes à l'impératif, contextualisées pour l'enseignement supérieur privé (funnel étudiant, Parcoursup, journées portes ouvertes, fiches Google Business Profile des campus, refontes de site, campagnes de rentrée). Chaque action doit découler d'au moins une actualité citée au-dessus.

═══ ÉTAPE 3 — FORMAT ═══
Réponds UNIQUEMENT avec un fragment HTML : pas de texte avant ni après, pas de bloc de code markdown, pas de balise <style> ni <script>.

<div class="day-entry" data-date="${iso}" data-label="${label}">
  <div class="day-banner">${label}</div>
  <div class="day-body">
    <div class="synthesis-block">
      <p class="synthesis-title">Synthèse du jour</p>
      <ul class="synthesis-list"><li>…</li></ul>
    </div>
    <div class="theme-block">
      <p class="theme-title">SEO / GEO</p>
      <div class="item">
        <p class="item-title">…</p>
        <p class="item-text">…</p>
        <p class="item-source">Source : <a href="URL" target="_blank" rel="noopener">Nom de la source, date</a></p>
      </div>
    </div>
    <div class="theme-block"><p class="theme-title">IA appliquée au marketing digital</p>…</div>
    <div class="theme-block"><p class="theme-title">SEA / Social Ads</p>…</div>
    <div class="theme-block"><p class="theme-title">Google Analytics / GTM</p>…</div>
    <div class="theme-block"><p class="theme-title">UX Design / CRO</p>…</div>
    <div class="actions-block">
      <p class="actions-title">Actions potentielles à réaliser</p>
      <ul class="actions-list"><li>…</li></ul>
    </div>
  </div>
</div>

Les 5 theme-block doivent apparaître dans cet ordre exact, même vides. Encode les caractères spéciaux en entités HTML (&amp;, &gt;, &lt;).`;
}

// ---------------------------------------------------------------------------
// Appel API
// ---------------------------------------------------------------------------
async function callGemini(prompt) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      input: prompt,
      tools: [{ type: 'google_search' }],
    }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`API Gemini ${res.status} : ${body.slice(0, 2000)}`);

  const json = JSON.parse(body);
  if (DEBUG_RAW) {
    writeFileSync(join(ROOT, 'debug-response.json'), JSON.stringify(json, null, 2));
    console.log('Réponse brute écrite dans debug-response.json');
  }
  return json;
}

// La forme de la réponse diffère entre l'API Interactions et generateContent.
// On collecte les fragments de texte du modèle en écartant les blocs de
// raisonnement (thought), puis on retombe sur un parcours générique si besoin.
function extractText(json) {
  const chunks = [];
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.thought === true) return;
    if (typeof node.text === 'string' && node.text.trim()) chunks.push(node.text);
    for (const value of Object.values(node)) walk(value);
  };

  const direct =
    json?.candidates?.[0]?.content?.parts ??
    json?.model_output?.content?.parts ??
    json?.output?.content?.parts;
  if (Array.isArray(direct)) direct.forEach(walk);
  if (!chunks.length && typeof json?.output_text === 'string') chunks.push(json.output_text);
  if (!chunks.length) walk(json);

  return chunks.join('').trim();
}

// ---------------------------------------------------------------------------
// Filtrage : qualité de source + anti-doublon
// ---------------------------------------------------------------------------
function stripFences(text) {
  return text.replace(/^\s*```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function normalizeUrl(u) {
  try {
    const p = new URL(u);
    return (p.hostname.replace(/^www\./, '') + p.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function filterItems(fragment, history) {
  const dropped = [];
  const candidates = [];
  const seenToday = new Set();
  let kept = 0;

  let out = fragment.replace(
    /<div class="item">[\s\S]*?<\/div>\s*(?=<div class="item">|<\/div>)/g,
    (item) => {
      const title =
        (item.match(/<p class="item-title">([\s\S]*?)<\/p>/) || [, '(sans titre)'])[1]
          .replace(/<[^>]+>/g, '').trim();
      const href = (item.match(/<p class="item-source">[\s\S]*?href="([^"]+)"/) || [])[1];

      if (!href) {
        dropped.push(`${title} — aucun lien source`);
        return '';
      }

      const verdict = classify(href);
      if (!verdict.ok) {
        dropped.push(`${title} — ${verdict.reason} (${verdict.host || href})`);
        if (verdict.candidate) candidates.push({ host: verdict.host, title, href });
        return '';
      }

      const key = normalizeUrl(href);
      if (history.urls.has(key)) {
        dropped.push(`${title} — déjà publié un jour précédent`);
        return '';
      }
      if (seenToday.has(key)) {
        dropped.push(`${title} — doublon dans l'édition du jour`);
        return '';
      }

      seenToday.add(key);
      kept += 1;
      return item;
    }
  );

  // Un thème vidé par le filtrage doit afficher le libellé prévu, pas un blanc.
  out = out.replace(
    /(<div class="theme-block">\s*<p class="theme-title">[^<]*<\/p>)(\s*)(<\/div>)/g,
    '$1\n        <p class="empty-theme">Rien de significatif aujourd\'hui</p>\n      $3'
  );

  return { html: out, kept, dropped, candidates };
}

function logCandidates(candidates, iso) {
  if (!candidates.length) return;
  if (!existsSync(CANDIDATES)) {
    writeFileSync(
      CANDIDATES,
      '# Sources candidates\n\n' +
        'Sources citées par le modèle mais absentes du référentiel `scripts/sources.mjs`.\n' +
        "Les items concernés n'ont pas été publiés. Pour approuver une source, ajoutez son\n" +
        'domaine à `TRUSTED_DOMAINS` puis supprimez la ligne ici.\n\n',
      'utf8'
    );
  }
  const lines = candidates
    .map((c) => `- [ ] \`${c.host}\` — ${iso} — ${c.title}\n      ${c.href}`)
    .join('\n');
  appendFileSync(CANDIDATES, lines + '\n', 'utf8');
  console.log(`${candidates.length} source(s) candidate(s) journalisée(s) dans sources-candidates.md`);
}

function validate(fragment, iso) {
  if (/<script|<style/i.test(fragment)) {
    throw new Error('Le fragment contient une balise <script> ou <style> — refusé.');
  }
  if (!fragment.startsWith('<div class="day-entry"')) {
    throw new Error('Le fragment ne commence pas par .day-entry.');
  }
  if (!fragment.includes(`data-date="${iso}"`)) {
    throw new Error(`data-date absent ou incorrect (attendu ${iso}).`);
  }
  const themes = (fragment.match(/class="theme-block"/g) || []).length;
  if (themes !== 5) throw new Error(`5 theme-block attendus, ${themes} trouvés.`);
}

// ---------------------------------------------------------------------------
// Insertion dans index.html
// ---------------------------------------------------------------------------
function injectEntry(html, fragment, iso) {
  const openTag = '<div class="entries">';
  const start = html.indexOf(openTag);
  const footer = html.indexOf('<p class="footer-note">');
  if (start < 0 || footer < 0) {
    throw new Error('Marqueurs .entries / .footer-note introuvables dans index.html.');
  }

  const head = html.slice(0, start + openTag.length);
  const tail = html.slice(footer);
  const body = html.slice(start + openTag.length, footer);

  const existing = body
    .split(/(?=<div class="day-entry")/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('<div class="day-entry"'))
    .map((s) => s.replace(/<\/div>\s*$/, '').trimEnd() + '\n  </div>');

  const others = existing
    .filter((e) => !e.includes(`data-date="${iso}"`))
    .slice(0, MAX_DAYS - 1);

  const entries = [fragment, ...others].map((e) => '\n  ' + e.trim()).join('\n');
  return head + entries + '\n</div>\n\n' + tail;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const date = parisDate();
const current = readFileSync(INDEX, 'utf8');
const history = readHistory(current);

console.log(`Veille du ${date.label} — modèle ${MODEL}`);
console.log(`Historique : ${history.titles.length} sujet(s) déjà traité(s), à ne pas répéter.`);

const raw = await callGemini(buildPrompt(date, history));
const text = extractText(raw);

if (!text) {
  console.error(
    "Impossible d'extraire le texte de la réponse. Relancez avec DEBUG_RAW=1 et " +
      'inspectez debug-response.json.'
  );
  process.exit(1);
}

let fragment = stripFences(text);
const { html: filtered, kept, dropped, candidates } = filterItems(fragment, history);
fragment = filtered;

if (dropped.length) {
  console.warn(`\n${dropped.length} item(s) écarté(s) :`);
  dropped.forEach((d) => console.warn('  - ' + d));
}
logCandidates(candidates, date.iso);

validate(fragment, date.iso);

if (kept < 3) {
  console.error(
    `\nSeulement ${kept} item(s) retenu(s) après filtrage — publication annulée pour ` +
      "ne pas dégrader le site. index.html n'a pas été modifié."
  );
  process.exit(1);
}

console.log(`\n${kept} item(s) publié(s).`);

if (DRY_RUN) {
  console.log('--- DRY RUN, index.html non modifié ---\n');
  console.log(fragment);
  process.exit(0);
}

const updated = injectEntry(current, fragment, date.iso);
writeFileSync(INDEX, updated, 'utf8');
console.log(
  `index.html mis à jour — ${(updated.match(/class="day-entry"/g) || []).length} jour(s) d'historique.`
);
