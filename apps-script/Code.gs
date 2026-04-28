/**
 * AdsVizor Lead Capture — Google Apps Script Web App  v5
 *
 * Source of truth: this file lives at apps-script/Code.gs in the repo.
 * To deploy: copy entire contents → paste into script.google.com editor →
 *            save → Deploy → Manage deployments → New version.
 *
 * Features:
 * - Upsert by email (step-1 partial + step-2 complete = 1 row)
 * - "Formation demandée" = formation_interest + visitor_message merged
 * - Auto-creates missing header columns on every request — no manual sheet edits
 * - RGPD consent proof: stores URL, label text, timestamp, IP, User-Agent
 * - Race-safe (LockService) — concurrent writes serialized
 *
 * Column schema (24 columns A → X):
 * A=0   Date soumission       (timestamp_submitted)
 * B=1   Mis à jour            (updated_at)
 * C=2   Nom                   (visitor_name)
 * D=3   Email                 (visitor_email) ← UPSERT KEY
 * E=4   Téléphone             (visitor_phone)
 * F=5   Formation demandée    (formation_interest + visitor_message merged)
 * G=6   Consentement          (consent_marketing)
 * H=7   Code sécurité         (security_code)
 * I=8   Statut professionnel  (professional_status)
 * J=9   Statut lead           ("Partiel" → "Complet")
 * K=10  Notes                 (manual — never touched by script)
 * L=11  Client                (client_slug)
 * M=12  Offre                 (offer_id)
 * N=13  Version               (page_version)
 * O=14  UTM Source
 * P=15  UTM Medium
 * Q=16  UTM Campagne
 * R=17  UTM Terme
 * S=18  UTM Contenu
 * T=19  Consent URL           (RGPD proof — page where consent was given)
 * U=20  Consent Texte         (RGPD proof — exact label text shown)
 * V=21  Consent Timestamp     (RGPD proof — when user clicked submit)
 * W=22  Consent IP            (RGPD proof — IP from CF-Connecting-IP)
 * X=23  Consent User-Agent    (RGPD proof — browser UA)
 * Y=24  Ville                 (Cloudflare cf.city)
 * Z=25  Région                (Cloudflare cf.region)
 */

const SHEET_COLUMNS = [
  "Date soumission",       // A 0
  "Mis à jour",            // B 1
  "Nom",                   // C 2
  "Email",                 // D 3
  "Téléphone",             // E 4
  "Formation demandée",    // F 5
  "Consentement",          // G 6
  "Code sécurité",         // H 7
  "Statut professionnel",  // I 8
  "Statut lead",           // J 9
  "Notes",                 // K 10
  "Client",                // L 11
  "Offre",                 // M 12
  "Version",               // N 13
  "UTM Source",            // O 14
  "UTM Medium",            // P 15
  "UTM Campagne",          // Q 16
  "UTM Terme",             // R 17
  "UTM Contenu",           // S 18
  "Consent URL",           // T 19
  "Consent Texte",         // U 20
  "Consent Timestamp",     // V 21
  "Consent IP",            // W 22
  "Consent User-Agent",    // X 23
  "Ville",                 // Y 24
  "Région"                 // Z 25
];

