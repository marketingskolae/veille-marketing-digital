#!/usr/bin/env node
// Diagnostic d'accès à l'API Gemini.
// Isole la cause d'un 429 : quota général, ou recherche Google indisponible ?
//
//   $env:GEMINI_API_KEY = Read-Host "Cle Gemini"
//   node scripts/diagnostic.mjs

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

if (!API_KEY) {
  console.error('GEMINI_API_KEY manquante.');
  process.exit(1);
}

async function essai(libelle, body) {
  process.stdout.write(`${libelle.padEnd(42)} `);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const texte = await res.text();
    if (res.ok) {
      console.log('OK');
      return { ok: true, json: JSON.parse(texte) };
    }
    let message = texte.slice(0, 160);
    try {
      const j = JSON.parse(texte);
      message = (Array.isArray(j) ? j[0] : j)?.error?.message || message;
    } catch {}
    console.log(`ÉCHEC ${res.status} — ${message.trim().slice(0, 120)}`);
    return { ok: false, status: res.status };
  } catch (e) {
    console.log('ERREUR RÉSEAU — ' + e.message);
    return { ok: false };
  }
}

console.log(`Modèle testé : ${MODEL}\n`);

// 1. Appel nu : teste le quota de base du modèle.
const sansOutil = await essai('1. Génération simple (sans recherche)', {
  model: MODEL,
  input: 'Réponds exactement : OK',
});

// 2. Même appel avec la recherche Google : teste l'accès au grounding.
const avecOutil = await essai('2. Génération avec recherche Google', {
  model: MODEL,
  input: 'Quelle est la date du jour selon le web ? Réponds en une phrase.',
  tools: [{ type: 'google_search' }],
});

console.log('\n─── Interprétation ───');
if (sansOutil.ok && avecOutil.ok) {
  console.log("Tout fonctionne. Le 429 précédent venait d'une limite par minute :");
  console.log('attendez 60 secondes et relancez la génération.');
} else if (sansOutil.ok && !avecOutil.ok) {
  console.log('Le modèle répond, mais PAS avec la recherche Google.');
  console.log('=> Le grounding exige un compte de facturation actif sur le projet.');
  console.log('   Activez la facturation : https://aistudio.google.com/apikey');
} else {
  console.log("Même un appel simple échoue : le problème n'est pas la recherche.");
  console.log('=> Vérifiez le palier et les quotas : https://aistudio.google.com/rate-limit');
}

// La forme exacte de la réponse en cas de succès n'est pas documentée : on la
// journalise pour valider (ou corriger) l'extracteur de generate.mjs.
const reussi = avecOutil.json || sansOutil.json;
if (reussi) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('debug-response.json', JSON.stringify(reussi, null, 2));
  console.log('\nRéponse réussie enregistrée dans debug-response.json');
  console.log('Clés de premier niveau :', Object.keys(reussi).join(', '));
}
