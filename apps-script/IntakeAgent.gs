/**
 * AdsVizor Webuilder Agent — Apps Script
 *
 * Workflow:
 *   1. Tu envoies un email à webuilder@adsvizor.com avec le catalogue en pièce jointe
 *      Sujet: "WEBUILDER: {client-slug} - Description"
 *   2. Ce script tourne toutes les 5 minutes, détecte l'email
 *   3. Extrait le texte des pièces jointes (PDF, Excel, Word) directement dans Apps Script
 *   4. Crée une branche webuilder/{slug} sur GitHub
 *   5. Crée webuilder/{slug}/NOTES.md avec les infos + le texte extrait
 *   6. Ouvre un PR GitHub → déclenche l'agent de construction du site
 *
 * Setup (une seule fois):
 *   1. Apps Script → Services → ajouter "Drive API" (v2)
 *   2. Project Settings → Script Properties → Ajoute:
 *      GITHUB_TOKEN = ghp_xxxxxxxxxxxx  (scope: repo)
 *   3. Lance createTrigger() une seule fois
 *
 * Format de l'email:
 *   À      : webuilder@adsvizor.com
 *   Sujet  : WEBUILDER: {client-slug} - Description
 *   Corps  : Toutes les infos client (nom, adresse, tel, email, zone, marques...)
 *   Pièces : catalogue PDF, Excel, Word, etc.
 */

const CONFIG = {
  WEBUILDER_EMAIL:   'webuilder@adsvizor.com',
  DRIVE_FOLDER_NAME: 'AdsVizor-Webuilder',
  GITHUB_OWNER:      'adsvizor',
  GITHUB_REPO:       'adsvizor-web',
  GITHUB_TOKEN_KEY:  'GITHUB_TOKEN',
  PROCESSED_LABEL:   'webuilder-processed',
};

// ─── Point d'entrée principal ─────────────────────────────────────────────────

function processWebuilderEmails() {
  const token = PropertiesService.getScriptProperties().getProperty(CONFIG.GITHUB_TOKEN_KEY);
  if (!token) {
    console.error('❌ GITHUB_TOKEN manquant dans Script Properties');
    return;
  }

  const threads = GmailApp.search(
    `subject:"WEBUILDER:" -label:${CONFIG.PROCESSED_LABEL} -from:notifications@github.com`
  );
  if (threads.length === 0) {
    console.log('Pas de nouveaux emails webuilder.');
    return;
  }

  const webuilderFolder = getOrCreateFolder(CONFIG.DRIVE_FOLDER_NAME);

  for (const thread of threads) {
    const message = thread.getMessages()[0];
    try {
      const prUrl = processMessage(message, webuilderFolder, token);
      addLabel(thread, CONFIG.PROCESSED_LABEL);
      if (prUrl) {
        console.log(`✅ PR créé: ${prUrl}`);
      }
    } catch (e) {
      console.error(`❌ Erreur sur "${message.getSubject()}": ${e.stack}`);
    }
  }
}

// ─── Traitement d'un email ───────────────────────────────────────────────────

function processMessage(message, webuilderFolder, token) {
  const subject = message.getSubject();
  const body    = message.getPlainBody();
  const sender  = message.getFrom();
  const date    = message.getDate();

  const slugMatch = subject.match(/WEBUILDER:\s*([a-z0-9][a-z0-9-]*)/i);
  if (!slugMatch) {
    console.log(`⏭️ Skipping: pas de slug valide dans "${subject}"`);
    return null;
  }
  const clientSlug = slugMatch[1].toLowerCase();
  console.log(`📦 Traitement webuilder: ${clientSlug}`);

  // Sauvegarde + extraction texte des pièces jointes
  const clientFolder  = getOrCreateFolder(clientSlug, webuilderFolder);
  const attachments   = processAttachments(message.getAttachments(), clientFolder);

  // Construit le NOTES.md avec texte extrait embarqué
  const notesContent = buildNotes({ clientSlug, sender, date, subject, body, attachments });

  return createGitHubPR(clientSlug, notesContent, token);
}

// ─── Traitement des pièces jointes (sauvegarde + extraction texte) ────────────

