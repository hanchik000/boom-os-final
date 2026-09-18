import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, AlertTriangle, ChevronRight, Loader2, ChefHat, Users, UserCog,
  Radio, Table2, CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { NavTab } from './Sidebar';

// ---------------------------------------------------------------------------------------------
// Live Operations -- "what is happening right now, what needs attention, what can I do about it."
// Reads /api/operations/live, a single server-side aggregation over the existing Order Core, KDS,
// CashShift, waiter/operator sessions, credit and inventory tables. No client-side totals; the one
// mutation this screen performs (approve/reject a removal request) calls the existing, already
// audited orders.ts endpoints -- no new business logic.
// ---------------------------------------------------------------------------------------------

interface Props { onNavigate: (tab: NavTab) => void; }

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '0.00'); }
function fmtTime(v?: string | null) { if (!v) return '—'; try { return new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return v; } }

const REFRESH_MS = 20000;

const DELAY_COLOR: Record<string, string> = { NORMAL: 'text-slate-400', WARNING: 'text-amber-400', DELAYED: 'text-red-400' };
const DELAY_BADGE: Record<string, string> = { NORMAL: 'bg-slate-800 text-slate-400', WARNING: 'bg-amber-500/15 text-amber-400', DELAYED: 'bg-red-500/15 text-red-400' };
const ALERT_SEVERITY_COLOR: Record<string, string> = { critical: 'border-red-500/40 bg-red-500/10 text-red-300', warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300', info: 'border-slate-600 bg-slate-800/60 text-slate-300' };

export const LiveOperationsView: React.FC<Props> = ({ onNavigate }) => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState(user?.branch_id || '');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decisionBusy, setDecisionBusy] = useState<string | null>(null);

  useEffect(() => { api.getBranches().then(r => { setBranches(r.branches || []); if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id); }).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setError('');
    try { setData(await api.getLiveOperations(branchId)); }
    catch (e: any) { setError(e?.message || (ru ? 'Не удалось загрузить операции.' : 'Amallar ýüklenip bilmedi.')); }
    finally { setLoading(false); }
  }, [branchId, ru]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (approvalId: string, approve: boolean) => {
    if (decisionBusy) return;
    setDecisionBusy(approvalId);
    try {
      if (approve) await api.approveItemRemoval(approvalId);
      else await api.rejectItemRemoval(approvalId);
      await load();
    } catch (e: any) { setError(e?.message || (ru ? 'Не удалось выполнить действие.' : 'Amal ýerine ýetirilip bilmedi.')); }
    finally { setDecisionBusy(null); }
  };

  const p = data?.permissions || {};
  const currency = data?.branch?.currency || 'TMT';

  const ORDER_STATUS_LABELS: Record<string, string> = {
    PENDING_CONFIRMATION: ru ? 'Ожидает' : 'Garaşýar',
    CONFIRMED: ru ? 'Подтверждён' : 'Tassyklandy',
    PREPARING: ru ? 'Готовится' : 'Taýýarlanýar',
    READY: ru ? 'Готово' : 'Taýýar',
  };

  function alertText(a: any): string {
    switch (a.type) {
      case 'DELAYED_ORDER': return ru ? `Заказ #${a.params.order_number} готовится ${a.params.minutes} мин` : `#${a.params.order_number} sargyt ${a.params.minutes} min taýýarlanýar`;
      case 'PENDING_REMOVAL_REQUEST': return ru ? `Запрос на удаление: ${a.params.item} (заказ #${a.params.order_number}, ${a.params.requester})` : `Aýyrmak haýyşy: ${a.params.item} (#${a.params.order_number}, ${a.params.requester})`;
      case 'OPEN_CASH_SHIFT': return ru ? `Смена ${a.params.cashier} открыта с прошлого дня` : `${a.params.cashier} çalyşygy öňki günden açyk`;
      case 'CASH_DIFFERENCE': return ru ? `Расхождение кассы у ${a.params.cashier}: ${money(a.params.difference)}` : `${a.params.cashier} kassasynda tapawut: ${money(a.params.difference)}`;
      case 'CREDIT_LIMIT_ISSUE': return ru ? `Превышен кредитный лимит: ${a.params.name}` : `Kredit çägi aşyldy: ${a.params.name}`;
      case 'LOW_STOCK': return a.message_key === 'ops.alert.outOfStock' ? (ru ? `Нет на складе: ${a.params.name}` : `Ammarda ýok: ${a.params.name}`) : (ru ? `Заканчивается: ${a.params.name} (${a.params.stock} ${a.params.unit})` : `Azalýar: ${a.params.name} (${a.params.stock} ${a.params.unit})`);
      default: return a.type;
    }
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2"><Radio className="w-5 h-5 text-amber-400" /> {ru ? 'ЖИВЫЕ ОПЕРАЦИИ' : 'JANLY AMALLAR'}</h1>
          <p className="text-xs text-slate-500">{data?.branch?.name || ''} {data && <span className="text-slate-600">· {ru ? 'обновлено' : 'täzelendi'} {fmtTime(data.generated_at)}</span>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 1 && (
            <select className="field text-xs !w-auto" value={branchId} onChange={e => setBranchId(e.target.value)}>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
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
          {/* ---- ALERT / ACTION CENTER ---- */}
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

          {/* ---- PENDING REMOVAL REQUESTS (inline action) ---- */}
          {p.removals && data.removal_requests?.length > 0 && (
            <div className="rounded-xl bg-slate-900 border border-amber-500/30 overflow-hidden">
              <div className="px-4 py-2.5 text-[11px] font-semibold text-amber-400 uppercase tracking-wider border-b border-slate-800">{ru ? 'Запросы на удаление позиций' : 'Pozisiýa aýyrmak haýyşlary'} ({data.removal_requests.length})</div>
              <div className="divide-y divide-slate-800">
                {data.removal_requests.map((r: any) => (
                  <div key={r.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                    <div className="text-slate-300"><span className="text-white font-medium">#{r.order_number}</span> · {r.title_snapshot} × {r.requested_quantity} — <span className="text-slate-500">{r.reason}</span></div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button disabled={decisionBusy === r.id} onClick={() => void decide(r.id, true)} className="btn text-[10px] py-1 px-2 bg-emerald-500 text-slate-950 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {ru ? 'Одобрить' : 'Tassykla'}</button>
                      <button disabled={decisionBusy === r.id} onClick={() => void decide(r.id, false)} className="btn text-[10px] py-1 px-2 bg-slate-800 text-slate-300 flex items-center gap-1"><XCircle className="w-3 h-3" /> {ru ? 'Отклонить' : 'Ret et'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ---- LIVE ORDER BOARD ---- */}
            {data.live_orders && (
              <div className="lg:col-span-2 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 flex items-center justify-between">
                  <span>{ru ? 'Активные заказы' : 'Işjeň sargytlar'} ({data.live_orders.length})</span>
                  <button onClick={() => onNavigate('operations')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Все' : 'Ählisi'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="max-h-[480px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-800/40 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2">#</th>
                        <th className="text-left px-2 py-2">{ru ? 'Стол' : 'Stol'}</th>
                        <th className="text-left px-2 py-2">{ru ? 'Официант' : 'Ofisiant'}</th>
                        <th className="text-left px-2 py-2">{ru ? 'Статус' : 'Status'}</th>
                        <th className="text-right px-2 py-2">{ru ? 'Мин' : 'Min'}</th>
                        <th className="text-right px-2 py-2">{ru ? 'Позиций' : 'Pozisiýa'}</th>
                        <th className="text-right px-4 py-2">{ru ? 'Сумма' : 'Jemi'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.live_orders.map((o: any) => (
                        <tr key={o.id} onClick={() => onNavigate('operations')} className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30 cursor-pointer">
                          <td className="px-4 py-2 font-medium">{o.order_number}</td>
                          <td className="px-2 py-2">{o.table_code || '—'}</td>
                          <td className="px-2 py-2">{o.waiter_name || '—'}</td>
                          <td className="px-2 py-2">{ORDER_STATUS_LABELS[o.status] || o.status}</td>
                          <td className={`px-2 py-2 text-right font-semibold ${DELAY_COLOR[o.delay_state]}`}>
                            {o.elapsed_minutes}
                            {o.delay_state !== 'NORMAL' && <span className={`ml-1 px-1 rounded text-[9px] ${DELAY_BADGE[o.delay_state]}`}>{o.delay_state === 'DELAYED' ? (ru ? 'ЗАДЕРЖКА' : 'GIJIKDI') : (ru ? 'ВНИМАНИЕ' : 'ÜNS BER')}</span>}
                          </td>
                          <td className="px-2 py-2 text-right">{o.item_count}</td>
                          <td className="px-4 py-2 text-right">{money(o.final_amount)}</td>
                        </tr>
                      ))}
                      {data.live_orders.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">{ru ? 'Нет активных заказов' : 'Işjeň sargyt ýok'}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ---- KDS MONITOR ---- */}
            {data.kds && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><ChefHat className="w-3.5 h-3.5" /> KDS</div>
                  <button onClick={() => onNavigate('operations')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Кухня' : 'Aşhana'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="rounded-lg bg-slate-800/60 p-2 text-center"><div className="text-lg font-black text-white">{data.kds.by_status.NEW}</div><div className="text-[9px] text-slate-500 uppercase">{ru ? 'Новые' : 'Täze'}</div></div>
                  <div className="rounded-lg bg-slate-800/60 p-2 text-center"><div className="text-lg font-black text-white">{data.kds.by_status.PREPARING}</div><div className="text-[9px] text-slate-500 uppercase">{ru ? 'Готовится' : 'Taýýarlanýar'}</div></div>
                  <div className="rounded-lg bg-slate-800/60 p-2 text-center"><div className="text-lg font-black text-white">{data.kds.by_status.READY}</div><div className="text-[9px] text-slate-500 uppercase">{ru ? 'Готово' : 'Taýýar'}</div></div>
                </div>
                {data.kds.delayed_count > 0 && <div className="text-xs text-red-400 font-semibold mb-1.5">{data.kds.delayed_count} {ru ? 'с задержкой' : 'gijikdirilen'}</div>}
                {data.kds.average_preparation_minutes !== null && <div className="text-xs text-slate-400">{ru ? 'Среднее время' : 'Ortaça wagt'}: <span className="text-white font-semibold">{data.kds.average_preparation_minutes} {ru ? 'мин' : 'min'}</span></div>}
                {data.kds.oldest_active && <div className="text-xs text-slate-400 flex items-center gap-1 mt-1"><Clock className="w-3 h-3" /> #{data.kds.oldest_active.order_number} — <span className={DELAY_COLOR[data.kds.oldest_active.delay_state]}>{data.kds.oldest_active.elapsed_minutes} {ru ? 'мин' : 'min'}</span></div>}
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            {/* ---- WAITER WORKLOAD ---- */}
            {data.waiters && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <div className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800 flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {ru ? 'Нагрузка официантов' : 'Ofisiantlaryň ýüki'}</div>
                <div className="divide-y divide-slate-800 max-h-72 overflow-y-auto">
                  {data.waiters.map((w: any) => (
                    <div key={w.id} className="px-4 py-2 text-xs flex items-center justify-between">
                      <div>
                        <div className="text-slate-200 font-medium flex items-center gap-1.5">{w.name} {w.session.active ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={ru ? 'В сети' : 'Onlaýn'} /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />}</div>
                        <div className="text-slate-500">{ru ? 'заказов' : 'sargyt'}: {w.active_orders} · {ru ? 'столов' : 'stol'}: {w.open_tables} · {money(w.sales_today)} {currency}</div>
                      </div>
                      {w.pending_removal_requests > 0 && <span className="text-amber-400 font-semibold">{w.pending_removal_requests}</span>}
                    </div>
                  ))}
                  {data.waiters.length === 0 && <div className="px-4 py-6 text-center text-slate-500 text-xs">{ru ? 'Нет данных' : 'Maglumat ýok'}</div>}
                </div>
              </div>
            )}

            {/* ---- CASHIER OPERATIONS ---- */}
            {p.cash_shifts && (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5" /> {ru ? 'Касса' : 'Kassa'}</div>
                  <button onClick={() => onNavigate('cashierPos')} className="text-[10px] text-amber-400 flex items-center gap-0.5">{ru ? 'Касса' : 'Kassa'} <ChevronRight className="w-3 h-3" /></button>
                </div>
                {data.cashier_operations ? (
                  <div className="space-y-1 text-xs text-slate-300">
                    <div className="flex justify-between"><span>{ru ? 'Кассир' : 'Kassir'}</span><span className="text-white flex items-center gap-1">{data.cashier_operations.cashier_name} {data.cashier_operations.pos_session.active ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Открыта' : 'Açyldy'}</span><span>{fmtTime(data.cashier_operations.opened_at)}</span></div>
                    <div className="flex justify-between"><span>{ru ? 'Транзакций' : 'Amallar'}</span><span>{data.cashier_operations.transactions_this_shift}</span></div>
                    <div className="flex justify-between font-bold text-white pt-1 border-t border-slate-800"><span>{ru ? 'Ожидаемая касса' : 'Garaşylýan kassa'}</span><span>{money(data.cashier_operations.expected_cash)}</span></div>
                  </div>
                ) : <div className="text-xs text-slate-500">{ru ? 'Смена не открыта' : 'Çalyşyk açyk däl'}</div>}
              </div>
            )}

            {/* ---- ACTIVE POS SESSIONS + TABLES ---- */}
            <div className="space-y-4">
              {p.pos_sessions && data.pos_sessions && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{ru ? 'Активные сессии POS' : 'Aktiw POS sessiýalar'} ({data.pos_sessions.length})</div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {data.pos_sessions.map((s: any) => (
                      <div key={s.id} className="flex justify-between text-xs text-slate-300">
                        <span>{s.employee_name} <span className="text-slate-600">({s.role === 'CASHIER' ? (ru ? 'кассир' : 'kassir') : (ru ? 'официант' : 'ofisiant')})</span></span>
                        <span className="text-slate-500">{fmtTime(s.last_activity)}</span>
                      </div>
                    ))}
                    {data.pos_sessions.length === 0 && <div className="text-xs text-slate-500">{ru ? 'Нет активных сессий' : 'Aktiw sessiýa ýok'}</div>}
                  </div>
                </div>
              )}
              {p.tables && data.tables && (
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Table2 className="w-3.5 h-3.5" /> {ru ? 'Столы' : 'Stollar'}</div>
                  <div className="flex gap-4 text-xs">
                    <div><span className="text-white font-bold text-base">{data.tables.by_status.OCCUPIED || 0}</span> <span className="text-slate-500">{ru ? 'занято' : 'eýelenen'}</span></div>
                    <div><span className="text-white font-bold text-base">{data.tables.by_status.AVAILABLE || 0}</span> <span className="text-slate-500">{ru ? 'свободно' : 'boş'}</span></div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
