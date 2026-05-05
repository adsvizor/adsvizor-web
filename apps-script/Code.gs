/**
 * AdsVizor Lead Capture — Google Apps Script Web App  v7
 *
 * Source of truth: this file lives at apps-script/Code.gs in the repo.
 * To deploy: copy entire contents → paste into script.google.com editor →
 *            save → Deploy → Manage deployments → New version.
 *
 * Changes in v7:
 * - New column order (Code sécurité, Statut professionnel, Ville, Région moved up)
 * - All reads/writes use column-name lookup — order in the sheet doesn't matter
 * - Auto-creates missing columns on every request
 * - Auto-creates a date tab (YYYY-MM-DD) for each new submission date
 * - reorderColumns_() function: run once manually to physically reorder existing sheet
 *
 * Column schema v7 (26 columns):
 *  0  Date soumission
 *  1  Mis à jour
 *  2  Nom
 *  3  Email               ← UPSERT KEY
 *  4  Téléphone
 *  5  Formation demandée
 *  6  Code sécurité
 *  7  Statut professionnel
 *  8  Ville
 *  9  Région
 * 10  Notes               (manual — never overwritten)
 * 11  Consentement
 * 12  Statut lead         ("Partiel" → "Complet")
 * 13  Client
 * 14  Offre
 * 15  Version
 * 16  UTM Source
 * 17  UTM Medium
 * 18  UTM Campagne
 * 19  UTM Terme
 * 20  UTM Contenu
 * 21  Consent URL
 * 22  Consent Texte
 * 23  Consent Timestamp
 * 24  Consent IP
 * 25  Consent User-Agent
 */

const SHEET_COLUMNS = [
  "Date soumission",       //  0
  "Mis à jour",            //  1
  "Nom",                   //  2
  "Email",                 //  3
  "Téléphone",             //  4
  "Formation demandée",    //  5
  "Code sécurité",         //  6
  "Statut professionnel",  //  7
  "Ville",                 //  8
  "Région",                //  9
  "Notes",                 // 10
  "Consentement",          // 11
  "Statut lead",           // 12
  "Client",                // 13
  "Offre",                 // 14
  "Version",               // 15
  "UTM Source",            // 16
  "UTM Medium",            // 17
  "UTM Campagne",          // 18
  "UTM Terme",             // 19
  "UTM Contenu",           // 20
  "Consent URL",           // 21
  "Consent Texte",         // 22
  "Consent Timestamp",     // 23
  "Consent IP",            // 24
  "Consent User-Agent",    // 25
];

const NUM_COLS = SHEET_COLUMNS.length; // 26

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