function processAttachments(attachments, folder) {
  const results = [];
  for (const att of attachments) {
    const name = att.getName();
    const type = att.getContentType();
    const size = Math.round(att.getSize() / 1024);
    console.log(`📎 Traitement: ${name} (${type}, ${size} KB)`);

    // Sauvegarde dans Drive
    const blob = att.copyBlob();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const driveUrl = `https://drive.google.com/file/d/${file.getId()}/view`;

    // Extraction du texte
    let extractedText = null;
    try {
      if (type === 'application/pdf') {
        extractedText = extractTextFromPdf(att.copyBlob(), name);
      } else if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                 type === 'application/vnd.ms-excel') {
        extractedText = extractTextFromExcel(att.copyBlob(), name);
      } else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                 type === 'application/msword') {
        extractedText = extractTextFromWord(att.copyBlob(), name);
      } else if (type.startsWith('text/')) {
        extractedText = att.getDataAsString('UTF-8');
      }
    } catch (e) {
      console.warn(`⚠️ Extraction échouée pour ${name}: ${e.message}`);
    }

    results.push({ name, type, size: `${size} KB`, driveUrl, extractedText });
  }
  return results;
}

// ─── Extraction texte PDF (via conversion Google Docs) ───────────────────────

function extractTextFromPdf(blob, name) {
  console.log(`📄 Extraction PDF: ${name}`);
  blob.setName(name);

  // Convertit le PDF en Google Doc pour extraire le texte
  const driveFile = Drive.Files.insert(
    { title: `_tmp_webuilder_${name}`, mimeType: MimeType.GOOGLE_DOCS },
    blob,
    { convert: true }
  );

  try {
    const doc  = DocumentApp.openById(driveFile.id);
    const text = doc.getBody().getText();
    console.log(`✅ PDF extrait: ${text.length} caractères`);
    return text;
  } finally {
    // Supprime le fichier temporaire
    try { Drive.Files.remove(driveFile.id); } catch (e) {}
  }
}

// ─── Extraction texte Excel (via conversion Google Sheets) ───────────────────

function extractTextFromExcel(blob, name) {
  console.log(`📊 Extraction Excel: ${name}`);
  blob.setName(name);

  const driveFile = Drive.Files.insert(
    { title: `_tmp_webuilder_${name}`, mimeType: MimeType.GOOGLE_SHEETS },
    blob,
    { convert: true }
  );

  try {
    const ss    = SpreadsheetApp.openById(driveFile.id);
    const lines = [];
    for (const sheet of ss.getSheets()) {
      lines.push(`\n[Feuille: ${sheet.getName()}]`);
      const data = sheet.getDataRange().getValues();
      for (const row of data) {
        const rowText = row.filter(c => c !== '').join(' | ');
        if (rowText.trim()) lines.push(rowText);
      }
    }
    const text = lines.join('\n');
    console.log(`✅ Excel extrait: ${text.length} caractères`);
    return text;
  } finally {
    try { Drive.Files.remove(driveFile.id); } catch (e) {}
  }
}

// ─── Extraction texte Word (via conversion Google Docs) ──────────────────────

function extractTextFromWord(blob, name) {
  console.log(`📝 Extraction Word: ${name}`);
  blob.setName(name);

  const driveFile = Drive.Files.insert(
    { title: `_tmp_webuilder_${name}`, mimeType: MimeType.GOOGLE_DOCS },
    blob,
    { convert: true }
  );

  try {
    const doc  = DocumentApp.openById(driveFile.id);
    const text = doc.getBody().getText();
    console.log(`✅ Word extrait: ${text.length} caractères`);
    return text;
  } finally {
    try { Drive.Files.remove(driveFile.id); } catch (e) {}
  }
}

// ─── Construction du NOTES.md ─────────────────────────────────────────────────

