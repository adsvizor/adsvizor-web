/**
 * AdsVizor Webuilder Agent
 *
 * Triggered by GitHub Actions on PR open/update (branch: webuilder/{slug})
 * 1. Reads webuilder/{slug}/NOTES.md from the PR branch
 * 2. Downloads catalog files from Drive links
 * 3. Extracts text (PDF, Excel, Word, images)
 * 4. Calls Claude API to analyze + generate config.json + pages
 * 5. Writes clients/{slug}/ structure to repo
 * 6. Posts PR comment with questions if info is missing
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANTHROPIC = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_OWNER = process.env.REPO_OWNER || 'adsvizor';
const REPO_NAME  = process.env.REPO_NAME  || 'adsvizor-web';
const BRANCH     = process.env.BRANCH_NAME || '';

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Extract client slug from branch name (webuilder/{slug})
  const slugMatch = BRANCH.match(/webuilder\/(.+)/);
  if (!slugMatch) {
    console.error(`❌ Cannot extract slug from branch: ${BRANCH}`);
    process.exit(1);
  }
  const clientSlug = slugMatch[1];
  console.log(`📦 Webuilder agent starting for: ${clientSlug}`);

  // Read NOTES.md
  const notesPath = `webuilder/${clientSlug}/NOTES.md`;
  if (!fs.existsSync(notesPath)) {
    await postPRComment(`❌ \`${notesPath}\` not found. Please add a NOTES.md with catalog links and description.`);
    process.exit(1);
  }
  const notes = fs.readFileSync(notesPath, 'utf-8');
  console.log(`✅ Read NOTES.md (${notes.length} chars)`);

  // Extract Drive links from NOTES.md
  const driveLinks = extractDriveLinks(notes);
  console.log(`📎 Found ${driveLinks.length} Drive link(s)`);

  // Download and extract text from catalog files
  let catalogText = '';
  for (const link of driveLinks) {
    try {
      const text = await downloadAndExtract(link);
      catalogText += `\n\n=== File: ${link.name} ===\n${text}`;
      console.log(`✅ Extracted text from ${link.name} (${text.length} chars)`);
    } catch (e) {
      console.warn(`⚠️ Could not extract ${link.name}: ${e.message}`);
    }
  }

  // Call Claude to analyze catalog + generate site config
  console.log('🤖 Calling Claude API to analyze catalog...');
  const result = await analyzeCatalog({ clientSlug, notes, catalogText });

  if (result.questions && result.questions.length > 0) {
    // Post questions as PR comment and stop
    const comment = buildQuestionsComment(result.questions);
    await postPRComment(comment);
    console.log('❓ Questions posted to PR — waiting for answers');
    return;
  }

  // Generate client site structure
  console.log('🏗️ Generating client site...');
  generateClientSite(clientSlug, result.config);

  // Post success comment
  const siteUrl = `https://${clientSlug}.adsvizor.com`;
  await postPRComment([
    `✅ **Site généré pour \`${clientSlug}\`**`,
    ``,
    `Le site a été construit et est prêt à déployer.`,
    `URL cible : ${siteUrl}`,
    ``,
    `**Fichiers créés :**`,
    `- \`clients/${clientSlug}/config.json\``,
    `- \`clients/${clientSlug}/pages/index.html\` (à venir)`,
    ``,
    `Merge ce PR pour déployer sur Cloudflare Pages.`,
  ].join('\n'));

  console.log(`✅ Client site generated for ${clientSlug}`);
}

// ─── Extract Drive links from NOTES.md ───────────────────────────────────────

function extractDriveLinks(notes) {
  const links = [];
  // Match markdown links: [filename](url)
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = regex.exec(notes)) !== null) {
    const url = match[2];
    if (url.includes('drive.google.com') || url.includes('docs.google.com') ||
        url.includes('dropbox.com') || url.includes('onedrive') ||
        url.includes('wetransfer.com')) {
      links.push({ name: match[1], url: convertToDirectDownload(url) });
    }
  }
  return links;
}

function convertToDirectDownload(url) {
  // Google Drive: convert share link to direct download
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
  }
  return url;
}

// ─── Download file and extract text ──────────────────────────────────────────

async function downloadAndExtract(link) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(link.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(link.name).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      text += `\n[Sheet: ${sheetName}]\n`;
      text += XLSX.utils.sheet_to_csv(sheet);
    }
    return text;
  }

  if (ext === '.csv' || ext === '.txt' || ext === '.md') {
    return buffer.toString('utf-8');
  }

  // For images or unknown formats, return a placeholder
  return `[Binary file: ${link.name} — ${buffer.length} bytes]`;
}

// ─── Claude API: analyze catalog ─────────────────────────────────────────────

async function analyzeCatalog({ clientSlug, notes, catalogText }) {
  const systemPrompt = `You are the AdsVizor Webuilder Agent. Your job is to analyze a business catalog and generate a complete website configuration for a lead-capture landing page.

AdsVizor is a multi-tenant landing page system. Each client gets a subdomain (e.g. ${clientSlug}.adsvizor.com).
The site uses a config.json with {{placeholder}} syntax to fill shared HTML templates.

Your output must be a JSON object with:
1. "config": a complete config.json object (following the AdsVizor schema)
2. "questions": array of strings (questions to ask if critical info is missing)

If you have enough information, set "questions" to [].
If critical info is missing (what the business sells, contact info, etc.), set "questions" to a list of specific questions and set "config" to null.

The config.json must include ALL these fields adapted to the business:
- lang, meta_title, meta_description, og_type, og_url, og_image_url
- logo_text, nav_item_0-4 (href + label)
- headline, subheadline, hero_badge, hero_image_url, hero_image_alt
- cta_href, cta_id, cta_label
- stat_1-3 (value + label) — use realistic numbers for the sector
- benefits_title, benefit_1-2 (title, text, image_url, image_alt)
- why_us_title, why_us_a-d (emoji, title, text)
- field_formation_label, field_formation_placeholder, field_formation_opt_* (3-6 options relevant to products/services)
- form_title, form_id, form_action: "https://${clientSlug}.adsvizor.com/api/leads"
- client_slug: "${clientSlug}", offer_id: "lead-gen-v1", page_version: "1.0.0"
- contact_* fields (address, phone, email if available)
- post_1-4 (blog post ideas with title, excerpt, href, image_url)
- show_stats: true, show_testimonials: false

Use Unsplash URLs for images: https://images.unsplash.com/photo-XXXXX?w=1400&h=700&q=85&auto=format&fit=crop
Choose photos relevant to the business sector.

Adapt ALL text to the specific business — do NOT use training/CPF language unless the catalog is about training.
Write in French unless the catalog clearly targets an English-speaking audience.`;

  const userMessage = `Client slug: ${clientSlug}

=== NOTES FROM SENDER ===
${notes}

=== CATALOG CONTENT ===
${catalogText || '(No catalog file attached — analyze from notes only)'}

Generate the complete config.json for this client's landing page.`;

  const response = await ANTHROPIC.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;

  // Extract JSON from response
  const jsonMatch = text.match(/```json\n?([\s\S]+?)\n?```/) ||
                    text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON');
  }

  return JSON.parse(jsonMatch[1]);
}

// ─── Generate client site structure ──────────────────────────────────────────

function generateClientSite(clientSlug, config) {
  const clientDir = `clients/${clientSlug}`;
  fs.mkdirSync(`${clientDir}/pages`, { recursive: true });
  fs.mkdirSync(`${clientDir}/blog`,  { recursive: true });

  // Write config.json
  fs.writeFileSync(
    `${clientDir}/config.json`,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
  console.log(`✅ Written: ${clientDir}/config.json`);

  // Write minimal agent.config.json
  const agentConfig = {
    client_slug: clientSlug,
    base_url: `https://${clientSlug}.adsvizor.com`,
    system_prompt: `You are a professional blog writer for ${config.logo_text || clientSlug}. Write informative, SEO-optimized articles about ${config.meta_description || 'this business'}.`,
    article_types: ['guide', 'tips', 'news'],
    nav_links: [
      { label: 'Accueil', href: '/' },
      { label: 'Blog', href: '/blog.html' },
      { label: 'Contact', href: '/contact.html' },
    ],
  };
  fs.writeFileSync(
    `${clientDir}/agent.config.json`,
    JSON.stringify(agentConfig, null, 2),
    'utf-8'
  );
  console.log(`✅ Written: ${clientDir}/agent.config.json`);
}

// ─── GitHub PR comment ────────────────────────────────────────────────────────

async function postPRComment(body) {
  if (!PR_NUMBER || !GH_TOKEN) {
    console.log('PR comment (dry run):', body);
    return;
  }
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AdsVizor-WebuilderAgent/1.0',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (res.ok) console.log('✅ PR comment posted');
  else console.error('❌ PR comment failed:', await res.text());
}

function buildQuestionsComment(questions) {
  return [
    '## ❓ Webuilder Agent — Questions',
    '',
    "J'ai besoin de quelques informations supplémentaires pour générer le site :",
    '',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Réponds à ce commentaire ou mets à jour `NOTES.md` et pousse un nouveau commit.',
  ].join('\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(async (err) => {
  console.error('❌ Fatal error:', err);
  await postPRComment(`❌ **Webuilder agent error:**\n\`\`\`\n${err.message}\n\`\`\``);
  process.exit(1);
});
