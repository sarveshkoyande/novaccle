// Ported from index.html's #view-placeholder — reused for both Analytics
// and Assets nav destinations (PLACEHOLDER_VIEW_META in the old app).
export default function PlaceholderPage({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="view on">
      <div className="hero">
        <div className="hero-l">
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
      </div>
      <section className="admin-field-panel">
        <div className="admin-panel-head">
          <div>
            <h3>Coming soon</h3>
            <p>This page isn't built yet — check back after it's scoped.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