function doPost(e) {
  let payload = {};
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: "error", message: "Missing request body." });
    }

    payload = parseJson_(e.postData.contents);

    // Honeypot — silently accept bot submissions so they don't retry
    if (asString_(payload.hp_trap).trim() || asString_(payload.website).trim()) {
      return jsonResponse_({ status: "ok" });
    }

    const clientSlug = asString_(payload.client_slug).trim();
    if (!clientSlug) return jsonResponse_({ status: "error", message: "client_slug is required." });

    const email = asString_(payload.visitor_email).trim().toLowerCase();
    if (!email)                return jsonResponse_({ status: "error", message: "visitor_email is required." });
    if (!isValidEmail_(email)) return jsonResponse_({ status: "error", message: "visitor_email is invalid." });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss)    return jsonResponse_({ status: "error", message: "No active spreadsheet." });
    const sheet = ss.getActiveSheet();
    if (!sheet) return jsonResponse_({ status: "error", message: "No active sheet." });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) {
      return jsonResponse_({ status: "error", message: "Server busy, please retry." });
    }

    try {
      // Schema sync inside the lock so concurrent writes don't double-add columns
      ensureSchema_(sheet);

      // Build column-name → 0-based-index map from CURRENT sheet header
      const colMap = getColMap_(sheet);

      const nowIso    = new Date().toISOString();
      const isPartial = payload.partial === true;
      const newStatus = isPartial ? "Partiel" : "Complet";
      const utm       = (payload.utm && typeof payload.utm === "object") ? payload.utm : {};
      const formation = mergeFormation_(payload.formation_interest, payload.visitor_message);

      const emailColIdx = colMap["Email"];
      const data = sheet.getDataRange().getValues();
      let existingSheetRow = -1;

      for (let i = 1; i < data.length; i++) {
        if (asString_(data[i][emailColIdx]).trim().toLowerCase() === email) {
          existingSheetRow = i + 1; // 1-based
          break;
        }
      }

      if (existingSheetRow > 0) {
        // ── UPDATE ──────────────────────────────────────────────────────
        const existingData = data[existingSheetRow - 1];
        const statusIdx    = colMap["Statut lead"];
        const currentStatus = asString_(existingData[statusIdx]);

        setCellByName_(sheet, existingSheetRow, colMap, "Mis à jour", nowIso);

        // Don't downgrade a Complet lead back to Partiel
        if (!isPartial || currentStatus !== "Complet") {
          setCellByName_(sheet, existingSheetRow, colMap, "Statut lead", newStatus);
        }

        // Formation: append history if user changes choice
        const formationFinal = appendFormationHistory_(
          asString_(existingData[colMap["Formation demandée"]]), formation
        );

        const updates = {
          "Nom":                  payload.visitor_name,
          "Téléphone":            payload.visitor_phone,
          "Formation demandée":   formationFinal,
          "Code sécurité":        payload.security_code,
          "Statut professionnel": payload.professional_status,
          "Ville":                payload.visitor_city,
          "Région":               payload.visitor_region,
          "Client":               payload.client_slug,
          "Offre":                payload.offer_id,
          "Version":              payload.page_version,
          "UTM Source":           utm.source,
          "UTM Medium":           utm.medium,
          "UTM Campagne":         utm.campaign,
          "UTM Terme":            utm.term,
          "UTM Contenu":          utm.content,
          "Consent URL":          payload.consent_url,
          "Consent Texte":        payload.consent_text,
          "Consent Timestamp":    payload.consent_timestamp,
          "Consent IP":           payload.consent_ip,
          "Consent User-Agent":   payload.consent_user_agent,
        };

        for (const [colName, value] of Object.entries(updates)) {
          const v = nullIfEmpty_(asString_(value));
          if (v !== "" && colMap[colName] !== undefined) {
            setCellByName_(sheet, existingSheetRow, colMap, colName, v);
          }
        }

        // Consent boolean — update only if explicitly provided
        if (payload.consent_marketing !== null && payload.consent_marketing !== undefined
            && asString_(payload.consent_marketing) !== "") {
          setCellByName_(sheet, existingSheetRow, colMap, "Consentement",
            normalizeConsent_(payload.consent_marketing));
        }

      } else {
        // ── INSERT ──────────────────────────────────────────────────────
        const row = new Array(sheet.getLastColumn()).fill("");

        function set_(name, value) {
          const idx = colMap[name];
          if (idx !== undefined) row[idx] = value;
        }

        set_("Date soumission",     nowIso);
        set_("Mis à jour",          nowIso);
        set_("Nom",                 nullIfEmpty_(asString_(payload.visitor_name)));
        set_("Email",               email);
        set_("Téléphone",           nullIfEmpty_(asString_(payload.visitor_phone)));
        set_("Formation demandée",  formation);
        set_("Code sécurité",       nullIfEmpty_(asString_(payload.security_code)));
        set_("Statut professionnel",nullIfEmpty_(asString_(payload.professional_status)));
        set_("Ville",               nullIfEmpty_(asString_(payload.visitor_city)));
        set_("Région",              nullIfEmpty_(asString_(payload.visitor_region)));
        set_("Notes",               "");
        set_("Consentement",        normalizeConsent_(payload.consent_marketing));
        set_("Statut lead",         newStatus);
        set_("Client",              clientSlug);
        set_("Offre",               nullIfEmpty_(asString_(payload.offer_id)));
        set_("Version",             nullIfEmpty_(asString_(payload.page_version)));
        set_("UTM Source",          nullIfEmpty_(asString_(utm.source)));
        set_("UTM Medium",          nullIfEmpty_(asString_(utm.medium)));
        set_("UTM Campagne",        nullIfEmpty_(asString_(utm.campaign)));
        set_("UTM Terme",           nullIfEmpty_(asString_(utm.term)));
        set_("UTM Contenu",         nullIfEmpty_(asString_(utm.content)));
        set_("Consent URL",         nullIfEmpty_(asString_(payload.consent_url)));
        set_("Consent Texte",       nullIfEmpty_(asString_(payload.consent_text)));
        set_("Consent Timestamp",   nullIfEmpty_(asString_(payload.consent_timestamp)));
        set_("Consent IP",          nullIfEmpty_(asString_(payload.consent_ip)));
        set_("Consent User-Agent",  nullIfEmpty_(asString_(payload.consent_user_agent)));

        sheet.appendRow(row);
      }

      // ── Sync date tab ────────────────────────────────────────────────
      syncDateTab_(sheet, nowIso);

    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({ status: "ok" });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unexpected error.";
    try { logError_(payload, errMsg); } catch (_) {}
    return jsonResponse_({ status: "error", message: errMsg });
  }
}

