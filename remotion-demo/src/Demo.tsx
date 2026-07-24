import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  interpolate,
  spring,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Nunito';
import { theme as t } from './theme';

const { fontFamily } = loadFont();

export const FPS = 30;
export const DURATION_FRAMES = 900; // 30s @ 30fps

// ---- frame allocation (sums to 900) ----
const INTRO = 120;
const LANDING = 200;
const FORM_CHAT = 200;
const ADMIN = 160;
const CALENDAR = 160;
const OUTRO = 60;

function fadeInOut(frame: number, duration: number, edge = 14) {
  return interpolate(
    frame,
    [0, edge, duration - edge, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

const Caption: React.FC<{ children: React.ReactNode; frame: number }> = ({ children, frame }) => {
  const y = interpolate(frame, [0, 20], [16, 0], { extrapolateRight: 'clamp' });
  const op = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute',
        left: 80,
        bottom: 70,
        fontFamily,
        fontWeight: 800,
        fontSize: 40,
        color: t.ink,
        transform: `translateY(${y}px)`,
        opacity: op,
        textShadow: '0 2px 18px rgba(255,255,255,.9)',
      }}
    >
      {children}
    </div>
  );
};

const BrandMark: React.FC<{ size?: number }> = ({ size = 64 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background: `linear-gradient(135deg, ${t.gold}, ${t.nvOrange})`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontFamily,
      fontWeight: 800,
      fontSize: size * 0.34,
      boxShadow: '0 6px 20px rgba(231,74,33,.35)',
      flexShrink: 0,
    }}
  >
    HQ
  </div>
);

// ============ SCENE 1: INTRO ============
const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = spring({ frame, fps: FPS, config: { damping: 14, mass: 0.6 } });
  const op = fadeInOut(frame, INTRO);
  const subOpacity = interpolate(frame, [26, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: t.bg, alignItems: 'center', justifyContent: 'center', opacity: op }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, transform: `scale(${0.85 + scale * 0.15})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <BrandMark size={84} />
          <div style={{ fontFamily, fontWeight: 800, fontSize: 64, color: t.ink, letterSpacing: -1 }}>
            Novartis Accelerate
          </div>
        </div>
        <div style={{ fontFamily, fontWeight: 700, fontSize: 28, color: t.ink3, opacity: subOpacity }}>
          Campaign Requirement Gathering Platform
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ============ SCENE 2: LANDING / REQUESTS ============
const StatCard: React.FC<{ label: string; num: string; sub: string; tint: string; color: string; icon: string; delay: number }> = ({ label, num, sub, tint, color, icon, delay }) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - delay);
  const s = spring({ frame: local, fps: FPS, config: { damping: 16 } });
  return (
    <div
      style={{
        background: t.surface,
        border: `1px solid ${t.line}`,
        borderRadius: t.radius,
        boxShadow: t.shadow,
        padding: '20px 22px',
        width: 300,
        opacity: s,
        transform: `translateY(${(1 - s) * 18}px)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily, fontWeight: 800, fontSize: 15, color: t.ink3, textTransform: 'uppercase', letterSpacing: 1 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: tint, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{icon}</div>
        {label}
      </div>
      <div style={{ fontFamily, fontWeight: 800, fontSize: 40, color: t.ink, marginTop: 8 }}>{num}</div>
      <div style={{ fontFamily, fontWeight: 600, fontSize: 15, color: t.ink3, marginTop: 4 }}>{sub}</div>
    </div>
  );
};

const REQ_ROWS = [
  { name: 'Kisqali HCP Adjuvant — Q3 Wave 2', id: 'TP-88213', phase: 'Planning', color: t.nvOrange, ic: 'K', pdot: t.brand },
  { name: 'Cosentyx PsO Refills Nurture — DTC', id: 'TP-88155', phase: 'Pre-planning', color: t.brand, ic: 'C', pdot: t.gold },
  { name: 'Entresto Q4 HFpEF Congress Alerts', id: 'TP-88289', phase: 'Planning', color: t.gold, ic: 'E', pdot: t.brand },
];

const LandingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fadeInOut(frame, LANDING);
  const stats = [
    { label: 'Total active', num: '14', sub: 'across 6 brands', tint: t.brandTint, color: t.brand, icon: '◆' },
    { label: 'Needing my input', num: '3', sub: '2 planning · 1 execution', tint: t.goldTint, color: t.goldDk, icon: '⏱' },
    { label: 'AI-drafted values', num: '327', sub: 'this quarter', tint: t.aiTint, color: t.aiDk, icon: '✦' },
    { label: 'Live campaigns', num: '28', sub: 'avg cycle 21 days', tint: t.okTint, color: t.ok, icon: '✓' },
  ];

  const rowsOpacity = interpolate(frame, [50, 75], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: t.bg, opacity: op, padding: '70px 80px', fontFamily }}>
      <div style={{ fontWeight: 800, fontSize: 46, color: t.ink }}>Campaign requests</div>
      <div style={{ fontWeight: 600, fontSize: 19, color: t.ink2, marginTop: 8, marginBottom: 34, maxWidth: 900 }}>
        All requests you own, contribute to, or need to review — one place, live status for every phase.
      </div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 30 }}>
        {stats.map((s, i) => (
          <StatCard key={s.label} {...s} delay={i * 6} />
        ))}
      </div>
      <div
        style={{
          background: t.surface,
          border: `1px solid ${t.line}`,
          borderRadius: t.radius,
          boxShadow: t.shadow,
          overflow: 'hidden',
          opacity: rowsOpacity,
        }}
      >
        {REQ_ROWS.map((r, i) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '18px 24px',
              borderBottom: i < REQ_ROWS.length - 1 ? `1px solid ${t.line2}` : 'none',
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: r.color, color: '#fff', fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.ic}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: t.ink }}>{r.name}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: t.ink3, marginTop: 2 }}>{r.id}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: t.ink2 }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: r.pdot, display: 'inline-block' }} />
              {r.phase}
            </div>
          </div>
        ))}
      </div>
      <Caption frame={frame}>One place for every campaign, every phase.</Caption>
    </AbsoluteFill>
  );
};

// ============ SCENE 3: FORM + AI CHAT ============
const FormChatScene: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fadeInOut(frame, FORM_CHAT);
  const bubble1 = spring({ frame: Math.max(0, frame - 40), fps: FPS, config: { damping: 16 } });
  const bubble2 = spring({ frame: Math.max(0, frame - 70), fps: FPS, config: { damping: 16 } });
  const bubble3 = spring({ frame: Math.max(0, frame - 100), fps: FPS, config: { damping: 16 } });

  const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: t.ink }}>{label}</div>
      <div style={{ height: 46, border: `1px solid ${t.line}`, borderRadius: 8, background: t.surface2, display: 'flex', alignItems: 'center', padding: '0 14px', fontWeight: 500, fontSize: 15, color: t.ink2 }}>{value}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ background: t.bg, opacity: op, padding: '60px 70px', fontFamily, flexDirection: 'row', gap: 30 }}>
      <div style={{ flex: 1.5, background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow, padding: 30, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>⤳</span>
          <span style={{ fontWeight: 700, fontSize: 24, color: t.ink }}>Journey</span>
          <span style={{ marginLeft: 'auto', background: t.brandTint, color: t.brand, fontWeight: 800, fontSize: 13, padding: '4px 12px', borderRadius: 99 }}>In Progress</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Field label="Journey Name" value="Kisqali Breast Cancer — Q3 Launch" />
          <Field label="Journey Owner" value="Priya Sharma" />
          <Field label="Journey Type" value="Multichannel" />
          <Field label="Primary Channel" value="Email, SMS" />
        </div>
      </div>
      <div style={{ flex: 1, background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: `linear-gradient(135deg, ${t.nvOrange}, ${t.gold})`, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 99, background: 'rgba(255,255,255,.25)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✦</div>
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Campaign Navigator</div>
        </div>
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, background: t.surface2 }}>
          <div style={{ opacity: bubble1, transform: `translateY(${(1 - bubble1) * 10}px)`, alignSelf: 'flex-end', background: t.brand, color: '#fff', fontWeight: 500, fontSize: 14, padding: '10px 14px', borderRadius: 12, maxWidth: '85%' }}>
            Fill Journey with the Kisqali brief I pasted
          </div>
          <div style={{ opacity: bubble2, transform: `translateY(${(1 - bubble2) * 10}px)`, alignSelf: 'flex-start', background: t.surface, border: `1px solid ${t.line2}`, color: t.ink, fontWeight: 500, fontSize: 14, padding: '10px 14px', borderRadius: 12, maxWidth: '85%' }}>
            Found it — staged 4 fields in Journey. Confirm to apply?
          </div>
          <div style={{ opacity: bubble3, transform: `translateY(${(1 - bubble3) * 10}px)`, alignSelf: 'flex-start', background: t.okTint, border: `1px solid ${t.ok}22`, color: t.ok, fontWeight: 700, fontSize: 13, padding: '8px 14px', borderRadius: 12 }}>
            ✓ Applied — Journey now 9/31 fields
          </div>
        </div>
        <div style={{ padding: '12px 16px', borderTop: `1px solid ${t.line}`, display: 'flex', gap: 8 }}>
          {['💬 Ask', '📎 Upload', '📋 Paste', '🎤 Speak'].map((x) => (
            <div key={x} style={{ fontSize: 12, fontWeight: 700, color: t.ink3, background: t.surface2, borderRadius: 7, padding: '6px 10px' }}>{x}</div>
          ))}
        </div>
      </div>
      <Caption frame={frame}>Ask, paste, or upload — AI fills the form for you.</Caption>
    </AbsoluteFill>
  );
};

