// Layout, sizing and colour — ported from app/drawing.py. One layout, shared
// by the SVG renderer and the .vsdx writer, so the two are the same drawing
// in two formats rather than two drawings of the same data.

const MARGIN = 40;
const TOP = 74;
const NW = 264, NH = 66;
const DW = 240, DH = 92;
const SW = 130, SH = 40;
const PANE_W = 250;
const ROW_GAP = 46;
const COL_W = 330;
const STOP_DX = 60;

const PALETTE = {
  entry: ['#E7F1F5', '#14607A'],
  datasource: ['#FBF3DA', '#8A6508'],
  process: ['#F2F2F2', '#8A8681'],
  decision: ['#FBF3DA', '#C8A302'],
  segment: ['#EEEAF6', '#5B4B8A'],
  stop: ['#FBEAE8', '#C4342B'],
  exit: ['#E7F2EC', '#1B7F51'],
  note: ['#FFFFFF', '#B4AFA8'],
};
const DEFAULT = ['#F6F8FA', '#8A8681'];

const STATUS = {
  live: ['#E7F2EC', '#1B7F51'],
  new: ['#FBF3DA', '#C8A302'],
  hold: ['#FBEAE8', '#C4342B'],
  built_not_live: ['#F2F2F2', '#8A8681'],
};

const LABEL_CHARS = 32;
const DETAIL_CHARS = 40;
const DECISION_CHARS = 26;
const LABEL_LINE_H = 17;
const DETAIL_LINE_H = 14;