function doGet() {
  return jsonResponse_({ status: "ok", message: "AdsVizor lead endpoint v7 is running." });
}

// ---------------------------------------------------------------------------
// Schema management
// ---------------------------------------------------------------------------

/**
 * Ensures the sheet has all SHEET_COLUMNS headers in row 1.
 * Empty sheet → writes full header. Missing columns → appends them.
 * Never reorders or renames existing columns.
 */
function ensureSchema_(sheet) {
  const lastCol = sheet.getLastColumn();

  if (lastCol === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, NUM_COLS).setValues([SHEET_COLUMNS]);
    sheet.setFrozenRows(1);
    return;
  }

  // Read existing headers
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return asString_(h).trim(); });

  // Append any columns from SHEET_COLUMNS that are not yet present
  const missing = SHEET_COLUMNS.filter(function(col) {
    return currentHeaders.indexOf(col) === -1;
  });
  if (missing.length > 0) {
    const nextCol = lastCol + 1;
    sheet.getRange(1, nextCol, 1, missing.length).setValues([missing]);
  }
}

/**
 * Returns a map of { "Column Name" → 0-based-index } from the current header row.
 */
function getColMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach(function(h, i) { map[asString_(h).trim()] = i; });
  return map;
}

/**
 * Sets a cell value by column name (1-based row, 0-based colMap index).
 */
function setCellByName_(sheet, row1based, colMap, colName, value) {
  const idx = colMap[colName];
  if (idx === undefined) return;
  sheet.getRange(row1based, idx + 1).setValue(value);
}

// ---------------------------------------------------------------------------
// Date tab management
// ---------------------------------------------------------------------------

/**
 * Creates (or updates) a tab named "YYYY-MM-DD" containing all leads from
 * the main sheet submitted on that date. Safe to call after every write.
 */
function syncDateTab_(mainSheet, isoTimestamp) {
  const dateStr = isoTimestamp.substring(0, 10); // "YYYY-MM-DD"
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Get or create the date tab
  let dateSheet = ss.getSheetByName(dateStr);
  if (!dateSheet) {
    dateSheet = ss.insertSheet(dateStr);
    // Move date tab after the main sheet
    try {
      const mainIdx = ss.getSheets().indexOf(mainSheet);
      ss.moveActiveSheet(mainIdx + 2); // 1-based after main
    } catch (_) {}
  }

  // Sync headers from main sheet
  const mainLastCol = mainSheet.getLastColumn();
  if (mainLastCol === 0) return;
  const headers = mainSheet.getRange(1, 1, 1, mainLastCol).getValues()[0];

  // Find all main-sheet rows whose "Date soumission" starts with dateStr
  const mainData = mainSheet.getDataRange().getValues();
  const colMap = getColMap_(mainSheet);
  const dateColIdx = colMap["Date soumission"];
  if (dateColIdx === undefined) return;

  const matchingRows = mainData.slice(1).filter(function(row) {
    return asString_(row[dateColIdx]).substring(0, 10) === dateStr;
  });

  // Rebuild date tab completely (clear + rewrite)
  dateSheet.clearContents();
  dateSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  dateSheet.setFrozenRows(1);

  if (matchingRows.length > 0) {
    dateSheet.getRange(2, 1, matchingRows.length, headers.length).setValues(matchingRows);
  }
}

