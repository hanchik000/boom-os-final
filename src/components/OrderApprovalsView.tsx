import React, { useEffect, useState } from 'react';
import { Check, X, RefreshCw, ClipboardCheck, Ban, PackageX, PackageCheck, Undo2, Wallet, Gift } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { complimentReasonLabel } from './CashierPOSView';

export const OrderApprovalsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const [requests, setRequests] = useState<any[]>([]);
  const [closures, setClosures] = useState<any[]>([]);
  const [compliments, setCompliments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const ru = language === 'ru';
  const canRemoval = hasPermission('orders.item_remove.approve');
  const canClosure = hasPermission('orders.closure.approve');
  const canCompliment = hasPermission('orders.compliment.approve');

  const load = async () => {
    setLoading(true);
    try {
      if (canRemoval) setRequests((await api.getItemRemovalRequests({ branch_id: user?.branch_id || undefined, status: 'PENDING' })).requests || []);
      if (canClosure) setClosures((await api.getOrderClosures({ branch_id: user?.branch_id || undefined, status: 'PENDING' })).closures || []);
      if (canCompliment) setCompliments((await api.getComplimentRequests({ branch_id: user?.branch_id || undefined, status: 'PENDING' })).compliments || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (canRemoval || canClosure || canCompliment) load(); }, [user?.branch_id, canRemoval, canClosure, canCompliment]);

  if (!canRemoval && !canClosure && !canCompliment) return null;

  const decideCompliment = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      if (approve) await api.approveCompliment(id);
      else await api.rejectCompliment(id);
      await load();
    } finally { setBusy(null); }
  };

  // The three product outcomes are shown verbatim -- the manager approves the decision the
  // requester actually made; nothing here re-derives or silently changes it.
  const treatmentLabel = (t: string) => t === 'WRITE_OFF' ? (ru ? 'Списать продукты' : 'Önümleri hasapdan aýyrmak')
    : t === 'RESTORE_STOCK' ? (ru ? 'Вернуть на склад' : 'Ammara gaýtarmak')
    : (ru ? 'Не списывать продукты' : 'Önümleri hasapdan aýyrmazlyk');
  const treatmentIcon = (t: string) => t === 'WRITE_OFF' ? <PackageX className="w-4 h-4" /> : t === 'RESTORE_STOCK' ? <Undo2 className="w-4 h-4" /> : <PackageCheck className="w-4 h-4" />;
  const productionLabel = (p: string) => ({ NOT_STARTED: ru ? 'Производство не начато' : 'Önümçilik başlanmady', QUEUED: ru ? 'В очереди на кухне' : 'Aşhana nobatynda', PREPARING: ru ? 'Готовится' : 'Taýýarlanýar', READY: ru ? 'Готово' : 'Taýýar', SERVED: ru ? 'Подано' : 'Berildi', CANCELLED: ru ? 'Отменено' : 'Ýatyryldy' } as Record<string, string>)[p] || p;

  const decideClosure = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      if (approve) await api.approveOrderClosure(id);
      else await api.rejectOrderClosure(id);
      await load();
    } finally { setBusy(null); }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      if (approve) await api.approveItemRemoval(id);
      else await api.rejectItemRemoval(id);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">{ru ? 'Подтверждения менеджера' : 'Menejer tassyklamalary'}</h2></div>
          <p className="text-sm text-slate-400 mt-1">{ru ? 'Официант и кассир могут только запросить: решение принимает менеджер.' : 'Ofisiant we kassir diňe haýyş edip biler: karary menejer kabul edýär.'}</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {canClosure && (
        <section className="space-y-3">
          <div className="flex items-center gap-2"><Ban className="w-4 h-4 text-red-400" /><h3 className="text-sm font-bold text-white uppercase tracking-wide">{ru ? 'Отказ / Закрыто заведением' : 'Ret ediş / Kärhana tarapyndan ýapyldy'}</h3></div>
          <p className="text-xs text-slate-500">{ru ? 'Возврат денег не равен возврату ингредиентов: если блюдо уже приготовлено, продукты на склад не возвращаются.' : 'Pul gaýtarmak önümleri gaýtarmak däldir: tagam eýýäm taýýarlanan bolsa, önümler ammara gaýdyp gelmeýär.'}</p>
          {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : closures.length === 0 ? <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-500 text-sm">{ru ? 'Нет ожидающих запросов на закрытие.' : 'Garaşylýan ýapyş haýyşy ýok.'}</div> : (
            <div className="space-y-3">
              {closures.map(c => <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="font-semibold text-white">#{c.order_number}{c.table_code ? ` · ${ru ? 'Стол' : 'Stol'} ${c.table_code}` : ''} · {c.final_amount} TMT</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`px-2 py-1 rounded-md border ${c.type === 'CLOSED_BY_ESTABLISHMENT' ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' : 'border-red-500/40 bg-red-500/10 text-red-300'}`}>{c.type === 'CLOSED_BY_ESTABLISHMENT' ? (ru ? 'ЗАКРЫТО ЗАВЕДЕНИЕМ' : 'KÄRHANA TARAPYNDAN ÝAPYLDY') : (ru ? 'ОТКАЗ' : 'RET EDIŞ')}</span>
                    <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300 inline-flex items-center gap-1">{treatmentIcon(c.inventory_treatment)}{treatmentLabel(c.inventory_treatment)}</span>
                    <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-400">{productionLabel(c.production_state)}</span>
                    {c.refund_requested && <span className="px-2 py-1 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 inline-flex items-center gap-1"><Wallet className="w-3 h-3" />{ru ? 'С возвратом денег' : 'Pul gaýtarmak bilen'}</span>}
                  </div>
                  <div className="text-sm text-slate-300">{c.reason}{c.comment ? ` — ${c.comment}` : ''}</div>
                  <div className="text-xs text-slate-500">{ru ? 'Запросил' : 'Haýyş eden'}: {c.requester_name || c.requester_user_id || '—'} ({c.requester_role})</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button disabled={busy === c.id} onClick={() => decideClosure(c.id, true)} className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold disabled:opacity-50"><Check className="w-4 h-4 inline mr-1" />{ru ? 'Одобрить' : 'Tassyklamak'}</button>
                  <button disabled={busy === c.id} onClick={() => decideClosure(c.id, false)} className="px-3 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-50"><X className="w-4 h-4 inline mr-1" />{ru ? 'Отклонить' : 'Ret etmek'}</button>
                </div>
              </div>)}
            </div>
          )}
        </section>
      )}

      {canCompliment && (
        <section className="space-y-3">
          <div className="flex items-center gap-2"><Gift className="w-4 h-4 text-sky-400" /><h3 className="text-sm font-bold text-white uppercase tracking-wide">{ru ? 'От заведения' : 'Kärhanadan'}</h3></div>
          <p className="text-xs text-slate-500">{ru ? 'Гость не платит за позицию, но её реальная себестоимость учитывается заведением. Одобрить может только один менеджер, и только один раз.' : 'Myhman pozisiýa üçin tölemeýär, ýöne onuň hakyky özüne düşýän bahasy hasaba alynýar. Diňe bir menejer we diňe bir gezek tassyklap biler.'}</p>
          {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : compliments.length === 0 ? <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-500 text-sm">{ru ? 'Нет ожидающих запросов.' : 'Garaşylýan haýyş ýok.'}</div> : (
            <div className="space-y-3">
              {compliments.map(c => <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="font-semibold text-white">#{c.order_number} · {c.quantity} × {c.menu_item_name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-1 rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-300">{complimentReasonLabel(c.reason, ru)}</span>
                    <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">{ru ? 'Обычная стоимость' : 'Adaty bahasy'}: {c.normal_value}</span>
                    {c.customer_name && <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-400">{c.customer_name}</span>}
                  </div>
                  {c.comment && <div className="text-sm text-slate-300">{c.comment}</div>}
                  <div className="text-xs text-slate-500">{ru ? 'Запросил' : 'Haýyş eden'}: {c.requester_name || '—'} ({c.requester_role})</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button disabled={busy === c.id} onClick={() => decideCompliment(c.id, true)} className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold disabled:opacity-50"><Check className="w-4 h-4 inline mr-1" />{ru ? 'Одобрить' : 'Tassyklamak'}</button>
                  <button disabled={busy === c.id} onClick={() => decideCompliment(c.id, false)} className="px-3 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-50"><X className="w-4 h-4 inline mr-1" />{ru ? 'Отклонить' : 'Ret etmek'}</button>
                </div>
              </div>)}
            </div>
          )}
        </section>
      )}

      {canRemoval && (
        <section className="space-y-3">
          <div className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-amber-400" /><h3 className="text-sm font-bold text-white uppercase tracking-wide">{ru ? 'Запросы на удаление позиций' : 'Haryt aýyrmak tassyklamalary'}</h3></div>
          {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : requests.length === 0 ? <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-500 text-sm">{ru ? 'Нет ожидающих запросов.' : 'Garaşylýan haýyş ýok.'}</div> : (
            <div className="space-y-3">
              {requests.map(r => <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-white">#{r.order_number} · {r.title_snapshot}</div>
                  <div className="text-xs text-slate-400 mt-1">{ru ? 'Количество' : 'Mukdar'}: {r.requested_quantity} · {ru ? 'Официант' : 'Ofisiant'}: {r.requester_name || r.requester_user_id}</div>
                  <div className="text-sm text-slate-300 mt-2">{r.reason}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button disabled={busy===r.id} onClick={() => decide(r.id, true)} className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-semibold disabled:opacity-50"><Check className="w-4 h-4 inline mr-1" />{ru ? 'Одобрить' : 'Tassyklamak'}</button>
                  <button disabled={busy===r.id} onClick={() => decide(r.id, false)} className="px-3 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 text-sm font-semibold disabled:opacity-50"><X className="w-4 h-4 inline mr-1" />{ru ? 'Отклонить' : 'Ret etmek'}</button>
                </div>
              </div>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