// ============ SCENE 4: ADMIN (schema-driven, no-code) ============
const ADMIN_ROWS = [
  { ic: '▣', name: 'Generic/Overview', fields: 30, needs: 'preplan: aor · plan: aor, xm' },
  { ic: '⤳', name: 'Journey', fields: 9, needs: 'plan: aor · exec: ops' },
  { ic: '◫', name: 'MDS - Target List', fields: 20, needs: 'plan: xm, mds' },
];

const AdminScene: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fadeInOut(frame, ADMIN);
  const rowsIn = interpolate(frame, [20, 45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: t.bg, opacity: op, padding: '70px 80px', fontFamily }}>
      <div style={{ fontWeight: 800, fontSize: 42, color: t.ink }}>Manage sections</div>
      <div style={{ fontWeight: 600, fontSize: 18, color: t.ink2, marginTop: 8, marginBottom: 26, maxWidth: 900 }}>
        Add, edit, and reorder the form's sections and fields — no code, no redeploy.
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        {['Manage sections', 'Manage form fields', 'Manage nudges'].map((tab, i) => (
          <div key={tab} style={{ fontWeight: 700, fontSize: 15, padding: '10px 4px', color: i === 0 ? t.brand : t.ink3, borderBottom: i === 0 ? `2px solid ${t.brand}` : '2px solid transparent' }}>{tab}</div>
        ))}
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow, overflow: 'hidden', opacity: rowsIn }}>
        <div style={{ display: 'flex', padding: '12px 22px', background: t.surface2, borderBottom: `1px solid ${t.line}`, fontWeight: 800, fontSize: 13, color: t.ink3, textTransform: 'uppercase', letterSpacing: 1 }}>
          <div style={{ flex: 2 }}>Section</div>
          <div style={{ flex: 1 }}>Fields</div>
          <div style={{ flex: 3 }}>Needs (who, per phase)</div>
        </div>
        {ADMIN_ROWS.map((r, i) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', padding: '16px 22px', borderBottom: i < ADMIN_ROWS.length - 1 ? `1px solid ${t.line2}` : 'none' }}>
            <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 16, color: t.ink }}>
              <span>{r.ic}</span>{r.name}
            </div>
            <div style={{ flex: 1, fontWeight: 700, fontSize: 15, color: t.ink2 }}>{r.fields}</div>
            <div style={{ flex: 3, fontWeight: 600, fontSize: 14, color: t.ink3 }}>{r.needs}</div>
          </div>
        ))}
      </div>
      <Caption frame={frame}>Every section, field, and rule — fully admin-editable.</Caption>
    </AbsoluteFill>
  );
};

