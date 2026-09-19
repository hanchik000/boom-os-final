import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, RefreshCw, Check, X, Gift, PlayCircle, Loader2, History } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export const BoomcardView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const canManage = hasPermission('boomcard.manage');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [settings, setSettings] = useState<any | null>(null);
  const [status, setStatus] = useState('');
  const [cards, setCards] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [giftItem, setGiftItem] = useState('');
  const [giftQty, setGiftQty] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [s, list, menu] = await Promise.all([
        api.getBoomcardSettings(),
        api.getBoomcards({ branch_id: branchId, status: status || undefined }),
        api.getMenu(branchId).catch(() => ({ items: [] as any[] })),
      ]);
      setSettings(s); setCards(list.cards || []); setMenuItems((menu as any).items || []);
    } catch (e: any) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [branchId, status]);
  useEffect(() => { void load(); }, [load]);

  const openCard = async (id: string) => {
    setError('');
    try { setSelected(await api.getBoomcard(id)); } catch (e: any) { setError(e?.message || 'Failed to load'); }
  };
  const act = async (fn: () => Promise<any>, message: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(message); await load(); if (selected) await openCard(selected.card.id); }
    catch (e: any) { setError(e?.message || 'Failed'); }
    finally { setBusy(false); }
  };

  if (!hasPermission('boomcard.view')) return null;

  const statusChip = (s: string) => s === 'ACTIVE' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
    : s === 'CANDIDATE' ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-400';
  const eventLabel = (t: string) => ({
    CANDIDATE_IDENTIFIED: ru ? 'Кандидат определён' : 'Dalaşgär kesgitlendi', ACTIVATED: ru ? 'Активирована' : 'Işjeňleşdirildi',
    RENEWED: ru ? 'Продлена' : 'Uzaldyldy', DEACTIVATED: ru ? 'Деактивирована' : 'Öçürildi',
    BREAKFAST_GRANTED: ru ? 'Начислены завтраки' : 'Ertirlikler berildi', BIRTHDAY_GIFT_GRANTED: ru ? 'Назначен подарок' : 'Sowgat bellendi',
  } as Record<string, string>)[t] || t;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">BOOMCARD</h2></div>
          <p className="text-sm text-slate-400 mt-1">{ru ? 'Автоматика только предлагает кандидатов — активирует, продлевает и деактивирует карту менеджер.' : 'Awtomatika diňe dalaşgärleri hödürleýär — karty menejer işjeňleşdirýär, uzaldýar we öçürýär.'}</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm p-3">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm p-3">{notice}</div>}

      {settings && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`px-2 py-1 rounded-md border ${settings.automatic_lifecycle_enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
            {ru ? 'Автоматический жизненный цикл' : 'Awtomatiki ýaşaýyş sikli'}: {settings.automatic_lifecycle_enabled ? 'ON' : 'OFF'}
          </span>
          <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">{ru ? 'Порог' : 'Bosaga'}: {settings.monthly_spend_threshold}</span>
          <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">{ru ? 'Срок' : 'Möhlet'}: {settings.validity_days} {ru ? 'дн.' : 'gün'}</span>
          <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">{ru ? 'Завтраков за период' : 'Döwürde ertirlik'}: {settings.breakfasts_per_period}</span>
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <div className="text-sm font-semibold text-white">{ru ? 'Оценка периода' : 'Döwür bahalandyrmasy'}</div>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="space-y-1"><span className="block text-xs text-slate-400">{ru ? 'С' : 'Başlangyç'}</span><input type="datetime-local" className="field" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="space-y-1"><span className="block text-xs text-slate-400">{ru ? 'По' : 'Ahyry'}</span><input type="datetime-local" className="field" value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="btn bg-amber-500 text-slate-950 font-semibold inline-flex items-center gap-1.5" disabled={busy || !from || !to}
              onClick={() => void act(async () => {
                const r = await api.evaluateBoomcardLifecycle(branchId, new Date(from).toISOString(), new Date(to).toISOString());
                setNotice(ru ? `Кандидатов: ${r.candidates.length}. Истекло карт: ${r.expired_card_ids.length}.` : `Dalaşgärler: ${r.candidates.length}. Möhleti geçen: ${r.expired_card_ids.length}.`);
              }, '')}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}{ru ? 'Рассчитать' : 'Hasaplamak'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{ru ? 'Расчёт никого не активирует. При выключенной автоматике он только показывает, кто прошёл порог.' : 'Hasaplama hiç kimi işjeňleşdirmeýär. Awtomatika öçürilen bolsa, ol diňe bosagany geçenleri görkezýär.'}</p>
        </div>
      )}

      <div className="flex gap-2">
        {([['', ru ? 'Все' : 'Ählisi'], ['CANDIDATE', ru ? 'Кандидаты' : 'Dalaşgärler'], ['ACTIVE', ru ? 'Активные' : 'Işjeň'], ['INACTIVE', ru ? 'Неактивные' : 'Işjeň däl']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${status === k ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {loading ? <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            {cards.map(c => (
              <button key={c.id} onClick={() => void openCard(c.id)} className={`w-full text-left rounded-xl border p-3 ${selected?.card?.id === c.id ? 'border-amber-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900/50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white font-semibold">{c.customer_name}</span>
                  <span className={`px-2 py-0.5 rounded-md text-xs border ${statusChip(c.status)}`}>{c.status}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">{c.card_number} · {c.customer_phone}</div>
                <div className="text-xs text-slate-500 mt-0.5">{ru ? 'Завтраки' : 'Ertirlikler'}: {c.breakfast_used}/{c.breakfast_granted}{c.valid_until ? ` · ${ru ? 'до' : 'çenli'} ${String(c.valid_until).slice(0, 10)}` : ''}</div>
              </button>
            ))}
            {!cards.length && <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-500 text-sm">{ru ? 'Карт нет.' : 'Kart ýok.'}</div>}
          </div>

          {selected && (
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-bold">{selected.card.customer_name}</div>
                  <div className="text-xs text-slate-400">{selected.card.card_number} · {selected.card.status}</div>
                </div>
                <button className="p-2 rounded-lg border border-slate-700 text-slate-400" onClick={() => setSelected(null)}><X className="w-4 h-4" /></button>
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {selected.card.status !== 'ACTIVE' && <button className="btn bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm" disabled={busy} onClick={() => void act(() => api.activateBoomcard(selected.card.id), ru ? 'Карта активирована.' : 'Kart işjeňleşdirildi.')}><Check className="w-4 h-4 inline mr-1" />{ru ? 'Активировать' : 'Işjeňleşdirmek'}</button>}
                  {selected.card.status === 'ACTIVE' && <button className="btn bg-slate-800 text-slate-200 text-sm" disabled={busy} onClick={() => void act(() => api.renewBoomcard(selected.card.id), ru ? 'Карта продлена.' : 'Kart uzaldyldy.')}>{ru ? 'Продлить' : 'Uzaltmak'}</button>}
                  {selected.card.status !== 'INACTIVE' && <button className="btn bg-red-600/20 border border-red-500/30 text-red-300 text-sm" disabled={busy} onClick={() => void act(() => api.deactivateBoomcard(selected.card.id), ru ? 'Карта деактивирована.' : 'Kart öçürildi.')}>{ru ? 'Деактивировать' : 'Öçürmek'}</button>}
                </div>
              )}

              {canManage && selected.card.status === 'ACTIVE' && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2">
                  <div className="text-sm font-semibold text-white inline-flex items-center gap-1.5"><Gift className="w-4 h-4 text-amber-400" />{ru ? 'Подарок на день рождения' : 'Doglan gün sowgady'}</div>
                  <div className="flex flex-wrap gap-2 items-end">
                    <select className="field flex-1" value={giftItem} onChange={e => setGiftItem(e.target.value)}>
                      <option value="">{ru ? '— блюдо —' : '— tagam —'}</option>
                      {menuItems.map(m => <option key={m.id} value={m.id}>{m.name_ru}</option>)}
                    </select>
                    <input className="field w-20" type="number" min={1} value={giftQty} onChange={e => setGiftQty(Number(e.target.value))} />
                    <button className="btn bg-amber-500 text-slate-950 font-semibold text-sm" disabled={busy || !giftItem} onClick={() => void act(() => api.grantBirthdayGift(selected.card.id, giftItem, giftQty), ru ? 'Подарок назначен.' : 'Sowgat bellendi.')}>{ru ? 'Назначить' : 'Bellemek'}</button>
                  </div>
                  <p className="text-[11px] text-slate-500">{ru ? 'Гость в личном кабинете видит только, что подарок есть — конкретное блюдо ему не показывается.' : 'Myhman şahsy kabinetde diňe sowgadyň barlygyny görýär — anyk tagam görkezilmeýär.'}</p>
                </div>
              )}

              {selected.gifts?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-slate-400">{ru ? 'Назначенные подарки (видно менеджеру)' : 'Bellenen sowgatlar (menejere görünýär)'}</div>
                  {selected.gifts.map((g: any) => <div key={g.id} className="text-xs text-slate-300">{g.quantity} × {g.menu_item_name} · {g.status} · {ru ? 'до' : 'çenli'} {String(g.valid_until).slice(0, 10)}</div>)}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-xs text-slate-400 inline-flex items-center gap-1"><History className="w-3 h-3" />{ru ? 'История' : 'Taryh'}</div>
                {selected.events.map((e: any) => (
                  <div key={e.id} className="text-xs text-slate-400 flex justify-between gap-2">
                    <span>{eventLabel(e.type)}{e.automatic ? ` · ${ru ? 'автоматически' : 'awtomatiki'}` : ''}{e.reason ? ` · ${e.reason}` : ''}</span>
                    <span className="text-slate-600 shrink-0">{String(e.created_at).slice(0, 16).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
