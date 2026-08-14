require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { AnthropicFoundry } = require('@anthropic-ai/foundry-sdk');
const { PrismaClient } = require('./generated/prisma');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const app = express();

// ---------------------------------------------------------------------------
// Diagnostics. The browser can only ever report "fetch threw" for anything
// that fails below the HTTP layer — wrong origin, connection refused, reset
// mid-flight — so the single most useful question is whether the request
// arrives here AT ALL. Every request is logged on arrival and again on
// completion; if the browser reports an error and nothing appears here, the
// request never reached this process and the problem is on the client side
// (usually the page being served from somewhere other than this server).
// ---------------------------------------------------------------------------
const started = new Date().toISOString();
console.log(`[server] pid=${process.pid} node=${process.version} boot=${started}`);

let reqSeq = 0;
app.use((req, res, next) => {
  const id = ++reqSeq;
  const t0 = Date.now();
  const origin = req.get('origin') || req.get('referer') || '-';
  const len = req.get('content-length') || '0';
  console.log(`[req ${id}] --> ${req.method} ${req.originalUrl} origin=${origin} bytes=${len} ip=${req.ip}`);
  res.on('finish', () => {
    console.log(`[req ${id}] <-- ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - t0}ms`);
  });
  // Fires when the client hangs up before the response completed — this is
  // what a browser-side "Failed to fetch" looks like from in here.
  res.on('close', () => {
    if (!res.writableEnded) {
      console.warn(`[req ${id}] !!! client disconnected before response completed after ${Date.now() - t0}ms`);
    }
  });
  next();
});

app.use(cors());
app.use(express.json({ limit: '500kb' }));

// A body larger than the limit, or malformed JSON, surfaces here rather than
// as a silent hang — both would otherwise look like "backend unreachable".
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err instanceof SyntaxError)) {
    console.error(`[server] rejected body: ${err.type || 'invalid JSON'} (${err.message})`);
    return res.status(413).json({ error: `Request body rejected: ${err.type || 'invalid JSON'}` });
  }
  return next(err);
});

process.on('uncaughtException', err => {
  console.error('[server] FATAL uncaughtException:', err && err.stack || err);
});
process.on('unhandledRejection', err => {
  console.error('[server] unhandledRejection:', err && err.stack || err);
});
['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach(sig => {
  process.on(sig, () => { console.warn(`[server] received ${sig} — exiting`); process.exit(0); });
});
process.on('exit', code => console.warn(`[server] process exiting with code ${code}`));

// In-memory upload handling for the chat's file-parse feature — files are
// parsed to text and discarded, never written to disk. 15 MB cap.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Parse an uploaded PDF / Word (.docx) / Excel (.xlsx/.xls/.csv) to plain
// text so the chat agent can read a pasted brief the same way it reads a
// typed message. Extension-driven (mimetypes are unreliable across browsers).
async function extractFileText(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    const res = await parser.getText();
    return res.text || '';
  }
  if (ext === 'docx' || ext === 'doc') {
    const res = await mammoth.extractRawText({ buffer });
    return res.value || '';
  }
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    // Flatten every sheet to CSV-ish text, sheet name as a header, so
    // structured cells survive as readable rows the model can interpret.
    return wb.SheetNames.map(name => `### Sheet: ${name}\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`).join('\n\n');
  }
  throw new Error(`Unsupported file type ".${ext}". Upload a PDF, Word (.docx), or Excel (.xlsx/.csv) file.`);
}

// POST /api/upload (multipart, field name "file") -> { filename, text }.
// The client then feeds `text` into the normal agent-fill flow, so an
// uploaded brief behaves exactly like a long typed message.
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    const text = (await extractFileText(req.file.buffer, req.file.originalname)).trim();
    if (!text) return res.status(422).json({ error: 'Could not extract any text from that file (it may be scanned/image-only).' });
    // Guard against a giant document blowing the model's context — keep the
    // first ~24k chars, which is plenty for a campaign brief.
    res.json({ filename: req.file.originalname, text: text.slice(0, 24000) });
  } catch (err) {
    console.error('[server] File parse failed:', err);
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Claude on Microsoft Foundry. The SDK builds
// https://{resource}.services.ai.azure.com/anthropic/ from `resource` and
// sends the key as the x-api-key header; `resource` and `baseURL` are
// mutually exclusive, so only one of them is passed.
const apiKey = process.env.ANTHROPIC_FOUNDRY_API_KEY;
const foundryResource = process.env.ANTHROPIC_FOUNDRY_RESOURCE;
if (!apiKey || !foundryResource) {
  console.warn('[server] ANTHROPIC_FOUNDRY_API_KEY / ANTHROPIC_FOUNDRY_RESOURCE not set — the agent routes will return 503 until server/.env has both.');
}
const ai = apiKey && foundryResource ? new AnthropicFoundry({ apiKey, resource: foundryResource }) : null;
const MODEL = process.env.CLAUDE_DEPLOYMENT || 'claude-opus-4-8';
// Anthropic requires an explicit output cap. 16k keeps a long multi-field
// propose_fill well within limits while staying under the SDK's HTTP timeout
// for non-streaming requests (the SSE stream below is our own, not the model's).
const MAX_OUTPUT_TOKENS = 16000;
// Large multi-field messages (e.g. "fill the whole CMA sheet", 45 fields
// across 10 groups) are deliberately chunked to at most 10 fields per
// propose_fill call, one call per turn (see BASE_SYSTEM_PROMPT) — cramming
// everything into a single call was unreliable (dropped/partial
// assignments). 15 rounds is headroom for match_section + a chunk's worth
// of tool calls plus any read/nav calls in the same turn, not for looping
// through every chunk at once.
const MAX_TOOL_ROUNDS = 15;

// Real backend for the New Campaign Request modal's Brand/Indication search —
// SQLite via Prisma (prisma/schema.prisma: BrandIndication), seeded with fake
// brand-master data by prisma/seed.js. Stands in for a real TactPlan/MDS feed.
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' }),
});

// GET /api/brands?q=kis -> distinct brand names matching the query, for the
// Brand field's search-as-you-type dropdown.
app.get('/api/brands', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = await prisma.brandIndication.findMany({
    where: q ? { brand: { contains: q } } : undefined,
    distinct: ['brand'],
    select: { brand: true },
    orderBy: { brand: 'asc' },
    take: 25,
  });
  res.json({ brands: rows.map(r => r.brand) });
});

// GET /api/indications?brand=Kisqali -> that brand's known indications, for
// the Indication field's dropdown once a brand has been picked/typed.
app.get('/api/indications', async (req, res) => {
  const brand = (req.query.brand || '').toString().trim();
  if (!brand) return res.json({ indications: [] });
  const rows = await prisma.brandIndication.findMany({
    where: { brand: { equals: brand } },
    select: { indication: true },
    orderBy: { indication: 'asc' },
  });
  res.json({ indications: rows.map(r => r.indication) });
});