// ============ SCENE 5: CALENDAR / GANTT ============
const GANTT_BARS = [
  { label: 'Discovery', color: t.brand, x: 0, w: 120, tag: '' },
  { label: 'CPF (Campaign Planning Form)', color: '#7A5AB8', x: 90, w: 260, tag: '78%' },
  { label: 'Journey Build', color: t.ok, x: 200, w: 300, tag: 'Risk' },
  { label: 'Medical Review (MLR)', color: '#C23B6B', x: 520, w: 200, tag: 'Delayed +2d' },
  { label: 'Deployment', color: t.ink4, x: 700, w: 140, tag: '' },
];

const CalendarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fadeInOut(frame, CALENDAR);
  const kpiIn = spring({ frame, fps: FPS, config: { damping: 16 } });

  const Kpi: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
      <div style={{ fontWeight: 800, fontSize: 12, color: t.ink3, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontWeight: 800, fontSize: 22, color: t.ink, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <AbsoluteFill style={{ background: t.bg, opacity: op, padding: '70px 80px', fontFamily }}>
      <div style={{ fontWeight: 800, fontSize: 42, color: t.ink, marginBottom: 24 }}>Kisqali HCP Launch</div>
      <div
        style={{
          background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow,
          padding: '20px 26px', display: 'flex', gap: 50, marginBottom: 22,
          opacity: kpiIn, transform: `translateY(${(1 - kpiIn) * 14}px)`,
        }}
      >
        <Kpi label="Overall Progress" value="62%" />
        <Kpi label="Estimated Go Live" value="Oct 15, 2025" />
        <Kpi label="Confidence" value="89% High" />
        <Kpi label="Overall Status" value="● On Track" />
      </div>
      <div style={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: t.radius, boxShadow: t.shadow, padding: '26px 30px' }}>
        {GANTT_BARS.map((b, i) => {
          const local = Math.max(0, frame - 20 - i * 8);
          const grow = spring({ frame: local, fps: FPS, config: { damping: 18 } });
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: i < GANTT_BARS.length - 1 ? 20 : 0 }}>
              <div style={{ width: 260, fontWeight: 700, fontSize: 15, color: t.ink }}>{b.label}</div>
              <div style={{ flex: 1, position: 'relative', height: 30 }}>
                <div
                  style={{
                    position: 'absolute', left: b.x, width: b.w * grow, height: 26, borderRadius: 7,
                    background: b.color, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
                    color: '#fff', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                >
                  {b.tag && <span style={{ background: 'rgba(255,255,255,.28)', borderRadius: 99, padding: '1px 8px', fontSize: 11 }}>{b.tag}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Caption frame={frame}>The full campaign timeline, at a glance.</Caption>
    </AbsoluteFill>
  );
};

// ============ SCENE 6: OUTRO ============
const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const op = fadeInOut(frame, OUTRO, 18);
  const s = spring({ frame, fps: FPS, config: { damping: 14 } });

  return (
    <AbsoluteFill style={{ background: t.bg, alignItems: 'center', justifyContent: 'center', opacity: op }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, transform: `scale(${0.9 + s * 0.1})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <BrandMark size={56} />
          <div style={{ fontFamily, fontWeight: 800, fontSize: 44, color: t.ink }}>Novartis Accelerate</div>
        </div>
        <div style={{ fontFamily, fontWeight: 700, fontSize: 22, color: t.brand }}>From CPF to Go-Live — end to end.</div>
      </div>
    </AbsoluteFill>
  );
};

// ============ ROOT COMPOSITION ============
export const Demo: React.FC = () => {
  return (
    <>
      <Sequence from={0} durationInFrames={INTRO}>
        <IntroScene />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={LANDING}>
        <LandingScene />
      </Sequence>
      <Sequence from={INTRO + LANDING} durationInFrames={FORM_CHAT}>
        <FormChatScene />
      </Sequence>
      <Sequence from={INTRO + LANDING + FORM_CHAT} durationInFrames={ADMIN}>
        <AdminScene />
      </Sequence>
      <Sequence from={INTRO + LANDING + FORM_CHAT + ADMIN} durationInFrames={CALENDAR}>
        <CalendarScene />
      </Sequence>
      <Sequence from={INTRO + LANDING + FORM_CHAT + ADMIN + CALENDAR} durationInFrames={OUTRO}>
        <OutroScene />
      </Sequence>
    </>
  );
};