function normalise(spec) {
  let nodes, edges;
  if (Array.isArray(spec)) {
    nodes = spec.slice();
    edges = [];
  } else {
    nodes = spec.nodes || spec.steps || [];
    edges = spec.edges || [];
  }
  if (nodes.length && !nodes.some((n) => n.id)) {
    nodes = nodes.map((n, i) => ({ ...n, id: `n${i}` }));
    edges = nodes.slice(0, -1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
  }
  return [nodes, edges];
}

function colours(node) {
  if (node.status && STATUS[node.status]) return STATUS[node.status];
  return PALETTE[node.type] || DEFAULT;
}

function wrap(text, width) {
  const out = [];
  for (const paragraph of String(text || '').split('\n')) {
    let current = '';
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (current) {
          out.push(current);
          current = '';
        }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      const candidate = `${current} ${word}`.trim();
      if (candidate.length <= width) current = candidate;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function size(node) {
  const kind = node.type;
  const label = node.label || '';
  const detail = node.detail || '';

  if (kind === 'decision') {
    const lines = wrap(label, DECISION_CHARS).length + wrap(detail, DECISION_CHARS).length;
    return [DW, Math.max(DH, 46 + lines * 15)];
  }
  if (kind === 'stop') return [SW, SH];
  if (kind === 'note') {
    const boxes = (node.attrs || {}).boxes || [];
    const lines = boxes.reduce((sum, b) => sum + (b.lines || []).length, 0);
    return [PANE_W, 34 + boxes.length * 26 + lines * 16];
  }

  const height = 14 + wrap(label, LABEL_CHARS).length * LABEL_LINE_H + wrap(detail, DETAIL_CHARS).length * DETAIL_LINE_H + 12;
  return [NW, Math.max(NH, height)];
}

function layout(nodes, edges) {
  const pos = {};
  const seg = nodes.filter((n) => (n.region || 'segmentation') === 'segmentation');

  const panes = seg.filter((n) => n.type === 'note');
  const segments = seg.filter((n) => n.type === 'segment');
  // A "side branch" sits off to the right of wherever it connects from,
  // instead of continuing straight down the main vertical line — every
  // suppression's Stop pill has always drawn this way, since a rejection
  // isn't the campaign's main path. `attrs.branch === 'side'` puts any
  // OTHER block there too (a chat-added "No" arm, a rejected-path note,
  // ...) without needing its own node type the way Stop got one; it draws
  // at its own real size (see `size()`) rather than a fixed pill.
  const sideBranches = seg.filter((n) => n.type !== 'note' && n.type !== 'segment' && (n.type === 'stop' || (n.attrs && n.attrs.branch === 'side')));
  const sideBranchIds = new Set(sideBranches.map((n) => n.id));
  const spine = seg.filter((n) => !['note', 'segment'].includes(n.type) && !sideBranchIds.has(n.id));

  const spineX = MARGIN + PANE_W + MARGIN;
  let y = TOP;

  const left = panes.find((p) => p.id === 'pane.left');
  if (left) {
    const [w, h] = size(left);
    pos[left.id] = [MARGIN, TOP, w, h];
  }

  const branchSource = {};
  for (const edge of edges) if (sideBranchIds.has(edge.to)) branchSource[edge.to] = edge.from;

  for (const node of spine) {
    const [w, h] = size(node);
    pos[node.id] = [spineX + (NW - w) / 2, y, w, h];
    y += h + ROW_GAP;
  }

  for (const branch of sideBranches) {
    const [w, h] = size(branch);
    const src = branchSource[branch.id];
    const sy = src && pos[src] ? pos[src][1] + (pos[src][3] - h) / 2 : TOP;
    pos[branch.id] = [spineX + NW + STOP_DX, sy, w, h];
  }

  // How far right the side-branch column actually reaches, so the
  // enrollment-sources pane (drawn further right still) never overlaps a
  // branch wider than the old fixed Stop-pill width used to guarantee.
  const sideBranchW = sideBranches.length ? Math.max(...sideBranches.map((n) => size(n)[0])) : SW;
  const right = panes.find((p) => p.id === 'pane.right');
  if (right) {
    const [w, h] = size(right);
    pos[right.id] = [spineX + NW + STOP_DX + sideBranchW + MARGIN, TOP, w, h];
  }

  segments.forEach((node, i) => {
    const [w, h] = size(node);
    pos[node.id] = [spineX + i * COL_W - (NW - w) / 2, y, w, h];
  });
  if (segments.length) y += NH + ROW_GAP;

  return pos;
}

function route(src, dst) {
  const [sx, sy, sw, sh] = src;
  const [dx, dy, dw, dh] = dst;
  const overlap = sy < dy + dh && dy < sy + sh;

  let start, end;
  if (overlap && dx >= sx + sw) {
    start = [sx + sw, sy + sh / 2];
    end = [dx, dy + dh / 2];
  } else if (overlap && dx + dw <= sx) {
    start = [sx, sy + sh / 2];
    end = [dx + dw, dy + dh / 2];
  } else {
    start = [sx + sw / 2, sy + sh];
    end = [dx + dw / 2, dy];
  }

  if (Math.abs(start[0] - end[0]) < 1 || Math.abs(start[1] - end[1]) < 1) return [start, end];

  if (start[1] === end[1] || overlap) {
    const mid = (start[0] + end[0]) / 2;
    return [start, [mid, start[1]], [mid, end[1]], end];
  }
  const mid = (start[1] + end[1]) / 2;
  return [start, [start[0], mid], [end[0], mid], end];
}

function codes(nodes) {
  const out = {};
  nodes.forEach((n, i) => (out[n.id] = `B${i + 1}`));
  return out;
}

function extent(pos) {
  const vals = Object.values(pos);
  const width = vals.length ? Math.max(...vals.map(([x, , w]) => x + w)) : 600;
  const height = vals.length ? Math.max(...vals.map(([, y, , h]) => y + h)) : 400;
  return [width, height];
}

module.exports = {
  MARGIN, TOP, NW, NH, DW, DH, SW, SH, PANE_W, ROW_GAP, COL_W, STOP_DX,
  LABEL_CHARS, DETAIL_CHARS, DECISION_CHARS, LABEL_LINE_H, DETAIL_LINE_H,
  normalise, colours, wrap, size, layout, route, codes, extent,
};
