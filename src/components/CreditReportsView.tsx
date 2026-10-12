import React, { useEffect, useState } from 'react';
import { Loader2, Wallet, Users, BriefcaseBusiness, Receipt, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useBranchScope } from '../useBranchScope';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState, LoadingState } from './ui';

// ---------------------------------------------------------------------------------------------
// Credit / Receivables reports -- read-only rollups over the real credit_accounts /
// credit_transactions ledger (server-computed), plus a manager repayment action that posts
// through the same /api/credit/repay endpoint the cashier uses.
//
// Stage 34.10 adds, without recomputing anything here: a debtor-status filter (with debt /
// settled / over limit) that the SERVER applies, an over-limit and an archived badge read
// straight from the server rows, a period filter, and a per-account drill-down so every
// movement is explainable line by line.
// ---------------------------------------------------------------------------------------------

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); }

type Tab = 'overview' | 'customers' | 'staff' | 'cashiers';
type DebtorStatus = '' | 'WITH_DEBT' | 'SETTLED' | 'OVER_LIMIT';

export const CreditReportsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const { branchId, setBranchId, branches } = useBranchScope();

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<any | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [cashierTx, setCashierTx] = useState<any[]>([]);
  const [status, setStatus] = useState<DebtorStatus>('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const [repayFor, setRepayFor] = useState<any | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState('CASH');
  const [repayBusy, setRepayBusy] = useState(false);
  const [repayError, setRepayError] = useState('');

  const [detail, setDetail] = useState<any | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const period = () => ({ ...(start ? { start: new Date(start).toISOString() } : {}), ...(end ? { end: new Date(end).toISOString() } : {}) });

  const load = async (t: Tab) => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      if (t === 'overview') setOverview(await api.getCreditReportOverview({ branch_id: branchId, ...period() }));
      if (t === 'customers') setCustomers((await api.getCreditReportCustomers(branchId, status || undefined)).customers);
      if (t === 'staff') setStaff((await api.getCreditReportStaff(branchId, status || undefined)).staff);
      if (t === 'cashiers') setCashierTx((await api.getCreditReportCashier({ branch_id: branchId, ...period() })).transactions);
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, branchId, status, start, end]);

  const openDetail = async (accountId: string) => {
    setDetailBusy(true); setDetail(null);
    try { setDetail(await api.getCreditAccount(accountId, period())); }
    catch (e: any) { setError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
    finally { setDetailBusy(false); }
  };

  const doRepay = async () => {
    if (!repayFor || repayBusy || !repayAmount) return;
    setRepayBusy(true); setRepayError('');
    try {
      await api.recordCreditRepayment({ account_id: repayFor.account_id, amount: repayAmount, method: repayMethod, branch_id: branchId }, `manager-repay-${repayFor.account_id}-${Date.now()}`);
      setRepayFor(null); setRepayAmount('');
      await load(tab);
    } catch (e: any) { setRepayError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
    finally { setRepayBusy(false); }
  };

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'overview', label: ru ? 'Обзор' : 'Syn', icon: Wallet },
    { id: 'customers', label: ru ? 'Клиенты' : 'Müşderiler', icon: Users },
    { id: 'staff', label: ru ? 'Сотрудники' : 'Işgärler', icon: BriefcaseBusiness },
    { id: 'cashiers', label: ru ? 'По кассирам' : 'Kassirler boýunça', icon: Receipt },
  ];

  const statuses: Array<{ id: DebtorStatus; label: string }> = [
    { id: '', label: ru ? 'Все' : 'Ählisi' },
    { id: 'WITH_DEBT', label: ru ? 'С долгом' : 'Bergili' },
    { id: 'SETTLED', label: ru ? 'Погашено' : 'Üzülen' },
    { id: 'OVER_LIMIT', label: ru ? 'Сверх лимита' : 'Çäkden aşa' },
  ];

  // Stage 44: without a branch this screen rendered an empty shell and explained nothing. The
  // shared rule chooses the branch (see useBranchScope); when there is genuinely none to show, the
  // screen says so and says where to choose one.
  if (!branchId) {
    return (
      <div className="p-6">
        <EmptyState
          title={ru ? 'Филиал не выбран.' : 'Şahamça saýlanmadyk.'}
          hint={ru
            ? 'Долги и возвраты считаются по кассам и гостям конкретного филиала. Выберите филиал в шапке страницы или попросите администратора привязать вашу учётную запись к филиалу.'
            : 'Bergiler we gaýtarmalar anyk şahamçanyň kassalary we myhmanlary boýunça hasaplanýar. Sahypanyň ýokarsynda şahamçany saýlaň ýa-da hasabyňyzy şahamça baglamagy administratordan soraň.'}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        {branches.length > 1 && (
          <select
            id="credit-branch-pick"
            className="field w-56 text-xs"
            aria-label={ru ? 'Филиал' : 'Şahamça'}
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
          >
            {branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
          </select>
        )}
        {tabs.map(tb => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)} className={`btn text-xs flex items-center gap-1.5 ${tab === tb.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {tb.label}
            </button>
          );
        })}
      </div>

      {(tab === 'customers' || tab === 'staff') && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{ru ? 'Статус' : 'Ýagdaý'}</span>
          {statuses.map(s => (
            <button key={s.id || 'ALL'} onClick={() => setStatus(s.id)} className={`px-2 py-1 rounded text-[10px] font-semibold ${status === s.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{s.label}</button>
          ))}
        </div>
      )}

      {(tab === 'overview' || tab === 'cashiers') && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{ru ? 'Период' : 'Döwür'}</span>
          <input type="date" className="field text-xs py-1" value={start} onChange={e => setStart(e.target.value)} />
          <span>—</span>
          <input type="date" className="field text-xs py-1" value={end} onChange={e => setEnd(e.target.value)} />
          {(start || end) && <button className="btn-secondary btn-sm" onClick={() => { setStart(''); setEnd(''); }}>{ru ? 'Сбросить' : 'Arassala'}</button>}
        </div>
      )}

      {loading && <LoadingState/>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && tab === 'overview' && overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4"><div className="text-xs text-slate-400">{ru ? 'Выдано в кредит' : 'Kredite berildi'}</div><div className="text-xl font-black text-white">{money(overview.amount_issued)}</div><div className="text-[10px] text-slate-500">{overview.credits_issued} {ru ? 'продаж' : 'satuw'}</div></div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4"><div className="text-xs text-slate-400">{ru ? 'Погашено' : 'Üzüldi'}</div><div className="text-xl font-black text-emerald-400">{money(overview.repaid_amount)}</div><div className="text-[10px] text-slate-500">{overview.repayments} {ru ? 'платежей' : 'töleg'}</div></div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4"><div className="text-xs text-slate-400">{ru ? 'Текущая задолженность' : 'Häzirki bergi'}</div><div className="text-xl font-black text-amber-400">{money(overview.current_outstanding)}</div><div className="text-[10px] text-slate-500">{overview.debtor_count} {ru ? 'должников' : 'bergidar'}</div></div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4"><div className="text-xs text-slate-400">{ru ? 'Частичные платежи' : 'Bölek tölegler'}</div><div className="text-xl font-black text-white">{overview.partial_payment_count}</div></div>
        </div>
      )}

      {!loading && (tab === 'customers' || tab === 'staff') && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Имя' : 'Ady'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Лимит' : 'Çäk'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Долг' : 'Bergi'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Доступно' : 'Elýeterli'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Выдано' : 'Berildi'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Погашено' : 'Üzüldi'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(tab === 'customers' ? customers : staff).map((r: any) => (
                <tr key={r.account_id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2">
                    {r.name || r.full_name}{r.phone ? <span className="text-slate-500"> · {r.phone}</span> : ''}
                    {/* An archived employee keeps their debt -- it is shown, never quietly dropped. */}
                    {r.archived && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[9px] font-semibold">{ru ? 'АРХИВ' : 'ARHIW'}</span>}
                    {r.over_limit && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-semibold">{ru ? 'СВЕРХ ЛИМИТА' : 'ÇÄKDEN AŞA'}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{money(r.credit_limit)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-400">{money(r.current_balance)}</td>
                  <td className={`px-3 py-2 text-right ${r.over_limit ? 'text-red-400' : ''}`}>{money(r.available)}</td>
                  <td className="px-3 py-2 text-right">{money(r.credit_issued)}</td>
                  <td className="px-3 py-2 text-right">{money(r.repayments)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button className="btn-secondary btn-sm" onClick={() => void openDetail(r.account_id)}>{ru ? 'История' : 'Taryh'}</button>
                    {hasPermission('credit.repay') && (
                      <button className="btn btn-sm ml-1" disabled={Number(r.current_balance) <= 0} onClick={() => { setRepayFor(r); setRepayAmount(String(r.current_balance)); setRepayMethod('CASH'); setRepayError(''); }}>{ru ? 'Погасить' : 'Üz'}</button>
                    )}
                  </td>
                </tr>
              ))}
              {(tab === 'customers' ? customers : staff).length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'cashiers' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Дата' : 'Sene'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Кассир' : 'Kassir'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Тип' : 'Görnüş'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Получатель' : 'Alyjy'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Заказ' : 'Sargyt'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Сумма' : 'Mukdar'}</th>
              </tr>
            </thead>
            <tbody>
              {cashierTx.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{r.cashier_name}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2">{r.recipient_name || '—'}</td>
                  <td className="px-3 py-2">{r.order_number || '—'}</td>
                  <td className="px-3 py-2 text-right">{money(r.amount)}</td>
                </tr>
              ))}
              {cashierTx.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {(detailBusy || detail) && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3">
            {detailBusy && <LoadingState/>}
            {detail && (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-white text-lg font-bold">{detail.owner?.name || '—'}
                      {detail.owner?.archived && <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[9px] font-semibold align-middle">{ru ? 'АРХИВ' : 'ARHIW'}</span>}
                    </h2>
                    <div className="text-xs text-slate-400">
                      {ru ? 'Лимит' : 'Çäk'}: {money(detail.account?.credit_limit)} · {ru ? 'Долг' : 'Bergi'}: {money(detail.account?.current_balance)} ·{' '}
                      <span className={detail.over_limit ? 'text-red-400 font-semibold' : ''}>{ru ? 'Доступно' : 'Elýeterli'}: {money(detail.available_credit)}</span>
                      {detail.owner?.employment_status ? ` · ${detail.owner.employment_status}` : ''}
                    </div>
                  </div>
                  <button className="text-slate-400 hover:text-white" onClick={() => setDetail(null)}><X className="w-4 h-4" /></button>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-800/60 text-slate-400">
                    <tr>
                      <th className="text-left px-2 py-1.5">{ru ? 'Дата' : 'Sene'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Тип' : 'Görnüş'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Заказ' : 'Sargyt'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Кассир' : 'Kassir'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Утвердил' : 'Tassyklan'}</th>
                      <th className="text-right px-2 py-1.5">{ru ? 'Сумма' : 'Mukdar'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.transactions || []).map((t: any) => (
                      <tr key={t.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-2 py-1.5">{new Date(t.created_at).toLocaleString()}</td>
                        <td className="px-2 py-1.5">{t.type}{t.method ? <span className="text-slate-500"> · {t.method}</span> : ''}</td>
                        <td className="px-2 py-1.5">{t.order_number || '—'}</td>
                        <td className="px-2 py-1.5">{t.cashier_name || '—'}</td>
                        <td className="px-2 py-1.5">{t.approver_name || '—'}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold ${t.type === 'CREDIT' ? 'text-amber-400' : 'text-emerald-400'}`}>{t.type === 'CREDIT' ? '+' : '−'}{money(t.amount)}</td>
                      </tr>
                    ))}
                    {(detail.transactions || []).length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-500">{ru ? 'Нет движений за период' : 'Döwürde hereket ýok'}</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {repayFor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3">
            <h2 className="text-white text-lg font-bold">{ru ? 'Погашение' : 'Üzmek'} — {repayFor.name || repayFor.full_name}</h2>
            <div className="text-xs text-slate-400">{ru ? 'Текущий долг' : 'Häzirki bergi'}: {money(repayFor.current_balance)}</div>
            <input className="field text-sm" type="number" min="0" step="0.01" value={repayAmount} onChange={e => setRepayAmount(e.target.value)} />
            <div className="grid grid-cols-3 gap-1.5">
              {['CASH', 'CARD', 'PAYROLL_DEDUCTION'].filter(m => m !== 'PAYROLL_DEDUCTION' || tab === 'staff').map(m => (
                <button key={m} onClick={() => setRepayMethod(m)} className={`py-1.5 rounded text-[10px] font-semibold ${repayMethod === m ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{m}</button>
              ))}
            </div>
            {/* Payroll deduction is refused by the server unless the signed-in user may approve it. */}
            {repayMethod === 'PAYROLL_DEDUCTION' && <div className="text-[10px] text-amber-400">{ru ? 'Удержание из зарплаты требует подтверждения менеджера.' : 'Aýlykdan tutmak dolandyryjynyň tassyklamagyny talap edýär.'}</div>}
            {repayError && <div className="text-red-400 text-xs">{repayError}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-secondary" disabled={repayBusy} onClick={() => setRepayFor(null)}>{ru ? 'Отмена' : 'Ýatyr'}</button>
              <button className="btn" disabled={repayBusy || !repayAmount} onClick={() => void doRepay()}>{repayBusy ? '…' : (ru ? 'Подтвердить' : 'Tassykla')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
