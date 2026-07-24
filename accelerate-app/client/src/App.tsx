import { useEffect, useState } from 'react';
import AdminSchema from './AdminSchema';

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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '32px 40px' }}>
      <h1 style={{ marginBottom: 4 }}>Novartis Accelerate — Admin</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Form schema editor (Phase 1). Backend:{' '}
        {health === 'checking' && 'checking…'}
        {health === 'ok' && <strong style={{ color: '#1E7A4F' }}>connected</strong>}
        {health === 'error' && <strong style={{ color: '#c0392b' }}>unreachable</strong>}
      </p>
      <AdminSchema />
    </main>
  );
}

export default App;