// GET /api/brand-lookup?brand=Kisqali&indication=... -> drives the modal's
// Asset Scope inference: brand+indication both on record => Update Existing
// Campaign; brand on record but this indication isn't => New Indication
// Launch; brand not on record at all => New Brand Launch stays available.
app.get('/api/brand-lookup', async (req, res) => {
  const brand = (req.query.brand || '').toString().trim();
  const indication = (req.query.indication || '').toString().trim();
  if (!brand) return res.json({ brandKnown: false, indicationKnown: false });

  const brandMatches = await prisma.brandIndication.findMany({ where: { brand: { equals: brand } } });
  const brandKnown = brandMatches.length > 0;
  const indicationKnown = brandKnown && !!indication &&
    brandMatches.some(m => m.indication.toLowerCase() === indication.toLowerCase());
  res.json({ brandKnown, indicationKnown });
});

// ===========================================================================
// Persisted form entries — every field value actually saved, tagged by its
// stage (phase column: preplan/plan/exec) so the chat agent can ground
// answers about already-entered data in a real query (get_entries tool
// below) instead of only ever proposing new fills or relying on whatever
// happens to still be in the conversation's history.
// ===========================================================================

// POST /api/entries — bulk upsert. Called after a section Save or a
// confirmed chat-fill proposal with every currently-filled field in that
// section (client: hqe-requirement-studio-mock_2.html's syncSectionEntries()).
app.post('/api/entries', async (req, res) => {
  const { tactplanId, entries } = req.body || {};
  if (!tactplanId || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'tactplanId and entries[] are required.' });
  }
  for (const e of entries) {
    if (!e.sectionId || !e.fieldId || !e.phase) continue;
    await prisma.fieldEntry.upsert({
      where: { tactplanId_sectionId_fieldId: { tactplanId, sectionId: e.sectionId, fieldId: e.fieldId } },
      update: { value: String(e.value ?? ''), phase: e.phase, sectionName: e.sectionName || e.sectionId, fieldLabel: e.fieldLabel || e.fieldId },
      create: {
        tactplanId, sectionId: e.sectionId, sectionName: e.sectionName || e.sectionId,
        phase: e.phase, fieldId: e.fieldId, fieldLabel: e.fieldLabel || e.fieldId, value: String(e.value ?? ''),
      },
    });
  }
  res.json({ ok: true, count: entries.length });
});

// GET /api/entries?tactplanId=&phase=&sectionId= — for debugging/inspection;
// also what the get_entries agent tool queries under the hood.
app.get('/api/entries', async (req, res) => {
  const { tactplanId, phase, sectionId } = req.query;
  if (!tactplanId) return res.status(400).json({ error: 'tactplanId is required.' });
  const rows = await prisma.fieldEntry.findMany({
    where: {
      tactplanId: tactplanId.toString(),
      ...(phase ? { phase: phase.toString() } : {}),
      ...(sectionId ? { sectionId: sectionId.toString() } : {}),
    },
    orderBy: [{ sectionId: 'asc' }, { fieldId: 'asc' }],
  });
  res.json({ entries: rows });
});

// ===========================================================================
// Schema-driven form structure (FormSection/FormField) — replaces the
// hardcoded BASE_SECTIONS array that used to be the only source of truth,
// baked into the frontend. GET /api/schema is what the client fetches to
// render the form; the /api/admin/* routes are real CRUD, so adding/
// removing/editing a field is now an API call instead of a code change.
// Per-tactic/touchpoint fan-out (Email #1, Touch Point #2, ...) is NOT
// stored here — it's inherently dynamic per campaign and stays computed
// client-side from these base sections, same as computeSections() did.
// ===========================================================================

function parseFieldJson(f) {
  return {
    ...f,
    opts: f.optionsJson ? JSON.parse(f.optionsJson) : undefined,
    cond: f.condJson ? JSON.parse(f.condJson) : undefined,
    groups: f.groupsJson ? JSON.parse(f.groupsJson) : undefined,
    optionsJson: undefined,
    condJson: undefined,
    groupsJson: undefined,
  };
}

