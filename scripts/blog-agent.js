import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MODEL = 'claude-sonnet-4-6';
const MIN_WORDS = 800;
const MAX_BLOG_POSTS = 10;

// ── Client resolution ──────────────────────────────────────────────────────
const CLIENT_SLUG = (process.env.CLIENT_SLUG || 'formations').trim();
console.log(`📦 Client: ${CLIENT_SLUG}`);
let agentConfig;
try {
  agentConfig = JSON.parse(readFileSync(path.join(ROOT, `clients/${CLIENT_SLUG}/agent.config.json`), 'utf-8'));
} catch (err) {
  console.error(`❌ Cannot load clients/${CLIENT_SLUG}/agent.config.json: ${err.message}`);
  process.exit(1);
}
const ARTICLE_TYPES = agentConfig.article_types;

const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
if (!apiKey) {
  console.error('❌ ANTHROPIC_API_KEY is not set or empty');
  process.exit(1);
}
console.log(`🔑 API key loaded (length: ${apiKey.length}, prefix: ${apiKey.slice(0, 10)}...)`);
const client = new Anthropic({ apiKey });

// ── File helpers ───────────────────────────────────────────────────────────

function readJSON(relPath) {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), 'utf-8'));
}

function writeJSON(relPath, data) {
  writeFileSync(path.join(ROOT, relPath), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function todayFr() {
  return new Date().toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

function countWords(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
}

// ── Topic rotation ─────────────────────────────────────────────────────────

function selectNextType(history) {
  const recent = history.articles.slice(-3).map(a => a.type);
  // Pick a type not used in the last 3 articles
  for (const type of ARTICLE_TYPES) {
    if (!recent.includes(type)) return type;
  }
  // All 3 used recently — pick the least recently used
  return ARTICLE_TYPES
    .map(t => ({ type: t, lastIndex: history.articles.map(a => a.type).lastIndexOf(t) }))
    .sort((a, b) => a.lastIndex - b.lastIndex)[0].type;
}

// ── Claude prompts ─────────────────────────────────────────────────────────

async function generateArticle(type, history) {
  const recentArticles = history.articles
    .slice(-6)
    .map(a => `- [${a.type}] ${a.title}`)
    .join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: agentConfig.system_prompt,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [
      {
        role: 'user',
        content: `${agentConfig.type_instructions[type]}

Articles déjà publiés (évite les doublons) :
${recentArticles}

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown ni \`\`\`json) avec cette structure exacte :
{
  "slug": "blog-[mot-cle-hyphenate]",
  "title_tag": "Titre SEO complet — AdsVizor",
  "meta_description": "Description meta 120-155 caractères",
  "article_tag": "${agentConfig.type_labels[type]}",
  "h1": "Titre principal de l'article",
  "intro": "Paragraphe d'introduction accrocheur, 80-120 mots",
  "sections": [
    {"type": "h2", "content": "Titre de section"},
    {"type": "p", "content": "Paragraphe de texte"},
    {"type": "quote", "content": "Texte de la citation", "cite": "— Prénom Nom, contexte"},
    {"type": "highlight", "title": "TITRE EN MAJUSCULES", "items": ["Point 1", "Point 2", "Point 3"]}
  ],
  "sources": [
    {"name": "Nom de la source", "url": "https://url-officielle.fr", "description": "Ce que contient cette source"}
  ],
  "keyword": "mot-clé principal pour le SEO"
}`
      }
    ]
  });

  const raw = response.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Claude response is not valid JSON:\n${raw.slice(0, 300)}`);
  }
}

async function optimizeSEO(article) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `Vérifie et optimise le SEO pour le mot-clé "${article.keyword}".

Title tag actuel (${article.title_tag.length} car): ${article.title_tag}
H1 actuel: ${article.h1}
Meta description actuelle (${article.meta_description.length} car): ${article.meta_description}

Règles :
- Le mot-clé doit apparaître dans le title, le H1 et l'intro
- Meta description : 120-155 caractères avec le mot-clé
- Title tag : 50-65 caractères max

Réponds UNIQUEMENT avec un JSON valide (sans markdown) :
{
  "title_tag": "...",
  "meta_description": "...",
  "h1": "..."
}`
      }
    ]
  });

  try {
    const optimized = JSON.parse(response.content[0].text.trim());
    return { ...article, ...optimized };
  } catch {
    console.warn('⚠️  SEO optimization parse failed, keeping original');
    return article;
  }
}

// ── HTML assembly ──────────────────────────────────────────────────────────

function buildSections(sections) {
  return sections.map(s => {
    switch (s.type) {
      case 'h2':
        return `\n        <h2>${s.content}</h2>`;
      case 'p':
        return `\n        <p>${s.content}</p>`;
      case 'quote':
        return `\n        <div class="article-quote">\n          ${s.content}\n          <cite>${s.cite}</cite>\n        </div>`;
      case 'highlight':
        return `\n        <div class="article-highlight">\n          <h3>${s.title}</h3>\n          <ul>\n            ${s.items.map(i => `<li>${i}</li>`).join('\n            ')}\n          </ul>\n        </div>`;
      default:
        return '';
    }
  }).join('');
}

function buildSources(sources) {
  if (!sources || sources.length === 0) return '';
  const items = sources.map(s =>
    `<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a> : ${s.description}</li>`
  ).join('\n            ');
  return `\n        <div class="article-highlight" style="margin-top:48px;">\n          <h3>Sources</h3>\n          <ul>\n            ${items}\n          </ul>\n        </div>`;
}

function buildCTA(type) {
  const cta = agentConfig.cta_blocks[type] || agentConfig.cta_blocks[agentConfig.article_types[0]];
  return `\n        <div class="article-cta-block">\n          <h2>${cta.h2}</h2>\n          <p>${cta.p}</p>\n          <a href="${agentConfig.cta_link}">Parler à un conseiller →</a>\n        </div>`;
}

function assembleHTML(article, type, date) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>${article.title_tag}</title>
    <meta name="description" content="${article.meta_description}" />

    <meta property="og:title" content="${article.h1}" />
    <meta property="og:description" content="${article.meta_description}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${agentConfig.base_url}/blog/${article.slug.replace(/^blog-/, '')}.html" />
    <meta property="og:image" content="${agentConfig.base_url}/og-image.jpg" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

    <link rel="stylesheet" href="main.css" />
    <script defer src="script.js?v=12"></script>
  <style>
    .site-logo { height: 60px; width: auto; }
    @media (min-width: 768px) { .site-logo { height: 72px; } }
    @media (max-width: 767px) {
      .nav-toggle { display: flex !important; }
      header nav:not(.is-open) { display: none !important; }
    }
    @media (min-width: 768px) {
      .nav-toggle { display: none !important; }
      header nav { display: block !important; }
    }
    .article-wrap { max-width: 740px; margin: 0 auto; padding: 48px 20px 80px; }
    .article-back { display: inline-flex; align-items: center; gap: 6px; font-size: 0.9rem; font-weight: 600; color: var(--color-muted, #64748b); text-decoration: none; margin-bottom: 32px; transition: color 140ms; }
    .article-back:hover { color: var(--color-accent, #2563eb); text-decoration: none; }
    .article-meta { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .article-tag { background: #eff6ff; color: #2563eb; font-size: 0.78rem; font-weight: 700; padding: 4px 12px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
    .article-date { font-size: 0.88rem; color: var(--color-muted, #64748b); }
    .article-wrap h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 800; line-height: 1.2; letter-spacing: -0.03em; color: #0f172a; margin: 0 0 24px; }
    .article-intro { font-size: 1.1rem; color: #334155; line-height: 1.75; margin-bottom: 36px; padding-bottom: 36px; border-bottom: 1px solid #e2e8f0; }
    .article-quote { background: #eff6ff; border-left: 4px solid #2563eb; border-radius: 0 12px 12px 0; padding: 20px 24px; margin: 32px 0; font-size: 1.05rem; font-style: italic; color: #1e3a8a; line-height: 1.65; }
    .article-quote cite { display: block; margin-top: 10px; font-style: normal; font-size: 0.85rem; font-weight: 700; color: #2563eb; }
    .article-wrap h2 { font-size: 1.3rem; font-weight: 700; color: #0f172a; margin: 40px 0 14px; letter-spacing: -0.02em; }
    .article-wrap p { font-size: 1rem; color: #334155; line-height: 1.8; margin: 0 0 18px; }
    .article-highlight { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px 28px; margin: 32px 0; }
    .article-highlight h3 { font-size: 0.95rem; font-weight: 700; color: #2563eb; margin: 0 0 14px; text-transform: uppercase; letter-spacing: 0.05em; }
    .article-highlight ul { margin: 0; padding-left: 20px; }
    .article-highlight li { font-size: 0.97rem; color: #334155; line-height: 1.7; margin-bottom: 6px; }
    .article-cta-block { background: linear-gradient(135deg, #2563eb, #4f46e5); border-radius: 20px; padding: 36px 32px; margin: 48px 0 0; text-align: center; color: #fff; }
    .article-cta-block h2 { color: #fff; margin: 0 0 12px; font-size: 1.4rem; }
    .article-cta-block p { color: rgba(255,255,255,0.85); margin: 0 0 24px; font-size: 1rem; }
    .article-cta-block a { display: inline-block; background: #fff; color: #2563eb; font-weight: 700; font-size: 1rem; padding: 14px 32px; border-radius: 12px; text-decoration: none; transition: opacity 140ms; }
    .article-cta-block a:hover { opacity: 0.9; text-decoration: none; }
  </style>
  </head>

  <body>
    <header>
      <div>
        <a href="/" class="site-logo-link"><img src="/logo.png" alt="AdsVizor" class="site-logo" /></a>
      </div>
      <nav aria-label="Navigation principale">
        <ul>
          ${agentConfig.nav_links.map(l => `<li><a href="${l.href}">${l.label}</a></li>`).join('\n          ')}
        </ul>
      </nav>
    </header>
    <button class="nav-toggle" aria-expanded="false" aria-label="Ouvrir le menu">
      <span></span><span></span><span></span>
    </button>

    <main>
      <div class="article-wrap">
        <a href="blog.html" class="article-back">← Retour au blog</a>
        <div class="article-meta">
          <span class="article-tag">${article.article_tag}</span>
          <span class="article-date">${date}</span>
        </div>
        <h1>${article.h1}</h1>
        <p class="article-intro">${article.intro}</p>${buildSections(article.sections)}${buildSources(article.sources)}${buildCTA(type)}
      </div>
    </main>

    <footer>
      <p>${agentConfig.footer_text}</p>
    </footer>
  </body>
</html>
`;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(html, keyword) {
  const $ = cheerio.load(html);
  const errors = [];

  if (html.includes('{{') || html.includes('}}'))
    errors.push('Unresolved {{placeholders}} found');

  if ($('h1').length !== 1)
    errors.push(`Expected 1 H1, found ${$('h1').length}`);

  if ($('h2').length < 2)
    errors.push(`Expected ≥2 H2, found ${$('h2').length}`);

  if ($('.article-cta-block').length === 0)
    errors.push('Missing .article-cta-block');

  if ($('a[href="contact.html"]').length === 0)
    errors.push('Missing link to contact.html');

  const wordCount = countWords($('.article-wrap').html() || '');
  if (wordCount < MIN_WORDS)
    errors.push(`Too short: ${wordCount} words (min ${MIN_WORDS})`);

  if (errors.length > 0)
    throw new Error(`Validation failed:\n${errors.map(e => `  • ${e}`).join('\n')}`);

  const kw = keyword.toLowerCase().split(' ')[0];
  if (!$('h1').text().toLowerCase().includes(kw))
    console.warn(`⚠️  Keyword "${kw}" not in H1 (non-blocking)`);

  console.log(`✅ Validation passed — ${wordCount} words`);
}

// ── Config update ──────────────────────────────────────────────────────────

function updateConfig(article, date) {
  const config = readJSON(`clients/${CLIENT_SLUG}/config.json`);

  // Collect current posts (newest first, skip empty slots)
  const posts = [];
  for (let i = 1; i <= MAX_BLOG_POSTS; i++) {
    const href = config[`post_${i}_href`];
    if (href) posts.push({
      href,
      date: config[`post_${i}_date`],
      tag:  config[`post_${i}_tag`],
      title:   config[`post_${i}_title`],
      excerpt: config[`post_${i}_excerpt`],
    });
  }

  // Prepend new article
  posts.unshift({
    href:    `blog/${article.slug.replace(/^blog-/, '')}.html`,
    date,
    tag:     article.article_tag,
    title:   article.h1,
    excerpt: article.intro.replace(/<[^>]+>/g, '').slice(0, 200) + '…',
  });

  // Evict oldest if over limit, return them for cleanup
  const evicted = [];
  while (posts.length > MAX_BLOG_POSTS) evicted.push(posts.pop());

  // Write all 10 slots (empty string for unused slots)
  for (let i = 1; i <= MAX_BLOG_POSTS; i++) {
    const p = posts[i - 1];
    config[`post_${i}_href`]    = p ? p.href    : '';
    config[`post_${i}_date`]    = p ? p.date    : '';
    config[`post_${i}_tag`]     = p ? p.tag     : '';
    config[`post_${i}_title`]   = p ? p.title   : '';
    config[`post_${i}_excerpt`] = p ? p.excerpt : '';
  }

  writeJSON(`clients/${CLIENT_SLUG}/config.json`, config);
  console.log('✅ config.json updated');
  return evicted;
}

// ── History update ─────────────────────────────────────────────────────────

function updateHistory(article, type, evicted = []) {
  const history = readJSON(`data/${CLIENT_SLUG}/blog-history.json`);
  history.articles.push({
    slug: article.slug,
    title: article.h1,
    type,
    date: new Date().toISOString().split('T')[0],
    keyword: article.keyword
  });
  if (history.articles.length > 20)
    history.articles = history.articles.slice(-20);

  // Remove evicted articles from history and delete their HTML files
  if (evicted.length > 0) {
    const evictedSlugs = new Set(evicted.map(e => e.href.replace('.html', '')));
    history.articles = history.articles.filter(a => !evictedSlugs.has(a.slug));
    for (const ev of evicted) {
      try {
        unlinkSync(path.join(ROOT, `clients/${CLIENT_SLUG}/${ev.href}`));
        console.log(`🗑️  Deleted evicted article: clients/${CLIENT_SLUG}/${ev.href}`);
      } catch { console.warn(`⚠️  Could not delete clients/${CLIENT_SLUG}/${ev.href}`); }
    }
  }

  writeJSON(`data/${CLIENT_SLUG}/blog-history.json`, history);
  console.log('✅ blog-history.json updated');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Blog agent starting…');

  const history = readJSON(`data/${CLIENT_SLUG}/blog-history.json`);
  const type = selectNextType(history);
  console.log(`📝 Type: ${type}`);

  // Step 1 — Generate article
  console.log('✍️  Generating article…');
  let article;
  try {
    article = await generateArticle(type, history);
  } catch (err) {
    console.error('❌ Generation failed:', err.message);
    process.exit(1);
  }
  console.log(`✅ Generated: "${article.h1}"`);

  // Step 2 — SEO optimization
  console.log('🔍 Optimizing SEO…');
  try {
    article = await optimizeSEO(article);
    console.log('✅ SEO done');
  } catch (err) {
    console.warn('⚠️  SEO optimization failed, keeping original:', err.message);
  }

  // Step 3 — Assemble HTML
  const date = todayFr();
  const html = assembleHTML(article, type, date);

  // Step 4 — Validate
  console.log('🔎 Validating…');
  try {
    validate(html, article.keyword);
  } catch (err) {
    console.error('❌ Validation failed:', err.message);
    process.exit(1);
  }

  // Step 5 — Write file
  const filename = article.slug.replace(/^blog-/, '');
  const blogDir = path.join(ROOT, `clients/${CLIENT_SLUG}/blog`);
  mkdirSync(blogDir, { recursive: true });
  const filePath = path.join(blogDir, `${filename}.html`);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ Written: clients/${CLIENT_SLUG}/blog/${filename}.html`);

  // Step 6 — Update config.json + history
  const evicted = updateConfig(article, date);
  updateHistory(article, type, evicted);

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📰 ${article.h1}`);
  console.log(`🔑 Keyword : ${article.keyword}`);
  console.log(`📅 Date    : ${date}`);
  console.log(`🔗 File    : clients/${CLIENT_SLUG}/blog/${filename}.html`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
