import React, { useCallback, useEffect, useState } from 'react';
import { Users, RefreshCw, Plus, Search, CreditCard, Coins, Wallet, Receipt } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// Stage 34.9 -- CRM. One customer record backs every surface: waiter POS, cashier POS, the BOOMCARD
// cabinet, credit and this screen. A profile deliberately has no discount field: identifying a
// guest never changes a price.
export const CustomersView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const canManage = hasPermission('customers.manage');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError('');
    try { setCustomers((await api.getCustomers({ branch_id: branchId, search: search.trim() || undefined })).customers || []); }
    catch (e: any) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [branchId, search]);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: string) => {
    setError('');
    try { const d = await api.getCrmCustomer(id); setSelected(d); setBirthDate(d.customer.birth_date || ''); }
    catch (e: any) { setError(e?.message || 'Failed to load'); }
  };
  const create = async () => {
    if (busy || !newName.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await api.createCustomer({ branch_id: branchId, name: newName.trim(), phone: newPhone.trim() || undefined });
      setNewName(''); setNewPhone(''); await load(); await open(r.customer.id);
    } catch (e: any) { setError(e?.message || 'Failed to create'); }
    finally { setBusy(false); }
  };
  const saveBirthDate = async () => {
    if (busy || !selected) return;
    setBusy(true); setError('');
    try { await api.updateCustomer(selected.customer.id, { birth_date: birthDate.trim() || null }); await open(selected.customer.id); }
    catch (e: any) { setError(e?.message || 'Failed to save'); }
    finally { setBusy(false); }
  };

  if (!hasPermission('customers.view')) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><Users className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">{ru ? 'Клиенты' : 'Müşderiler'}</h2></div>
          <p className="text-sm text-slate-400 mt-1">{ru ? 'Одна карточка гостя для всех экранов: POS официанта, касса, BOOMCARD, кредит и CRM. Привязка клиента не даёт скидку.' : 'Ähli ekranlar üçin bir myhman kartoçkasy: ofisiant POS, kassa, BOOMCARD, kredit we CRM. Müşderini baglamak arzanladyş bermeýär.'}</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm p-3">{error}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9 w-full" value={search} onChange={e => setSearch(e.target.value)} placeholder={ru ? 'Имя или телефон' : 'At ýa-da telefon'} />
          </div>

          {canManage && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2">
              <div className="text-sm font-semibold text-white">{ru ? 'Новый клиент' : 'Täze müşderi'}</div>
              <input className="field w-full" value={newName} onChange={e => setNewName(e.target.value)} placeholder={ru ? 'Имя (обязательно)' : 'At (hökmany)'} />
              <input className="field w-full" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder={ru ? 'Телефон (необязательно)' : 'Telefon (hökman däl)'} />
              <button className="btn bg-amber-500 text-slate-950 font-semibold inline-flex items-center gap-1.5" disabled={busy || !newName.trim()} onClick={() => void create()}><Plus className="w-4 h-4" />{ru ? 'Создать' : 'Döretmek'}</button>
              <p className="text-[11px] text-slate-500">{ru ? 'Телефон необязателен, но именно он позволяет узнать гостя при следующем визите.' : 'Telefon hökman däl, ýöne dine ol myhmany indiki gezek tanamaga mümkinçilik berýär.'}</p>
            </div>
          )}

          {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : (
            <div className="space-y-2">
              {customers.map(c => (
                <button key={c.id} onClick={() => void open(c.id)} className={`w-full text-left rounded-xl border p-3 ${selected?.customer?.id === c.id ? 'border-amber-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900/50'}`}>
                  <div className="text-white font-semibold">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.phone || (ru ? 'телефон не указан' : 'telefon görkezilmedik')}</div>
                </button>
              ))}
              {!customers.length && <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-500 text-sm">{ru ? 'Клиентов нет.' : 'Müşderi ýok.'}</div>}
            </div>
          )}
        </div>

        {selected && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
            <div>
              <div className="text-white font-bold text-lg">{selected.customer.name}</div>
              <div className="text-xs text-slate-400">{selected.customer.phone || (ru ? 'телефон не указан' : 'telefon görkezilmedik')}</div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-500 inline-flex items-center gap-1"><Coins className="w-3 h-3" />BOOMCOIN</div><div className="text-white font-bold text-base">{selected.boomcoin.balance}</div><div className="text-slate-500">{ru ? 'зачётные траты' : 'hasap çykdajylary'}: {selected.boomcoin.qualifying_spend}</div></div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-500 inline-flex items-center gap-1"><Wallet className="w-3 h-3" />BOOMBACK</div><div className="text-white font-bold text-base">{selected.boomback.balance}</div></div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-500 inline-flex items-center gap-1"><CreditCard className="w-3 h-3" />BOOMCARD</div><div className="text-white font-bold text-base">{selected.boomcard?.status || '—'}</div>{selected.boomcard && <div className="text-slate-500">{ru ? 'завтраки' : 'ertirlikler'}: {selected.boomcard.breakfast_used}/{selected.boomcard.breakfast_granted}</div>}</div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5"><div className="text-slate-500 inline-flex items-center gap-1"><Receipt className="w-3 h-3" />{ru ? 'Кредит' : 'Kredit'}</div><div className="text-white font-bold text-base">{selected.credit?.current_balance ?? '—'}</div>{selected.credit && <div className="text-slate-500">{ru ? 'лимит' : 'çäk'}: {selected.credit.credit_limit}</div>}</div>
            </div>

            {canManage && (
              <div className="flex items-end gap-2">
                <label className="space-y-1"><span className="block text-xs text-slate-400">{ru ? 'Дата рождения' : 'Doglan senesi'}</span><input className="field" value={birthDate} onChange={e => setBirthDate(e.target.value)} placeholder="YYYY-MM-DD" /></label>
                <button className="btn bg-slate-800 text-slate-200 text-sm" disabled={busy} onClick={() => void saveBirthDate()}>{ru ? 'Сохранить' : 'Ýatda saklamak'}</button>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs text-slate-400">{ru ? 'Последние заказы' : 'Soňky sargytlar'}</div>
              {(selected.orders || []).slice(0, 10).map((o: any) => (
                <div key={o.id} className="text-xs text-slate-300 flex justify-between gap-2"><span>#{o.order_number} · {o.status}</span><span className="text-slate-500">{o.final_amount}</span></div>
              ))}
              {!(selected.orders || []).length && <div className="text-xs text-slate-600">{ru ? 'Заказов нет.' : 'Sargyt ýok.'}</div>}
            </div>

            <div className="space-y-1">
              <div className="text-xs text-slate-400">{ru ? 'Выданные скидки' : 'Berlen arzanladyşlar'}</div>
              {(selected.discounts || []).slice(0, 10).map((d: any) => (
                <div key={d.id} className="text-xs text-slate-300 flex justify-between gap-2"><span>{d.percent ? `${d.percent}%` : d.amount} · {d.status}</span><span className="text-slate-500">{String(d.created_at).slice(0, 10)}</span></div>
              ))}
              {!(selected.discounts || []).length && <div className="text-xs text-slate-600">{ru ? 'Скидок не было.' : 'Arzanladyş bolmady.'}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
