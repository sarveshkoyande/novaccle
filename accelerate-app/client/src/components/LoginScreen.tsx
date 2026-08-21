import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import { PERSONAS, type PersonaKey } from '../personas';

// Derives a plausible demo email from a persona's display name — keeps the
// "prefilled credentials" illusion consistent across whichever persona is
// picked, instead of the login form staying frozen on Priya Sharma's email
// no matter who you're about to sign in as.
function emailFor(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).join('.');
  return `${slug}@novartis-agency.com`;
}

// Mock auth, ported from index.html's #loginScreen. Persona used to be
// fixed (always Priya Sharma/AOR) with a separate in-app "viewing the
// platform as" switcher available after login — moved here instead: who
// you're signing in as is now a real choice made AT login, via the picker
// button at the top-right of the card, matching how a real per-account
// login works. AppShell no longer offers a switcher; logging in as someone
// else means logging out and picking again from this screen.
export default function LoginScreen() {
  const login = useSessionStore((s) => s.login);
  const [selected, setSelected] = useState<PersonaKey>('aor');
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const persona = PERSONAS[selected];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className={`persona-wrap login-persona-picker ${menuOpen ? 'open' : ''}`} ref={wrapRef}>
          <button className="persona-btn login-persona-btn" onClick={() => setMenuOpen((v) => !v)} title="Choose who to log in as">
            <span className="p-av" style={{ borderColor: persona.color }}>
              {persona.abbr}
            </span>
            <span className="p-caret">▾</span>
          </button>
          <div className="persona-menu">
            <div className="persona-menu-h">Log in as</div>
            {(Object.entries(PERSONAS) as [PersonaKey, (typeof PERSONAS)[PersonaKey]][]).map(([k, p]) => (
              <button
                key={k}
                className={`persona-item ${k === selected ? 'on' : ''}`}
                onClick={() => {
                  setSelected(k);
                  setMenuOpen(false);
                }}
              >
                <span className="p-av" style={{ borderColor: p.color }}>
                  {p.abbr}
                </span>
                <div className="p-info">
                  <b>{p.name}</b>
                  <i>{p.role}</i>
                  <span>{p.scope}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="login-brand">
          <div className="brand-mark">
            <img src="/novartis-logo.svg" alt="Novartis" />
          </div>
          <div className="brand-name">Accelerate</div>
        </div>
        <h2>Sign in</h2>
        <p className="login-sub">Requirement Gathering Platform</p>
        <label className="login-field">
          <span>Email</span>
          <input value={emailFor(persona.name)} readOnly />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input type="password" defaultValue="demo-password-1234" readOnly />
        </label>
        <button className="btn-primary login-btn" onClick={() => login(selected)}>
          Log in
        </button>
        <p className="login-hint">
          Demo credentials prefilled — signs you in as{' '}
          <b>
            {persona.name}, {persona.role}
          </b>
          . Use the picker above to log in as someone else.
        </p>
      </div>
    </div>
  );
}
