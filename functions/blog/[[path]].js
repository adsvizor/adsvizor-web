/**
 * Cloudflare Pages Function — Blog article router
 *
 * Intercepts all requests to /blog/* and serves the article from
 * the client-specific directory: clients/{slug}/blog/{file}
 *
 * Injects <base href="/"> so every relative link (CSS, JS, nav, back-link)
 * resolves from the domain root — no need to rewrite existing HTML files.
 *
 * URL routing:
 *   formations.adsvizor.com/blog/sophie-marchand.html
 *   → clients/formations/blog/sophie-marchand.html
 *
 * Local dev fallback: ?client=formations (Live Server doesn't have subdomains)
 */
export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  // ── Resolve client slug ──────────────────────────────────────────────────
  const hostParts = url.hostname.split('.');
  let slug;
  if (hostParts.length >= 3) {
    // Production subdomain: formations.adsvizor.com → "formations"
    slug = hostParts[0];
  } else {
    // Local dev: fall back to ?client= query param, then "formations"
    slug = url.searchParams.get('client') || 'formations';
  }

  // ── Build asset path ─────────────────────────────────────────────────────
  const pathSegments = params.path || [];
  const assetUrl = new URL(url.toString());
  assetUrl.pathname = `/clients/${slug}/blog/${pathSegments.join('/')}`;
  assetUrl.search = '';  // strip query params before fetching asset

  // ── Fetch asset from Pages deployment ────────────────────────────────────
  const response = await env.ASSETS.fetch(assetUrl.toString());

  if (!response.ok) {
    return new Response(`Article not found (client: ${slug})`, {
      status: response.status,
      headers: { 'content-type': 'text/plain' }
    });
  }

  // ── Inject <base href="/"> so relative links resolve from domain root ─────
  const html = await response.text();
  const fixedHtml = html.replace('<head>', '<head>\n    <base href="/">');

  return new Response(fixedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}
