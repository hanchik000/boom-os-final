import React, { useEffect, useState } from 'react';
import { Tag, Plus, Power, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Stage 35.6 -- the Promotion Engine, manager-facing.
//
// A promotion attaches a REAL promotional price to a REAL menu item, for a real window of time.
// The badge, the price and whether it is live right now are all computed by the SERVER -- this
// screen never invents a price and never decides for itself whether a promotion has expired.
// ---------------------------------------------------------------------------------------------

const PLACEMENTS = ['PRODUCT_CARD', 'CATALOG', 'BANNER', 'CATEGORY', 'PROMOTIONS_SECTION'];
const PLACEMENT_LABELS: Record<string, { ru: string; tk: string }> = {
  PRODUCT_CARD: { ru: 'Карточка товара', tk: 'Haryt kartasy' },
  CATALOG: { ru: 'Главный каталог', tk: 'Esasy katalog' },
  BANNER: { ru: 'Баннер', tk: 'Baner' },
  CATEGORY: { ru: 'Категория', tk: 'Kategoriýa' },
  PROMOTIONS_SECTION: { ru: 'Раздел акций', tk: 'Aksiýalar bölümi' },
};

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); }
function toLocalInput(iso?: string) { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

export const PromotionsView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const can = hasPermission('promotions.manage');

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>({ menu_item_id: '', promo_price: '', starts_at: toLocalInput(new Date().toISOString()), ends_at: '', placements: ['PRODUCT_CARD', 'CATALOG'], badge_ru: 'Акция', badge_tk: 'BOOM DEAL' });

  const load = async () => {
    if (!branchId) return;
    setError('');
    try {
      const catalog = await api.getVisualCatalog(branchId);
      setItems(catalog.items || []);
      const res = await api.getPromotions(branchId);
      setPromotions(res.promotions || []);
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
  };

  useEffect(() => { api.getBranches({ status: 'ACTIVE' }).then(r => { setBranches(r.branches || []); if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id); }).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId]);

  const togglePlacement = (p: string) => setForm((f: any) => ({ ...f, placements: f.placements.includes(p) ? f.placements.filter((x: string) => x !== p) : [...f.placements, p] }));

  const selectedItem = items.find(i => i.id === form.menu_item_id);

  const save = async () => {
    setError('');
    if (!form.menu_item_id || !form.promo_price || !form.ends_at) { setError(ru ? 'Выберите блюдо, цену акции и дату окончания.' : 'Naharyny, aksiýa bahasyny we tamamlanýan senesini saýlaň.'); return; }
    try {
      await api.createPromotion({ ...form, branch_id: branchId, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() });
      setForm({ ...form, menu_item_id: '', promo_price: '', ends_at: '' });
      await load();
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
  };

  if (!hasPermission('promotions.view')) return <div className="p-8 text-slate-400">{ru ? 'Нет доступа.' : 'Elýeterli däl.'}</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[.18em] text-amber-400 font-bold">Stage 35.6 · Promotion Engine</div>
          <h2 className="text-2xl font-black text-white mt-1">{ru ? 'Акции' : 'Aksiýalar'}</h2>
          <p className="text-xs text-slate-400 mt-1">{ru ? 'Реальное блюдо, реальная цена и реальная акционная цена. Гость видит это автоматически на всех каналах меню.' : 'Hakyky nahar, hakyky baha we hakyky aksiýa bahasy. Myhman muny ähli menýu kanallarynda awtomatiki görýär.'}</p>
        </div>
        <select className="field w-64" value={branchId} onChange={e => setBranchId(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}</select>
      </div>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{error}</div>}

      {can && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex items-center gap-2 text-white font-bold"><Plus className="w-4 h-4 text-amber-400" />{ru ? 'Новая акция' : 'Täze aksiýa'}</div>
          <div className="grid md:grid-cols-4 gap-3">
            <select className="field" value={form.menu_item_id} onChange={e => setForm({ ...form, menu_item_id: e.target.value })}>
              <option value="">{ru ? 'Блюдо' : 'Nahar'}</option>
              {items.map(i => <option key={i.id} value={i.id}>{ru ? i.name_ru : i.name_tk} · {money(i.price)}</option>)}
            </select>
            <input className="field" type="number" min="0" step="0.01" placeholder={ru ? 'Акционная цена' : 'Aksiýa bahasy'} value={form.promo_price} onChange={e => setForm({ ...form, promo_price: e.target.value })} />
            <input className="field" type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} />
            <input className="field" type="datetime-local" value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} />
          </div>
          {selectedItem && form.promo_price && Number(form.promo_price) >= Number(selectedItem.price) && (
            <div className="text-[11px] text-red-400">{ru ? `Акционная цена должна быть ниже обычной (${money(selectedItem.price)}).` : `Aksiýa bahasy adaty bahadan (${money(selectedItem.price)}) pes bolmaly.`}</div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <input className="field" placeholder={ru ? 'Бейдж (RU), напр. Акция' : 'Bellik (RU)'} value={form.badge_ru} onChange={e => setForm({ ...form, badge_ru: e.target.value })} />
            <input className="field" placeholder={ru ? 'Бейдж (TK), напр. BOOM DEAL' : 'Bellik (TK)'} value={form.badge_tk} onChange={e => setForm({ ...form, badge_tk: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">{ru ? 'Где показывать' : 'Nirede görkezmeli'}</span>
            {PLACEMENTS.map(p => <label key={p} className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer"><input type="checkbox" checked={form.placements.includes(p)} onChange={() => togglePlacement(p)} />{ru ? PLACEMENT_LABELS[p].ru : PLACEMENT_LABELS[p].tk}</label>)}
          </div>
          <button className="btn" onClick={() => void save()}><Plus className="w-4 h-4" /> {ru ? 'Создать акцию' : 'Aksiýa döret'}</button>
        </div>
      )}

      <div className="space-y-3">
        {promotions.map(p => (
          <div key={p.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-wrap gap-4 items-center">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0"><Tag className="w-4 h-4 text-amber-400" /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold">{ru ? p.item_name_ru : p.item_name_tk}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${p.is_live ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>{p.is_live ? (ru ? 'ИДЁТ' : 'DIÝI') : (ru ? 'НЕ АКТИВНА' : 'IŞLEMEÝÄR')}</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5"><span className="line-through">{money(p.item_price)}</span> → <span className="text-amber-400 font-semibold">{money(p.promo_price)}</span> · {new Date(p.starts_at).toLocaleString()} — {new Date(p.ends_at).toLocaleString()}</div>
            </div>
            {can && (
              <div className="flex gap-1">
                <button className="btn bg-slate-800" onClick={() => void api.updatePromotion(p.id, { active: !p.active }).then(load)}><Power className="w-3.5 h-3.5" /></button>
                <button className="btn bg-red-500/10 text-red-300" onClick={() => void api.deactivatePromotion(p.id).then(load)}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        ))}
        {!promotions.length && <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500">{ru ? 'Нет акций.' : 'Aksiýa ýok.'}</div>}
      </div>
    </div>
  );
};
