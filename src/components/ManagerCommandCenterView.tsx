import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, TrendingUp, Wallet, CreditCard, Banknote, Receipt, ShoppingBag, ChefHat,
  Users, UserCog, Boxes, AlertTriangle, ChevronRight, Loader2
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { agoFragment, timeAgoLabel } from '../freshness';
import { NavTab } from './Sidebar';

// ---------------------------------------------------------------------------------------------
// Manager Command Center -- a single read-only view over the real, existing Order/Payment/
// CashShift/Credit/KDS/Waiter/Inventory/Staff data (server-aggregated by /api/dashboard/manager).
// No client-side totals: every number shown here is exactly what the backend computed.
// ---------------------------------------------------------------------------------------------

interface Props { onNavigate: (tab: NavTab) => void; }

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '0.00'); }
function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function computeRange(preset: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date();
  if (preset === 'today') return { start: startOfDay(now).toISOString(), end: now.toISOString() };
  if (preset === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); return { start: startOfDay(y).toISOString(), end: startOfDay(now).toISOString() }; }
  if (preset === 'week') { const w = new Date(now); const day = (w.getDay() + 6) % 7; w.setDate(w.getDate() - day); return { start: startOfDay(w).toISOString(), end: now.toISOString() }; }
  if (preset === 'month') { const m = new Date(now.getFullYear(), now.getMonth(), 1); return { start: m.toISOString(), end: now.toISOString() }; }
  return { start: customStart ? new Date(customStart).toISOString() : startOfDay(now).toISOString(), end: customEnd ? new Date(customEnd).toISOString() : now.toISOString() };
}

// Stage 35.9 -- live operational refresh. 30s default poll, paused whenever the tab is not
// visible so an idle background tab never keeps hitting the server. This constant is the only
// timing change in this stage; the request itself, its params and its permission/branch gating
// are entirely unchanged.
const REFRESH_MS = 30000;

// Stage 44: the "N назад" wording moved to src/freshness.ts, because the kitchen, the pass and
// the kitchen control screens now show the same indicator. Same behaviour, one source.

