/**
 * AdsVizor Webuilder Agent — Apps Script
 *
 * Workflow:
 *   1. Tu envoies un email à webuilder@adsvizor.com avec le catalogue en pièce jointe
 *      Sujet: "WEBUILDER: {client-slug} - Description"
 *   2. Ce script tourne toutes les 5 minutes, détecte l'email
 *   3. Sauvegarde les pièces jointes dans Google Drive → AdsVizor-Webuilder/{slug}/
 *   4. Crée une branche webuilder/{slug} sur GitHub
 *   5. Crée webuilder/{slug}/NOTES.md avec les liens Drive + le corps de ton email
 *   6. Ouvre un PR GitHub → déclenche l'agent de construction du site
 *
 * Setup (une seule fois):
 *   1. Ouvre ce script dans Google Apps Script
 *   2. Menu Extensions → Apps Script Properties → Script Properties → Ajoute:
 *      GITHUB_TOKEN = ghp_xxxxxxxxxxxx  (scope: repo)
 *   3. Mets à jour GITHUB_OWNER ci-dessous avec ton username GitHub
 *   4. Lance createTrigger() une seule fois
 *   5. Autorise les permissions demandées
 */

const CONFIG = {
  WEBUILDER_EMAIL:      'webuilder@adsvizor.com',
  DRIVE_FOLDER_NAME: 'AdsVizor-Webuilder',
  GITHUB_OWNER:      'adsvizor',   // ← à modifier
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

  const threads = GmailApp.search(`to:${CONFIG.WEBUILDER_EMAIL} is:unread`);
  if (threads.length === 0) {
    console.log('Pas de nouveaux emails webuilder.');
    return;
  }

  const webuilderFolder = getOrCreateFolder(CONFIG.DRIVE_FOLDER_NAME);

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      if (!message.isUnread()) continue;
      try {
        const prUrl = processMessage(message, webuilderFolder, token);
        message.markRead();
        addLabel(thread, CONFIG.PROCESSED_LABEL);
        console.log(`✅ PR créé: ${prUrl}`);
      } catch (e) {
        console.error(`❌ Erreur sur message "${message.getSubject()}": ${e.message}`);
        // On ne marque pas comme lu → sera retenté au prochain cycle
      }
    }
  }
}

// ─── Traitement d'un email ───────────────────────────────────────────────────

function processMessage(message, webuilderFolder, token) {
  const subject  = message.getSubject();
  const body     = message.getPlainBody();
  const sender   = message.getFrom();
  const date     = message.getDate();

  // Extrait le slug depuis le sujet: "WEBUILDER: mon-client - description"
  const slugMatch  = subject.match(/WEBUILDER:\s*([a-z0-9][a-z0-9-]*)/i);
  const clientSlug = slugMatch
    ? slugMatch[1].toLowerCase()
    : `client-${Utilities.formatDate(date, 'Europe/Paris', 'yyyyMMdd-HHmm')}`;

  console.log(`📦 Traitement webuilder: ${clientSlug}`);

  // Sauvegarde les pièces jointes dans Drive
  const clientFolder = getOrCreateFolder(clientSlug, webuilderFolder);
  const driveLinks   = saveAttachments(message.getAttachments(), clientFolder);

  // Construit le NOTES.md
  const notesContent = buildNotes({ clientSlug, sender, date, subject, body, driveLinks });

  // Crée la branche + fichier + PR sur GitHub
  return createGitHubPR(clientSlug, notesContent, token);
}

// ─── Sauvegarde des pièces jointes dans Drive ────────────────────────────────

function saveAttachments(attachments, folder) {
  const links = [];
  for (const att of attachments) {
    const file = folder.createFile(att.copyBlob());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    links.push({
      name: att.getName(),
      url:  file.getDownloadUrl(),
      type: att.getContentType(),
      size: Math.round(att.getSize() / 1024) + ' KB',
    });
    console.log(`📎 Sauvegardé: ${att.getName()}`);
  }
  return links;
}

// ─── Construction du NOTES.md ─────────────────────────────────────────────────

function buildNotes({ clientSlug, sender, date, subject, body, driveLinks }) {
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
    `## Fichiers catalogue`,
    ``,
  ];

  if (driveLinks.length === 0) {
    lines.push('_Aucune pièce jointe._');
  } else {
    for (const f of driveLinks) {
      lines.push(`- [${f.name}](${f.url}) _(${f.type}, ${f.size})_`);
    }
  }

  lines.push(``, `## Notes de l'expéditeur`, ``);
  lines.push(body ? body.trim() : '_Aucune note._');

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
  const base = `https://api.github.com/repos/${CONFIG.GITHUB_OWNER}/${CONFIG.GITHUB_REPO}`;
  const branch = `webuilder/${clientSlug}`;
  const filePath = `webuilder/${clientSlug}/NOTES.md`;

  // 1. SHA de main
  const refRes  = JSON.parse(UrlFetchApp.fetch(`${base}/git/ref/heads/main`, { headers }).getContentText());
  const mainSha = refRes.object.sha;

  // 2. Créer la branche (ignore si elle existe déjà)
  UrlFetchApp.fetch(`${base}/git/refs`, {
    method: 'post', headers,
    payload: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
    muteHttpExceptions: true,
  });

  // 3. Créer le fichier NOTES.md
  UrlFetchApp.fetch(`${base}/contents/${filePath}`, {
    method: 'put', headers,
    payload: JSON.stringify({
      message:  `webuilder: nouveau catalogue ${clientSlug}`,
      content:  Utilities.base64Encode(notesContent, Utilities.Charset.UTF_8),
      branch:   branch,
    }),
  });

  // 4. Ouvrir le PR
  const prRes = JSON.parse(UrlFetchApp.fetch(`${base}/pulls`, {
    method: 'post', headers,
    payload: JSON.stringify({
      title: `[Webuilder] Nouveau client: ${clientSlug}`,
      body: [
        `Catalogue reçu par email le ${new Date().toLocaleDateString('fr-FR')}.`,
        ``,
        `L'agent va analyser le catalogue et construire le site \`${clientSlug}\`.`,
        ``,
        `**Branche:** \`${branch}\``,
        `**Fichier:** \`${filePath}\``,
        ``,
        `> Si des informations sont manquantes, l'agent postera ses questions ici en commentaire.`,
      ].join('\n'),
      head: branch,
      base: 'main',
    }),
    muteHttpExceptions: true,
  }).getContentText());

  return prRes.html_url;
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
  // Supprime les triggers existants pour éviter les doublons
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processWebuilderEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processWebuilderEmails')
    .timeBased()
    .everyMinutes(5)
    .create();
  console.log('✅ Trigger créé: processWebuilderEmails toutes les 5 minutes');
}
           