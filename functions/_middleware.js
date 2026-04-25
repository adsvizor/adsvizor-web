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

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ── Pass through non-HTML and root templates ─────────────────────────────
  const isHtml = url.pathname.endsWith('.html') || url.pathname === '/';
  if (!isHtml || ROOT_TEMPLATES.has(url.pathname)) return next();

  // ── Resolve client slug ──────────────────────────────────────────────────
  const hostParts = url.hostname.split('.');
  const slug = hostParts.length >= 3
    ? hostParts[0]
    : (url.searchParams.get('client') || 'formations');

  // ── Build asset path ─────────────────────────────────────────────────────
  // /blog/sophie-marchand.html → /clients/formations/blog/sophie-marchand.html
  // /formations-cpf.html      → /clients/formations/pages/formations-cpf.html
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
