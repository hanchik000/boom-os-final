import React, { useEffect, useState } from 'react';
import { Loader2, Wallet, Users, BriefcaseBusiness, Receipt } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Credit / Receivables reports -- read-only rollups over the real credit_accounts /
// credit_transactions ledger (server-computed), plus a manager repayment action that posts
// through the same /api/credit/repay endpoint the cashier uses.
// ---------------------------------------------------------------------------------------------

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); }

type Tab = 'overview' | 'customers' | 'staff' | 'cashiers';

export const CreditReportsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';

  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState<any | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [cashierTx, setCashierTx] = useState<any[]>([]);

  const [repayFor, setRepayFor] = useState<any | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState('CASH');
  const [repayBusy, setRepayBusy] = useState(false);
  const [repayError, setRepayError] = useState('');

  const load = async (t: Tab) => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      if (t === 'overview') setOverview(await api.getCreditReportOverview({ branch_id: branchId }));
      if (t === 'customers') setCustomers((await api.getCreditReportCustomers(branchId)).customers);
      if (t === 'staff') setStaff((await api.getCreditReportStaff(branchId)).staff);
      if (t === 'cashiers') setCashierTx((await api.getCreditReportCashier({ branch_id: branchId })).transactions);
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, branchId]);

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

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        {tabs.map(tb => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)} className={`btn text-xs flex items-center gap-1.5 ${tab === tb.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {tb.label}
            </button>
          );
        })}
      </div>

      {loading && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> {ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>}
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
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Имя' : 'Ady'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Лимит' : 'Çäk'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Долг' : 'Bergi'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Доступно' : 'Elýeterli'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Выдано' : 'Berildi'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Погашено' : 'Üzüldi'}</th>
                {hasPermission('credit.repay') && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {(tab === 'customers' ? customers : staff).map((r: any) => (
                <tr key={r.account_id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2">{r.name || r.full_name}{r.phone ? <span className="text-slate-500"> · {r.phone}</span> : ''}</td>
                  <td className="px-3 py-2 text-right">{money(r.credit_limit)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-amber-400">{money(r.current_balance)}</td>
                  <td className="px-3 py-2 text-right">{money(r.available)}</td>
                  <td className="px-3 py-2 text-right">{money(r.credit_issued)}</td>
                  <td className="px-3 py-2 text-right">{money(r.repayments)}</td>
                  {hasPermission('credit.repay') && (
                    <td className="px-3 py-2 text-right">
                      <button className="btn text-[10px] py-1 px-2" disabled={Number(r.current_balance) <= 0} onClick={() => { setRepayFor(r); setRepayAmount(String(r.current_balance)); setRepayMethod('CASH'); setRepayError(''); }}>{ru ? 'Погасить' : 'Üz'}</button>
                    </td>
                  )}
                </tr>
              ))}
              {(tab === 'customers' ? customers : staff).length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'cashiers' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
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
            {repayError && <div className="text-red-400 text-xs">{repayError}</div>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn bg-slate-800 text-slate-200" disabled={repayBusy} onClick={() => setRepayFor(null)}>{ru ? 'Отмена' : 'Ýatyr'}</button>
              <button className="btn bg-emerald-500 text-slate-950" disabled={repayBusy || !repayAmount} onClick={() => void doRepay()}>{repayBusy ? '…' : (ru ? 'Подтвердить' : 'Tassykla')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
