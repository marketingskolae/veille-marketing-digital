// Référentiel de sources de la veille marketing digital.
//
// Deux niveaux :
//   TRUSTED  — sources reconnues par les praticiens du secteur, publiables telles quelles.
//   BLOCKED  — catégories jamais acceptables, quel que soit le contenu.
//
// Une source hors TRUSTED n'est pas publiée, mais elle est journalisée dans
// sources-candidates.md pour arbitrage humain. La liste grandit par décision,
// jamais par accident.

export const TRUSTED_DOMAINS = [
  // ── Officiel : Google ────────────────────────────────────────────────────
  'developers.google.com',        // Search Central, docs, changelogs
  'blog.google',                  // annonces produit
  'support.google.com',           // notes de version GA4 / GTM / Ads
  'thinkwithgoogle.com',
  'analytics.google.com',
  'ads.google.com',
  'business.google.com',
  'web.dev',                      // Core Web Vitals, perf

  // ── Officiel : autres plateformes ────────────────────────────────────────
  'about.ads.microsoft.com',
  'business.facebook.com',
  'business.linkedin.com',
  'openai.com',                   // évolutions ChatGPT → enjeu GEO direct
  'anthropic.com',
  'perplexity.ai',

  // ── Médias spécialisés de référence ──────────────────────────────────────
  'searchengineland.com',
  'searchenginejournal.com',
  'seroundtable.com',
  'ppchero.com',
  'marketingland.com',
  'smashingmagazine.com',

  // ── Éditeurs d'outils, contenus factuels et études ───────────────────────
  'ahrefs.com',
  'semrush.com',
  'sistrix.com',
  'screamingfrog.co.uk',
  'optmyzr.com',                  // référence PPC reconnue
  'adalysis.com',
  'searchpilot.com',              // SEO testing, méthodologie solide

  // ── Experts individuels faisant autorité ─────────────────────────────────
  'simoahava.com',                // LA référence GTM / tracking
  'analyticsmania.com',
  'ipullrank.com',                // Mike King, référence GEO
  'kevin-indig.com',              // Growth Memo
  'sparktoro.com',                // Rand Fishkin

  // ── UX / CRO ─────────────────────────────────────────────────────────────
  'nngroup.com',
  'baymard.com',
  'cxl.com',
  'speero.com',
  'goodui.org',

  // ── Francophone ──────────────────────────────────────────────────────────
  'blogdumoderateur.com',
  'abondance.com',                // Olivier Andrieu
  'webrankinfo.com',              // Olivier Duffez
  'sri-france.org',               // données marché pub digitale FR
  'alliancedigitale.org',
];

// Catégories jamais publiables, même si le domaine venait à être ajouté.
// Filtrage sur la chaîne complète de l'URL.
export const BLOCKED_PATTERNS = [
  /prnewswire|businesswire|globenewswire|newswire|einpresswire/i, // fils de communiqués
  /medium\.com|substack\.com\/p\/|linkedin\.com\/pulse/i,          // auto-publication
  /reddit\.com|quora\.com|x\.com|twitter\.com|facebook\.com\/(?!business)/i, // réseaux et forums
  /\/tag\/|\/category\/|\/author\/|\/page\/\d+/i,                  // pages de listing, pas d'article
  /\?utm_|\/sponsored|\/advertorial|\/partenaire/i,                // contenus sponsorisés
];

export function classify(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return { ok: false, reason: 'URL invalide' };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url)) {
      return { ok: false, reason: `catégorie exclue (${pattern.source.slice(0, 30)})`, host };
    }
  }

  const trusted = TRUSTED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  if (!trusted) {
    return { ok: false, reason: 'domaine hors référentiel', host, candidate: true };
  }

  return { ok: true, host };
}
