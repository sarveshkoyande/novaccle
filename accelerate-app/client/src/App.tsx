import { useEffect, useState } from 'react';
import AdminSchema from './AdminSchema';
import './App.css';

// Phase 0/1 shell: health check proves the pipe works (Vite dev proxy ->
// Express -> Prisma); AdminSchema is the Phase 1 deliverable — a real,
// working admin UI over the schema-driven backend. The actual campaign
// form (Phase 2+) still lives in the old monolithic HTML mock for now.
function App() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(() => setHealth('ok'))
      .catch(() => setHealth('error'));
  }, []);

  // Styling lives in index.css / App.css rather than inline: the font-family
  // here restated what :root already sets, and the hardcoded #666 / #1E7A4F /
  // #c0392b were a third palette on top of the two the stylesheets carried.
  return (
    <main className="app-shell">
      <header className="app-head">
        <h1>Novartis Accelerate — Admin</h1>
        <p>
          Form schema editor (Phase 1). Backend:{' '}
          {health === 'checking' && <span className="app-health">checking…</span>}
          {health === 'ok' && <strong className="app-health ok">connected</strong>}
          {health === 'error' && <strong className="app-health error">unreachable</strong>}
        </p>
      </header>
      <AdminSchema />
    </main>
  );
}

export default App;