/**
 * Rebuilds ALL date tabs from scratch based on current main sheet data.
 * Run manually from the Apps Script editor when needed.
 */
function rebuildAllDateTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mainSheet = ss.getActiveSheet();
  const mainData  = mainSheet.getDataRange().getValues();
  const colMap    = getColMap_(mainSheet);
  const dateColIdx = colMap["Date soumission"];
  if (dateColIdx === undefined) { Logger.log("Column 'Date soumission' not found."); return; }

  // Collect unique dates from all data rows
  const dates = new Set();
  for (let i = 1; i < mainData.length; i++) {
    const d = asString_(mainData[i][dateColIdx]).substring(0, 10);
    if (d.length === 10) dates.add(d);
  }

  dates.forEach(function(dateStr) {
    syncDateTab_(mainSheet, dateStr + "T00:00:00.000Z");
    Logger.log("Rebuilt tab: " + dateStr);
  });
  Logger.log("Done. " + dates.size + " date tab(s) rebuilt.");
}

// ---------------------------------------------------------------------------
// One-time column reorder (run manually once to fix existing sheet)
// ---------------------------------------------------------------------------

/**
 * Physically reorders the active sheet's columns to match SHEET_COLUMNS.
 * Run this ONCE from the Apps Script editor after deploying v7.
 * Steps: Extensions → Apps Script → select reorderColumns_ → Run
 */
function reorderColumns_() {
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) { Logger.log("Sheet is empty."); return; }

  // Ensure all columns exist first
  ensureSchema_(sheet);

  const lastCol = sheet.getLastColumn();
  const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const currentHeaders = allData[0].map(function(h) { return asString_(h).trim(); });

  // Build reordered data: for each desired column, find its current index
  const reordered = allData.map(function(row) {
    return SHEET_COLUMNS.map(function(colName) {
      const idx = currentHeaders.indexOf(colName);
      return idx !== -1 ? row[idx] : "";
    });
  });

  // Write reordered data back (same range, same size)
  // First clear extra columns if sheet was wider
  if (lastCol > NUM_COLS) {
    sheet.getRange(1, NUM_COLS + 1, lastRow, lastCol - NUM_COLS).clearContent();
  }
  sheet.getRange(1, 1, lastRow, NUM_COLS).setValues(reordered);
  Logger.log("Columns reordered successfully. " + lastRow + " rows processed.");
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

function appendFormationHistory_(existing, incoming) {
  const e = asString_(existing).trim();
  const n = asString_(incoming).trim();
  if (!e) return n;
  if (!n) return e;
  if (e === n) return e;
  const segments = e.split(" → ").map(function(s) { return s.trim(); });
  if (segments.indexOf(n) !== -1) return e;
  return e + " → " + n;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError_(payload, errorMsg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let errSheet = ss.getSheetByName("Erreurs");
  if (!errSheet) {
    errSheet = ss.insertSheet("Erreurs");
    errSheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "Email", "Erreur", "Client", "Téléphone", "Formation", "Payload complet"
    ]]);
    errSheet.setFrozenRows(1);
  }
  const p = payload || {};
  errSheet.appendRow([
    new Date().toISOString(),
    asString_(p.visitor_email),
    errorMsg,
    asString_(p.client_slug),
    asString_(p.visitor_phone),
    asString_(p.formation_interest),
    JSON.stringify(p)
  ]);
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
