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
 *   2. Project Settings → Script Properties → Ajoute:
 *      GITHUB_TOKEN = ghp_xxxxxxxxxxxx  (scope: repo)
 *   3. Lance createTrigger() une seule fois
 *   4. Autorise les permissions demandées
 *
 * Format de l'email:
 *   À      : webuilder@adsvizor.com
 *   Sujet  : WEBUILDER: {client-slug} - Description
 *   Corps  : Infos sur le client (nom, adresse, tel, zone, marques, etc.)
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
    // Prend le premier message non-traité du thread
    const message = thread.getMessages()[0];
    try {
      const prUrl = processMessage(message, webuilderFolder, token);
      addLabel(thread, CONFIG.PROCESSED_LABEL);
      if (prUrl) {
        console.log(`✅ PR créé: ${prUrl}`);
      }
    } catch (e) {
      console.error(`❌ Erreur sur "${message.getSubject()}": ${e.message}`);
      // On ne label pas → sera retenté au prochain cycle
    }
  }
}

// ─── Traitement d'un email ───────────────────────────────────────────────────

function processMessage(message, webuilderFolder, token) {
  const subject = message.getSubject();
  const body    = message.getPlainBody();
  const sender  = message.getFrom();
  const date    = message.getDate();

  // Extrait le slug depuis le sujet: "WEBUILDER: mon-client - description"
  const slugMatch = subject.match(/WEBUILDER:\s*([a-z0-9][a-z0-9-]*)/i);
  if (!slugMatch) {
    console.log(`⏭️ Skipping: pas de slug valide dans "${subject}"`);
    return null;
  }
  const clientSlug = slugMatch[1].toLowerCase();
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
    // URL publique téléchargeable directement (sans auth) depuis GitHub Actions
    links.push({
      name: att.getName(),
      url:  `https://drive.google.com/uc?id=${file.getId()}&export=download&confirm=t`,
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

  // 4. Ouvrir le PR (si un PR existe déjà pour cette branche, récupérer son URL)
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
        `**Fichier:** \`${filePath}\``,
        ``,
        `> Si des informations sont manquantes, l'agent postera ses questions ici en commentaire.`,
      ].join('\n'),
      head: branch,
      base: 'main',
    }),
    muteHttpExceptions: true,
  });
  const prData = JSON.parse(prCreateRes.getContentText());

  // Si PR déjà existant (422), récupérer l'URL du PR ouvert
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
