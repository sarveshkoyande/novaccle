import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useSessionStore } from '../stores/useSessionStore';
import { useLayoutStore, type LayoutMode } from '../stores/useLayoutStore';
import { PERSONAS } from '../personas';
import NotificationBell from './NotificationBell';

const LAYOUT_OPTIONS: { mode: LayoutMode; title: string }[] = [
  { mode: 'chat', title: 'Full-screen chat' },
  { mode: 'split', title: 'Split chat and form' },
  { mode: 'form', title: 'Full-screen form' },
];

// Three glyphs on one identical square base, sitting bare on the app bar —
// no button box around them at rest, and empty (outline only, no fill) until
// selected: a plain square (chat takes the whole screen), a square split by
// a center line (both panes share it), a square quartered by a plus (form
// takes the whole screen). All three use the exact same <rect> geometry —
// a mismatched fill-only square (no stroke) used to read visibly smaller
// than its stroked siblings, since a 2px stroke centered on the path adds
// ~1px outward on every side that a bare fill doesn't. Selecting one fills
// its square black and turns its dividing line(s) orange, same "black +
// orange" state language as the top-nav active tab elsewhere in the shell.
function LayoutGlyph({ mode, active }: { mode: LayoutMode; active: boolean }) {
  const squareFill = active ? 'var(--nv-warm-black)' : 'none';
  const squareStroke = active ? 'var(--nv-warm-black)' : 'currentColor';
  const lineStroke = active ? 'var(--nv-space-orange)' : 'currentColor';
  const square = <rect x="2" y="2" width="20" height="20" fill={squareFill} stroke={squareStroke} strokeWidth="2" />;
  if (mode === 'chat') {
    return (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        {square}
      </svg>
    );
  }
  if (mode === 'split') {
    return (
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        {square}
        <line x1="12" y1="2" x2="12" y2="22" stroke={lineStroke} strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
      {square}
      <line x1="12" y1="2" x2="12" y2="22" stroke={lineStroke} strokeWidth="2" />
      <line x1="2" y1="12" x2="22" y2="12" stroke={lineStroke} strokeWidth="2" />
    </svg>
  );
}

// Ported from index.html's .appbar — real <NavLink> routes replace the old
// showLanding()/showPlan()/showAdmin() manual class-toggling, and the
// persona dropdown is local component state (open/closed) instead of a
// document-level click listener toggling a DOM class.
export default function AppShell() {
  const currentPersona = useSessionStore((s) => s.currentPersona);
  const logout = useSessionStore((s) => s.logout);
  const layoutMode = useLayoutStore((s) => s.mode);
  const setLayoutMode = useLayoutStore((s) => s.setMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const persona = PERSONAS[currentPersona];
  const pathname = useLocation().pathname;
  // Requests landing ("/") has its own chat+list split (.hm-agent/.hm-rail)
  // that the same toggle now drives too, alongside the request-detail
  // chat/form split — anywhere else (Calendar, Admin) there's no chat pane
  // for the toggle to mean anything, so it stays hidden there.
  const showLayoutToggle = pathname === '/' || /^\/requests\/[^/]+/.test(pathname);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <>
      <div className="appbar">
        <NavLink to="/" className="brand-logo">
          <div className="brand-mark">
            <img src="/novartis-logo.svg" alt="Novartis" />
          </div>
          <div className="brand-name">Accelerate</div>
        </NavLink>
        <nav className="top-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'on' : '')}>
            Calendar
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'on' : '')}>
            Admin
          </NavLink>
        </nav>
        <div className="appbar-right">
          {showLayoutToggle && (
            <div className="layout-toggle" role="group" aria-label="Screen layout">
              {LAYOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  className={`layout-toggle-btn ${layoutMode === opt.mode ? 'on' : ''}`}
                  title={opt.title}
                  aria-label={opt.title}
                  aria-pressed={layoutMode === opt.mode}
                  onClick={() => setLayoutMode(opt.mode)}
                >
                  <LayoutGlyph mode={opt.mode} active={layoutMode === opt.mode} />
                </button>
              ))}
            </div>
          )}
          <NotificationBell persona={currentPersona} />
          {/* No more in-app persona switching — who you are was fixed at
              login (see LoginScreen's picker). This is read-only identity
              plus the one action available once signed in: log out, which
              takes you back to the sign-in screen to pick again. */}
          <div className={`persona-wrap ${menuOpen ? 'open' : ''}`} ref={wrapRef}>
            <button className="persona-btn" onClick={() => setMenuOpen((v) => !v)}>
              <span className="p-av" style={{ borderColor: persona.color }}>
                {persona.abbr}
              </span>
              <span className="p-name">
                <b>{persona.name}</b>
                <i>{persona.role}</i>
              </span>
              <span className="p-caret">▾</span>
            </button>
            <div className="persona-menu">
              <div className="persona-menu-h">Signed in as</div>
              <div className="persona-item on persona-item-static">
                <span className="p-av" style={{ borderColor: persona.color }}>
                  {persona.abbr}
                </span>
                <div className="p-info">
                  <b>{persona.name}</b>
                  <i>{persona.role}</i>
                  <span>{persona.scope}</span>
                </div>
              </div>
              <hr />
              <button className="persona-item persona-logout" onClick={logout}>
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>
      <Outlet />
    </>
  );
}
