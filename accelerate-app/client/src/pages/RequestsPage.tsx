import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useSessionStore } from '../stores/useSessionStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { PERSONAS, type PersonaKey } from '../personas';
import { REQUESTS, buildCampaignRequest, buildGenericOverviewEntries, type CampaignRequest } from '../data/requests';
import NewRequestModal from '../components/NewRequestModal';
import ChatPanel from '../components/ChatPanel';

const REQ_PAGE_SIZE = 5;

const REQ_STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'preplan', label: 'Pre-planning' },
  { key: 'plan', label: 'Planning' },
  { key: 'exec', label: 'Execution' },
  { key: 'completed', label: 'Completed' },
];

function matchesStatusFilter(r: CampaignRequest, f: string): boolean {
  if (f === 'completed') return r.status === 'completed';
  if (['preplan', 'plan', 'exec'].includes(f)) return r.phase === f && r.status !== 'completed';
  return true; // 'all'
}

const STAT_MINE_SUB: Partial<Record<PersonaKey, string>> = {
  aor: '2 planning · 1 execution',
  xm: '1 decision blocking · confirm-and-go',
  mds: '1 target list · 1 pending visio',
  cep: '2 planning · Data Cloud + MCI',
  ops: '1 execution · orchestration',
};

// Ported from index.html's #view-landing (renderRequestsTable/
// renderFilterMenu/renderReqPager) — the agent-first home screen. Search/
// filter/sort/pagination are real React state + useMemo here instead of the
// original's module-level currentReqFilter/currentReqAssignee/reqPage
// globals + manual innerHTML re-render.
export default function RequestsPage() {
  const navigate = useNavigate();
  const currentPersona = useSessionStore((s) => s.currentPersona);
  const layoutMode = useLayoutStore((s) => s.mode);

  // data-view="landing" is what caps #view-landing/.hm-grid at height:100%
  // (see legacy-design-system.css) so .hm-agent's message column scrolls
  // internally instead of growing forever with the conversation — without
  // it, a long thread pushes the composer far below the fold (looked like
  // "can't click or type in the chat box": the input was still there, just
  // rendered 1000+px down the page). This WAS removed for a while over a
  // real but differently-caused bug (the chat pane stretching to a wrong
  // height) — the actual fix for that is the separate data-landing-layout
  // attribute below driving the chat/split/form toggle, not dropping the
  // height cap altogether.
  useEffect(() => {
    document.body.dataset.view = 'landing';
    document.body.dataset.landingLayout = layoutMode === 'chat' ? 'collapsed' : layoutMode === 'form' ? 'formfull' : 'open';
    return () => {
      delete document.body.dataset.view;
      delete document.body.dataset.landingLayout;
    };
  }, [layoutMode]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState<'anyone' | 'me'>('anyone');
  const [page, setPage] = useState(1);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  // REQUESTS has no backing table (confirmed: no /api/requests route) — the
  // original mutates that same module-level array directly (REQUESTS.unshift)
  // and manually re-renders; this bump forces this component to re-read it
  // the same way, rather than duplicating the list into its own React state.
  const [requestsVersion, setRequestsVersion] = useState(0);

  const filteredSorted = useMemo(() => {
    let rows = REQUESTS.filter(
      (r) => matchesStatusFilter(r, statusFilter) && (assigneeFilter === 'anyone' || r.mineTo.includes(currentPersona)),
    );
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.brand.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => b.daysOpen - a.daysOpen);
  }, [statusFilter, assigneeFilter, search, currentPersona, requestsVersion]);

  function handleCreateRequest(req: CampaignRequest) {
    REQUESTS.unshift(req);
    setRequestsVersion((v) => v + 1);
    setNewRequestOpen(false);
    setPage(1);
    navigate(`/requests/${req.id}`);
    // Fire-and-forget: the portfolio row is already live locally (above),
    // this just makes it survive a reload/restart instead of only existing
    // in this tab's in-memory REQUESTS array (see bootstrapPersistedCampaigns).
    api.createCampaign(req).catch(() => {});
  }

  // Chat's propose_new_campaign flow — same seed-and-navigate as the New
  // Request modal, just built from the fields the agent staged instead of
  // form inputs. Also seeds Generic/Overview with those same intake values
  // (agency, brand, indication, ...) — without this the campaign record
  // existed but its own form looked completely unanswered, since creating
  // the portfolio-list entry and writing form field entries were two
  // separate systems that nothing connected.
  async function handleCreateCampaignFromChat(fields: Parameters<typeof buildCampaignRequest>[0]): Promise<string> {
    const req = buildCampaignRequest(fields);
    handleCreateRequest(req);
    const sections = schemaQuery.data?.sections || [];
    const entries = buildGenericOverviewEntries(sections, req.id, fields);
    if (entries.length) await api.saveEntries(req.id, entries);
    return req.id;
  }

  const pages = Math.max(1, Math.ceil(filteredSorted.length / REQ_PAGE_SIZE));
  const clampedPage = Math.min(page, pages);
  const start = (clampedPage - 1) * REQ_PAGE_SIZE;
  const rows = filteredSorted.slice(start, start + REQ_PAGE_SIZE);

  const mineCount = REQUESTS.filter((r) => r.mineTo.includes(currentPersona)).length;

  const assigneeScoped = REQUESTS.filter((r) => assigneeFilter === 'anyone' || r.mineTo.includes(currentPersona));
  const statusScoped = REQUESTS.filter((r) => matchesStatusFilter(r, statusFilter));
  const activeFilterCount = (statusFilter !== 'all' ? 1 : 0) + (assigneeFilter !== 'anyone' ? 1 : 0);

  function setStatus(key: string) {
    setStatusFilter(key);
    setPage(1);
  }
  function setAssignee(key: 'anyone' | 'me') {
    setAssigneeFilter(key);
    setPage(1);
  }
  function clearFilters() {
    setStatusFilter('all');
    setAssigneeFilter('anyone');
    setPage(1);
  }

  // Same schema every campaign shares (confirmed earlier: /api/schema isn't
  // tactplanId-scoped) — fetched here too so this page can call the same
  // /api/agent-fill the request-detail chat uses, with no campaign open
  // (tactplanId: null). This is what makes it the literal same chat session
  // as any individual request's — one useChatStore thread per persona,
  // reused via the same <ChatPanel>, instead of a separate agent/endpoint/
  // component that reset every time you left this page.
  const schemaQuery = useQuery({ queryKey: ['schema'], queryFn: api.getSchema });

  return (
    <div className="view on" id="view-landing">
      <div className="hm-grid">
        <section className="hm-agent" aria-label="Campaign agent">
          <ChatPanel
            variant="inline"
            sections={schemaQuery.data?.sections || []}
            tactplanId={null}
            onApplyProposal={() => {}}
            onOpenCampaign={(tactplanId) => navigate(`/requests/${tactplanId}`)}
            onCreateCampaign={handleCreateCampaignFromChat}
          />
        </section>

        <div className="hm-rail">
          <div className="stats">
            <div className="stat-card" style={{ '--i': 0 } as React.CSSProperties}>
              <div className="sc-lbl"><span className="sc-ico sc-a">◆</span><span>Total active</span></div>
              <div className="sc-num">{REQUESTS.filter((r) => r.status === 'active').length}</div>
              <div className="sc-sub">across {new Set(REQUESTS.map((r) => r.brand)).size} brands</div>
            </div>
            <div className="stat-card" style={{ '--i': 1 } as React.CSSProperties}>
              <div className="sc-lbl"><span className="sc-ico sc-b">⏱</span><span>Requests assigned to me</span></div>
              <div className="sc-num">{mineCount}</div>
              <div className="sc-sub">{STAT_MINE_SUB[currentPersona] || ''}</div>
            </div>
            <div className="stat-card" style={{ '--i': 2 } as React.CSSProperties}>
              <div className="sc-lbl"><span className="sc-ico sc-d">✦</span><span>AI-drafted values</span></div>
              <div className="sc-num">327</div>
              <div className="sc-sub">this quarter · 82% confirmed unchanged</div>
            </div>
            <div className="stat-card" style={{ '--i': 3 } as React.CSSProperties}>
              <div className="sc-lbl"><span className="sc-ico sc-c">✓</span><span>Live campaigns</span></div>
              <div className="sc-num">28</div>
              <div className="sc-sub">Q3 2026 · avg cycle 21 days</div>
            </div>
          </div>

          <section className="hm-list" aria-label="Campaigns">
            <div className="hm-list-head">
              <h4>Campaigns</h4>
              <button className="btn-primary btn-sm" onClick={() => setNewRequestOpen(true)}>
                + New request
              </button>
              <div className="search-input">
                <input
                  placeholder="Search brand, TactPlan ID, name…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="flt-wrap">
                <button
                  className={`flt-btn ${activeFilterCount ? 'on' : ''}`}
                  aria-haspopup="true"
                  aria-expanded={filterMenuOpen}
                  title="Filter campaigns"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilterMenuOpen((v) => !v);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
                  </svg>
                  <span>Filter</span>
                  {activeFilterCount > 0 && <span className="flt-count">{activeFilterCount}</span>}
                </button>
                {filterMenuOpen && (
                  <div className="flt-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="flt-group">
                      <span className="flt-label">Status</span>
                      {REQ_STATUS_FILTERS.map((f) => (
                        <button
                          key={f.key}
                          className={`flt-opt ${statusFilter === f.key ? 'on' : ''}`}
                          role="menuitemradio"
                          aria-checked={statusFilter === f.key}
                          onClick={() => setStatus(f.key)}
                        >
                          <span>{f.label}</span>
                          <span className="flt-n">{assigneeScoped.filter((r) => matchesStatusFilter(r, f.key)).length}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flt-group">
                      <span className="flt-label">Assigned to</span>
                      {([{ key: 'anyone', label: 'Anyone' }, { key: 'me', label: 'Assigned to me' }] as const).map((a) => (
                        <button
                          key={a.key}
                          className={`flt-opt ${assigneeFilter === a.key ? 'on' : ''}`}
                          role="menuitemradio"
                          aria-checked={assigneeFilter === a.key}
                          onClick={() => setAssignee(a.key)}
                        >
                          <span>{a.label}</span>
                          <span className="flt-n">
                            {a.key === 'anyone' ? statusScoped.length : statusScoped.filter((r) => r.mineTo.includes(currentPersona)).length}
                          </span>
                        </button>
                      ))}
                    </div>
                    {activeFilterCount > 0 && (
                      <button className="flt-clear" onClick={clearFilters}>
                        Clear filters
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="req-table">
              <div className="rt-head">
                <div>Campaign</div>
                <div>Phase</div>
                <div>Owners</div>
                <div>Your action</div>
                <div></div>
              </div>
              {rows.length ? (
                rows.map((r, i) => {
                  const isMine = r.mineTo.includes(currentPersona);
                  const act = r.action[currentPersona];
                  const actText = r.actionText[currentPersona];
                  const actCls = act === 'me' ? 'act-me' : act === 'block' ? 'act-block' : 'act-wait';
                  const pdotCls = r.phase === 'preplan' ? 'pdot-pp' : r.phase === 'plan' ? 'pdot-p' : 'pdot-e';
                  return (
                    <div
                      key={r.id}
                      className={`rt-row ${isMine ? 'mine' : ''}`}
                      style={{ '--i': Math.min(i, 10) } as React.CSSProperties}
                      onClick={() => navigate(`/requests/${r.id}`)}
                    >
                      <div className="rt-camp">
                        <div className="rt-name"><b>{r.name}</b></div>
                        <div className="rt-id">{r.id}</div>
                      </div>
                      <div className="rt-phase">
                        <span className={`pdot ${pdotCls}`} />
                        {r.phaseLabel}
                      </div>
                      <div className="rt-owners">
                        {r.owners.map((o) => (
                          <span key={o} className="p-av" style={{ borderColor: PERSONAS[o].color }} title={PERSONAS[o].name}>
                            {PERSONAS[o].abbr}
                          </span>
                        ))}
                      </div>
                      <div>
                        <span className={`rt-action ${actCls}`}>{actText}</span>
                      </div>
                      <div className="rt-chev">→</div>
                    </div>
                  );
                })
              ) : (
                <div className="rt-empty">No requests match this filter.</div>
              )}
            </div>

            {filteredSorted.length > 0 && (
              <div className="rp-bar">
                <div className="rp-count">
                  Showing <b>{start + 1}-{start + rows.length}</b> of <b>{filteredSorted.length}</b>
                </div>
                <div className="rp-nav">
                  <button className="rp-btn" disabled={clampedPage === 1} onClick={() => setPage(clampedPage - 1)} aria-label="Previous page">
                    ‹
                  </button>
                  {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                    <button key={n} className={`rp-btn ${n === clampedPage ? 'on' : ''}`} onClick={() => setPage(n)}>
                      {n}
                    </button>
                  ))}
                  <button className="rp-btn" disabled={clampedPage === pages} onClick={() => setPage(clampedPage + 1)} aria-label="Next page">
                    ›
                  </button>
                </div>
                <div className="rp-page">
                  Page <b>{clampedPage}</b> of <b>{pages}</b>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {newRequestOpen && <NewRequestModal onClose={() => setNewRequestOpen(false)} onCreate={handleCreateRequest} />}
    </div>
  );
}
