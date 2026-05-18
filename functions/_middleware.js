/**
 * Cloudflare Pages — Global routing middleware
 *
 * Routes client-specific HTML pages to their per-client directory,
 * then injects <base href="/"> so all relative links resolve from the
 * domain root regardless of where the file is physically stored.
 *
 * Routing rules:
 *   /blog/*.html  → clients/{slug}/blog/*.html
 *   /*.html       → clients/{slug}/pages/*.html   (non-template pages)
 *   everything else → served as-is (static assets, root templates)
 *
 * Root templates served as-is (NOT routed to client directory):
 *   index.html, blog.html, thank-you.html, contact.html, privacy.html
 *
 * Client slug resolution:
 *   Production: subdomain of request (formations.adsvizor.com → "formations")
 *   Local dev:  ?client= query param, or "formations" fallback
 */

const ROOT_TEMPLATES = new Set([
  '/',
  '/index.html',
  '/blog.html',
  '/thank-you.html',
  '/contact.html',
  '/privacy.html',
]);

// ── Redirections 301 — anciennes URLs vers nouvelles URLs par catégorie ──────
const REDIRECTS_301 = {
  '/formation-bureautique-office.html':    '/bureautique/formation-bureautique-office.html',
  '/formation-excel.html':                 '/bureautique/formation-excel.html',
  '/formation-word.html':                  '/bureautique/formation-word.html',
  '/formation-powerpoint.html':            '/bureautique/formation-powerpoint.html',
  '/formation-outils-collaboratifs.html':  '/bureautique/formation-outils-collaboratifs.html',
  '/formation-wordpress.html':             '/bureautique/formation-wordpress.html',
  '/formation-pao.html':                   '/bureautique/formation-pao.html',
  '/formation-bases-informatique.html':    '/bureautique/formation-bases-informatique.html',
  '/formation-anglais-toeic.html':         '/langues/formation-anglais-toeic.html',
  '/formation-management-leadership.html': '/management/formation-management-leadership.html',
  '/formation-gestion-de-projet.html':     '/management/formation-gestion-de-projet.html',
  '/formation-marketing-digital.html':     '/marketing/formation-marketing-digital.html',
  '/formation-comptabilite-paie.html':     '/finance/formation-comptabilite-paie.html',
  '/formation-developpement-personnel.html': '/dev-personnel/formation-developpement-personnel.html',
  '/formation-bilan-competences.html':     '/dev-personnel/formation-bilan-competences.html',
  '/formation-creation-entreprise.html':   '/entrepreneuriat/formation-creation-entreprise.html',
  '/formation-intelligence-artificielle.html': '/ia/formation-intelligence-artificielle.html',
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const hostParts = url.hostname.split('.');

  // ── Root domain (adsvizor.com or www.adsvizor.com) → serve landing only ──
  // Any request to the root domain serves the landing page (just the logo).
  // Real clients live on subdomains (formations.adsvizor.com, etc.).
  // Localhost is excluded so local dev still works normally.
  const isLocal = url.hostname.includes('localhost') || /^\d+\./.test(url.hostname);
  const isRootDomain = !isLocal && (
    hostParts.length === 2 ||
    (hostParts.length === 3 && hostParts[0] === 'www')
  );
  if (isRootDomain) {
    // Serve static assets (logo, favicon, css, etc.) as-is
    if (!url.pathname.endsWith('.html') && url.pathname !== '/') return next();
    const landingUrl = new URL(url.toString());
    landingUrl.pathname = '/landing.html';
    landingUrl.search = '';
    return env.ASSETS.fetch(landingUrl.toString());
  }

  // ── Redirections 301 pour les anciennes URLs ─────────────────────────────
  if (REDIRECTS_301[url.pathname]) {
    return Response.redirect(
      `${url.protocol}//${url.host}${REDIRECTS_301[url.pathname]}`,
      301
    );
  }

  // ── Pass through non-HTML assets ─────────────────────────────────────────
  const isHtml = url.pathname.endsWith('.html') || url.pathname === '/';
  if (!isHtml) return next();

  // ── Root templates: serve with server-side meta replacement ──────────────
  // Root templates (index.html, blog.html, etc.) are shared across clients.
  // Google indexes them before JS runs, so we replace {{meta_title}} and
  // {{meta_description}} server-side using the client's config.json.
  if (ROOT_TEMPLATES.has(url.pathname)) {
    const slugForMeta = hostParts.length >= 3
      ? hostParts[0]
      : (url.searchParams.get('client') || 'formations');

    // Fetch the root template as-is
    const rootResponse = await next();
    if (!rootResponse.ok) return rootResponse;

    let rootHtml = await rootResponse.text();

    // Fetch client config for meta replacement
    try {
      const configUrl = new URL(url.toString());
      configUrl.pathname = `/clients/${slugForMeta}/config.json`;
      configUrl.search = '';
      const configRes = await env.ASSETS.fetch(configUrl.toString());
      if (configRes.ok) {
        const config = await configRes.json();
        // Replace all config string values as placeholders (covers meta_title,
        // blog_meta_title, contact_meta_title, lang, og_* etc.)
        for (const [key, value] of Object.entries(config)) {
          if (typeof value === 'string') {
            rootHtml = rootHtml.replaceAll(`{{${key}}}`, value);
          }
        }
        // Inject hero image preload in <head> so the browser starts fetching
        // the image immediately at parse time — before any JS runs.
        // This is the primary fix for LCP on the hero image.
        if (config.hero_image_url) {
          const preloadTag = `  <link rel="preload" as="image" href="${config.hero_image_url}" fetchpriority="high">\n`;
          rootHtml = rootHtml.replace('</head>', preloadTag + '</head>');
        }
        // Mark body as server-rendered so CSS reveals it immediately,
        // bypassing the JS-driven FOUC guard (body.ready). This eliminates
        // the config fetch latency from LCP since all placeholders are
        // already replaced above.
        rootHtml = rootHtml.replace('<body', '<body class="server-rendered"');
      }
    } catch (_) { /* serve template as-is if config fetch fails */ }

    return new Response(rootHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  // ── Resolve client slug ──────────────────────────────────────────────────
  const slug = hostParts.length >= 3
    ? hostParts[0]
    : (url.searchParams.get('client') || 'formations');

  // ── Build asset path ─────────────────────────────────────────────────────
  // /blog/sophie-marchand.html → /clients/formations/blog/sophie-marchand.html
  // /formations.html      → /clients/formations/pages/formations.html
  const assetPath = url.pathname.startsWith('/blog/')
    ? `/clients/${slug}${url.pathname}`
    : `/clients/${slug}/pages${url.pathname}`;

  const assetUrl = new URL(url.toString());
  assetUrl.pathname = assetPath;
  assetUrl.search = '';

  // ── Fetch from Pages static assets ──────────────────────────────────────
  const response = await env.ASSETS.fetch(assetUrl.toString());

  if (!response.ok) {
    // Not found in client directory — fall through to default 404
    return next();
  }

  // ── Inject <base href="/"> so relative links resolve from domain root ─────
  const html = await response.text();
  const fixedHtml = html.replace('<head>', '<head>\n    <base href="/">');

  return new Response(fixedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
