require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI, createPartFromFunctionResponse } = require('@google/genai');
const { PrismaClient } = require('./generated/prisma');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const app = express();
app.use(cors());
app.use(express.json({ limit: '500kb' }));

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

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('[server] GEMINI_API_KEY is not set — /api/agent-fill will return 503 until server/.env has it.');
}
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const MODEL = 'gemini-2.5-flash';
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

app.get('/api/schema', async (req, res) => {
  const sections = await prisma.formSection.findMany({
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
  const { id, num, name, icon, parentId, audienceGate, note, needs, order } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id and name are required.' });
  try {
    const section = await prisma.formSection.create({
      data: {
        id, num: num || '', name, icon: icon || '▣', parentId: parentId || null,
        audienceGate: !!audienceGate, note: note || null,
        needsJson: JSON.stringify(needs || { preplan: [], plan: [], exec: [] }),
        order: order ?? (await prisma.formSection.count()),
      },
    });
    res.json({ section });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/sections/:id', async (req, res) => {
  const { num, name, icon, parentId, audienceGate, note, needs, order } = req.body || {};
  try {
    const section = await prisma.formSection.update({
      where: { id: req.params.id },
      data: {
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

const BASE_SYSTEM_PROMPT = `You are the Novartis Accelerate assistant — a form-filling agent embedded in a pharma campaign requirement-gathering platform, not a general-purpose chatbot. If asked what you are or who made you, answer in that identity (the platform's assistant) — never describe yourself as "a large language model trained by Google" or similar; that's an implementation detail, not who you are here. Most messages are free text — sometimes hurried, informal, with typos, in any language — describing a form section and values for fields in it. Some messages are just questions about data already entered into the form, with nothing new to fill. Some messages are corrections or preferences about how YOU should behave going forward, not about the form at all. Some messages are just plain chat (greetings, questions about the platform) with no fields to fill. Some messages ask to move to a different stage of the process. You have five tools:

- match_section(query): locates which section of the form the user means and returns its real field names. ALWAYS pass the user's ENTIRE original message as query — never extract just a fragment or sub-topic of it (e.g. don't pass just "tact franchise" from a message that says "let's fill the whole cma sheet, for the tact franchise..." — pass the whole message). Matching is substring-based against section names/aliases, so the full message gives it the best chance; a cherry-picked fragment can accidentally match nothing or match the wrong thing.
- propose_fill(sectionId, assignments): stages field:value pairs for the user to confirm. This does NOT write anything to the form yet — it only proposes. For a normal-sized message, batch every assignment you can extract into ONE propose_fill call for that section — do not call it once per group/topic. BUT: if the message specifies more than 10 fields for one section (e.g. "fill the whole CMA sheet" with all ten groups), do NOT try to fit them all in one call and do NOT call propose_fill more than once in the same turn for that section. Instead: stage only the FIRST 10 fields (in the order the fields appear on the form) as a single propose_fill call, then end your turn — do not call propose_fill again this turn. Tell the user exactly which fields/groups you staged and that the rest are queued; once they confirm this batch and say "continue" (or similar), stage the next 10 from the same original message, and so on. This exists because attempting to cram 30-45+ fields into one call is unreliable — it produces partial/dropped assignments — and because staging everything at once with no pacing overwhelms the confirm-review step. 10 fields, one confirmed batch at a time.
- get_entries(sectionId?, phase?): looks up field values already saved to the form (real persisted data, not memory/history) — optionally filtered to one section and/or one stage (preplan/plan/exec). Use this whenever the user asks what's already been entered, confirmed, or set for something — never answer from conversation history or a guess when this tool can ground the answer in what's actually saved.
- learn_skill(title, rule): permanently records a correction or preference about how you should behave, so it applies automatically on every future turn from now on — not just this session. Use this when the user is correcting your behavior, stating a standing preference, or clarifying a rule for how to handle something going forward ("always do X", "don't do Y", "when someone says Z, you should..."), as opposed to a one-off form-fill or a question. This is a judgment call you make from the message's intent — there is no fixed keyword list for it. "rule" should be the general, reusable instruction (not campaign-specific data); "title" is a short label for it.
- navigate_stage(stage): moves the user to a different stage of the process (cpf/crf/build/deploy/monitor). Use this whenever the user asks to go to, move to, advance to, switch to, or proceed to a stage by name — this is a real UI navigation, not a form-fill, so don't call match_section or propose_fill for it.

Rules:
- Only reach for match_section/propose_fill when the message is actually about filling in NEW form values. If it's a greeting or a general question with nothing to fill, just reply directly and briefly, in persona — do not call match_section on a "hello".
- If the user is asking a question about existing data ("what's the brand we set for OMS", "what did we put for the campaign name", "what's still empty in planning"), call get_entries — do not guess from memory, and do not call propose_fill for a read-only question.
- If the user is correcting how you behave or stating a standing preference (not campaign data), call learn_skill instead of just apologizing and moving on — the correction should actually persist. Confirm in your final reply what you've learned, in one short sentence.
- When you do call a tool, output exactly one short, plain, professional sentence right before it stating what you're about to do and why — write it like a status log entry, not a conversational aside. No first-person filler ("Okay", "I'm", "I've"), no chit-chat.
- ALWAYS call match_section before propose_fill — never guess a section id or field name from memory.
- Only call propose_fill after match_section has told you the section's real field names. Only include a field in assignments if the user's text actually specifies a value for it — never invent one. Field names must be copied verbatim from the list match_section returned.
- If match_section finds no match, end your turn asking the user which section they mean — do not guess.
- After calling propose_fill, end your turn with one short sentence telling the user the values are staged and awaiting confirmation in the UI — never claim they were applied.
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
      parametersJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: "The user's ENTIRE original message, verbatim — not a fragment or extracted sub-topic. Matching is substring-based, so passing the whole message maximizes the chance of finding the section name/alias wherever it appears." } },
        required: ['query'],
      },
    },
    {
      name: 'propose_fill',
      description: 'Stage field:value assignments for one section for the user to confirm. Does not write to the form.',
      parametersJsonSchema: {
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
      parametersJsonSchema: {
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
      parametersJsonSchema: {
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
      parametersJsonSchema: {
        type: 'object',
        properties: {
          stage: { type: 'string', enum: ['cpf', 'crf', 'build', 'deploy', 'monitor'], description: 'cpf = CPF & Visio, crf = CRF & Asset Handoff, build = Build & Proofing, deploy = Deployment, monitor = Monitoring.' },
        },
        required: ['stage'],
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
  return { error: `Unknown tool "${name}".` };
}

// SSE agent loop — same event-per-step granularity as govex's streamAgentTurn:
// "reasoning" (the model's one-sentence narration before a tool call),
// "tool_start"/"tool" (a named skill actually executing), "proposal" (a
// propose_fill result, ready for the client's existing Confirm/Cancel card),
// "final" (closing text), "error".
app.post('/api/agent-fill', async (req, res) => {
  const { sections, text, history, tactplanId } = req.body || {};
  if (!ai) return res.status(503).json({ error: 'GEMINI_API_KEY not configured on the server.' });
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
  const ctx = { sections, originalText: text, tactplanId: tactplanId || null };

  try {
    // Client resends the prior turn's history (from the "history" event
    // below) so corrections like "my mistake, brand is X" land in the same
    // conversation instead of starting a blank one each request — there's
    // no server-side session store, so the client is the source of truth
    // for continuity, same effect as govex's ChatSession.historyJson.
    const chat = ai.chats.create({
      model: MODEL,
      history: Array.isArray(history) ? history : undefined,
      config: {
        systemInstruction: await buildSystemPrompt(),
        tools: [{ functionDeclarations: buildToolDeclarations() }],
        automaticFunctionCalling: { disable: true },
        temperature: 0.3,
      },
    });

    let response = await chat.sendMessage({ message: text });
    if (response.text?.trim() && response.functionCalls?.length) send('reasoning', { text: response.text.trim() });

    let rounds = 0;
    while (response.functionCalls?.length && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const responseParts = [];
      for (const call of response.functionCalls) {
        const name = call.name || 'unknown_tool';
        const args = call.args || {};
        const callId = call.id || `${name}-${rounds}`;

        send('tool_start', { name });
        let result;
        try { result = await executeTool(name, args, ctx); }
        catch (err) { result = { error: err instanceof Error ? err.message : 'Tool execution failed.' }; }
        send('tool', { name, result });
        if (name === 'propose_fill' && result?.proposed) send('proposal', result);
        if (name === 'learn_skill' && result?.learned) send('learned', result);
        if (name === 'navigate_stage' && result?.navigated) send('navigate', result);

        responseParts.push(createPartFromFunctionResponse(callId, name, result));
      }
      response = await chat.sendMessage({ message: responseParts });
      if (response.text?.trim() && response.functionCalls?.length) send('reasoning', { text: response.text.trim() });
    }

    send('final', { text: response.text?.trim() || '' });
    send('history', { history: chat.getHistory() });
    res.end();
  } catch (err) {
    console.error('[server] Agent turn failed:', err);
    send('error', { error: 'Agent turn failed.', detail: String(err.message || err) });
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