function buildNotes({ clientSlug, sender, date, subject, body, attachments }) {
  const dateStr = Utilities.formatDate(date, 'Europe/Paris', 'yyyy-MM-dd HH:mm');
  const lines = [
    `# Webuilder: ${clientSlug}`,
    ``,
    `| Champ | Valeur |`,
    `|-------|--------|`,
    `| Date | ${dateStr} |`,
    `| De | ${sender} |`,
    `| Sujet | ${subject} |`,
    ``,
    `## Notes de l'expéditeur`,
    ``,
    body ? body.trim() : '_Aucune note._',
    ``,
    `## Fichiers catalogue`,
    ``,
  ];

  if (attachments.length === 0) {
    lines.push('_Aucune pièce jointe._');
  } else {
    for (const f of attachments) {
      lines.push(`- [${f.name}](${f.driveUrl}) _(${f.type}, ${f.size})_`);
    }
  }

  // Texte extrait des fichiers (directement embarqué — pas besoin de télécharger)
  const withText = attachments.filter(f => f.extractedText && f.extractedText.trim().length > 50);
  if (withText.length > 0) {
    lines.push(``, `## Contenu extrait des fichiers`, ``);
    for (const f of withText) {
      lines.push(`### ${f.name}`, ``, f.extractedText.trim().slice(0, 15000), ``);
    }
  }

  return lines.join('\n');
}

// ─── Création de la branche + fichier + PR sur GitHub ────────────────────────

function createGitHubPR(clientSlug, notesContent, token) {
  const headers = {
    'Authorization': `token ${token}`,
    'Accept':        'application/vnd.github.v3+json',
    'Content-Type':  'application/json',
    'User-Agent':    'AdsVizor-WebuilderAgent/1.0',
  };
  const base     = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}`;
  const branch   = `webuilder/${clientSlug}`;
  const filePath = `webuilder/${clientSlug}/NOTES.md`;

  // 1. SHA de main
  const refRes  = JSON.parse(UrlFetchApp.fetch(`${base}/git/ref/heads/main`, { headers }).getContentText());
  const mainSha = refRes.object.sha;

  // 2. Créer la branche (ignore 422 si elle existe déjà)
  UrlFetchApp.fetch(`${base}/git/refs`, {
    method: 'post', headers,
    payload: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    muteHttpExceptions: true,
  });

  // 3. Créer ou mettre à jour NOTES.md (SHA requis si le fichier existe déjà)
  const existingRes  = UrlFetchApp.fetch(`${base}/contents/${filePath}?ref=${branch}`, {
    headers, muteHttpExceptions: true,
  });
  const existingData = JSON.parse(existingRes.getContentText());
  const filePayload  = {
    message: `webuilder: nouveau catalogue ${clientSlug}`,
    content: Utilities.base64Encode(notesContent, Utilities.Charset.UTF_8),
    branch:  branch,
  };
  if (existingData.sha) filePayload.sha = existingData.sha;
  UrlFetchApp.fetch(`${base}/contents/${filePath}`, {
    method: 'put', headers,
    payload: JSON.stringify(filePayload),
  });

  // 4. Ouvrir le PR (récupère l'existant si déjà créé)
  const prCreateRes = UrlFetchApp.fetch(`${base}/pulls`, {
    method: 'post', headers,
    payload: JSON.stringify({
      title: `[Webuilder] Nouveau client: ${clientSlug}`,
      body: [
        `Catalogue reçu par email le ${new Date().toLocaleDateString('fr-FR')}.`,
        ``,
        `L'agent va analyser le catalogue et construire le site \`${clientSlug}\`.`,
        ``,
        `**Branche:** \`${branch}\``,
      ].join('\n'),
      head: branch,
      base: 'main',
    }),
    muteHttpExceptions: true,
  });
  const prData = JSON.parse(prCreateRes.getContentText());

  if (!prData.html_url) {
    const existingPrsRes = UrlFetchApp.fetch(
      `${base}/pulls?head=${CONFIG.GITHUB_OWNER}:${branch}&state=open`,
      { headers }
    );
    const existingPrs = JSON.parse(existingPrsRes.getContentText());
    return existingPrs.length > 0
      ? existingPrs[0].html_url
      : `https://github.com/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}/tree/${branch}`;
  }

  return prData.html_url;
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function getOrCreateFolder(name, parent) {
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function addLabel(thread, labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  label.addToThread(thread);
}

// ─── Setup: lance cette fonction une seule fois ───────────────────────────────

function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processWebuilderEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processWebuilderEmails')
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log('✅ Trigger créé: processWebuilderEmails toutes les 5 minutes');
}
