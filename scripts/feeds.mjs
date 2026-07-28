// Collecte des sources de la veille via leurs flux RSS/Atom.
//
// C'est ici que la contrainte de qualité devient structurelle : le modèle ne
// verra jamais autre chose que ce que ces flux publient. Il n'a aucun moyen de
// citer une source hors liste, ni d'inventer une URL.
//
// Toutes les URL ci-dessous ont été vérifiées : code 200 et items datés.

// `heures` fixe la fenêtre de fraîcheur propre à chaque source. Les médias
// d'actualité publient plusieurs fois par jour : 48 h suffisent. Les sources de
// fond (NN/g, Smashing, Simo Ahava, blogs officiels) publient une à deux fois
// par semaine — avec 48 h elles seraient muettes en permanence et le thème
// UX/CRO resterait vide. L'anti-doublon garantit qu'un article capté dans une
// fenêtre large ne ressort jamais deux fois.
export const FEEDS = [
  // ── SEO / GEO ────────────────────────────────────────────────────────────
  { nom: 'Search Engine Land', url: 'https://searchengineland.com/feed', theme: 'seo', heures: 48 },
  { nom: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/feed/', theme: 'seo', heures: 48 },
  { nom: 'Search Engine Roundtable', url: 'https://www.seroundtable.com/index.rdf', theme: 'seo', heures: 48 },
  { nom: 'Google Search Central', url: 'https://developers.google.com/search/blog/feed.xml', theme: 'seo', heures: 240 },
  { nom: 'Ahrefs', url: 'https://ahrefs.com/blog/feed/', theme: 'seo', heures: 96 },
  { nom: 'Abondance', url: 'https://www.abondance.com/feed', theme: 'seo', heures: 48 },
  { nom: 'WebRankInfo', url: 'https://www.webrankinfo.com/rss.xml', theme: 'seo', heures: 168 },
  { nom: 'SparkToro', url: 'https://sparktoro.com/blog/feed/', theme: 'seo', heures: 168 },
  { nom: 'Aleyda Solis', url: 'https://www.aleydasolis.com/en/feed/', theme: 'seo', heures: 336 },
  { nom: 'iPullRank', url: 'https://ipullrank.com/feed', theme: 'seo', heures: 336 },

  // ── SEA / Social Ads ─────────────────────────────────────────────────────
  { nom: 'Search Engine Land — PPC', url: 'https://searchengineland.com/library/ppc/feed', theme: 'sea', heures: 48 },
  { nom: 'Google Ads & Commerce', url: 'https://blog.google/products/ads-commerce/rss/', theme: 'sea', heures: 240 },
  { nom: 'Jon Loomer', url: 'https://www.jonloomer.com/feed/', theme: 'sea', heures: 96 },

  // ── Généralistes : alimentent IA, SEA et GA4 selon les jours ─────────────
  { nom: 'Blog du Modérateur', url: 'https://www.blogdumoderateur.com/feed/', theme: 'mixte', heures: 48 },
  { nom: 'Semrush', url: 'https://www.semrush.com/blog/feed/', theme: 'mixte', heures: 96 },
  // Flux d'archive volumineux (~1000 items) et largement hors marketing
  // (recherche, sécurité) : fenêtre courte, le tri est fait par le modèle.
  { nom: 'OpenAI', url: 'https://openai.com/blog/rss.xml', theme: 'mixte', heures: 96 },

  // ── Analytics / Tracking ─────────────────────────────────────────────────
  { nom: 'Simo Ahava', url: 'https://www.simoahava.com/index.xml', theme: 'ga4', heures: 720 },

  // ── UX / CRO ─────────────────────────────────────────────────────────────
  // UX Collective a été retiré : c'est une publication de « craft » design —
  // carrière, essais, philosophie du métier — et non une source CRO. Sur dix
  // articles collectés, deux seulement relevaient d'une veille marketing. Le
  // thème sera intermittent, ce qui vaut mieux qu'un thème rempli à côté.
  { nom: 'Nielsen Norman Group', url: 'https://www.nngroup.com/feed/rss/', theme: 'ux', heures: 240 },
  { nom: 'Smashing Magazine', url: 'https://www.smashingmagazine.com/feed/', theme: 'ux', heures: 240 },
];

const UA = 'Mozilla/5.0 (compatible; VeilleMarketingBot/1.0)';

// ---------------------------------------------------------------------------
// Analyse XML minimale, tolérante aux trois dialectes rencontrés :
// RSS 2.0 (<item><pubDate>), RDF (<item><dc:date>), Atom (<entry><updated>).
// ---------------------------------------------------------------------------
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function champ(bloc, ...noms) {
  for (const nom of noms) {
    const m = bloc.match(new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i'));
    if (m) return decode(m[1]);
  }
  return '';
}

function lien(bloc) {
  // Atom place l'URL dans un attribut href ; RSS et RDF dans le texte.
  const atom = bloc.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)
    || bloc.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  const texte = champ(bloc, 'link', 'guid');
  const url = (texte.startsWith('http') ? texte : '') || (atom ? atom[1] : '');
  return url.trim();
}

function parse(xml, source) {
  const blocs = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  return blocs
    .map((bloc) => {
      const dateBrute = champ(bloc, 'pubDate', 'dc:date', 'updated', 'published', 'date');
      const date = new Date(dateBrute);
      return {
        titre: champ(bloc, 'title'),
        url: lien(bloc),
        resume: champ(bloc, 'description', 'summary', 'content:encoded').slice(0, 400),
        date: isNaN(date) ? null : date,
        source: source.nom,
        theme: source.theme,
      };
    })
    .filter((e) => e.titre && e.url);
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------
async function recuperer(source) {
  try {
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(source.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: ctrl.signal,
    });
    clearTimeout(minuteur);
    if (!res.ok) return { source, entrees: [], erreur: `HTTP ${res.status}` };
    return { source, entrees: parse(await res.text(), source) };
  } catch (e) {
    return { source, entrees: [], erreur: e.name === 'AbortError' ? 'délai dépassé' : e.message };
  }
}

export async function collecter({ verbose = true } = {}) {
  const tout = [];
  const rapport = [];

  // Les flux d'un même domaine sont appelés en série : trois requêtes
  // simultanées vers searchengineland.com déclenchent un 429.
  const parDomaine = new Map();
  for (const source of FEEDS) {
    const hote = new URL(source.url).hostname;
    if (!parDomaine.has(hote)) parDomaine.set(hote, []);
    parDomaine.get(hote).push(source);
  }

  const resultats = (
    await Promise.all(
      [...parDomaine.values()].map(async (groupe) => {
        const sorties = [];
        for (const source of groupe) sorties.push(await recuperer(source));
        return sorties;
      })
    )
  ).flat();

  for (const { source, entrees, erreur } of resultats) {
    // Une entrée sans date exploitable est écartée : impossible de garantir
    // qu'elle relève bien de la fenêtre de fraîcheur.
    const limite = Date.now() - (source.heures || 48) * 3600 * 1000;
    const recentes = entrees.filter((e) => e.date && e.date.getTime() >= limite);
    tout.push(...recentes);
    rapport.push({
      source: source.nom,
      total: entrees.length,
      recentes: recentes.length,
      fenetre: source.heures || 48,
      erreur: erreur || null,
    });
  }

  if (verbose) {
    for (const r of rapport) {
      const etat = r.erreur
        ? `ÉCHEC (${r.erreur})`
        : `${String(r.recentes).padStart(2)} retenu(s) / ${String(r.total).padStart(3)} — fenêtre ${r.fenetre}h`;
      console.log(`  ${r.source.padEnd(28)} ${etat}`);
    }
    const muets = rapport.filter((r) => r.erreur);
    if (muets.length) {
      console.warn(`\n${muets.length} flux muet(s) : ${muets.map((m) => m.source).join(', ')}`);
    }
  }

  // Déduplication inter-flux : un même article syndiqué deux fois (Search
  // Engine Land publie sur son flux général et ses flux thématiques).
  const vues = new Set();
  const uniques = tout.filter((e) => {
    const cle = normaliser(e.url);
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });

  return uniques.sort((a, b) => b.date - a.date);
}

export function normaliser(url) {
  try {
    const p = new URL(url);
    return (p.hostname.replace(/^www\./, '') + p.pathname).replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}