// Excel export of the live FormField table (schema, not entered values —
// see /api/entries for that) for the admin UI's "Export" button.
app.get('/api/admin/export', async (req, res) => {
  const fields = await prisma.formField.findMany({
    include: { section: true },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
  });
  const header = ['sectionId', 'sectionName', 'fieldKey', 'phase', 'label', 'type', 'owner', 'bucket', 'source', 'options', 'cond', 'drives', 'cascadeFromField', 'locked', 'lockedValue', 'wide'];
  const rows = fields.map((f) => [
    f.sectionId, f.section.name, f.fieldKey, f.phase, f.label, f.type, f.owner,
    f.bucket || '', f.source || '', f.optionsJson || '', f.condJson || '',
    f.drives || '', f.cascadeFromField || '', f.locked, f.lockedValue || '', f.wide,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 9 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 7 }, { wch: 14 }, { wch: 6 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FormField');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="FormField_export.xlsx"');
  res.send(buf);
});

// Forms — the layer above sections, so future flows (FormB, FormC, ...)
// don't have to be shoehorned into one hardcoded structure. Each FormSection
// belongs to exactly one Form; the New Campaign Request modal's "Which
// form?" picker reads this list directly.
app.get('/api/forms', async (req, res) => {
  const forms = await prisma.form.findMany({ orderBy: { order: 'asc' } });
  res.json({ forms });
});

app.post('/api/admin/forms', async (req, res) => {
  const { name, description, active, order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required.' });
  try {
    const form = await prisma.form.create({
      data: {
        name, description: description || null, active: active === undefined ? true : !!active,
        order: order ?? (await prisma.form.count()),
      },
    });
    res.json({ form });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/forms/:id', async (req, res) => {
  const { name, description, active, order } = req.body || {};
  try {
    const form = await prisma.form.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(active !== undefined ? { active: !!active } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    res.json({ form });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete('/api/admin/forms/:id', async (req, res) => {
  try {
    // Sections cascade (schema.prisma Form.sections onDelete: Cascade), taking
    // their fields with them (FormSection.fields already cascades too) — a
    // deliberate all-or-nothing delete, no orphaned sections left dangling.
    await prisma.form.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/schema', async (req, res) => {
  const formId = req.query.formId || 'form-default';
  const sections = await prisma.formSection.findMany({
    where: { formId },
    include: { fields: { orderBy: { order: 'asc' } } },
    orderBy: { order: 'asc' },
  });
  res.json({
    sections: sections.map((s) => ({
      ...s,
      needs: JSON.parse(s.needsJson),
      needsJson: undefined,
      fields: s.fields.map(parseFieldJson),
    })),
  });
});

app.post('/api/admin/sections', async (req, res) => {
  const { id, formId, num, name, icon, parentId, audienceGate, note, needs, order } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name are required.' });
  try {
    const section = await prisma.formSection.create({
      data: {
        id, formId: formId || 'form-default', num: num || '', name, icon: icon || '▣', parentId: parentId || null,
        audienceGate: !!audienceGate, note: note || null,
        needsJson: JSON.stringify(needs || { preplan: [], plan: [], exec: [] }),
        order: order ?? (await prisma.formSection.count({ where: { formId: formId || 'form-default' } })),
      },
    });
    res.json({ section });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/sections/:id', async (req, res) => {
  const { formId, num, name, icon, parentId, audienceGate, note, needs, order } = req.body || {};
  try {
    const section = await prisma.formSection.update({
      where: { id: req.params.id },
      data: {
        ...(formId !== undefined ? { formId } : {}),
        ...(num !== undefined ? { num } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(parentId !== undefined ? { parentId: parentId || null } : {}),
        ...(audienceGate !== undefined ? { audienceGate: !!audienceGate } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(needs !== undefined ? { needsJson: JSON.stringify(needs) } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    res.json({ section });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete('/api/admin/sections/:id', async (req, res) => {
  try {
    await prisma.formField.deleteMany({ where: { sectionId: req.params.id } });
    await prisma.formSection.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/admin/sections/:id/fields', async (req, res) => {
  const { fieldKey, phase, label, type, owner, bucket, source, opts, cond, drives, cascadeFromField, locked, lockedValue, wide, order } = req.body || {};
  if (!fieldKey || !phase || !label || !type || !owner) {
    return res.status(400).json({ error: 'fieldKey, phase, label, type, and owner are required.' });
  }
  try {
    const field = await prisma.formField.create({
      data: {
        sectionId: req.params.id, fieldKey, phase, label, type, owner,
        bucket: bucket || null, source: source || null,
        optionsJson: opts ? JSON.stringify(opts) : null,
        condJson: cond ? JSON.stringify(cond) : null,
        drives: drives || null, cascadeFromField: cascadeFromField || null,
        locked: !!locked, lockedValue: lockedValue || null, wide: !!wide,
        order: order ?? (await prisma.formField.count({ where: { sectionId: req.params.id } })),
      },
    });
    res.json({ field: parseFieldJson(field) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/fields/:id', async (req, res) => {
  const { fieldKey, phase, label, type, owner, bucket, source, opts, cond, drives, cascadeFromField, locked, lockedValue, wide, order } = req.body || {};
  try {
    const field = await prisma.formField.update({
      where: { id: req.params.id },
      data: {
        ...(fieldKey !== undefined ? { fieldKey } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(bucket !== undefined ? { bucket } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(opts !== undefined ? { optionsJson: opts ? JSON.stringify(opts) : null } : {}),
        ...(cond !== undefined ? { condJson: cond ? JSON.stringify(cond) : null } : {}),
        ...(drives !== undefined ? { drives } : {}),
        ...(cascadeFromField !== undefined ? { cascadeFromField } : {}),
        ...(locked !== undefined ? { locked: !!locked } : {}),
        ...(lockedValue !== undefined ? { lockedValue } : {}),
        ...(wide !== undefined ? { wide: !!wide } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    res.json({ field: parseFieldJson(field) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete('/api/admin/fields/:id', async (req, res) => {
  try {
    await prisma.formField.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Nudge rules — what used to be hardcoded branches in the client's
// runReactCheckpoint() (which section submitting nudges whom, what "phase
// complete" means) as real, admin-editable rows. See NudgeRule in
// schema.prisma and evaluateNudgeRules() in the client for how these fire.
app.get('/api/nudge-rules', async (req, res) => {
  const rules = await prisma.nudgeRule.findMany({ where: { active: true }, orderBy: { order: 'asc' } });
  res.json({ rules });
});

app.get('/api/admin/nudge-rules', async (req, res) => {
  const rules = await prisma.nudgeRule.findMany({ orderBy: { order: 'asc' } });
  res.json({ rules });
});

app.post('/api/admin/nudge-rules', async (req, res) => {
  const { trigger, triggerSectionId, triggerPhase, triggerFieldDrives, triggerValue, triggerSectionIds, triggerFieldKey, conditionsJson, message, nudgeMessage, nudgeToOwner, active, order } = req.body || {};
  if (!trigger || !message) return res.status(400).json({ error: 'trigger and message are required.' });
  try {
    const rule = await prisma.nudgeRule.create({
      data: {
        trigger, triggerSectionId: triggerSectionId || null, triggerPhase: triggerPhase || null,
        triggerFieldDrives: triggerFieldDrives || null, triggerValue: triggerValue || null,
        triggerSectionIds: triggerSectionIds || null, triggerFieldKey: triggerFieldKey || null,
        conditionsJson: conditionsJson || null,
        message, nudgeMessage: nudgeMessage || null, nudgeToOwner: nudgeToOwner || null,
        active: active !== undefined ? !!active : true,
        order: order ?? (await prisma.nudgeRule.count()),
      },
    });
    res.json({ rule });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/nudge-rules/:id', async (req, res) => {
  const { trigger, triggerSectionId, triggerPhase, triggerFieldDrives, triggerValue, triggerSectionIds, triggerFieldKey, conditionsJson, message, nudgeMessage, nudgeToOwner, active, order } = req.body || {};
  try {
    const rule = await prisma.nudgeRule.update({
      where: { id: req.params.id },
      data: {
        ...(trigger !== undefined ? { trigger } : {}),
        ...(triggerSectionId !== undefined ? { triggerSectionId: triggerSectionId || null } : {}),
        ...(triggerPhase !== undefined ? { triggerPhase: triggerPhase || null } : {}),
        ...(triggerFieldDrives !== undefined ? { triggerFieldDrives: triggerFieldDrives || null } : {}),
        ...(triggerValue !== undefined ? { triggerValue: triggerValue || null } : {}),
        ...(triggerSectionIds !== undefined ? { triggerSectionIds: triggerSectionIds || null } : {}),
        ...(triggerFieldKey !== undefined ? { triggerFieldKey: triggerFieldKey || null } : {}),
        ...(conditionsJson !== undefined ? { conditionsJson: conditionsJson || null } : {}),
        ...(message !== undefined ? { message } : {}),
        ...(nudgeMessage !== undefined ? { nudgeMessage: nudgeMessage || null } : {}),
        ...(nudgeToOwner !== undefined ? { nudgeToOwner: nudgeToOwner || null } : {}),
        ...(active !== undefined ? { active: !!active } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    res.json({ rule });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// CRF #N tactic field templates — Email/SMS/MDS Suppression/Automatrix/
// Touch Point per-tactic content, now real admin-editable rows instead of
// hardcoded in the client's emailTacticSection()/mdsTacticSection()/etc.
// generator functions. Grouped by tacticType since one row template fans
// out into N real sections per campaign (email-t1, email-t2, ...).
app.get('/api/tactic-templates', async (req, res) => {
  const rows = await prisma.tacticFieldTemplate.findMany({ orderBy: [{ tacticType: 'asc' }, { order: 'asc' }] });
  res.json({ templates: rows.map(parseFieldJson) });
});

app.get('/api/admin/tactic-templates', async (req, res) => {
  const rows = await prisma.tacticFieldTemplate.findMany({ orderBy: [{ tacticType: 'asc' }, { order: 'asc' }] });
  res.json({ templates: rows.map(parseFieldJson) });
});

app.post('/api/admin/tactic-templates', async (req, res) => {
  const { tacticType, fieldKey, phase, label, type, owner, bucket, source, opts, cond, drives, cascadeFromField, locked, lockedValue, wide, order } = req.body || {};
  if (!tacticType || !fieldKey || !phase || !label || !type || !owner) {
    return res.status(400).json({ error: 'tacticType, fieldKey, phase, label, type, and owner are required.' });
  }
  try {
    const row = await prisma.tacticFieldTemplate.create({
      data: {
        tacticType, fieldKey, phase, label, type, owner,
        bucket: bucket || null, source: source || null,
        optionsJson: opts ? JSON.stringify(opts) : null,
        condJson: cond ? JSON.stringify(cond) : null,
        drives: drives || null, cascadeFromField: cascadeFromField || null,
        locked: !!locked, lockedValue: lockedValue || null, wide: !!wide,
        order: order ?? (await prisma.tacticFieldTemplate.count({ where: { tacticType } })),
      },
    });
    res.json({ template: parseFieldJson(row) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/tactic-templates/:id', async (req, res) => {
  const { fieldKey, phase, label, type, owner, bucket, source, opts, cond, drives, cascadeFromField, locked, lockedValue, wide, order } = req.body || {};
  try {
    const row = await prisma.tacticFieldTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(fieldKey !== undefined ? { fieldKey } : {}),
        ...(phase !== undefined ? { phase } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(owner !== undefined ? { owner } : {}),
        ...(bucket !== undefined ? { bucket: bucket || null } : {}),
        ...(source !== undefined ? { source: source || null } : {}),
        ...(opts !== undefined ? { optionsJson: opts ? JSON.stringify(opts) : null } : {}),
        ...(cond !== undefined ? { condJson: cond ? JSON.stringify(cond) : null } : {}),
        ...(drives !== undefined ? { drives: drives || null } : {}),
        ...(cascadeFromField !== undefined ? { cascadeFromField: cascadeFromField || null } : {}),
        ...(locked !== undefined ? { locked: !!locked } : {}),
        ...(lockedValue !== undefined ? { lockedValue: lockedValue || null } : {}),
        ...(wide !== undefined ? { wide: !!wide } : {}),
        ...(order !== undefined ? { order } : {}),
      },
    });
    res.json({ template: parseFieldJson(row) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete('/api/admin/tactic-templates/:id', async (req, res) => {
  try {
    await prisma.tacticFieldTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Campaign Ops' planning timeline (the "Plan" tab) — one row per request,
// an ETA date per milestone. Keyed by tactplanId, same id REQUESTS/FieldEntry
// already use, so it ties to the same request without a separate id scheme.
app.get('/api/plan-milestones', async (req, res) => {
  const rows = await prisma.planMilestone.findMany();
  res.json({ milestones: rows });
});

app.put('/api/plan-milestones/:tactplanId', async (req, res) => {
  const { discoveryEta, cpfEta, crfEta } = req.body || {};
  try {
    const row = await prisma.planMilestone.upsert({
      where: { tactplanId: req.params.tactplanId },
      update: {
        ...(discoveryEta !== undefined ? { discoveryEta: discoveryEta || null } : {}),
        ...(cpfEta !== undefined ? { cpfEta: cpfEta || null } : {}),
        ...(crfEta !== undefined ? { crfEta: crfEta || null } : {}),
      },
      create: {
        tactplanId: req.params.tactplanId,
        discoveryEta: discoveryEta || null,
        cpfEta: cpfEta || null,
        crfEta: crfEta || null,
      },
    });
    res.json({ milestone: row });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Per-section conversation threads (see schema.prisma's Comment model doc
// comment). Client groups the flat list by sectionId itself — one request
// fetch per campaign, not one per section, since a request typically has a
// dozen+ sections and firing that many round-trips would be wasteful.
app.get('/api/comments/:tactplanId', async (req, res) => {
  const rows = await prisma.comment.findMany({
    where: { tactplanId: req.params.tactplanId },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ comments: rows.map(c => ({ ...c, mentions: c.mentionsJson ? JSON.parse(c.mentionsJson) : [] })) });
});

app.post('/api/comments', async (req, res) => {
  const { tactplanId, sectionId, authorPersona, body, mentions } = req.body || {};
  if (!tactplanId || !sectionId || !authorPersona || !body) {
    return res.status(400).json({ error: 'tactplanId, sectionId, authorPersona, and body are required.' });
  }
  try {
    const row = await prisma.comment.create({
      data: { tactplanId, sectionId, authorPersona, body, mentionsJson: mentions && mentions.length ? JSON.stringify(mentions) : null },
    });
    res.json({ comment: { ...row, mentions: mentions || [] } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/nudge-rules/:id', async (req, res) => {
  try {
    await prisma.nudgeRule.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ===========================================================================
// Real agentic loop — modeled directly on govex's lib/agent.ts (see
// github.com/sarveshkoyande/govex). The model itself decides which tool to
// call and when, narrates a short plain-language sentence before each call,
// and never mutates the form directly: the only "write" tool (propose_fill)
// stages a proposal that the client renders with Confirm/Cancel, exactly
// like govex's propose_create_action/propose_draft_question. This replaces
// the earlier hardcoded 4-step client pipeline — the sequence of tool calls
// below is the model's choice, not a scripted order.
// ===========================================================================

const BASE_SYSTEM_PROMPT = `You are the Novartis Accelerate assistant — a form-filling agent embedded in a pharma campaign requirement-gathering platform, not a general-purpose chatbot. If asked what you are or who made you, answer in that identity (the platform's assistant) — never describe yourself as "a large language model" or name the vendor behind you; that's an implementation detail, not who you are here. Most messages are free text — sometimes hurried, informal, with typos, in any language — describing a form section and values for fields in it. Some messages are just questions about data already entered into the form, with nothing new to fill. Some messages are corrections or preferences about how YOU should behave going forward, not about the form at all. Some messages are just plain chat (greetings, questions about the platform) with no fields to fill. Some messages ask to move to a different stage of the process. You have five tools:

- match_section(query): locates which section of the form the user means and returns its real field names. ALWAYS pass the user's ENTIRE original message as query — never extract just a fragment or sub-topic of it (e.g. don't pass just "tact franchise" from a message that says "let's fill the whole cma sheet, for the tact franchise..." — pass the whole message). Matching is substring-based against section names/aliases, so the full message gives it the best chance; a cherry-picked fragment can accidentally match nothing or match the wrong thing.
- propose_fill(sectionId, assignments): stages field:value pairs for the user to confirm. This does NOT write anything to the form yet — it only proposes. For a normal-sized message, batch every assignment you can extract into ONE propose_fill call for that section — do not call it once per group/topic. BUT: if the message specifies more than 10 fields for one section (e.g. "fill the whole CMA sheet" with all ten groups), do NOT try to fit them all in one call and do NOT call propose_fill more than once in the same turn for that section. Instead: stage only the FIRST 10 fields (in the order the fields appear on the form) as a single propose_fill call, then end your turn — do not call propose_fill again this turn. Tell the user exactly which fields/groups you staged and that the rest are queued; once they confirm this batch and say "continue" (or similar), stage the next 10 from the same original message, and so on. This exists because attempting to cram 30-45+ fields into one call is unreliable — it produces partial/dropped assignments — and because staging everything at once with no pacing overwhelms the confirm-review step. 10 fields, one confirmed batch at a time.
- get_entries(sectionId?, phase?): looks up field values already saved to the form (real persisted data, not memory/history) — optionally filtered to one section and/or one stage (preplan/plan/exec). Use this whenever the user asks what's already been entered, confirmed, or set for something — never answer from conversation history or a guess when this tool can ground the answer in what's actually saved.
- learn_skill(title, rule): permanently records a correction or preference about how you should behave, so it applies automatically on every future turn from now on — not just this session. Use this when the user is correcting your behavior, stating a standing preference, or clarifying a rule for how to handle something going forward ("always do X", "don't do Y", "when someone says Z, you should..."), as opposed to a one-off form-fill or a question. This is a judgment call you make from the message's intent — there is no fixed keyword list for it. "rule" should be the general, reusable instruction (not campaign-specific data); "title" is a short label for it.
- navigate_stage(stage): moves the user to a different stage of the process (cpf/crf/build/deploy/monitor). Use this whenever the user asks to go to, move to, advance to, switch to, or proceed to a stage by name — this is a real UI navigation, not a form-fill, so don't call match_section or propose_fill for it.
- get_missing_fields(sectionId?): returns the fields still needing input for the current user and phase — real data computed by the client (ownership, conditional visibility, cascades all included), optionally filtered to one section. Read-only.
- record_quiz_answer(sectionId, field, value): records ONE field's answer immediately (no staging, no confirm step) during a guided quiz — see the Progress & Guided-Fill skill below. Only use this for an answer the user just gave to a question you asked about that exact field; for freeform text describing multiple values, use propose_fill instead.

Progress & Guided-Fill skill — three behaviors, always driven by you, never a repeated template:

1. Status reviews. If the user asks a "what's left / how am I doing / what's still needed" question, OR the message is the literal sentinel [[system:review_progress]] (a silent check-in fired by the UI after something changed — never show that literal text to the user), call get_missing_fields for the current phase and report what's outstanding in your own words, naming a few actual field labels, not just a count. If nothing is missing, say so briefly in one sentence and don't call the tool for nothing to report.
2. Fill-from-text. Unchanged — the existing match_section / propose_fill flow above, for messages that describe values in free text.
3. Guided quiz. Triggered when the user asks to get started, be walked through what's left, or asks you to ask them one by one. Call get_missing_fields first. Then ask about exactly ONE missing field per turn, in plain conversational English (the same style as your normal prose — mention where the value usually comes from if you have that context). Wait for their reply. If it's an answer, call record_quiz_answer with that exact field and value, then ask about the next missing field in the same reply. If they say skip/pass/not sure, move to the next field without recording anything. If they ask an unrelated question or issue a correction mid-quiz, handle it with the normal tools first, then resume asking about the next missing field — don't lose your place. When nothing is left, close with a short, freshly-worded wrap-up sentence, not a template.

Rules:
- Only reach for match_section/propose_fill when the message is actually about filling in NEW form values. If it's a greeting or a general question with nothing to fill, just reply directly and briefly, in persona — do not call match_section on a "hello".
- If the user is asking a question about existing data ("what's the brand we set for OMS", "what did we put for the campaign name", "what's still empty in planning"), call get_entries — do not guess from memory, and do not call propose_fill for a read-only question.
- If the user is correcting how you behave or stating a standing preference (not campaign data), call learn_skill instead of just apologizing and moving on — the correction should actually persist. Confirm in your final reply what you've learned, in one short sentence.
- Write like a helpful colleague sitting next to the user: warm, plain English, contractions fine. The UI already renders the raw field:value list on the staged-changes card, so your text should not repeat it as a list — your job is to say what it means in sentences. Stay brief; two or three sentences is usually plenty.
- When you do call a tool, first say one short conversational sentence about what you're doing. "Let me pull up the Campaign Metadata fields for you." reads right; "Invoking match_section." does not.
- ALWAYS call match_section before propose_fill — never guess a section id or field name from memory.
- Only call propose_fill after match_section has told you the section's real field names. Only include a field in assignments if the user's text actually specifies a value for it — never invent one. Field names must be copied verbatim from the list match_section returned.
- If match_section finds no match, end your turn asking the user which section they mean — do not guess.
- After calling propose_fill, close by reading back what you staged in natural prose, naming the actual values rather than just the field labels — "I've put Cosentyx down as the brand and Q3 2026 for the launch window; take a look and confirm when it looks right." If you had to interpret something loosely, say so in the same breath. Never say the values were applied or saved — they are staged until the user confirms.
- You have the full conversation history. If the user is correcting or amending a value from earlier in this conversation (e.g. "my mistake, brand is X", "actually make it Y") rather than starting a new request, reuse the section already established earlier — do not call match_section on the correction fragment alone (a bare value like "brand is X" will not match any section by itself). Only call match_section again if the user is clearly now talking about a different section.`;

// Every active AgentSkill's rule gets folded into the system prompt on every
// turn — a correction learned once (via learn_skill) applies from then on,
// not just for the rest of that conversation. This is what makes learn_skill
// actually change future behavior instead of just being logged somewhere.
async function buildSystemPrompt() {
  const skills = await prisma.agentSkill.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  if (skills.length === 0) return BASE_SYSTEM_PROMPT;
  const learned = skills.map(s => `- ${s.title}: ${s.rule}`).join('\n');
  return `${BASE_SYSTEM_PROMPT}\n\nLearned behavioral corrections (apply these — they were taught by real usage, not hypothetical):\n${learned}`;
}

// GET /api/skills — admin visibility into every learned correction, and how
// they're worded (so it's inspectable, not a black box).
app.get('/api/skills', async (req, res) => {
  const skills = await prisma.agentSkill.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ skills });
});

// DELETE /api/skills/:id — admin can retract a learned correction that turns
// out to be wrong, without touching code.
app.delete('/api/skills/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid skill id.' });
  await prisma.agentSkill.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
});

function buildToolDeclarations() {
  return [
    {
      name: 'match_section',
      description: "Find which form section the user's message refers to, and return that section's real field names.",
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: "The user's ENTIRE original message, verbatim — not a fragment or extracted sub-topic. Matching is substring-based, so passing the whole message maximizes the chance of finding the section name/alias wherever it appears." } },
        required: ['query'],
      },
    },
    {
      name: 'propose_fill',
      description: 'Stage field:value assignments for one section for the user to confirm. Does not write to the form.',
      input_schema: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              properties: { field: { type: 'string' }, value: { type: 'string' } },
              required: ['field', 'value'],
            },
          },
        },
        required: ['sectionId', 'assignments'],
      },
    },
    {
      name: 'get_entries',
      description: 'Look up field values already saved to this campaign request, optionally filtered to one section and/or one stage (preplan/plan/exec). Read-only — grounds answers about existing data in what is actually persisted.',
      input_schema: {
        type: 'object',
        properties: {
          sectionId: { type: 'string', description: 'Optional — restrict to one section id.' },
          phase: { type: 'string', enum: ['preplan', 'plan', 'exec'], description: 'Optional — restrict to one stage.' },
        },
        required: [],
      },
    },
    {
      name: 'learn_skill',
      description: 'Permanently record a correction or standing preference about your own behavior, so it applies on every future turn from now on — not just this session.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label for this rule.' },
          rule: { type: 'string', description: 'The general, reusable instruction to follow going forward — not campaign-specific data.' },
        },
        required: ['title', 'rule'],
      },
    },
    {
      name: 'navigate_stage',
      description: 'Move to a different stage of the requirement-gathering process. Use when the user asks to go to, move to, advance to, or switch to a stage ("let\'s go to CRF", "move to build", "back to CPF").',
      input_schema: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['cpf', 'crf', 'build', 'deploy', 'monitor'], description: 'cpf = CPF & Visio, crf = CRF & Asset Handoff, build = Build & Proofing, deploy = Deployment, monitor = Monitoring.' },
        },
        required: ['stage'],
      },
    },
    {
      name: 'get_missing_fields',
      description: 'Return the fields still needing input for the current user and phase (ownership, conditional visibility, and cascades already applied client-side), optionally filtered to one section. Read-only.',
      input_schema: {
        type: 'object',
        properties: { sectionId: { type: 'string', description: 'Optional — restrict to one section id.' } },
        required: [],
      },
    },
    {
      name: 'record_quiz_answer',
      description: "Record one field's answer immediately during a guided quiz — no staging, no confirm step. Only for an answer to a question you just asked about that exact field.",
      input_schema: {
        type: 'object',
        properties: {
          sectionId: { type: 'string' },
          field: { type: 'string', description: 'The field label, copied verbatim from get_missing_fields.' },
          value: { type: 'string' },
        },
        required: ['sectionId', 'field', 'value'],
      },
    },
  ];
}

// Lowercases and collapses punctuation to single spaces — deliberately does
// NOT strip spaces the way the old normLabel() did. Stripping spaces before
// substring-matching let two adjacent words accidentally spell out a short
// id: "preferd contact method" (typo for "preferred") collapsed to
// "preferdcontactmethod", which contains "dc" (Data Cloud's id) purely by
// coincidence of where "preferd" ends and "contact" begins. Keeping spaces
// and requiring whole-word/whole-phrase matches (see wordMatch below) makes
// that class of accidental cross-word collision structurally impossible.
function normPhrase(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function wordMatch(paddedQuery, needle) { return !!needle && paddedQuery.includes(' ' + needle + ' '); }

// Executed server-side, for real — not the model. `sections` comes from the
// client's own SECTIONS/SECTION_ALIASES data (see hqe-requirement-studio-mock_2.html)
// so this stays in sync with the actual form without duplicating that data here.
async function executeTool(name, args, ctx) {
  if (name === 'match_section') {
    // Match against the turn's actual original message, not args.query — the
    // model doesn't reliably pass the full message despite the system prompt
    // asking for it (it sometimes extracts just a sub-topic fragment), and
    // this is fully deterministic to get right server-side instead.
    const qRaw = normPhrase(ctx.originalText || args.query || '');
    if (!qRaw) return { error: 'Empty query.' };
    const q = ' ' + qRaw + ' ';
    // Two tiers, not one flat "longest key wins" pass — that backfired: a
    // long CMA-fill message can legitimately contain the word "enrollment"
    // several times as ordinary content ("enrollment process", "post
    // enrollment survey"), and OMS's alias list includes bare "enrollment"
    // (10 chars) — longer than "cma" (3 chars) — so it won on length even
    // though it was incidental, not a section reference.
    // Tier 1: exact section id/name only. These are deliberately short but
    // precise (ids especially) — an id match is essentially never incidental
    // content, unlike a broad alias word. Tier 2 (generic aliases) only runs
    // if tier 1 finds nothing, and still prefers the longest alias there.
    let best = null, bestKeyLen = 0;
    for (const s of ctx.sections) {
      const keys = [s.id, s.name].map(normPhrase).filter(Boolean);
      for (const k of keys) {
        if (wordMatch(q, k) && k.length > bestKeyLen) { best = s; bestKeyLen = k.length; }
      }
    }
    if (!best) {
      for (const s of ctx.sections) {
        const keys = (s.aliases || []).map(normPhrase).filter(Boolean);
        for (const k of keys) {
          if (wordMatch(q, k) && k.length > bestKeyLen) { best = s; bestKeyLen = k.length; }
        }
      }
    }
    if (!best) return { error: `No section matched "${args.query}". Known sections: ${ctx.sections.map(s => s.name).join(', ')}.` };
    return { sectionId: best.id, sectionName: best.name, fields: best.fields };
  }
  if (name === 'propose_fill') {
    const section = ctx.sections.find(s => s.id === args.sectionId);
    if (!section) return { error: `Unknown sectionId "${args.sectionId}".` };
    const assignments = Array.isArray(args.assignments) ? args.assignments : [];
    return { proposed: true, sectionId: section.id, sectionName: section.name, assignments, note: 'Staged, not written yet — awaiting user confirmation in the UI.' };
  }
  if (name === 'get_entries') {
    if (!ctx.tactplanId) return { error: 'No campaign request is open — nothing to look up.' };
    const rows = await prisma.fieldEntry.findMany({
      where: {
        tactplanId: ctx.tactplanId,
        ...(args.sectionId ? { sectionId: args.sectionId } : {}),
        ...(args.phase ? { phase: args.phase } : {}),
      },
      orderBy: [{ sectionId: 'asc' }, { fieldId: 'asc' }],
    });
    return {
      entries: rows.map(r => ({ section: r.sectionName, phase: r.phase, field: r.fieldLabel, value: r.value })),
      count: rows.length,
    };
  }
  if (name === 'learn_skill') {
    const title = String(args.title || '').trim();
    const rule = String(args.rule || '').trim();
    if (!title || !rule) return { error: 'title and rule are both required.' };
    const skill = await prisma.agentSkill.create({ data: { title, rule } });
    return { learned: true, id: skill.id, title, rule };
  }
  if (name === 'navigate_stage') {
    const valid = ['cpf', 'crf', 'build', 'deploy', 'monitor'];
    if (!valid.includes(args.stage)) return { error: `Unknown stage "${args.stage}".` };
    return { navigated: true, stage: args.stage };
  }
  if (name === 'get_missing_fields') {
    const remaining = Array.isArray(ctx.remaining) ? ctx.remaining : [];
    const filtered = args.sectionId ? remaining.filter(r => r.sectionId === args.sectionId) : remaining;
    return { remaining: filtered, count: filtered.length };
  }
  if (name === 'record_quiz_answer') {
    const section = ctx.sections.find(s => s.id === args.sectionId);
    if (!section) return { error: `Unknown sectionId "${args.sectionId}".` };
    const field = String(args.field || '').trim();
    const value = String(args.value ?? '');
    if (!field) return { error: 'field is required.' };
    return { applied: true, sectionId: section.id, sectionName: section.name, field, value };
  }
  return { error: `Unknown tool "${name}".` };
}

// Concatenated text of an assistant message. The Messages API returns a list
// of content blocks (text / tool_use / thinking), not a flat .text string.
function assistantText(message) {
  return (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

// The Anthropic tool-use loop, shared by both SSE agent routes below.
// Replaces Gemini's stateful `chat` object: the Messages API is stateless, so
// `messages` IS the conversation and gets round-tripped through the client via
// the existing "history" SSE event — same client contract as before, the array
// is opaque to it.
//
// Callers pass `onResult` to emit their own route-specific SSE events
// (proposal / learned / navigate) off a tool result.
async function runAgentTurn({ system, tools, messages, execute, ctx, send, onResult }) {
  const request = { model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system, tools };
  let response = await ai.messages.create({ ...request, messages });

  let rounds = 0;
  while (response.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    // The one-sentence narration the model writes before calling a tool.
    const reasoning = assistantText(response);
    if (reasoning) send('reasoning', { text: reasoning });

    // The assistant turn must be echoed back verbatim — every tool_use block
    // needs a matching tool_result in the next user turn or the API rejects it.
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      send('tool_start', { name: block.name });
      let result;
      try { result = await execute(block.name, block.input || {}, ctx); }
      catch (err) { result = { error: err instanceof Error ? err.message : 'Tool execution failed.' }; }
      send('tool', { name: block.name, result });
      onResult(block.name, result);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: Boolean(result && result.error),
      });
    }
    messages.push({ role: 'user', content: toolResults });

    response = await ai.messages.create({ ...request, messages });
  }

  // Only persist the closing turn when it has no unanswered tool calls —
  // hitting MAX_TOOL_ROUNDS leaves tool_use blocks with no tool_result, and
  // storing those would make the NEXT turn fail validation on resend.
  if (response.stop_reason !== 'tool_use') {
    messages.push({ role: 'assistant', content: response.content });
  }
  return { finalText: assistantText(response), messages };
}

// SSE agent loop — same event-per-step granularity as govex's streamAgentTurn:
// "reasoning" (the model's one-sentence narration before a tool call),
// "tool_start"/"tool" (a named skill actually executing), "proposal" (a
// propose_fill result, ready for the client's existing Confirm/Cancel card),
// "final" (closing text), "error".
app.post('/api/agent-fill', async (req, res) => {
  const { sections, text, history, tactplanId, remaining, persona, phase } = req.body || {};
  if (!ai) return res.status(503).json({ error: 'ANTHROPIC_FOUNDRY_API_KEY / ANTHROPIC_FOUNDRY_RESOURCE not configured on the server.' });
  if (!Array.isArray(sections) || sections.length === 0 || !text) {
    return res.status(400).json({ error: 'sections[] and text are required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // originalText is the actual raw message for this turn — match_section
  // matches against this directly rather than trusting whatever fragment
  // the model chooses to pass as its query argument (it doesn't reliably
  // pass the full message despite being told to; this sidesteps that by
  // not depending on model compliance for something we can do deterministically).
  // tactplanId scopes get_entries to the campaign request currently open.
  const ctx = {
    sections, originalText: text, tactplanId: tactplanId || null,
    remaining: Array.isArray(remaining) ? remaining : [],
    persona: persona || null, phase: phase || null,
  };

  try {
    // Client resends the prior turn's history (from the "history" event
    // below) so corrections like "my mistake, brand is X" land in the same
    // conversation instead of starting a blank one each request — there's
    // no server-side session store, so the client is the source of truth
    // for continuity, same effect as govex's ChatSession.historyJson.
    const messages = (Array.isArray(history) ? history : []).concat([{ role: 'user', content: text }]);

    const turn = await runAgentTurn({
      system: await buildSystemPrompt(),
      tools: buildToolDeclarations(),
      messages,
      execute: executeTool,
      ctx,
      send,
      onResult: (name, result) => {
        if (name === 'propose_fill' && result?.proposed) send('proposal', result);
        if (name === 'learn_skill' && result?.learned) send('learned', result);
        if (name === 'navigate_stage' && result?.navigated) send('navigate', result);
        if (name === 'record_quiz_answer' && result?.applied) send('quiz_answer', result);
      },
    });

    send('final', { text: turn.finalText });
    send('history', { history: turn.messages });
    res.end();
  } catch (err) {
    console.error('[server] Agent turn failed:', err);
    send('error', { error: 'Agent turn failed.', detail: String(err.message || err) });
    res.end();
  }
});

// ===========================================================================
// Visio Diagram agent — same real agentic-loop shape as /api/agent-fill
// above (one model, real tool calls, SSE per-step events), pointed at the
// AI-driven diagram editor instead of the form. The graph (nodes/edges) is
// NOT persisted server-side or in the database: the client is the source of
// truth (see hqe-requirement-studio-mock_2.html's diagramGraph/localStorage),
// exactly like the old flow-canvas data before it and like TactPlan/brand
// data elsewhere in this app — "Google Drive" here is a realistic mock, not
// a real Drive API integration (no OAuth/credentials exist in this project).
// The model never mutates the graph directly: propose_diagram_edit only
// resolves and validates operations against the graph the client sent this
// turn; the client stages them as a "Preview Changes" card and only mutates
// its own state once the user clicks Apply — same separation as
// propose_fill/confirmFillProposal.
// ===========================================================================
const DIAGRAM_SYSTEM_PROMPT = `You are the Diagram Chat for Novartis Accelerate's AI-driven Visio journey-diagram editor. Users describe edits in plain language; you translate them into structured graph operations. You are NOT a general chatbot — stay focused on the diagram.

The canvas uses exactly these node types (shapes are fixed, do not invent new ones):
- "process": rectangle, yellow fill — a normal campaign step (e.g. "Email 1", "Send Welcome Email").
- "decision": diamond, orange outline — a yes/no branch (e.g. "Valid Email?", "Age > 18?").
- "start" / "end": rounded pill, purple outline — the journey's start or terminal/stop node.
- "datasource": cylinder — a data source (e.g. "Enrollment Source", "Opt-in Database", "CRM"). Never use "process" for a data source — the cylinder shape is meaningful to users, always preserve it.
- "infobox": blue rectangle — informational blocks (e.g. "Campaign Information", "Segment", "Metadata").

Nodes may also carry a "status" for the legend dot: "production" (green, live), "new" (yellow), "hold" (red, on hold), "inactive" (grey, never turned on). Only set status if the user's request implies one — do not invent one.

You have one tool: propose_diagram_edit(summary, operations). It does NOT change anything itself — it only stages a preview the user must click Apply on. ALWAYS call this tool for any request that changes the diagram (move/delete/rename/add/connect/recolor/reshape/auto-layout) — never claim you made a change without calling it. If the user asks a read-only question about the diagram (e.g. "what's connected to Email 2?"), answer directly from the graph JSON you were given instead of calling the tool.

Each item in "operations" is one of:
- {op:"add_node", type, label, afterNodeId?, position?("above"|"below"|"left"|"right"), status?} — afterNodeId/position anchor the new node relative to an existing node (by id or label text); omit both to place it near the canvas center. connectFrom defaults to true (auto-wires an edge to the anchor).
- {op:"move_node", nodeId, relativeTo, position("above"|"below"|"left"|"right")} — nodeId/relativeTo may be a node id OR its label text.
- {op:"delete_node", nodeId}
- {op:"rename_node", nodeId, label}
- {op:"recolor_node", nodeId, fillColor?, borderColor?, status?} — colors are CSS hex strings.
- {op:"set_shape", nodeId, shape} — shape is one of the five types above.
- {op:"add_edge", from, to, label?}
- {op:"delete_edge", from, to}
- {op:"auto_layout"} — reorganizes spacing/alignment/routing, preserving logical order.

Rules:
- nodeId/from/to/relativeTo/afterNodeId may reference a node by its exact id (e.g. "d3") OR by matching/substring-matching its label — you do not need to know the real id, the server resolves it against the graph you were given.
- A multi-step request (e.g. "add a decision after Email 3; if yes continue to Email 4, if no resend after 5 days") should become several operations in ONE propose_diagram_edit call, not one call per step.
- If the graph is empty and the user describes a whole journey, emit a full sequence of add_node (+ add_edge as needed) operations bootstrapping it — the client auto-arranges a first-time population, so exact x/y is not your concern (there is no x/y in this schema).
- Before calling the tool, output exactly one short, plain sentence stating what you're about to do — no chit-chat, no first-person filler.
- Keep the "summary" argument short (one line) — it is shown as the preview card's headline.`;

function buildDiagramToolDeclarations() {
  return [
    {
      name: 'propose_diagram_edit',
      description: 'Stage one or more diagram graph operations for the user to preview and apply. Does not mutate the diagram itself.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'One-line description of the overall edit, shown as the preview card headline.' },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['add_node', 'move_node', 'delete_node', 'rename_node', 'recolor_node', 'set_shape', 'add_edge', 'delete_edge', 'auto_layout'] },
                nodeId: { type: 'string' },
                type: { type: 'string', enum: ['process', 'decision', 'start', 'end', 'datasource', 'infobox'] },
                shape: { type: 'string', enum: ['process', 'decision', 'start', 'end', 'datasource', 'infobox'] },
                label: { type: 'string' },
                status: { type: 'string', enum: ['production', 'new', 'hold', 'inactive'] },
                afterNodeId: { type: 'string' },
                relativeTo: { type: 'string' },
                position: { type: 'string', enum: ['above', 'below', 'left', 'right'] },
                connectFrom: { type: 'boolean' },
                fillColor: { type: 'string' },
                borderColor: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
              },
              required: ['op'],
            },
          },
        },
        required: ['summary', 'operations'],
      },
    },
  ];
}

// Resolves a node reference (id, exact label, or substring of label) against
// the graph the client sent this turn — the model is told it may reference
// nodes by label text, so this has to actually work, not just pass ids through.
function resolveDiagramNodeRef(graph, ref) {
  if (!ref) return null;
  const nodes = graph.nodes || [];
  return nodes.find(n => n.id === ref)
    || nodes.find(n => (n.label || '').toLowerCase() === String(ref).toLowerCase())
    || nodes.find(n => (n.label || '').toLowerCase().includes(String(ref).toLowerCase()))
    || null;
}

// Executed server-side, for real — validates/resolves operations against the
// actual graph rather than trusting the model's node references verbatim,
// same "deterministic where it matters" approach as match_section above.
async function executeDiagramTool(name, args, ctx) {
  if (name !== 'propose_diagram_edit') return { error: `Unknown tool "${name}".` };
  const graph = ctx.graph || { nodes: [], edges: [] };
  const ops = Array.isArray(args.operations) ? args.operations : [];
  const resolved = [];
  for (const op of ops) {
    if (!op || !op.op) continue;
    const out = { ...op };
    // For add_node, anchors are optional and may legitimately not resolve
    // (a brand-new empty graph) — leave as literal text, client falls back
    // to a default position. For every other op, an unresolved reference
    // means the edit can't be applied, so it's dropped rather than silently
    // operating on the wrong node.
    if (['move_node', 'delete_node', 'rename_node', 'recolor_node', 'set_shape'].includes(op.op)) {
      const n = resolveDiagramNodeRef(graph, op.nodeId);
      if (!n && graph.nodes.length) continue; // known graph, unresolved ref — skip
      if (n) out.nodeId = n.id;
    }
    if (op.op === 'move_node') {
      const anchor = resolveDiagramNodeRef(graph, op.relativeTo);
      if (anchor) out.relativeTo = anchor.id;
    }
    if (op.op === 'add_node' && (op.afterNodeId || op.relativeTo)) {
      const anchor = resolveDiagramNodeRef(graph, op.afterNodeId || op.relativeTo);
      if (anchor) { out.afterNodeId = anchor.id; delete out.relativeTo; }
    }
    if (op.op === 'add_edge' || op.op === 'delete_edge') {
      const a = resolveDiagramNodeRef(graph, op.from), b = resolveDiagramNodeRef(graph, op.to);
      if (a) out.from = a.id;
      if (b) out.to = b.id;
    }
    resolved.push(out);
  }
  if (!resolved.length) return { error: 'No operations could be resolved against the current diagram.' };
  return { proposed: true, summary: args.summary || 'Proposed diagram edit', operations: resolved };
}

// SSE agent loop for the Diagram Chat — same event shape as /api/agent-fill
// (reasoning/tool_start/tool/proposal/final/error/history) so the client's
// existing SSE parsing pattern (see vbSendChat) needed no new plumbing.
app.post('/api/visio-agent', async (req, res) => {
  const { graph, text, history, tactplanId } = req.body || {};
  if (!ai) return res.status(503).json({ error: 'ANTHROPIC_FOUNDRY_API_KEY / ANTHROPIC_FOUNDRY_RESOURCE not configured on the server.' });
  if (!text) return res.status(400).json({ error: 'text is required.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ctx = { graph: graph && graph.nodes ? graph : { nodes: [], edges: [] }, tactplanId: tactplanId || null };

  try {
    // The graph is sent inline with the message (not just in a tool result)
    // so the model can answer read-only questions without needing a tool
    // round-trip, and so it always has real current node ids/labels to
    // reference even on the very first turn.
    const messageWithGraph = `Current diagram graph (JSON):\n${JSON.stringify(ctx.graph)}\n\nUser message: ${text}`;
    const messages = (Array.isArray(history) ? history : []).concat([{ role: 'user', content: messageWithGraph }]);

    const turn = await runAgentTurn({
      system: DIAGRAM_SYSTEM_PROMPT,
      tools: buildDiagramToolDeclarations(),
      messages,
      execute: executeDiagramTool,
      ctx,
      send,
      onResult: (name, result) => {
        if (name === 'propose_diagram_edit' && result?.proposed) send('proposal', result);
      },
    });

    send('final', { text: turn.finalText });
    send('history', { history: turn.messages });
    res.end();
  } catch (err) {
    console.error('[server] Diagram agent turn failed:', err);
    send('error', { error: 'Diagram agent turn failed.', detail: String(err.message || err) });
    res.end();
  }
});

// Phase 0 pipe check for the new React client (accelerate-app/client) — used
// by its bare-shell App.tsx to confirm the dev proxy / production build
// actually reaches this server before any real UI is ported over.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'novartis-accelerate-server' });
});

// NOTE: still serving the existing single-file mock (public/index.html) as
// the live app — the React client (client/) is a bare Phase 0 shell so far
// and has no real UI yet. This route gets repointed at client/dist once the
// actual pages are ported (Phase 2+), not before, so the working app isn't
// broken out from under active use in the meantime.
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 4300;
app.listen(PORT, () => console.log(`Novartis Accelerate server running on http://localhost:${PORT}`));
