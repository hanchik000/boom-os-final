import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, TrendingUp, Wallet, CreditCard, Banknote, Receipt, ShoppingBag, ChefHat,
  Users, UserCog, Boxes, AlertTriangle, ChevronRight, Loader2
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
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

const REFRESH_MS = 45000;

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

  useEffect(() => { api.getBranches().then(r => { setBranches(r.branches || []); if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id); }).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd]);

  const load = useCallback(async () => {
    if (!branchId) return;
    setError('');
    try {
      const r = await api.getManagerDashboard({ branch_id: branchId, start: range.start, end: range.end });
      setData(r);
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось загрузить панель.' : 'Panel ýüklenip bilmedi.')); }
    finally { setLoading(false); }
  }, [branchId, range.start, range.end, ru]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

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
  const ALERT_SEVERITY_COLOR: Record<string, string> = { critical: 'border-red-500/40 bg-red-500/10 text-red-300', warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300', info: 'border-slate-600 bg-slate-800/60 text-slate-300' };

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
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* ---- Header: title / branch / date / refresh ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight">{ru ? 'ЦЕНТР УПРАВЛЕНИЯ' : 'DOLANDYRYŞ MERKEZI'}</h1>
          <p className="text-xs text-slate-500">{data?.branch?.name || ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <select className="field text-xs !w-auto" value={branchId} onChange={e => setBranchId(e.target.value)}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {presets.map(pr => (
              <button key={pr.id} onClick={() => setPreset(pr.id)} className={`px-2.5 py-1 rounded text-xs font-semibold ${preset === pr.id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>{pr.label}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" className="field text-xs !w-auto" value={customStart} onChange={e => setCustomStart(e.target.value)} />
              <span className="text-slate-500 text-xs">–</span>
              <input type="date" className="field text-xs !w-auto" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
            </div>
          )}
          <button className="btn text-xs flex items-center gap-1.5" disabled={loading} onClick={() => { setLoading(true); void load(); }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {ru ? 'Обновить' : 'Täzele'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm p-3">{error}</div>}
      {loading && !data && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> {ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>}

      {data && (
        <>
          {/* ---- ALERT CENTER ---- */}
          {data.alerts?.length > 0 && (
            <div className="space-y-1.5">
              {data.alerts.map((a: any, idx: number) => (
                <button key={idx} onClick={() => onNavigate(a.link)} className={`w-full text-left flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${ALERT_SEVERITY_COLOR[a.severity]}`}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1">{alertText(a)}</span>
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* ---- KPI HEADER ---- */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {kpiCards.map((c, idx) => {
              const Icon = c.icon;
              const Wrapper: any = c.tab ? 'button' : 'div';
              return (
                <Wrapper key={idx} onClick={c.tab ? () => onNavigate(c.tab!) : undefined} className={`text-left rounded-xl bg-slate-900 border border-slate-800 p-4 ${c.tab ? 'hover:border-amber-500/40 cursor-pointer' : ''}`}>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1"><Icon className="w-3 h-3" /> {c.label}</div>
                  <div className="text-lg font-black text-white">{c.isCount ? c.value : `${money(c.value)}`} {!c.isCount && <span className="text-[10px] text-slate-500 font-normal">{currency}</span>}</div>
                </Wrapper>
              );
            })}
          </div>

          {/* ---- FINANCIAL RECONCILIATION ---- */}
          {data.financial && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ru ? 'Продажи' : 'Satuw'}</div>
                <div className="space-y-1 text-xs text-slate-300">
                  <div className="flex justify-between"><span>{ru ? 'Наличные' : 'Nakt'}</span><span>{money(data.financial.sales.cash)}</span></div>
                  <div className="flex justify-between"><span>{ru ? 'Карта' : 'Kart'}</span><span>{money(data.financial.sales.card)}</span></div>
                  <div className="flex justify-between"><span>{ru ? 'Кредит' : 'Kredit'}</span><span>{money(data.financial.sales.credit)}</span></div>
                  {Number(data.financial.sales.other) > 0 && <div className="flex justify-between"><span>{ru ? 'Другое' : 'Başga'}</span><span>{money(data.financial.sales.other)}</span></div>}
                  <div className="flex justify-between font-bold text-white pt-1 border-t border-slate-800"><span>{ru ? 'ИТОГО ПРОДАЖИ' : 'JEMI SATUW'}</span><span>{money(data.financial.sales.total)}</span></div>
                </div>
              </div>
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ru ? 'Получено денег' : 'Alnan pul'}</div>
                <div className="space-y-1 text-xs text-slate-300">
                  <div className="flex justify-between"><span>{ru ? 'Наличные' : 'Nakt'}</span><span>{money(data.financial.received.cash)}</span></div>
                  <div className="flex justify-between"><span>{ru ? 'Карта' : 'Kart'}</span><span>{money(data.financial.received.card)}</span></div>
                  <div className="flex justify-between"><span>{ru ? 'Погашение кредита' : 'Kredit üzülmesi'}</span><span>{money(data.financial.received.credit_repayments)}</span></div>
                  <div className="flex justify-between font-bold text-emerald-400 pt-1 border-t border-slate-800"><span>{ru ? 'ИТОГО ПОЛУЧЕНО' : 'JEMI ALYNDY'}</span><span>{money(data.financial.received.total)}</span></div>
                </div>
              </div>
              {data.financial.receivables && (
                <button onClick={() => p.credit && onNavigate('creditReports')} className="text-left rounded-xl bg-slate-900 border border-slate-800 p-4 hover:border-amber-500/40">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ru ? 'Задолженность' : 'Bergiler'}</div>
                  <div className="space-y-1 text-xs text-slate-300">
                    <div className="flex justify-between"><span>{ru ? 'Клиенты' : 'Müşderiler'}</span><span>{money(data.financial.receivables.customer)}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Сотрудники' : 'Işgärler'}</span><span>{money(data.financial.receivables.staff)}</span></div>
                    <div className="flex justify-between font-bold text-amber-400 pt-1 border-t border-slate-800"><span>{ru ? 'ИТОГО' : 'JEMI'}</span><span>{money(data.financial.receivables.total)}</span></div>
                  </div>
                </button>
              )}
              {data.financial.refunds && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 md:col-span-3">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Возвраты за период' : 'Döwür üçin yzyna gaýtarmalar'}</div>
                  <div className="text-sm text-white mt-1">{money(data.financial.refunds.total)} {currency} <span className="text-slate-500 text-xs">({data.financial.refunds.count})</span></div>
                </div>
              )}
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---- CASH POSITION ---- */}
            {data.cash_position && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Кассовая смена' : 'Kassa çalyşygy'}</div>
                  <button onClick={() => onNavigate('cashierPos')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Открыть' : 'Aç'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                {data.cash_position.open_shift ? (
                  <div className="space-y-1 text-xs text-slate-300">
                    <div className="flex justify-between"><span>{ru ? 'Кассир' : 'Kassir'}</span><span className="text-white">{data.cash_position.open_shift.cashier_name}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Открытие' : 'Açylyş'}</span><span>{money(data.cash_position.open_shift.opening_cash)}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Продажи (нал.)' : 'Satuw (nakt)'}</span><span>{money(data.cash_position.open_shift.cash_sales)}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Погашения (нал.)' : 'Üzülme (nakt)'}</span><span>{money(data.cash_position.open_shift.credit_repayments)}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Возвраты' : 'Yzyna gaýtarma'}</span><span>{money(data.cash_position.open_shift.refunds)}</span></div>
                    <div className="flex justify-between font-bold text-white pt-1 border-t border-slate-800"><span>{ru ? 'Ожидаемая касса' : 'Garaşylýan kassa'}</span><span>{money(data.cash_position.expected_cash)}</span></div>
                  </div>
                ) : <div className="text-xs text-slate-500">{ru ? 'Смена не открыта' : 'Çalyşyk açyk däl'}</div>}
                {data.cash_position.last_closed_shift && (
                  <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-slate-500">
                    {ru ? 'Последнее закрытие' : 'Soňky ýapylyş'}: {data.cash_position.last_closed_shift.cashier_name}, {ru ? 'разница' : 'tapawut'} <span className={Number(data.cash_position.last_closed_shift.difference) !== 0 ? 'text-amber-400' : 'text-emerald-400'}>{money(data.cash_position.last_closed_shift.difference)}</span>
                  </div>
                )}
              </div>
            )}

            {/* ---- ORDERS LIVE STATUS ---- */}
            {data.orders && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Заказы' : 'Sargytlar'}</div>
                  <button onClick={() => onNavigate('operations')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Все заказы' : 'Ähli sargytlar'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(data.orders.by_status).map(([status, count]) => (
                    <button key={status} onClick={() => onNavigate('operations')} className="rounded-lg bg-slate-800/60 hover:bg-slate-800 p-2 text-left">
                      <div className="text-lg font-black text-white">{String(count)}</div>
                      <div className="text-[9px] text-slate-500 uppercase">{ORDER_STATUS_LABELS[status] || status}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---- KITCHEN / KDS ---- */}
            {data.kds && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><ChefHat className="w-3.5 h-3.5" /> {ru ? 'Кухня' : 'Aşhana'}</div>
                  <button onClick={() => onNavigate('operations')} className="text-[10px] text-amber-400 flex items-center gap-0.5">KDS <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-5 gap-2 mb-2">
                  {Object.entries(data.kds.by_status).map(([status, count]) => (
                    <div key={status} className="rounded-lg bg-slate-800/60 p-2 text-center">
                      <div className="text-lg font-black text-white">{String(count)}</div>
                      <div className="text-[9px] text-slate-500 uppercase">{KDS_STATUS_LABELS[status] || status}</div>
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
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> {ru ? 'Склад' : 'Ammar'}</div>
                  <button onClick={() => onNavigate('inventory')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Склад' : 'Ammar'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="space-y-1 text-xs">
                  <button onClick={() => onNavigate('inventory')} className="w-full flex justify-between text-slate-300 hover:text-white"><span>{ru ? 'Заканчивается' : 'Azalýar'}</span><span className={data.inventory.low_stock.length ? 'text-amber-400 font-semibold' : ''}>{data.inventory.low_stock.length}</span></button>
                  <button onClick={() => onNavigate('inventory')} className="w-full flex justify-between text-slate-300 hover:text-white"><span>{ru ? 'Нет в наличии' : 'Ýok'}</span><span className={data.inventory.out_of_stock.length ? 'text-red-400 font-semibold' : ''}>{data.inventory.out_of_stock.length}</span></button>
                  <div className="flex justify-between text-slate-500"><span>{ru ? 'Списания' : 'Ýazyp aýyrmalar'}</span><span>{data.inventory.recent_write_offs.length}</span></div>
                  <div className="flex justify-between text-slate-500"><span>{ru ? 'Поступления' : 'Gelenler'}</span><span>{data.inventory.recent_receipts.length}</span></div>
                  <div className="flex justify-between text-slate-500"><span>{ru ? 'Перемещения' : 'Geçirmeler'}</span><span>{data.inventory.recent_transfers.length}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* ---- WAITER PERFORMANCE ---- */}
          {data.waiters && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800"><Users className="w-3.5 h-3.5" /> {ru ? 'Официанты' : 'Ofisiantlar'}</div>
              <table className="w-full text-xs">
                <thead className="bg-slate-800/40 text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2">{ru ? 'Официант' : 'Ofisiant'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Заказы' : 'Sargytlar'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Продажи' : 'Satuw'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Ср. чек' : 'Orta çek'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Статус' : 'Status'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Запросы на удаление' : 'Aýyrmak haýyşlary'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.waiters.map((w: any) => (
                    <React.Fragment key={w.id}>
                      <tr className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30 cursor-pointer" onClick={() => setExpandedWaiter(expandedWaiter === w.id ? null : w.id)}>
                        <td className="px-4 py-2 font-medium">{w.name}</td>
                        <td className="px-3 py-2 text-right">{w.orders}</td>
                        <td className="px-3 py-2 text-right">{money(w.sales)}</td>
                        <td className="px-3 py-2 text-right">{money(w.average_check)}</td>
                        <td className="px-3 py-2 text-right"><span className={`px-1.5 py-0.5 rounded text-[10px] ${w.status === 'PROFESSIONAL' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-300'}`}>{w.status}</span></td>
                        <td className="px-3 py-2 text-right">{w.removal_requests > 0 ? <span className="text-amber-400 font-semibold">{w.removal_requests}</span> : w.removal_requests}</td>
                      </tr>
                      {expandedWaiter === w.id && (
                        <tr className="bg-slate-800/20"><td colSpan={6} className="px-4 py-2 text-[11px] text-slate-400">
                          {ru ? 'Продажи атрибутируются по официанту заказа (Order Core), не по кассиру.' : 'Satuw sargydyň ofisiantyna görä hasaplanýar (Order Core), kassira görä däl.'}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {data.waiters.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- CASHIER PERFORMANCE ---- */}
          {data.cashiers && (
            <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800"><UserCog className="w-3.5 h-3.5" /> {ru ? 'Кассиры' : 'Kassirler'}</div>
              <table className="w-full text-xs">
                <thead className="bg-slate-800/40 text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2">{ru ? 'Кассир' : 'Kassir'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Заказы' : 'Sargytlar'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Наличные' : 'Nakt'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Карта' : 'Kart'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Кредит' : 'Kredit'}</th>
                    <th className="text-right px-3 py-2">{ru ? 'Возвраты' : 'Yzyna gaýtarma'}</th>
                    {p.credit && <th className="text-right px-3 py-2">{ru ? 'Погашения' : 'Üzülmeler'}</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.cashiers.map((c: any) => (
                    <tr key={c.id} className="border-t border-slate-800 text-slate-200">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-right">{c.orders}</td>
                      <td className="px-3 py-2 text-right">{money(c.cash)}</td>
                      <td className="px-3 py-2 text-right">{money(c.card)}</td>
                      <td className="px-3 py-2 text-right">{money(c.credit)}</td>
                      <td className="px-3 py-2 text-right text-red-400">{money(c.refunds)}</td>
                      {p.credit && <td className="px-3 py-2 text-right">{money(c.credit_repayments)}</td>}
                    </tr>
                  ))}
                  {data.cashiers.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {/* ---- CREDIT / RECEIVABLES ---- */}
            {data.credit && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Кредит и задолженность' : 'Kredit we bergiler'}</div>
                  <button onClick={() => onNavigate('creditReports')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Отчёты' : 'Hasabatlar'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div><div className="text-slate-500">{ru ? 'Выдано сегодня' : 'Şu gün berildi'}</div><div className="text-white font-semibold">{money(data.credit.issued_today.total)}</div></div>
                  <div><div className="text-slate-500">{ru ? 'Погашено сегодня' : 'Şu gün üzüldi'}</div><div className="text-emerald-400 font-semibold">{money(data.credit.repayments_today.total)}</div></div>
                </div>
                {data.credit.top_debtors.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase">{ru ? 'Крупнейшие должники' : 'Iň uly bergidarlar'}</div>
                    {data.credit.top_debtors.map((d: any) => (
                      <button key={d.account_id} onClick={() => onNavigate('creditReports')} className="w-full flex justify-between text-xs text-slate-300 hover:text-white">
                        <span>{d.name} <span className="text-slate-600">({d.type === 'CUSTOMER' ? (ru ? 'клиент' : 'müşderi') : (ru ? 'сотрудник' : 'işgär')})</span></span>
                        <span className="text-amber-400 font-semibold">{money(d.current_balance)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- STAFF ---- */}
            {data.staff && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Персонал' : 'Işgärler'}</div>
                  <button onClick={() => onNavigate('employees')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Сотрудники' : 'Işgärler'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-slate-500">{ru ? 'Активны' : 'Aktiw'}</div><div className="text-white font-semibold text-base">{data.staff.by_employment_status.ACTIVE}</div></div>
                  <div><div className="text-slate-500">{ru ? 'Испытат.' : 'Synag'}</div><div className="text-white font-semibold text-base">{data.staff.by_employment_status.PROBATION}</div></div>
                  <div><div className="text-slate-500">{ru ? 'Архив' : 'Arhiw'}</div><div className="text-white font-semibold text-base">{data.staff.by_employment_status.TERMINATED}</div></div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-500">
                  <span>{ru ? 'Активные POS-сессии' : 'Aktiw POS sessiýalary'}</span>
                  <span className="text-slate-300">{ru ? 'официанты' : 'ofisiant'} {data.staff.active_pos_sessions.waiters} · {ru ? 'кассиры' : 'kassir'} {data.staff.active_pos_sessions.cashiers}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
