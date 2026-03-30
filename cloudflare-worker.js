/**
 * Cloudflare Worker — CORS proxy for AdsVizor leads
 *
 * Purpose:
 * - Browser POSTs to this Worker (same Cloudflare domain / controlled origin).
 * - Worker adds CORS headers for allowed origins.
 * - Worker forwards request body as-is to Google Apps Script Web App.
 *
 * Endpoint:
 * - POST /api/leads
 * - OPTIONS /api/leads  (preflight)
 */

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyEoenh92UzrurC6dxuKnSUabc-8wTQORaajQ6QNZ_ELovRGn4F21eEa9pShfNXzHCo/exec";

/**
 * Allow production domain + local dev.
 * - Keep this tight (do not use "*" with credentials).
 */
const ALLOWED_ORIGINS = new Set([
  "https://adsvizor.com",
  "https://www.adsvizor.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

function corsHeaders(origin) {
  // If the Origin is not explicitly allowed, return null (no CORS headers).
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // Helps CDNs/cache differentiate responses by Origin
    Vary: "Origin"
  };
}

function jsonResponse(status, body, origin) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  const cors = corsHeaders(origin);
  if (cors) Object.assign(headers, cors);
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    // Only handle the single API route.
    if (url.pathname !== "/api/leads") {
      return new Response("Not Found", { status: 404 });
    }

    // Preflight (CORS)
    if (request.method === "OPTIONS") {
      const cors = corsHeaders(origin);
      if (!cors) return new Response("Forbidden", { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, OPTIONS" } });
    }

    // Enforce origin allow-list for browser requests.
    // (Non-browser clients might omit Origin; we treat that as forbidden by default.)
    const cors = corsHeaders(origin);
    if (!cors) {
      return jsonResponse(403, { status: "error", message: "Origin not allowed." }, origin);
    }

    // Forward the request body as-is.
    // Keep content-type if provided; Apps Script typically expects application/json.
    const contentType = request.headers.get("Content-Type") || "application/json";
    const body = await request.arrayBuffer();

    const upstreamRes = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Accept: "application/json"
      },
      body
    });

    // Return upstream response, but add CORS headers for the browser.
    const resHeaders = new Headers(upstreamRes.headers);
    for (const [k, v] of Object.entries(cors)) resHeaders.set(k, v);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders
    });
  }
};