export const ManagerCommandCenterView: React.FC<Props> = ({ onNavigate }) => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState(user?.branch_id || '');
  const [preset, setPreset] = useState<Preset>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedWaiter, setExpandedWaiter] = useState<string | null>(null);

  // Stage 35.9 -- live refresh state. `refreshing` is a background fetch with data already on
  // screen (button spinner + a quiet header note), distinct from `loading` (no data yet, the
  // existing full-panel loading state below). `lastUpdatedAt` is a client-side timestamp of the
  // last fetch that actually SUCCEEDED -- a failed refresh never touches it, and it is never sent
  // back to the server or used in any calculation.
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [, setTick] = useState(0); // re-renders the "N sec ago" text; never touches data/requests

  useEffect(() => { api.getBranches().then(r => { setBranches(r.branches || []); if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id); }).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd]);

  // Stage 35.9 -- requestIdRef is the race-protection mechanism: the project's existing api.ts
  // request() has no abort/sequencing support to reuse, so this is the smallest safe addition.
  // Every load() call gets a new id; a response is only ever applied if it is still the NEWEST
  // outstanding request when it resolves, so a slow, superseded (e.g. stale-filter) response can
  // never overwrite fresher data. busyRef is a separate, simple guard used only by the manual
  // refresh button and the auto-poll tick, to skip firing a redundant network call while one is
  // already in flight for the current filters -- it deliberately does NOT gate the filter-change
  // effect below, since a branch/date change must always fetch immediately regardless of what was
  // already in flight.
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'manual' | 'auto' = 'manual') => {
    if (!branchId) return;
    const myId = ++requestIdRef.current;
    busyRef.current = true;
    if (mode === 'initial') setLoading(true); else setRefreshing(true);
    try {
      const r = await api.getManagerDashboard({ branch_id: branchId, start: range.start, end: range.end });
      if (requestIdRef.current !== myId) return; // superseded by a newer request -- discard
      setData(r);
      setError('');
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      if (requestIdRef.current !== myId) return; // superseded -- do not report a stale failure
      setError(e?.message || (ru ? 'Не удалось загрузить панель.' : 'Panel ýüklenip bilmedi.'));
    } finally {
      if (requestIdRef.current === myId) { setLoading(false); setRefreshing(false); }
      busyRef.current = false;
    }
  }, [branchId, range.start, range.end, ru]);

  // Initial load AND every branch/date-filter change -- always fires (bypasses busyRef on
  // purpose): a deliberate filter change must refetch now, not wait for whatever was in flight.
  useEffect(() => { void load('initial'); }, [load]);

  // Manual refresh: guarded against duplicate concurrent clicks.
  const manualRefresh = useCallback(() => { if (!busyRef.current) void load('manual'); }, [load]);

  // Auto refresh -- exactly one interval per mounted instance, paused while the tab is hidden,
  // an immediate refresh + resumed interval when the tab becomes visible again, guarded against
  // overlapping an already-running fetch, and always cleaned up on unmount/filter change.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => { if (timer === null) timer = window.setInterval(() => { if (!busyRef.current) void load('auto'); }, REFRESH_MS); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { if (!busyRef.current) void load('auto'); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [load]);

  // "N sec/min ago" ticker -- display-only, paused while the tab is hidden, never fetches.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => { if (timer === null) timer = window.setInterval(() => setTick(x => x + 1), 1000); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const presets: Array<{ id: Preset; label: string }> = [
    { id: 'today', label: ru ? 'Сегодня' : 'Şu gün' },
    { id: 'yesterday', label: ru ? 'Вчера' : 'Düýn' },
    { id: 'week', label: ru ? 'Эта неделя' : 'Bu hepde' },
    { id: 'month', label: ru ? 'Этот месяц' : 'Bu aý' },
    { id: 'custom', label: ru ? 'Период' : 'Aralyk' },
  ];

  const currency = data?.branch?.currency || 'TMT';
  const p = data?.permissions || {};

  const ORDER_STATUS_LABELS: Record<string, string> = {
    PENDING_CONFIRMATION: ru ? 'Новые' : 'Täze',
    CONFIRMED: ru ? 'Подтверждено' : 'Tassyklandy',
    PREPARING: ru ? 'Готовится' : 'Taýýarlanýar',
    READY: ru ? 'Готово' : 'Taýýar',
    COMPLETED: ru ? 'Завершено' : 'Tamamlandy',
    CANCELLED: ru ? 'Отменено' : 'Ýatyryldy',
    REFUNDED: ru ? 'Возврат' : 'Yzyna gaýtaryldy',
  };
  const KDS_STATUS_LABELS: Record<string, string> = {
    NEW: ru ? 'Новые' : 'Täze',
    PREPARING: ru ? 'Готовится' : 'Taýýarlanýar',
    READY: ru ? 'Готово' : 'Taýýar',
    COMPLETED: ru ? 'Завершено' : 'Tamamlandy',
    CANCELLED: ru ? 'Отменено' : 'Ýatyryldy',
  };

  function alertText(a: any): string {
    switch (a.type) {
      case 'LOW_STOCK':
        return a.message_key === 'dashboard.alert.outOfStock'
          ? (ru ? `Нет на складе: ${a.params.name}` : `Ammarda ýok: ${a.params.name}`)
          : (ru ? `Заканчивается: ${a.params.name} (${a.params.stock} ${a.params.unit})` : `Azalýar: ${a.params.name} (${a.params.stock} ${a.params.unit})`);
      case 'ORDER_DELAY':
        return ru ? `Заказ #${a.params.order_number} готовится ${a.params.minutes} мин (дольше обычного)` : `#${a.params.order_number} sargyt ${a.params.minutes} min taýýarlanýar (adatdakydan uzyn)`;
      case 'CASH_DIFFERENCE':
        return ru ? `Расхождение кассы у ${a.params.cashier}: ${money(a.params.difference)}` : `${a.params.cashier} kassasynda tapawut: ${money(a.params.difference)}`;
      case 'CREDIT_LIMIT_ISSUE':
        return ru ? `Превышен кредитный лимит: ${a.params.name}` : `Kredit çägi aşyldy: ${a.params.name}`;
      case 'OPEN_CASH_SHIFT':
        return ru ? `Смена ${a.params.cashier} открыта с прошлого периода` : `${a.params.cashier} çalyşygy öňki döwürden açyk`;
      default:
        return a.type;
    }
  }

  const kpiCards = data?.kpi ? [
    { label: ru ? 'ПРОДАЖИ' : 'SATUW', value: data.kpi.today_sales, icon: TrendingUp, tab: null as NavTab | null },
    { label: ru ? 'НАЛИЧНЫЕ' : 'NAKT', value: data.kpi.cash, icon: Banknote, tab: 'cashierPos' as NavTab },
    { label: ru ? 'КАРТА' : 'KART', value: data.kpi.card, icon: CreditCard, tab: 'cashierPos' as NavTab },
    { label: ru ? 'КРЕДИТ' : 'KREDIT', value: data.kpi.credit, icon: Wallet, tab: p.credit ? 'creditReports' as NavTab : null },
    ...(p.credit && data.credit ? [{ label: ru ? 'ДОЛГИ' : 'BERGILER', value: data.credit.outstanding_total, icon: Receipt, tab: 'creditReports' as NavTab }] : []),
    { label: ru ? 'ЗАКАЗЫ' : 'SARGYTLAR', value: String(data.kpi.orders), isCount: true, icon: ShoppingBag, tab: p.orders ? 'operations' as NavTab : null },
    { label: ru ? 'СРЕДНИЙ ЧЕК' : 'ORTAÇA ÇEK', value: data.kpi.average_check, icon: Receipt, tab: null },
  ] : [];

  return (
    <div className="cmd-center">
      {/* ---- TOP: title / branch / date / refresh ---- */}
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title">{ru ? 'ЦЕНТР УПРАВЛЕНИЯ' : 'DOLANDYRYŞ MERKEZI'}</h1>
          <p className="cmd-subtitle">{data?.branch?.name || ''}</p>
        </div>
        <div className="cmd-toolbar">
          {branches.length > 1 && (
            <select className="cmd-branch-select boom-focusable" value={branchId} onChange={e => setBranchId(e.target.value)}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="cmd-preset-group">
            {presets.map(pr => (
              <button key={pr.id} onClick={() => setPreset(pr.id)} className={`cmd-preset-btn boom-focusable ${preset === pr.id ? 'active' : ''}`}>{pr.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="cmd-date-range">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-slate-500 text-xs">–</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          )}
          {/* Stage 35.9 -- last-updated reflects the last SUCCESSFUL fetch only; a running or
              failed refresh never changes this text. */}
          <span className="cmd-last-updated" aria-live="polite">
            {refreshing ? (ru ? 'Обновляется…' : 'Täzelenýär…') : lastUpdatedAt ? timeAgoLabel(lastUpdatedAt, ru) : ''}
          </span>
          <button
            className="cmd-refresh-btn boom-focusable"
            disabled={loading || refreshing}
            aria-label={ru ? 'Обновить панель управления' : 'Dolandyryş merkezini täzelemek'}
            aria-busy={loading || refreshing}
            onClick={manualRefresh}
          >
            {(loading || refreshing) ? <Loader2 className="animate-spin" /> : <RefreshCw />} {ru ? 'Обновить' : 'Täzele'}
          </button>
        </div>
      </div>

      {/* Stage 35.9 -- a refresh failure while valid data is already on screen is a soft,
          non-destructive "stale" notice (old data stays visible); a failure with no data yet is
          the original hard error state. Neither ever fabricates a value. */}
      {error && data && (
        <div className="cmd-stale">
          {ru ? 'Не удалось обновить данные.' : 'Maglumatlary täzeläp bolmady.'}{' '}
          {lastUpdatedAt ? (ru ? `Показаны данные от ${agoFragment(lastUpdatedAt, true)}.` : `${agoFragment(lastUpdatedAt, false)} maglumatlar görkezilýär.`) : ''}
        </div>
      )}
      {error && !data && <div className="cmd-error">{error}</div>}
      {loading && !data && <div className="cmd-loading"><Loader2 className="w-4 h-4 animate-spin" /> {ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>}

      {data && (
        <>
          {/* ---- ALERT CENTER: real alerts only, drill-down where an endpoint supports it ---- */}
          {data.alerts?.length > 0 && (
            <div className="cmd-alerts">
              {data.alerts.map((a: any, idx: number) => (
                <button key={idx} onClick={() => onNavigate(a.link)} className={`cmd-alert boom-focusable ${a.severity}`}>
                  <AlertTriangle />
                  <span className="flex-1">{alertText(a)}</span>
                  <ChevronRight />
                </button>
              ))}
            </div>
          )}

          {/* ---- KPI STRIP ---- */}
          <div className="cmd-kpi-grid">
            {kpiCards.map((c, idx) => {
              const Icon = c.icon;
              const Wrapper: any = c.tab ? 'button' : 'div';
              return (
                <Wrapper key={idx} onClick={c.tab ? () => onNavigate(c.tab!) : undefined} className={`cmd-kpi ${c.tab ? 'clickable boom-focusable' : ''}`}>
                  <div className="cmd-kpi-label"><Icon /> {c.label}</div>
                  <div className="cmd-kpi-value">{c.isCount ? c.value : `${money(c.value)}`} {!c.isCount && <span className="cmd-currency">{currency}</span>}</div>
                </Wrapper>
              );
            })}
          </div>

          {/* ---- FINANCIAL RECONCILIATION -- SALES != CASH RECEIVED, kept visually separate ---- */}
          {data.financial && (
            <div className="cmd-grid-3">
              <div className="cmd-panel">
                <div className="cmd-panel-title">{ru ? 'Продажи' : 'Satuw'}</div>
                <div>
                  <div className="cmd-stat-row"><span>{ru ? 'Наличные' : 'Nakt'}</span><span>{money(data.financial.sales.cash)}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Карта' : 'Kart'}</span><span>{money(data.financial.sales.card)}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Кредит' : 'Kredit'}</span><span>{money(data.financial.sales.credit)}</span></div>
                  {Number(data.financial.sales.other) > 0 && <div className="cmd-stat-row"><span>{ru ? 'Другое' : 'Başga'}</span><span>{money(data.financial.sales.other)}</span></div>}
                  <div className="cmd-stat-row total"><span>{ru ? 'ИТОГО ПРОДАЖИ' : 'JEMI SATUW'}</span><span>{money(data.financial.sales.total)}</span></div>
                </div>
              </div>
              <div className="cmd-panel">
                <div className="cmd-panel-title">{ru ? 'Получено денег' : 'Alnan pul'}</div>
                <div>
                  <div className="cmd-stat-row"><span>{ru ? 'Наличные' : 'Nakt'}</span><span>{money(data.financial.received.cash)}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Карта' : 'Kart'}</span><span>{money(data.financial.received.card)}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Погашение кредита' : 'Kredit üzülmesi'}</span><span>{money(data.financial.received.credit_repayments)}</span></div>
                  <div className="cmd-stat-row total received"><span>{ru ? 'ИТОГО ПОЛУЧЕНО' : 'JEMI ALYNDY'}</span><span>{money(data.financial.received.total)}</span></div>
                </div>
              </div>
              {data.financial.receivables && (
                <button onClick={() => p.credit && onNavigate('creditReports')} className="cmd-panel linkable boom-focusable" style={{textAlign:'left'}}>
                  <div className="cmd-panel-title">{ru ? 'Задолженность' : 'Bergiler'}</div>
                  <div>
                    <div className="cmd-stat-row"><span>{ru ? 'Клиенты' : 'Müşderiler'}</span><span>{money(data.financial.receivables.customer)}</span></div>
                    <div className="cmd-stat-row"><span>{ru ? 'Сотрудники' : 'Işgärler'}</span><span>{money(data.financial.receivables.staff)}</span></div>
                    <div className="cmd-stat-row total receivables"><span>{ru ? 'ИТОГО' : 'JEMI'}</span><span>{money(data.financial.receivables.total)}</span></div>
                  </div>
                </button>
              )}
              {data.financial.refunds && (
                <div className="cmd-panel" style={{gridColumn:'1 / -1'}}>
                  <div className="cmd-panel-title" style={{marginBottom:0}}>{ru ? 'Возвраты за период' : 'Döwür üçin yzyna gaýtarmalar'}</div>
                  <div className="cmd-refunds-strip mt-1">{money(data.financial.refunds.total)} {currency} <span className="count">({data.financial.refunds.count})</span></div>
                </div>
              )}
            </div>
          )}

          <div className="cmd-grid-2">
            {/* ---- CASH POSITION -- the difference stays prominent ---- */}
            {data.cash_position && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title">{ru ? 'Кассовая смена' : 'Kassa çalyşygy'}</div>
                  <button onClick={() => onNavigate('cashierPos')} className="cmd-panel-link boom-focusable">{ru ? 'Открыть' : 'Aç'} <ChevronRight /></button>
                </div>
                {data.cash_position.open_shift ? (
                  <div>
                    <div className="cmd-stat-row"><span>{ru ? 'Кассир' : 'Kassir'}</span><span style={{color:'var(--boom-text)'}}>{data.cash_position.open_shift.cashier_name}</span></div>
                    <div className="cmd-stat-row"><span>{ru ? 'Открытие' : 'Açylyş'}</span><span>{money(data.cash_position.open_shift.opening_cash)}</span></div>
                    <div className="cmd-stat-row"><span>{ru ? 'Продажи (нал.)' : 'Satuw (nakt)'}</span><span>{money(data.cash_position.open_shift.cash_sales)}</span></div>
                    <div className="cmd-stat-row"><span>{ru ? 'Погашения (нал.)' : 'Üzülme (nakt)'}</span><span>{money(data.cash_position.open_shift.credit_repayments)}</span></div>
                    <div className="cmd-stat-row"><span>{ru ? 'Возвраты' : 'Yzyna gaýtarma'}</span><span>{money(data.cash_position.open_shift.refunds)}</span></div>
                    <div className="cmd-stat-row total"><span>{ru ? 'Ожидаемая касса' : 'Garaşylýan kassa'}</span><span>{money(data.cash_position.expected_cash)}</span></div>
                  </div>
                ) : <div className="text-xs text-slate-500">{ru ? 'Смена не открыта' : 'Çalyşyk açyk däl'}</div>}
                {data.cash_position.last_closed_shift && (
                  <div className="cmd-cash-diff">
                    <span>{ru ? 'Последнее закрытие' : 'Soňky ýapylyş'}: {data.cash_position.last_closed_shift.cashier_name}</span>
                    <span className={`value ${Number(data.cash_position.last_closed_shift.difference) !== 0 ? 'off' : 'balanced'}`}>{ru ? 'разница' : 'tapawut'} {money(data.cash_position.last_closed_shift.difference)}</span>
                  </div>
                )}
              </div>
            )}

            {/* ---- ORDERS LIVE STATUS ---- */}
            {data.orders && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title">{ru ? 'Заказы' : 'Sargytlar'}</div>
                  <button onClick={() => onNavigate('operations')} className="cmd-panel-link boom-focusable">{ru ? 'Все заказы' : 'Ähli sargytlar'} <ChevronRight /></button>
                </div>
                <div className="cmd-status-grid">
                  {Object.entries(data.orders.by_status).map(([status, count]) => (
                    <button key={status} onClick={() => onNavigate('operations')} className="cmd-status-tile clickable boom-focusable">
                      <div className="cmd-status-count">{String(count)}</div>
                      <div className="cmd-status-label">{ORDER_STATUS_LABELS[status] || status}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="cmd-grid-2">
            {/* ---- KITCHEN / KDS ---- */}
            {data.kds && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title"><ChefHat /> {ru ? 'Кухня' : 'Aşhana'}</div>
                  <button onClick={() => onNavigate('operations')} className="cmd-panel-link boom-focusable">KDS <ChevronRight /></button>
                </div>
                <div className="cmd-status-grid kds" style={{marginBottom:'8px'}}>
                  {Object.entries(data.kds.by_status).map(([status, count]) => (
                    <div key={status} className="cmd-status-tile" style={{textAlign:'center'}}>
                      <div className="cmd-status-count">{String(count)}</div>
                      <div className="cmd-status-label">{KDS_STATUS_LABELS[status] || status}</div>
                    </div>
                  ))}
                </div>
                {data.kds.average_preparation_minutes !== null && (
                  <div className="text-xs text-slate-400">{ru ? 'Среднее время приготовления' : 'Ortaça taýýarlyk wagty'}: <span className="text-white font-semibold">{data.kds.average_preparation_minutes} {ru ? 'мин' : 'min'}</span></div>
                )}
                {data.kds.longest_active_order && (
                  <div className="text-xs text-slate-400">{ru ? 'Дольше всех в работе' : 'Iň uzak işleýän'}: #{data.kds.longest_active_order.order_number} — <span className="text-white font-semibold">{data.kds.longest_active_order.minutes} {ru ? 'мин' : 'min'}</span></div>
                )}
              </div>
            )}

            {/* ---- INVENTORY ---- */}
            {data.inventory && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title"><Boxes /> {ru ? 'Склад' : 'Ammar'}</div>
                  <button onClick={() => onNavigate('inventory')} className="cmd-panel-link boom-focusable">{ru ? 'Склад' : 'Ammar'} <ChevronRight /></button>
                </div>
                <div>
                  <button onClick={() => onNavigate('inventory')} className="cmd-stat-row boom-focusable" style={{width:'100%'}}><span>{ru ? 'Заканчивается' : 'Azalýar'}</span><span className={data.inventory.low_stock.length ? 'cmd-flag' : ''}>{data.inventory.low_stock.length}</span></button>
                  <button onClick={() => onNavigate('inventory')} className="cmd-stat-row boom-focusable" style={{width:'100%'}}><span>{ru ? 'Нет в наличии' : 'Ýok'}</span><span className={data.inventory.out_of_stock.length ? 'cmd-flag' : ''} style={data.inventory.out_of_stock.length ? {color:'var(--boom-danger)'} : undefined}>{data.inventory.out_of_stock.length}</span></button>
                  <div className="cmd-stat-row"><span>{ru ? 'Списания' : 'Ýazyp aýyrmalar'}</span><span>{data.inventory.recent_write_offs.length}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Поступления' : 'Gelenler'}</span><span>{data.inventory.recent_receipts.length}</span></div>
                  <div className="cmd-stat-row"><span>{ru ? 'Перемещения' : 'Geçirmeler'}</span><span>{data.inventory.recent_transfers.length}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* ---- WAITER PERFORMANCE ---- */}
          {data.waiters && (
            <div className="cmd-table-wrap">
              <div className="cmd-table-head"><Users /> {ru ? 'Официанты' : 'Ofisiantlar'}</div>
              <table className="cmd-table">
                <thead>
                  <tr>
                    <th>{ru ? 'Официант' : 'Ofisiant'}</th>
                    <th>{ru ? 'Заказы' : 'Sargytlar'}</th>
                    <th>{ru ? 'Продажи' : 'Satuw'}</th>
                    <th>{ru ? 'Ср. чек' : 'Orta çek'}</th>
                    <th>{ru ? 'Статус' : 'Status'}</th>
                    <th>{ru ? 'Запросы на удаление' : 'Aýyrmak haýyşlary'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.waiters.map((w: any) => (
                    <React.Fragment key={w.id}>
                      <tr className="cmd-waiter-row boom-focusable" onClick={() => setExpandedWaiter(expandedWaiter === w.id ? null : w.id)}>
                        <td>{w.name}</td>
                        <td>{w.orders}</td>
                        <td>{money(w.sales)}</td>
                        <td>{money(w.average_check)}</td>
                        <td><span className={`cmd-status-badge ${w.status === 'PROFESSIONAL' ? 'pro' : ''}`}>{w.status}</span></td>
                        <td>{w.removal_requests > 0 ? <span className="cmd-flag">{w.removal_requests}</span> : w.removal_requests}</td>
                      </tr>
                      {expandedWaiter === w.id && (
                        <tr><td colSpan={6} style={{padding:'8px 16px',fontSize:'11px',color:'var(--boom-text-muted)',background:'rgba(255,255,255,.02)'}}>
                          {ru ? 'Продажи атрибутируются по официанту заказа (Order Core), не по кассиру.' : 'Satuw sargydyň ofisiantyna görä hasaplanýar (Order Core), kassira görä däl.'}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {data.waiters.length === 0 && <tr><td colSpan={6} className="cmd-empty-row">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- CASHIER PERFORMANCE ---- */}
          {data.cashiers && (
            <div className="cmd-table-wrap">
              <div className="cmd-table-head"><UserCog /> {ru ? 'Кассиры' : 'Kassirler'}</div>
              <table className="cmd-table">
                <thead>
                  <tr>
                    <th>{ru ? 'Кассир' : 'Kassir'}</th>
                    <th>{ru ? 'Заказы' : 'Sargytlar'}</th>
                    <th>{ru ? 'Наличные' : 'Nakt'}</th>
                    <th>{ru ? 'Карта' : 'Kart'}</th>
                    <th>{ru ? 'Кредит' : 'Kredit'}</th>
                    <th>{ru ? 'Возвраты' : 'Yzyna gaýtarma'}</th>
                    {p.credit && <th>{ru ? 'Погашения' : 'Üzülmeler'}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.cashiers.map((c: any) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.orders}</td>
                      <td>{money(c.cash)}</td>
                      <td>{money(c.card)}</td>
                      <td>{money(c.credit)}</td>
                      <td style={{color:'var(--boom-danger)'}}>{money(c.refunds)}</td>
                      {p.credit && <td>{money(c.credit_repayments)}</td>}
                    </tr>
                  ))}
                  {data.cashiers.length === 0 && <tr><td colSpan={7} className="cmd-empty-row">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <div className="cmd-grid-2">
            {/* ---- CREDIT / RECEIVABLES ---- */}
            {data.credit && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title">{ru ? 'Кредит и задолженность' : 'Kredit we bergiler'}</div>
                  <button onClick={() => onNavigate('creditReports')} className="cmd-panel-link boom-focusable">{ru ? 'Отчёты' : 'Hasabatlar'} <ChevronRight /></button>
                </div>
                <div className="cmd-grid-3" style={{marginBottom:'12px'}}>
                  <div className="cmd-mini-stat"><span className="label">{ru ? 'Выдано сегодня' : 'Şu gün berildi'}</span><span className="value">{money(data.credit.issued_today.total)}</span></div>
                  <div className="cmd-mini-stat"><span className="label">{ru ? 'Погашено сегодня' : 'Şu gün üzüldi'}</span><span className="value positive">{money(data.credit.repayments_today.total)}</span></div>
                </div>
                {data.credit.top_debtors.length > 0 && (
                  <div>
                    <div className="cmd-status-label" style={{marginBottom:'4px'}}>{ru ? 'Крупнейшие должники' : 'Iň uly bergidarlar'}</div>
                    {data.credit.top_debtors.map((d: any) => (
                      <button key={d.account_id} onClick={() => onNavigate('creditReports')} className="cmd-debtor-row boom-focusable">
                        <span>{d.name} <span className="type">({d.type === 'CUSTOMER' ? (ru ? 'клиент' : 'müşderi') : (ru ? 'сотрудник' : 'işgär')})</span></span>
                        <span className="amount">{money(d.current_balance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- STAFF ---- */}
            {data.staff && (
              <div className="cmd-panel">
                <div className="cmd-panel-head">
                  <div className="cmd-panel-title">{ru ? 'Персонал' : 'Işgärler'}</div>
                  <button onClick={() => onNavigate('employees')} className="cmd-panel-link boom-focusable">{ru ? 'Сотрудники' : 'Işgärler'} <ChevronRight /></button>
                </div>
                <div className="cmd-grid-3">
                  <div className="cmd-mini-stat"><span className="label">{ru ? 'Активны' : 'Aktiw'}</span><span className="value" style={{fontSize:'16px'}}>{data.staff.by_employment_status.ACTIVE}</span></div>
                  <div className="cmd-mini-stat"><span className="label">{ru ? 'Испытат.' : 'Synag'}</span><span className="value" style={{fontSize:'16px'}}>{data.staff.by_employment_status.PROBATION}</span></div>
                  <div className="cmd-mini-stat"><span className="label">{ru ? 'Архив' : 'Arhiw'}</span><span className="value" style={{fontSize:'16px'}}>{data.staff.by_employment_status.TERMINATED}</span></div>
                </div>
                <div className="cmd-cash-diff">
                  <span>{ru ? 'Активные POS-сессии' : 'Aktiw POS sessiýalary'}</span>
                  <span style={{color:'var(--boom-text-secondary)',fontWeight:600,fontSize:'11px'}}>{ru ? 'официанты' : 'ofisiant'} {data.staff.active_pos_sessions.waiters} · {ru ? 'кассиры' : 'kassir'} {data.staff.active_pos_sessions.cashiers}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
