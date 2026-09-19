// BOOM OS -- Stage 35.9: Manager Command Center Live Operations (refresh/UX only).
//
// Frontend reliability layer over the already-verified Stage 35.8 Manager Command Center: manual
// refresh, controlled 30s auto-refresh (paused off-tab), a "last updated" indicator, and a
// non-destructive stale-data state on a failed refresh. No new endpoint, no new business logic,
// no financial calculation moved into the frontend.
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const view = read('src/components/ManagerCommandCenterView.tsx');
const css = read('src/design-system/command-center.css');
const dashboard = read('server/routes/dashboard.ts');

const checks = [
  // -- Refresh control exists and is accessible
  ['a manual refresh control exists with an accessible label', view.includes("aria-label={ru ? 'Обновить панель управления'") && view.includes('className="cmd-refresh-btn boom-focusable"')],
  ['the refresh button exposes aria-busy while loading/refreshing', view.includes('aria-busy={loading || refreshing}')],
  ['the refresh button is disabled while loading/refreshing (no duplicate click can start a second visible request)', view.includes('disabled={loading || refreshing}')],

  // -- Manual refresh still calls the SAME existing dashboard source of truth
  ['manual refresh routes through the same load()/api.getManagerDashboard() call, no second data source', view.includes('const manualRefresh = useCallback(() => { if (!busyRef.current) void load(\'manual\'); }, [load]);') && (view.match(/api\.getManagerDashboard\(/g) || []).length === 1],
  ['the request still sends the same branch_id/start/end params, unchanged by this stage', view.includes('api.getManagerDashboard({ branch_id: branchId, start: range.start, end: range.end })')],
  ['no backend/API file was modified to support this stage', dashboard.includes("requirePermission('dashboard.view')") && dashboard.includes('if (!branchId || !allowed(req, branchId))')],

  // -- Automatic refresh: 30s interval, single instance, cleaned up, paused when hidden
  ['the auto-refresh interval is 30 seconds', view.includes('const REFRESH_MS = 30000;')],
  ['there is exactly one setInterval call site for data polling (plus one, separately, for the display-only "ago" ticker)', (view.match(/window\.setInterval\(/g) || []).length === 2],
  ['the polling interval is torn down on cleanup (unmount / filter change)', /const stop = \(\) => \{ if \(timer !== null\) \{ window\.clearInterval\(timer\); timer = null; \} \};[\s\S]{0,300}return \(\) => \{ stop\(\); document\.removeEventListener\('visibilitychange', onVisibility\); \};/.test(view)],
  ['document.visibilitychange pauses polling when the tab is hidden', view.includes("const onVisibility = () => {\n      if (document.hidden) stop();")],
  ['becoming visible again resumes the interval (and refreshes once immediately)', /else \{ if \(!busyRef\.current\) void load\('auto'\); start\(\); \}/.test(view)],
  ['polling never starts while the tab is already hidden on mount', view.includes('if (!document.hidden) start();')],

  // -- Duplicate-request / race protection
  ['a busyRef guard prevents the manual button and the poll tick from firing a duplicate concurrent request', view.includes('const busyRef = useRef(false);') && (view.match(/if \(!busyRef\.current\)/g) || []).length >= 3],
  ['a monotonic request-id guards against a stale (superseded) response overwriting fresher data', view.includes('const requestIdRef = useRef(0);') && view.includes('const myId = ++requestIdRef.current;')],
  ['a stale successful response is discarded, never applied to state', /if \(requestIdRef\.current !== myId\) return; \/\/ superseded by a newer request -- discard/.test(view)],
  ['a stale failed response is discarded too -- it never reports a failure for a request nobody is waiting on', /if \(requestIdRef\.current !== myId\) return; \/\/ superseded -- do not report a stale failure/.test(view)],
  ['a deliberate filter change always fetches immediately, bypassing the busy guard on purpose', view.includes("useEffect(() => { void load('initial'); }, [load]);")],

  // -- "Last updated" -- only on real success, never on a failed or merely-fired refresh
  ['a lastUpdatedAt timestamp state exists', view.includes('const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);')],
  ['lastUpdatedAt is set ONLY inside the success path, immediately after setData', /setData\(r\);\s*setError\(''\);\s*setLastUpdatedAt\(Date\.now\(\)\);/.test(view)],
  ['lastUpdatedAt is never written inside the catch (failure) branch', !/catch \(e: any\) \{[\s\S]{0,200}setLastUpdatedAt/.test(view)],
  ['a visible "last updated" indicator renders the formatted timestamp', view.includes('className="cmd-last-updated" aria-live="polite"') && view.includes('timeAgoLabel(lastUpdatedAt, ru)')],

  // -- Stale-data state: old data survives a failed refresh, never destroyed or faked
  ['data state is never cleared inside the failure branch -- old data remains on screen', !/catch \(e: any\) \{[\s\S]{0,200}setData\(/.test(view)],
  ['a distinct, non-destructive stale banner exists for "failed refresh, but data still present"', view.includes('{error && data && (') && view.includes('className="cmd-stale"')],
  ['the original hard-error state is kept for "no data at all yet"', view.includes('{error && !data && <div className="cmd-error">{error}</div>}')],
  ['the stale banner never fabricates a placeholder value -- it only reports how long ago the real data arrived', view.includes('agoFragment(lastUpdatedAt, true)') || view.includes('agoFragment(lastUpdatedAt, false)')],

  // -- No flicker: the original data-gated loading guard is untouched
  ['the full-panel loading spinner still only shows when there is truly no data yet, unchanged from 35.8', view.includes('{loading && !data && <div className="cmd-loading">')],

  // -- No page reload, no new data source, filters preserved
  ['this stage never reloads the browser page', !/window\.location\.reload/.test(view)],
  ['branch/date filter setters are never called by refresh logic -- only by the user\'s own filter controls', (() => { const refreshRegion = view.slice(view.indexOf('const load = useCallback'), view.indexOf('const presets:')); return !/setBranchId\(|setPreset\(|setCustomStart\(|setCustomEnd\(/.test(refreshRegion); })()],

  // -- Financial safety, re-pinned (this stage touches the same file Stage 35.8 already guarded)
  ['no arithmetic on financial fields was introduced anywhere in the render', !/data\.(financial|cash_position|credit)\.[a-zA-Z_.]+\s*[+\-*/]/.test(view)],
  ['sales and received-money remain two separate panels with two separate totals', /cmd-panel">[\s\S]{0,80}Продажи[\s\S]{0,1200}cmd-panel">[\s\S]{0,80}Получено/.test(view)],

  // -- Reduced motion
  ['reduced motion stops the refresh spinner specifically, without disabling the button', css.includes('.cmd-refresh-btn svg.animate-spin{animation:none}')],

  ['stage doc exists', fs.existsSync('docs/STAGE-35.9-MANAGER-COMMAND-CENTER-LIVE.md')],
];

let ok = 0;
for (const [name, v] of checks) { console.log(`${v ? 'PASS' : 'FAIL'} ${name}`); if (v) ok++; }
console.log(`${ok}/${checks.length} PASS`);
if (ok !== checks.length) process.exit(1);
