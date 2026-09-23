// Entry point: campaign inputs in, a design spec / SVG / .vsdx out. Ported
// (and trimmed to the Segmentation region only, per the plan's scope
// boundary — the SOP's separate Email Journey component is a follow-up) from
// app/flow/planner.py in the reference project.

const sop = require('./sop');
const segmentation = require('./segmentation');
const { FlowDesign } = require('./model');
const { flowSvg } = require('./svg');
const { flowVsdx } = require('./vsdx');
const { codes: codesFor } = require('./drawing');

function plan(inputs) {
  const design = new FlowDesign({ sopVersion: sop.VERSION });
  if (!inputs.audience) {
    design.warnings.push('Audience is not set, so the DTC rules were applied. Set Audience to HCP or DTC and regenerate.');
  }
  segmentation.build(design, inputs);
  return design;
}

// A block on the printed diagram (B1, B2, ...) is a rendering-time artifact
// — drawing.js assigns it from node order, not something the SOP rules or
// the campaign's own fields carry. So "edit B12" only means something once
// it's resolved against a SPECIFIC generation's node list; the mapping
// shifts if audience/segments/the unbranded fork change which nodes exist
// at all. `blocks()` is that resolution step, shared by both the chat-edit
// endpoint (to explain what's on the current diagram) and the override
// application below (to know which node id a saved override belongs to).
function blocks(inputs) {
  const spec = generate(inputs);
  const codeById = codesFor(spec.nodes);
  return spec.nodes.map((n) => ({ code: codeById[n.id], id: n.id, label: n.label, detail: n.detail }));
}

// `nodeOverrides` (node id -> replacement detail text) is how a chat edit
// against a specific block ("set B12 to ...") actually sticks — the SOP
// rules that build most blocks have no underlying campaign field to change
// (a suppression check like "Age 18+?" is fixed boilerplate, not derived
// from anything the campaign record states), so the override is applied
// directly to the generated node rather than routed through FlowInputs.
// Keyed by node id, not the printed code, because ids are stable across a
// regeneration and codes are not.
function applyOverrides(spec, overrides) {
  if (!overrides || !Object.keys(overrides).length) return spec;
  const patch = (n) => (overrides[n.id] !== undefined ? { ...n, detail: overrides[n.id], tbd: [] } : n);
  return { ...spec, nodes: spec.nodes.map(patch), steps: spec.steps.map(patch) };
}

function generate(inputs) {
  return applyOverrides(plan(inputs).toSpec(), inputs.nodeOverrides);
}

function svgFor(inputs, title) {
  return flowSvg(generate(inputs), title || inputs.campaignName || 'Segmentation Flow');
}

async function vsdxFor(inputs, title) {
  return flowVsdx(generate(inputs), title || inputs.campaignName || 'Segmentation Flow');
}

module.exports = { plan, generate, svgFor, vsdxFor, sop, blocks };