const EMAIL_COL   = 3;
const STATUS_COL  = 9;
const UPDATED_COL = 1;
const NUM_COLS    = SHEET_COLUMNS.length; // 26

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: "error", message: "Missing request body." });
    }

    const payload = parseJson_(e.postData.contents);

    // Honeypot — silently accept bot submissions so they don't retry
    if (asString_(payload.hp_trap).trim() || asString_(payload.website).trim()) {
      return jsonResponse_({ status: "ok" });
    }

    const clientSlug = asString_(payload.client_slug).trim();
    if (!clientSlug) return jsonResponse_({ status: "error", message: "client_slug is required." });

    const email = asString_(payload.visitor_email).trim().toLowerCase();
    if (!email)               return jsonResponse_({ status: "error", message: "visitor_email is required." });
    if (!isValidEmail_(email)) return jsonResponse_({ status: "error", message: "visitor_email is invalid." });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss)    return jsonResponse_({ status: "error", message: "No active spreadsheet." });
    const sheet = ss.getActiveSheet();
    if (!sheet) return jsonResponse_({ status: "error", message: "No active sheet." });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) {
      return jsonResponse_({ status: "error", message: "Server busy, please retry." });
    }

    try {
      // Schema sync inside the lock so concurrent writes don't double-add columns
      ensureSchema_(sheet);

      const nowIso    = new Date().toISOString();
      const isPartial = payload.partial === true;
      const newStatus = isPartial ? "Partiel" : "Complet";
      const utm       = (payload.utm && typeof payload.utm === "object") ? payload.utm : {};
      const formation = mergeFormation_(payload.formation_interest, payload.visitor_message);

      const data             = sheet.getDataRange().getValues();
      let   existingSheetRow = -1;

      for (let i = 1; i < data.length; i++) {
        if (asString_(data[i][EMAIL_COL]).trim().toLowerCase() === email) {
          existingSheetRow = i + 1;
          break;
        }
      }

      if (existingSheetRow > 0) {
        // ── UPDATE ──────────────────────────────────────────────────────
        const existingData = data[existingSheetRow - 1];

        sheet.getRange(existingSheetRow, UPDATED_COL + 1).setValue(nowIso);

        // Don't downgrade a Complet lead back to Partiel
        if (!isPartial || asString_(existingData[STATUS_COL]) !== "Complet") {
          sheet.getRange(existingSheetRow, STATUS_COL + 1).setValue(newStatus);
        }

        // Formation: APPEND history with " → " if user changes choice
        // (e.g. picks CACES first, then changes to Informatique).
        // Each segment kept once (no dedup string contains check would miss case-only diffs).
        const formationFinal = appendFormationHistory_(asString_(existingData[5]), formation);

        const updates = [
          [2,  payload.visitor_name],
          [4,  payload.visitor_phone],
          [5,  formationFinal],
          [7,  payload.security_code],
          [8,  payload.professional_status],
          [11, payload.client_slug],
          [12, payload.offer_id],
          [13, payload.page_version],
          [14, utm.source],
          [15, utm.medium],
          [16, utm.campaign],
          [17, utm.term],
          [18, utm.content],
          [19, payload.consent_url],
          [20, payload.consent_text],
          [21, payload.consent_timestamp],
          [22, payload.consent_ip],
          [23, payload.consent_user_agent],
          [24, payload.visitor_city],
          [25, payload.visitor_region]
        ];
        updates.forEach(function(pair) {
          const col0 = pair[0];
          const v = nullIfEmpty_(asString_(pair[1]));
          if (v !== "") sheet.getRange(existingSheetRow, col0 + 1).setValue(v);
        });

        // Consent boolean — update only if explicitly provided
        if (payload.consent_marketing !== null && payload.consent_marketing !== undefined
            && asString_(payload.consent_marketing) !== "") {
          sheet.getRange(existingSheetRow, 7).setValue(normalizeConsent_(payload.consent_marketing));
        }

      } else {
        // ── INSERT ──────────────────────────────────────────────────────
        const row = new Array(NUM_COLS).fill("");
        row[0]  = nowIso;
        row[1]  = nowIso;
        row[2]  = nullIfEmpty_(asString_(payload.visitor_name));
        row[3]  = email;
        row[4]  = nullIfEmpty_(asString_(payload.visitor_phone));
        row[5]  = formation;
        row[6]  = normalizeConsent_(payload.consent_marketing);
        row[7]  = nullIfEmpty_(asString_(payload.security_code));
        row[8]  = nullIfEmpty_(asString_(payload.professional_status));
        row[9]  = newStatus;
        row[10] = "";
        row[11] = clientSlug;
        row[12] = nullIfEmpty_(asString_(payload.offer_id));
        row[13] = nullIfEmpty_(asString_(payload.page_version));
        row[14] = nullIfEmpty_(asString_(utm.source));
        row[15] = nullIfEmpty_(asString_(utm.medium));
        row[16] = nullIfEmpty_(asString_(utm.campaign));
        row[17] = nullIfEmpty_(asString_(utm.term));
        row[18] = nullIfEmpty_(asString_(utm.content));
        row[19] = nullIfEmpty_(asString_(payload.consent_url));
        row[20] = nullIfEmpty_(asString_(payload.consent_text));
        row[21] = nullIfEmpty_(asString_(payload.consent_timestamp));
        row[22] = nullIfEmpty_(asString_(payload.consent_ip));
        row[23] = nullIfEmpty_(asString_(payload.consent_user_agent));
        row[24] = nullIfEmpty_(asString_(payload.visitor_city));
        row[25] = nullIfEmpty_(asString_(payload.visitor_region));
        sheet.appendRow(row);
      }

    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({ status: "ok" });

  } catch (err) {
    return jsonResponse_({ status: "error", message: err instanceof Error ? err.message : "Unexpected error." });
  }
}

function doGet() {
  return jsonResponse_({ status: "ok", message: "AdsVizor lead endpoint v5 is running." });
}

// ---------------------------------------------------------------------------
// Schema management — idempotent, safe to call on every request
// ---------------------------------------------------------------------------

/**
 * Make sure the sheet has all expected columns in row 1.
 * - Empty sheet → write the full header row.
 * - Existing sheet missing some columns at the end → append them.
 * - Never reorders or renames existing columns (preserves user data).
 */
function ensureSchema_(sheet) {
  const lastCol = sheet.getLastColumn();

  // Empty sheet — write the full header row
  if (lastCol === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, NUM_COLS).setValues([SHEET_COLUMNS]);
    return;
  }

  // Read current header row
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  // Append any missing columns at the end
  if (lastCol < NUM_COLS) {
    const missing = SHEET_COLUMNS.slice(lastCol);
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeFormation_(interest, message) {
  const a = asString_(interest).trim();
  const b = asString_(message).trim();
  if (a && b) return a + " — " + b;
  return a || b || "";
}

/**
 * Append a new formation choice to existing history with " → " separator.
 * - If existing is empty → return new
 * - If new is empty → return existing
 * - If new == existing OR new is already in the chain → return existing (no dup)
 * - Otherwise → return "existing → new"
 *
 * Lets us track journeys like "Permis de conduire (CACES) → Informatique & Digital"
 * when a user changes their mind in the dropdown.
 */
function appendFormationHistory_(existing, incoming) {
  const e = asString_(existing).trim();
  const n = asString_(incoming).trim();
  if (!e) return n;
  if (!n) return e;
  if (e === n) return e;
  // Avoid re-appending if incoming is already present in the chain
  const segments = e.split(" → ").map(function(s) { return s.trim(); });
  if (segments.indexOf(n) !== -1) return e;
  return e + " → " + n;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseJson_(text) {
  try { return JSON.parse(text); }
  catch (e) { throw new Error("Invalid JSON body."); }
}

function asString_(value) {
  return (value === null || value === undefined) ? "" : String(value);
}

function nullIfEmpty_(s) {
  const t = asString_(s).trim();
  return t || "";
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeConsent_(value) {
  if (value === true)  return true;
  if (value === false) return false;
  if (value === null || value === undefined) return "";
  const s = String(value).toLowerCase().trim();
  if (s === "true"  || s === "1" || s === "yes" || s === "oui") return true;
  if (s === "false" || s === "0" || s === "no"  || s === "non") return false;
  return "";
}
