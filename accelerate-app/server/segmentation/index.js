// Entry point: campaign inputs in, a design spec / SVG / .vsdx out. Ported
// (and trimmed to the Segmentation region only, per the plan's scope
// boundary — the SOP's separate Email Journey component is a follow-up) from
// app/flow/planner.py in the reference project.

const sop = require('./sop');
const segmentation = require('./segmentation');
const { FlowDesign } = require('./model');
const { flowSvg } = require('./svg');
const { flowVsdx } = require('./vsdx');

function plan(inputs) {
  const design = new FlowDesign({ sopVersion: sop.VERSION });
  if (!inputs.audience) {
    design.warnings.push('Audience is not set, so the DTC rules were applied. Set Audience to HCP or DTC and regenerate.');
  }
  segmentation.build(design, inputs);
  return design;
}

function generate(inputs) {
  return plan(inputs).toSpec();
}

function svgFor(inputs, title) {
  return flowSvg(generate(inputs), title || inputs.campaignName || 'Segmentation Flow');
}

async function vsdxFor(inputs, title) {
  return flowVsdx(generate(inputs), title || inputs.campaignName || 'Segmentation Flow');
}

module.exports = { plan, generate, svgFor, vsdxFor, sop };
