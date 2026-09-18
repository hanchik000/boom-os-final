import React, { useEffect, useState } from 'react';
import { Check, X, RefreshCw, ClipboardCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export const OrderApprovalsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const ru = language === 'ru';

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getItemRemovalRequests({ branch_id: user?.branch_id || undefined, status: 'PENDING' });
      setRequests(res.requests || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { if (hasPermission('orders.item_remove.approve')) load(); }, [user?.branch_id, hasPermission]);

  if (!hasPermission('orders.item_remove.approve')) return null;

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      if (approve) await api.approveItemRemoval(id);
      else await api.rejectItemRemoval(id);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">{ru ? 'Запросы на удаление позиций' : 'Haryt aýyrmak tassyklamalary'}</h2></div>
          <p className="text-sm text-slate-400 mt-1">{ru ? 'После отправки заказа официант не может удалить позицию без решения менеджера.' : 'Sargyt iberilenden soň ofisiant pozisiýany menejer tassyklamazdan aýryp bilmez.'}</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : requests.length === 0 ? <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">{ru ? 'Нет ожидающих запросов.' : 'Garaşylýan haýyş ýok.'}</div> : (
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
    </div>
  );
};
