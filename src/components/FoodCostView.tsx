import React, { useEffect, useState } from 'react';
import { Loader2, ChevronRight, Plus, X, Boxes, TrendingUp, ClipboardList, Scale } from 'lucide-react';
import { api } from '../api';
import { useBranchScope } from '../useBranchScope';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState, LoadingState } from './ui';

// ---------------------------------------------------------------------------------------------
// Food Cost -- MENU -> RECIPE -> INGREDIENTS -> INVENTORY economic chain, read from the existing
// Recipe Engine / Inventory ledger / Order Core. Every number here is exactly what the backend
// computed (server-authoritative BigInt arithmetic); this view only formats and displays it.
// ---------------------------------------------------------------------------------------------

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? '0.00'); }
function qtyFmt(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(v ?? '0'); }

type Tab = 'menu' | 'ingredients' | 'profitability' | 'counts';

export const FoodCostView: React.FC = () => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const { branchId, setBranchId, branches } = useBranchScope();

  const [tab, setTab] = useState<Tab>('menu');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [profitability, setProfitability] = useState<any | null>(null);
  const [counts, setCounts] = useState<any[]>([]);
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [allMenuItems, setAllMenuItems] = useState<any[]>([]);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [recipeForm, setRecipeForm] = useState<{ name: string; yield_qty: string; lines: Array<{ inventory_item_id: string; quantity: string }> } | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [recipeError, setRecipeError] = useState('');

  const [countForm, setCountForm] = useState<{ inventory_item_id: string; counted_quantity: string; reason: string }>({ inventory_item_id: '', counted_quantity: '', reason: '' });
  const [countBusy, setCountBusy] = useState(false);
  const [countError, setCountError] = useState('');

  const load = async (t: Tab) => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      if (t === 'menu') setMenuItems((await api.getFoodCostMenuItems({ branch_id: branchId })).items);
      if (t === 'ingredients') setIngredients((await api.getFoodCostIngredients(branchId)).ingredients);
      if (t === 'profitability') setProfitability(await api.getFoodCostProfitability({ branch_id: branchId }));
      if (t === 'counts') { setCounts((await api.getInventoryCounts(branchId)).counts); if (!inventoryItems.length) setInventoryItems((await api.getInventoryItems(branchId)).items); }
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, branchId]);
  useEffect(() => { if (branchId) { api.getMenuAdmin(branchId).then(r => setAllMenuItems(r.items)).catch(() => {}); api.getInventoryItems(branchId).then(r => setInventoryItems(r.items)).catch(() => {}); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId]);

  const openDetail = async (itemId: string) => {
    if (expandedItem === itemId) { setExpandedItem(null); setDetail(null); setRecipeForm(null); return; }
    setExpandedItem(itemId); setDetail(null); setRecipeForm(null); setRecipeError('');
    try {
      const [d, v] = await Promise.all([api.getFoodCostMenuItemDetail(itemId, branchId), api.getRecipeVersions(itemId, branchId)]);
      setDetail(d); setVersions(v.versions);
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
  };

  const startNewRecipe = () => setRecipeForm({ name: allMenuItems.find(m => m.id === expandedItem)?.name_ru || '', yield_qty: '1', lines: [{ inventory_item_id: '', quantity: '' }] });
  const startNewVersion = () => setRecipeForm({ name: detail?.recipe ? undefined as any : '', yield_qty: String(detail?.recipe?.yield_qty || '1'), lines: (detail?.recipe?.ingredients || []).map((i: any) => ({ inventory_item_id: i.inventory_item_id, quantity: String(i.quantity) })) });

  const submitRecipe = async () => {
    if (!recipeForm || !expandedItem || recipeBusy) return;
    const lines = recipeForm.lines.filter(l => l.inventory_item_id && l.quantity);
    if (!lines.length) { setRecipeError(ru ? 'Добавьте хотя бы один ингредиент.' : 'Iň azyndan bir ingredient goşuň.'); return; }
    setRecipeBusy(true); setRecipeError('');
    try {
      if (detail?.recipe) {
        await api.createRecipeVersion(detail.recipe.id, { yield_qty: recipeForm.yield_qty, ingredients: lines });
      } else {
        await api.createRecipe({ branch_id: branchId, menu_item_id: expandedItem, name: recipeForm.name || 'Recipe', yield_qty: recipeForm.yield_qty, ingredients: lines });
      }
      setRecipeForm(null);
      const [d, v] = await Promise.all([api.getFoodCostMenuItemDetail(expandedItem, branchId), api.getRecipeVersions(expandedItem, branchId)]);
      setDetail(d); setVersions(v.versions);
      void load('menu');
    } catch (e: any) { setRecipeError(e?.message || (ru ? 'Ошибка сохранения' : 'Ýatda saklama ýalňyşlygy')); }
    finally { setRecipeBusy(false); }
  };

  const submitCount = async () => {
    if (!countForm.inventory_item_id || !countForm.counted_quantity || countBusy) return;
    setCountBusy(true); setCountError('');
    try {
      await api.createInventoryCount({ branch_id: branchId, inventory_item_id: countForm.inventory_item_id, counted_quantity: countForm.counted_quantity, reason: countForm.reason || undefined });
      setCountForm({ inventory_item_id: '', counted_quantity: '', reason: '' });
      void load('counts');
    } catch (e: any) { setCountError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
    finally { setCountBusy(false); }
  };

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'menu', label: ru ? 'Себестоимость блюд' : 'Tagam bahasy', icon: Boxes },
    { id: 'ingredients', label: ru ? 'Ингредиенты' : 'Ingredientler', icon: Scale },
    { id: 'profitability', label: ru ? 'Рентабельность' : 'Girdejililik', icon: TrendingUp },
    { id: 'counts', label: ru ? 'Инвентаризация' : 'Inwentarizasiýa', icon: ClipboardList },
  ];

  const foodCostColor = (pct: string | null) => { if (pct === null) return 'text-slate-500'; const n = Number(pct); return n > 40 ? 'text-red-400' : n > 30 ? 'text-amber-400' : 'text-emerald-400'; };

  // Stage 44: without a branch this screen rendered an empty shell and explained nothing. The
  // shared rule chooses the branch (see useBranchScope); when there is genuinely none to show, the
  // screen says so and says where to choose one.
  if (!branchId) {
    return (
      <div className="p-6">
        <EmptyState
          title={ru ? 'Филиал не выбран.' : 'Şahamça saýlanmadyk.'}
          hint={ru
            ? 'Себестоимость и food cost считаются по складу и рецептам конкретного филиала. Выберите филиал в шапке страницы или попросите администратора привязать вашу учётную запись к филиалу.'
            : 'Öz bahasy we food cost anyk şahamçanyň ammary we reseptleri boýunça hasaplanýar. Sahypanyň ýokarsynda şahamçany saýlaň ýa-da hasabyňyzy şahamça baglamagy administratordan soraň.'}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        {branches.length > 1 && (
          <select
            id="foodcost-branch-pick"
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

      {loading && <LoadingState/>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {/* ---- MENU ITEMS (food cost report) ---- */}
      {!loading && tab === 'menu' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Блюдо' : 'Tagam'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Цена' : 'Baha'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Себестоимость' : 'Baha (resept)'}</th>
                <th className="text-right px-3 py-2">Food Cost %</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа' : 'Marja'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа %' : 'Marja %'}</th>
                <th className="text-center px-3 py-2">{ru ? 'Версия' : 'Wersiýa'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {menuItems.map((m: any) => (
                <React.Fragment key={m.id}>
                  <tr className="border-t border-slate-800 text-slate-200 hover:bg-slate-800/30 cursor-pointer" onClick={() => void openDetail(m.id)}>
                    <td className="px-3 py-2 font-medium">{ru ? m.name_ru : m.name_tk}</td>
                    <td className="px-3 py-2 text-right">{money(m.price)}</td>
                    <td className="px-3 py-2 text-right">{m.recipe_cost ? money(m.recipe_cost) : <span className="text-slate-600">{ru ? 'нет рецепта' : 'resept ýok'}</span>}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${foodCostColor(m.food_cost_percent)}`}>{m.food_cost_percent ?? '—'}{m.food_cost_percent !== null ? '%' : ''}</td>
                    <td className="px-3 py-2 text-right">{m.gross_margin ? money(m.gross_margin) : '—'}</td>
                    <td className="px-3 py-2 text-right">{m.gross_margin_percent ?? '—'}{m.gross_margin_percent !== null ? '%' : ''}</td>
                    <td className="px-3 py-2 text-center text-slate-400">{m.recipe_version ?? '—'}</td>
                    <td className="px-3 py-2 text-right"><ChevronRight className={`w-3.5 h-3.5 inline transition-transform ${expandedItem === m.id ? 'rotate-90' : ''}`} /></td>
                  </tr>
                  {expandedItem === m.id && (
                    <tr className="bg-slate-800/20"><td colSpan={8} className="px-3 py-3">
                      {!detail ? <div className="text-slate-500 text-xs">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div> : (
                        <div className="space-y-3">
                          {detail.recipe ? (
                            <div>
                              <table className="w-full text-[11px]">
                                <thead className="text-slate-500"><tr><th className="text-left py-1">{ru ? 'Ингредиент' : 'Ingredient'}</th><th className="text-right py-1">{ru ? 'Кол-во' : 'Mukdar'}</th><th className="text-right py-1">{ru ? 'Цена/ед' : 'Baha/birlik'}</th><th className="text-right py-1">{ru ? 'Стоимость' : 'Baha'}</th></tr></thead>
                                <tbody>
                                  {detail.recipe.ingredients.map((ing: any) => (
                                    <tr key={ing.inventory_item_id} className="border-t border-slate-800/60 text-slate-300">
                                      <td className="py-1">{ing.name}</td>
                                      <td className="py-1 text-right">{qtyFmt(ing.quantity)} {ing.unit}</td>
                                      <td className="py-1 text-right">{money(ing.unit_cost)}</td>
                                      <td className="py-1 text-right">{money(ing.line_cost)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="flex gap-4 mt-2 text-[11px] text-slate-400">
                                <span>{ru ? 'Всего' : 'Jemi'}: <span className="text-white font-semibold">{money(detail.recipe.recipe_total_cost)}</span></span>
                                <span>{ru ? 'Выход' : 'Çykyş'}: {detail.recipe.yield_qty}</span>
                                <span>{ru ? 'Версия' : 'Wersiýa'}: {detail.recipe.version}</span>
                              </div>
                            </div>
                          ) : <div className="text-slate-500 text-xs">{ru ? 'У этого блюда нет активного рецепта.' : 'Bu tagamyň işjeň resepti ýok.'}</div>}

                          {versions.length > 1 && (
                            <div className="text-[10px] text-slate-500">
                              {ru ? 'История версий' : 'Wersiýa taryhy'}: {versions.map(v => `v${v.version}${v.active ? ' (' + (ru ? 'текущая' : 'häzirki') + ')' : ''}`).join(', ')}
                            </div>
                          )}

                          {!recipeForm ? (
                            <button className="btn btn-sm" onClick={detail.recipe ? startNewVersion : startNewRecipe}>
                              <Plus className="w-3.5 h-3.5" /> {detail.recipe ? (ru ? 'Новая версия рецепта' : 'Täze resept wersiýasy') : (ru ? 'Создать рецепт' : 'Resept döret')}
                            </button>
                          ) : (
                            <div className="rounded-lg bg-slate-900 border border-slate-700 p-3 space-y-2">
                              {!detail.recipe && (
                                <div className="grid grid-cols-2 gap-2">
                                  <input className="field text-xs" placeholder={ru ? 'Название рецепта' : 'Resept ady'} value={recipeForm.name} onChange={e => setRecipeForm({ ...recipeForm, name: e.target.value })} />
                                  <input className="field text-xs" placeholder={ru ? 'Выход (порций)' : 'Çykyş'} value={recipeForm.yield_qty} onChange={e => setRecipeForm({ ...recipeForm, yield_qty: e.target.value })} />
                                </div>
                              )}
                              {detail.recipe && (
                                <input className="field text-xs w-32" placeholder={ru ? 'Выход' : 'Çykyş'} value={recipeForm.yield_qty} onChange={e => setRecipeForm({ ...recipeForm, yield_qty: e.target.value })} />
                              )}
                              {recipeForm.lines.map((line, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                  <select className="field text-xs flex-1" value={line.inventory_item_id} onChange={e => { const lines = [...recipeForm.lines]; lines[idx] = { ...lines[idx], inventory_item_id: e.target.value }; setRecipeForm({ ...recipeForm, lines }); }}>
                                    <option value="">{ru ? 'Выберите ингредиент' : 'Ingredient saýlaň'}</option>
                                    {inventoryItems.map((i: any) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                                  </select>
                                  <input className="field text-xs w-28" placeholder={ru ? 'Кол-во' : 'Mukdar'} value={line.quantity} onChange={e => { const lines = [...recipeForm.lines]; lines[idx] = { ...lines[idx], quantity: e.target.value }; setRecipeForm({ ...recipeForm, lines }); }} />
                                  <button className="text-slate-500 hover:text-red-400" onClick={() => setRecipeForm({ ...recipeForm, lines: recipeForm.lines.filter((_, i) => i !== idx) })}><X className="w-3.5 h-3.5" /></button>
                                </div>
                              ))}
                              <button className="text-[10px] text-amber-400" onClick={() => setRecipeForm({ ...recipeForm, lines: [...recipeForm.lines, { inventory_item_id: '', quantity: '' }] })}>+ {ru ? 'ингредиент' : 'ingredient'}</button>
                              {recipeError && <div className="text-red-400 text-xs">{recipeError}</div>}
                              <div className="flex gap-2">
                                <button className="btn-secondary btn-sm" disabled={recipeBusy} onClick={() => setRecipeForm(null)}>{ru ? 'Отмена' : 'Ýatyr'}</button>
                                <button className="btn btn-sm" disabled={recipeBusy} onClick={() => void submitRecipe()}>{recipeBusy ? '…' : (ru ? 'Сохранить' : 'Ýatda sakla')}</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
              {menuItems.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- INGREDIENTS ---- */}
      {!loading && tab === 'ingredients' && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Ингредиент' : 'Ingredient'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Остаток' : 'Galyndy'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Цена/ед' : 'Baha/birlik'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Стоимость запаса' : 'Ätiýaç bahasy'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Расход сегодня' : 'Şu gün sarp edildi'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Используется в' : 'Ulanylýar'}</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((i: any) => (
                <tr key={i.id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-medium">{i.name}</td>
                  <td className="px-3 py-2 text-right">{qtyFmt(i.current_stock)} {i.unit}</td>
                  <td className="px-3 py-2 text-right">{money(i.unit_cost)}</td>
                  <td className="px-3 py-2 text-right">{money(i.inventory_value)}</td>
                  <td className="px-3 py-2 text-right">{qtyFmt(i.consumption_today)} {i.unit}</td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">{i.affected_recipes.map((r: any) => ru ? r.name_ru : r.name_tk).join(', ') || '—'}</td>
                </tr>
              ))}
              {ingredients.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- PROFITABILITY ---- */}
      {!loading && tab === 'profitability' && profitability && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Блюдо' : 'Tagam'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Продано' : 'Satyldy'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Выручка' : 'Girdeji'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Себестоимость' : 'Baha'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа' : 'Marja'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа %' : 'Marja %'}</th>
              </tr>
            </thead>
            <tbody>
              {profitability.items.map((p: any) => (
                <tr key={p.menu_item_id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 font-medium">{ru ? p.name_ru : p.name_tk}</td>
                  <td className="px-3 py-2 text-right">{p.units_sold}</td>
                  <td className="px-3 py-2 text-right">{money(p.revenue)}</td>
                  <td className="px-3 py-2 text-right">{money(p.theoretical_cost)}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{money(p.gross_margin)}</td>
                  <td className="px-3 py-2 text-right">{p.gross_margin_percent ?? '—'}{p.gross_margin_percent !== null ? '%' : ''}</td>
                </tr>
              ))}
              {profitability.items.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет продаж за сегодня' : 'Şu gün satuw ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- INVENTORY COUNTS / VARIANCE ---- */}
      {!loading && tab === 'counts' && (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{ru ? 'Новая инвентаризация' : 'Täze inwentarizasiýa'}</div>
            <div className="grid grid-cols-3 gap-2">
              <select className="field text-xs" value={countForm.inventory_item_id} onChange={e => setCountForm({ ...countForm, inventory_item_id: e.target.value })}>
                <option value="">{ru ? 'Выберите товар' : 'Haryt saýlaň'}</option>
                {inventoryItems.map((i: any) => <option key={i.id} value={i.id}>{i.name} ({ru ? 'система' : 'ulgam'}: {qtyFmt(i.current_stock)} {i.unit})</option>)}
              </select>
              <input className="field text-xs" placeholder={ru ? 'Фактическое количество' : 'Hakyky mukdar'} value={countForm.counted_quantity} onChange={e => setCountForm({ ...countForm, counted_quantity: e.target.value })} />
              <input className="field text-xs" placeholder={ru ? 'Причина (необязательно)' : 'Sebäbi (hökmany däl)'} value={countForm.reason} onChange={e => setCountForm({ ...countForm, reason: e.target.value })} />
            </div>
            {countError && <div className="text-red-400 text-xs">{countError}</div>}
            <button className="btn btn-sm" disabled={countBusy} onClick={() => void submitCount()}>{countBusy ? '…' : (ru ? 'Зафиксировать' : 'Belläp goý')}</button>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800/60 text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2">{ru ? 'Товар' : 'Haryt'}</th>
                  <th className="text-right px-3 py-2">{ru ? 'Теоретически' : 'Teoretiki'}</th>
                  <th className="text-right px-3 py-2">{ru ? 'Фактически' : 'Hakyky'}</th>
                  <th className="text-right px-3 py-2">{ru ? 'Расхождение' : 'Tapawut'}</th>
                  <th className="text-left px-3 py-2">{ru ? 'Кто' : 'Kim'}</th>
                  <th className="text-left px-3 py-2">{ru ? 'Причина' : 'Sebäbi'}</th>
                </tr>
              </thead>
              <tbody>
                {counts.map((c: any) => (
                  <tr key={c.id} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-right">{qtyFmt(c.theoretical_quantity)} {c.unit}</td>
                    <td className="px-3 py-2 text-right">{qtyFmt(c.counted_quantity)} {c.unit}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${Number(c.delta) < 0 ? 'text-red-400' : Number(c.delta) > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>{Number(c.delta) > 0 ? '+' : ''}{qtyFmt(c.delta)} {c.unit}</td>
                    <td className="px-3 py-2 text-slate-400">{c.counted_by_name}</td>
                    <td className="px-3 py-2 text-slate-500 text-[10px]">{c.reason || '—'}</td>
                  </tr>
                ))}
                {counts.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
