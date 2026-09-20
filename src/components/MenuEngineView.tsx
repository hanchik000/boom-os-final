import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UtensilsCrossed, Plus, RefreshCw, Layers3, Pencil, Archive, Check, X, ImagePlus,
  Sandwich, AlertTriangle, Loader2, Tag
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api';

// ---------------------------------------------------------------------------------------------
// Stage 36 -- ADMIN Menu Builder.
//
// This is a control surface over the EXISTING Menu Engine (/api/menu) and the EXISTING Stage 35.4
// Media Engine (/api/media-assets). It invents nothing: every price, name, status, modifier and
// photo shown here is a value the server returned, and every mutation is an existing (or, for
// modifier edit/archive and dish media, a minimally extended) backend route. There is no
// client-side price arithmetic anywhere in this file -- prices are strings passed through to the
// server, which remains the only thing that decides what a dish costs.
//
// "Burger Constructor" is not a second engine: a configurable dish is simply a dish whose
// modifier groups are its components (bun / patty / sauce / extras). The constructor tab renders
// that same modifier structure component-first, and what it produces are the same real modifier
// rows the Order Core already consumes via `modifier_ids`.
// ---------------------------------------------------------------------------------------------

type Tab = 'catalog' | 'constructor';

// Display formatting only. Postgres returns numerics without trailing zeros ("95", "8"), so this
// pads them back to two decimals for the eye. It performs NO arithmetic: the value it is given is
// the value the server sent, and what gets sent back on save is the raw string the operator typed.
const money = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? ''); };

export const MenuEngineView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const canManage = hasPermission('menu.manage');
  const canMedia = hasPermission('menu.media.view');

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState(user?.branch_id || '');
  const [tab, setTab] = useState<Tab>('catalog');
  const [showArchived, setShowArchived] = useState(false);
  const [data, setData] = useState<{ categories: any[]; items: any[] }>({ categories: [], items: [] });
  const [selected, setSelected] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState('');

  // ---- draft state for creation forms
  const [cat, setCat] = useState({ name_ru: '', name_tk: '', sort_order: '0' });
  const [item, setItem] = useState({ category_id: '', sku: '', name_ru: '', name_tk: '', description_ru: '', description_tk: '', price: '', sort_order: '0' });
  const [group, setGroup] = useState({ name_ru: '', name_tk: '', min_select: '0', max_select: '1', required: false, sort_order: '0' });
  const [mod, setMod] = useState({ name_ru: '', name_tk: '', price_delta: '0', sort_order: '0' });
  const [modGroupId, setModGroupId] = useState('');

  // ---- inline edit state (id of the row being edited + its draft)
  const [editCat, setEditCat] = useState<any>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [editGroup, setEditGroup] = useState<any>(null);
  const [editMod, setEditMod] = useState<any>(null);
  const [mediaFor, setMediaFor] = useState<any>(null);

  const t = (r: string, k: string) => (ru ? r : k);

  const loadMenu = useCallback(async () => {
    if (!branchId) return;
    setBusy(true); setError('');
    try { setData(await api.getMenuAdmin(branchId, showArchived)); }
    catch (e: any) { setError(e?.message || t('Не удалось загрузить меню.', 'Menýu ýüklenip bilmedi.')); }
    finally { setBusy(false); }
  }, [branchId, showArchived, ru]);

  const loadModifiers = useCallback(async (itemId: string) => {
    try { const r = await api.getMenuModifiers(itemId, branchId, showArchived); setGroups(r.groups || []); }
    catch (e: any) { setError(e?.message || ''); }
  }, [branchId, showArchived]);

  useEffect(() => { void api.getBranches().then(r => { setBranches(r.branches || []); if (!branchId && r.branches?.[0]) setBranchId(r.branches[0].id); }).catch(() => undefined); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { void loadMenu(); }, [loadMenu]);
  useEffect(() => { if (selected) void loadModifiers(selected.id); }, [selected?.id, loadModifiers]);
  useEffect(() => {
    if (!branchId || !canMedia) return;
    void api.getMediaAssets(branchId).then(r => setAssets((r.assets || []).filter((a: any) => a.active))).catch(() => setAssets([]));
  }, [branchId, canMedia, mediaFor]);

  const run = async (label: string, fn: () => Promise<any>, after?: () => Promise<any> | void) => {
    setSaving(label); setError('');
    try { await fn(); await loadMenu(); if (after) await after(); }
    catch (e: any) { setError(e?.message || t('Операция не выполнена.', 'Amal ýerine ýetirilmedi.')); }
    finally { setSaving(''); }
  };

  const visibleItems = useMemo(() => data.items, [data.items]);
  const itemsOf = (categoryId: string) => visibleItems.filter((i: any) => i.category_id === categoryId);
  const isArchived = (row: any) => Boolean(row?.deleted_at) || row?.status === 'INACTIVE';

  if (!hasPermission('menu.view')) {
    return <div className="p-8 text-slate-400">{t('Нет доступа к Menu Engine.', 'Menu Engine elýeterli däl.')}</div>;
  }

  const selectedItem = selected ? visibleItems.find((i: any) => i.id === selected.id) || selected : null;

  return (
    <div className="cmd-center">
      {/* ---- TOP ---- */}
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title"><UtensilsCrossed className="inline w-5 h-5 text-amber-400 mr-2" />{t('MENU BUILDER', 'MENÝU GURUJY')}</h1>
          <p className="cmd-subtitle">{t('Категории, блюда, цены, модификаторы, конструктор и фото — всё из ADMIN.', 'Kategoriýalar, naharlar, bahalar, modifikatorlar we suratlar — ADMIN-den.')}</p>
        </div>
        <div className="cmd-toolbar">
          <select className="cmd-branch-select boom-focusable" value={branchId} onChange={e => { setBranchId(e.target.value); setSelected(null); }}>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <div className="cmd-preset-group">
            <button className={`cmd-preset-btn boom-focusable ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>{t('Каталог', 'Katalog')}</button>
            <button className={`cmd-preset-btn boom-focusable ${tab === 'constructor' ? 'active' : ''}`} onClick={() => setTab('constructor')}><Sandwich className="inline w-3 h-3 mr-1" />{t('Конструктор', 'Gurujy')}</button>
          </div>
          <label className="mb-cb boom-focusable"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> {t('Архив', 'Arhiw')}</label>
          <button className="cmd-refresh-btn boom-focusable" disabled={busy} onClick={() => void loadMenu()} aria-label={t('Обновить меню', 'Menýuny täzelemek')}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('Обновить', 'Täzele')}
          </button>
        </div>
      </div>

      {error && <div className="cmd-error">{error}</div>}
      {!canManage && <div className="cmd-stale">{t('Режим просмотра: нет права menu.manage.', 'Diňe görmek: menu.manage rugsady ýok.')}</div>}

      {tab === 'catalog' ? (
        <div className="mb-grid">
          {/* ================= LEFT: categories + dishes ================= */}
          <section className="mb-col">
            {canManage && (
              <div className="cmd-panel">
                <div className="cmd-panel-title"><Plus className="inline w-3 h-3 mr-1" />{t('Новая категория', 'Täze kategoriýa')}</div>
                <div className="mb-form-row">
                  <input className="mb-input" value={cat.name_ru} onChange={e => setCat({ ...cat, name_ru: e.target.value })} placeholder={t('Название RU', 'Ady RU')} />
                  <input className="mb-input" value={cat.name_tk} onChange={e => setCat({ ...cat, name_tk: e.target.value })} placeholder={t('Название TK', 'Ady TK')} />
                  <input className="mb-input mb-input-sm" value={cat.sort_order} onChange={e => setCat({ ...cat, sort_order: e.target.value })} placeholder="#" />
                  <button className="mb-btn gold boom-focusable" disabled={!cat.name_ru.trim() || !cat.name_tk.trim() || saving === 'cat'}
                    onClick={() => void run('cat', () => api.createMenuCategory({ ...cat, branch_id: branchId }), () => setCat({ name_ru: '', name_tk: '', sort_order: '0' }))}>
                    {saving === 'cat' ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Создать', 'Döret')}
                  </button>
                </div>
              </div>
            )}

            {canManage && (
              <div className="cmd-panel">
                <div className="cmd-panel-title"><Plus className="inline w-3 h-3 mr-1" />{t('Новое блюдо', 'Täze nahar')}</div>
                <div className="mb-form-grid">
                  <select className="mb-input" value={item.category_id} onChange={e => setItem({ ...item, category_id: e.target.value })}>
                    <option value="">{t('— категория —', '— kategoriýa —')}</option>
                    {data.categories.filter((c: any) => !isArchived(c)).map((c: any) => <option key={c.id} value={c.id}>{c.name_ru} / {c.name_tk}</option>)}
                  </select>
                  <input className="mb-input" value={item.sku} onChange={e => setItem({ ...item, sku: e.target.value })} placeholder="SKU" />
                  <input className="mb-input" value={item.name_ru} onChange={e => setItem({ ...item, name_ru: e.target.value })} placeholder={t('Название RU', 'Ady RU')} />
                  <input className="mb-input" value={item.name_tk} onChange={e => setItem({ ...item, name_tk: e.target.value })} placeholder={t('Название TK', 'Ady TK')} />
                  <input className="mb-input" value={item.price} onChange={e => setItem({ ...item, price: e.target.value })} placeholder={t('Цена', 'Baha')} inputMode="decimal" />
                  <input className="mb-input" value={item.sort_order} onChange={e => setItem({ ...item, sort_order: e.target.value })} placeholder="#" />
                  <input className="mb-input mb-span2" value={item.description_ru} onChange={e => setItem({ ...item, description_ru: e.target.value })} placeholder={t('Описание RU', 'Beýany RU')} />
                  <input className="mb-input mb-span2" value={item.description_tk} onChange={e => setItem({ ...item, description_tk: e.target.value })} placeholder={t('Описание TK', 'Beýany TK')} />
                  <button className="mb-btn gold mb-span2 boom-focusable" disabled={!item.category_id || !item.sku.trim() || !item.name_ru.trim() || !item.name_tk.trim() || !item.price.trim() || saving === 'item'}
                    onClick={() => void run('item', () => api.createMenuItem({ ...item, branch_id: branchId }), () => setItem({ ...item, sku: '', name_ru: '', name_tk: '', description_ru: '', description_tk: '', price: '' }))}>
                    {saving === 'item' ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Создать блюдо', 'Nahar döret')}
                  </button>
                </div>
              </div>
            )}

            {/* ---- catalog tree ---- */}
            <div className="cmd-table-wrap">
              <div className="cmd-table-head"><Layers3 /> {t('Каталог', 'Katalog')}</div>
              {busy && !data.categories.length ? <div className="cmd-empty-row">{t('Загрузка…', 'Ýüklenýär…')}</div> : null}
              {data.categories.map((c: any) => (
                <div key={c.id} className={`mb-cat ${isArchived(c) ? 'archived' : ''}`}>
                  <div className="mb-cat-head">
                    {editCat?.id === c.id ? (
                      <div className="mb-form-row grow">
                        <input className="mb-input" value={editCat.name_ru} onChange={e => setEditCat({ ...editCat, name_ru: e.target.value })} />
                        <input className="mb-input" value={editCat.name_tk} onChange={e => setEditCat({ ...editCat, name_tk: e.target.value })} />
                        <input className="mb-input mb-input-sm" value={String(editCat.sort_order)} onChange={e => setEditCat({ ...editCat, sort_order: e.target.value })} />
                        <select className="mb-input mb-input-sm" value={editCat.status} onChange={e => setEditCat({ ...editCat, status: e.target.value })}>
                          <option value="ACTIVE">{t('Активна', 'Aktiw')}</option>
                          <option value="INACTIVE">{t('Скрыта', 'Gizlin')}</option>
                        </select>
                        <button className="mb-btn gold boom-focusable" disabled={saving === `c${c.id}`} onClick={() => void run(`c${c.id}`, () => api.updateMenuCategory(c.id, { name_ru: editCat.name_ru, name_tk: editCat.name_tk, sort_order: editCat.sort_order, status: editCat.status }), () => setEditCat(null))}><Check className="w-3 h-3" /></button>
                        <button className="mb-btn boom-focusable" onClick={() => setEditCat(null)}><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <>
                        <span className="mb-cat-name">{c.name_ru} <span className="mb-muted">/ {c.name_tk}</span></span>
                        <span className="mb-chip">#{c.sort_order}</span>
                        {isArchived(c) && <span className="mb-chip archived">{t('архив', 'arhiw')}</span>}
                        {canManage && (
                          <span className="mb-actions">
                            <button className="mb-icon boom-focusable" title={t('Изменить', 'Üýtget')} aria-label={t('Изменить категорию', 'Kategoriýany üýtget')} onClick={() => setEditCat({ id: c.id, name_ru: c.name_ru, name_tk: c.name_tk, sort_order: String(c.sort_order), status: c.status })}><Pencil className="w-3.5 h-3.5" /></button>
                            {!isArchived(c) && <button className="mb-icon danger boom-focusable" title={t('В архив', 'Arhiwe')} aria-label={t('Архивировать категорию', 'Kategoriýany arhiwle')} disabled={saving === `ca${c.id}`} onClick={() => void run(`ca${c.id}`, () => api.archiveMenuCategory(c.id))}><Archive className="w-3.5 h-3.5" /></button>}
                            {isArchived(c) && <button className="mb-icon boom-focusable" title={t('Восстановить', 'Dikeld')} disabled={saving === `cr${c.id}`} onClick={() => void run(`cr${c.id}`, () => api.updateMenuCategory(c.id, { status: 'ACTIVE' }))}><RefreshCw className="w-3.5 h-3.5" /></button>}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {itemsOf(c.id).map((i: any) => (
                    <div key={i.id} className={`mb-dish ${selected?.id === i.id ? 'selected' : ''} ${isArchived(i) ? 'archived' : ''}`}>
                      {editItem?.id === i.id ? (
                        <div className="mb-form-grid grow">
                          <input className="mb-input" value={editItem.name_ru} onChange={e => setEditItem({ ...editItem, name_ru: e.target.value })} placeholder="RU" />
                          <input className="mb-input" value={editItem.name_tk} onChange={e => setEditItem({ ...editItem, name_tk: e.target.value })} placeholder="TK" />
                          <input className="mb-input" value={editItem.price} onChange={e => setEditItem({ ...editItem, price: e.target.value })} placeholder={t('Цена', 'Baha')} inputMode="decimal" />
                          <input className="mb-input" value={String(editItem.sort_order)} onChange={e => setEditItem({ ...editItem, sort_order: e.target.value })} placeholder="#" />
                          <input className="mb-input mb-span2" value={editItem.description_ru || ''} onChange={e => setEditItem({ ...editItem, description_ru: e.target.value })} placeholder={t('Описание RU', 'Beýany RU')} />
                          <input className="mb-input mb-span2" value={editItem.description_tk || ''} onChange={e => setEditItem({ ...editItem, description_tk: e.target.value })} placeholder={t('Описание TK', 'Beýany TK')} />
                          <select className="mb-input" value={editItem.status} onChange={e => setEditItem({ ...editItem, status: e.target.value })}>
                            <option value="ACTIVE">{t('В продаже', 'Satuwda')}</option>
                            <option value="INACTIVE">{t('Снято', 'Aýryldy')}</option>
                          </select>
                          <div className="mb-form-row mb-span2">
                            <button className="mb-btn gold boom-focusable" disabled={saving === `i${i.id}`} onClick={() => void run(`i${i.id}`, () => api.updateMenuItem(i.id, { name_ru: editItem.name_ru, name_tk: editItem.name_tk, price: editItem.price, sort_order: editItem.sort_order, status: editItem.status, description_ru: editItem.description_ru, description_tk: editItem.description_tk }), () => setEditItem(null))}><Check className="w-3 h-3" /> {t('Сохранить', 'Ýatda sakla')}</button>
                            <button className="mb-btn boom-focusable" onClick={() => setEditItem(null)}><X className="w-3 h-3" /> {t('Отмена', 'Goý bolsun')}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button className="mb-dish-main boom-focusable" onClick={() => setSelected(i)}>
                            <span className="mb-thumb">
                              {i.media_url
                                ? (i.media_kind === 'VIDEO'
                                  ? <video src={i.media_url} poster={i.media_poster_url || undefined} muted className="mb-thumb-img" />
                                  : <img src={i.media_url} alt={(ru ? i.media_alt_ru : i.media_alt_tk) || i.name_ru} className="mb-thumb-img" style={{ objectPosition: `${i.media_focal_x ?? 50}% ${i.media_focal_y ?? 50}%` }} />)
                                : <ImagePlus className="w-4 h-4 text-slate-600" />}
                            </span>
                            <span className="mb-dish-copy">
                              <b>{i.name_ru}</b>
                              <small>{i.sku} · {i.name_tk}</small>
                            </span>
                            <span className="mb-price">{money(i.price)}</span>
                          </button>
                          {isArchived(i) && <span className="mb-chip archived">{t('архив', 'arhiw')}</span>}
                          {canManage && (
                            <span className="mb-actions">
                              {canMedia && <button className="mb-icon boom-focusable" title={t('Фото блюда', 'Nahar suraty')} aria-label={t('Изменить фото блюда', 'Nahar suratyny üýtget')} onClick={() => setMediaFor(i)}><ImagePlus className="w-3.5 h-3.5" /></button>}
                              <button className="mb-icon boom-focusable" title={t('Изменить', 'Üýtget')} aria-label={t('Изменить блюдо', 'Nahary üýtget')} onClick={() => setEditItem({ id: i.id, name_ru: i.name_ru, name_tk: i.name_tk, price: String(i.price), sort_order: String(i.sort_order), status: i.status, description_ru: i.description_ru, description_tk: i.description_tk })}><Pencil className="w-3.5 h-3.5" /></button>
                              {!isArchived(i) && <button className="mb-icon danger boom-focusable" title={t('В архив', 'Arhiwe')} aria-label={t('Архивировать блюдо', 'Nahary arhiwle')} disabled={saving === `ia${i.id}`} onClick={() => void run(`ia${i.id}`, () => api.archiveMenuItem(i.id))}><Archive className="w-3.5 h-3.5" /></button>}
                              {isArchived(i) && <button className="mb-icon boom-focusable" title={t('Вернуть в продажу', 'Satuwa gaýtar')} disabled={saving === `ir${i.id}`} onClick={() => void run(`ir${i.id}`, () => api.updateMenuItem(i.id, { status: 'ACTIVE' }))}><RefreshCw className="w-3.5 h-3.5" /></button>}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {!itemsOf(c.id).length && <div className="mb-empty">{t('Нет блюд в категории', 'Kategoriýada nahar ýok')}</div>}
                </div>
              ))}
              {!busy && !data.categories.length && <div className="cmd-empty-row">{t('Категорий пока нет.', 'Entek kategoriýa ýok.')}</div>}
            </div>
          </section>

          {/* ================= RIGHT: modifiers for the selected dish ================= */}
          <aside className="cmd-panel mb-side">
            {selectedItem ? (
              <>
                <div className="cmd-panel-title"><Layers3 /> {t('Модификаторы', 'Modifikatorlar')}: {selectedItem.name_ru}</div>
                {canManage && (
                  <div className="mb-form-grid mb-boxed">
                    <input className="mb-input mb-span2" value={group.name_ru} onChange={e => setGroup({ ...group, name_ru: e.target.value })} placeholder={t('Группа RU (напр. Соус)', 'Topar RU')} />
                    <input className="mb-input mb-span2" value={group.name_tk} onChange={e => setGroup({ ...group, name_tk: e.target.value })} placeholder={t('Группа TK', 'Topar TK')} />
                    <input className="mb-input" value={group.min_select} onChange={e => setGroup({ ...group, min_select: e.target.value })} placeholder="min" />
                    <input className="mb-input" value={group.max_select} onChange={e => setGroup({ ...group, max_select: e.target.value })} placeholder="max" />
                    <label className="mb-cb mb-span2"><input type="checkbox" checked={group.required} onChange={e => setGroup({ ...group, required: e.target.checked })} /> {t('Обязательная группа', 'Hökmany topar')}</label>
                    <button className="mb-btn gold mb-span2 boom-focusable" disabled={!group.name_ru.trim() || !group.name_tk.trim() || saving === 'grp'}
                      onClick={() => void run('grp', () => api.createModifierGroup(selectedItem.id, { ...group, branch_id: branchId }), async () => { setGroup({ name_ru: '', name_tk: '', min_select: '0', max_select: '1', required: false, sort_order: '0' }); await loadModifiers(selectedItem.id); })}>
                      {saving === 'grp' ? <Loader2 className="w-3 h-3 animate-spin" /> : t('Создать группу', 'Topar döret')}
                    </button>
                  </div>
                )}

                {groups.map(g => (
                  <div key={g.id} className={`mb-group ${g.status === 'INACTIVE' ? 'archived' : ''}`}>
                    {editGroup?.id === g.id ? (
                      <div className="mb-form-grid">
                        <input className="mb-input mb-span2" value={editGroup.name_ru} onChange={e => setEditGroup({ ...editGroup, name_ru: e.target.value })} />
                        <input className="mb-input mb-span2" value={editGroup.name_tk} onChange={e => setEditGroup({ ...editGroup, name_tk: e.target.value })} />
                        <input className="mb-input" value={String(editGroup.min_select)} onChange={e => setEditGroup({ ...editGroup, min_select: e.target.value })} placeholder="min" />
                        <input className="mb-input" value={String(editGroup.max_select)} onChange={e => setEditGroup({ ...editGroup, max_select: e.target.value })} placeholder="max" />
                        <label className="mb-cb mb-span2"><input type="checkbox" checked={editGroup.required} onChange={e => setEditGroup({ ...editGroup, required: e.target.checked })} /> {t('Обязательная', 'Hökmany')}</label>
                        <div className="mb-form-row mb-span2">
                          <button className="mb-btn gold boom-focusable" disabled={saving === `g${g.id}`} onClick={() => void run(`g${g.id}`, () => api.updateModifierGroup(g.id, editGroup), () => loadModifiers(selectedItem.id).then(() => setEditGroup(null)))}><Check className="w-3 h-3" /></button>
                          <button className="mb-btn boom-focusable" onClick={() => setEditGroup(null)}><X className="w-3 h-3" /></button>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-group-head">
                        <span><b>{g.name_ru}</b> <span className="mb-muted">{g.min_select}–{g.max_select}{g.required ? ` · ${t('обяз.', 'hökm.')}` : ''}</span></span>
                        {g.status === 'INACTIVE' && <span className="mb-chip archived">{t('архив', 'arhiw')}</span>}
                        {canManage && (
                          <span className="mb-actions">
                            <button className="mb-icon boom-focusable" aria-label={t('Изменить группу', 'Topary üýtget')} onClick={() => setEditGroup({ id: g.id, name_ru: g.name_ru, name_tk: g.name_tk, min_select: String(g.min_select), max_select: String(g.max_select), required: Boolean(g.required), status: g.status })}><Pencil className="w-3.5 h-3.5" /></button>
                            {g.status !== 'INACTIVE'
                              ? <button className="mb-icon danger boom-focusable" aria-label={t('Архивировать группу', 'Topary arhiwle')} disabled={saving === `ga${g.id}`} onClick={() => void run(`ga${g.id}`, () => api.archiveModifierGroup(g.id), () => loadModifiers(selectedItem.id))}><Archive className="w-3.5 h-3.5" /></button>
                              : <button className="mb-icon boom-focusable" aria-label={t('Восстановить группу', 'Topary dikeld')} disabled={saving === `gr${g.id}`} onClick={() => void run(`gr${g.id}`, () => api.updateModifierGroup(g.id, { status: 'ACTIVE' }), () => loadModifiers(selectedItem.id))}><RefreshCw className="w-3.5 h-3.5" /></button>}
                          </span>
                        )}
                      </div>
                    )}

                    {(g.modifiers || []).map((m: any) => (
                      <div key={m.id} className={`mb-mod ${m.status === 'INACTIVE' ? 'archived' : ''}`}>
                        {editMod?.id === m.id ? (
                          <div className="mb-form-row grow">
                            <input className="mb-input" value={editMod.name_ru} onChange={e => setEditMod({ ...editMod, name_ru: e.target.value })} />
                            <input className="mb-input" value={editMod.name_tk} onChange={e => setEditMod({ ...editMod, name_tk: e.target.value })} />
                            <input className="mb-input mb-input-sm" value={String(editMod.price_delta)} onChange={e => setEditMod({ ...editMod, price_delta: e.target.value })} inputMode="decimal" />
                            <button className="mb-btn gold boom-focusable" disabled={saving === `m${m.id}`} onClick={() => void run(`m${m.id}`, () => api.updateModifier(m.id, editMod), () => loadModifiers(selectedItem.id).then(() => setEditMod(null)))}><Check className="w-3 h-3" /></button>
                            <button className="mb-btn boom-focusable" onClick={() => setEditMod(null)}><X className="w-3 h-3" /></button>
                          </div>
                        ) : (
                          <>
                            <span>{m.name_ru} <span className="mb-muted">/ {m.name_tk}</span></span>
                            <span className="mb-mod-price">{money(m.price_delta)}</span>
                            {canManage && (
                              <span className="mb-actions">
                                <button className="mb-icon boom-focusable" aria-label={t('Изменить модификатор', 'Modifikatory üýtget')} onClick={() => setEditMod({ id: m.id, name_ru: m.name_ru, name_tk: m.name_tk, price_delta: money(m.price_delta), status: m.status })}><Pencil className="w-3 h-3" /></button>
                                {m.status !== 'INACTIVE'
                                  ? <button className="mb-icon danger boom-focusable" aria-label={t('Архивировать модификатор', 'Modifikatory arhiwle')} disabled={saving === `ma${m.id}`} onClick={() => void run(`ma${m.id}`, () => api.archiveModifier(m.id), () => loadModifiers(selectedItem.id))}><Archive className="w-3 h-3" /></button>
                                  : <button className="mb-icon boom-focusable" aria-label={t('Восстановить модификатор', 'Modifikatory dikeld')} disabled={saving === `mr${m.id}`} onClick={() => void run(`mr${m.id}`, () => api.updateModifier(m.id, { status: 'ACTIVE' }), () => loadModifiers(selectedItem.id))}><RefreshCw className="w-3 h-3" /></button>}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ))}

                    {canManage && (modGroupId === g.id ? (
                      <div className="mb-form-row mb-boxed">
                        <input className="mb-input" value={mod.name_ru} onChange={e => setMod({ ...mod, name_ru: e.target.value })} placeholder={t('Опция RU', 'Warýant RU')} />
                        <input className="mb-input" value={mod.name_tk} onChange={e => setMod({ ...mod, name_tk: e.target.value })} placeholder={t('Опция TK', 'Warýant TK')} />
                        <input className="mb-input mb-input-sm" value={mod.price_delta} onChange={e => setMod({ ...mod, price_delta: e.target.value })} placeholder="+0.00" inputMode="decimal" />
                        <button className="mb-btn gold boom-focusable" disabled={!mod.name_ru.trim() || !mod.name_tk.trim() || saving === `nm${g.id}`}
                          onClick={() => void run(`nm${g.id}`, () => api.createModifier(g.id, mod), async () => { setMod({ name_ru: '', name_tk: '', price_delta: '0', sort_order: '0' }); setModGroupId(''); await loadModifiers(selectedItem.id); })}><Check className="w-3 h-3" /></button>
                        <button className="mb-btn boom-focusable" onClick={() => setModGroupId('')}><X className="w-3 h-3" /></button>
                      </div>
                    ) : <button className="mb-add boom-focusable" onClick={() => setModGroupId(g.id)}>+ {t('Добавить опцию', 'Warýant goş')}</button>)}
                  </div>
                ))}
                {!groups.length && <div className="mb-empty">{t('У блюда нет модификаторов.', 'Naharda modifikator ýok.')}</div>}
              </>
            ) : <div className="mb-empty">{t('Выберите блюдо, чтобы настроить модификаторы и фото.', 'Modifikatorlary sazlamak üçin nahar saýlaň.')}</div>}
          </aside>
        </div>
      ) : (
        /* ================= BURGER CONSTRUCTOR ================= */
        <div className="cmd-panel">
          <div className="cmd-panel-head">
            <div className="cmd-panel-title"><Sandwich /> {t('Бургер-конструктор', 'Burger gurujy')}</div>
            <span className="mb-muted mb-note">{t('Компоненты — это группы модификаторов блюда. Order Core получает реальные modifier_ids.', 'Komponentler — naharyň modifikator toparlary. Order Core hakyky modifier_ids alýar.')}</span>
          </div>
          <div className="mb-form-row">
            <select className="mb-input" value={selectedItem?.id || ''} onChange={e => setSelected(visibleItems.find((i: any) => i.id === e.target.value) || null)}>
              <option value="">{t('— выберите конструируемое блюдо —', '— gurulýan nahary saýlaň —')}</option>
              {visibleItems.filter((i: any) => !isArchived(i)).map((i: any) => <option key={i.id} value={i.id}>{i.name_ru} · {i.sku}</option>)}
            </select>
          </div>
          {selectedItem ? (
            <>
              <div className="mb-base">
                <span className="mb-thumb lg">
                  {selectedItem.media_url
                    ? <img src={selectedItem.media_url} alt={selectedItem.name_ru} className="mb-thumb-img" />
                    : <ImagePlus className="w-5 h-5 text-slate-600" />}
                </span>
                <div>
                  <b className="text-white">{selectedItem.name_ru}</b>
                  <div className="mb-muted">{t('Базовая цена', 'Esasy baha')}: <b className="mb-price">{money(selectedItem.price)}</b> · {t('сервер решает итог', 'jemi serwer kesgitleýär')}</div>
                </div>
              </div>
              <div className="mb-comp-grid">
                {groups.filter(g => g.status !== 'INACTIVE').map(g => (
                  <div key={g.id} className="mb-comp">
                    <div className="mb-comp-head">
                      <b>{g.name_ru}</b>
                      <span className="mb-chip">{g.required ? t('обязательно', 'hökmany') : t('опционально', 'islege bagly')} · {g.min_select}–{g.max_select}</span>
                    </div>
                    {(g.modifiers || []).filter((m: any) => m.status !== 'INACTIVE').map((m: any) => (
                      <div key={m.id} className="mb-comp-opt"><span>{m.name_ru}</span><span className="mb-mod-price">{Number(m.price_delta) > 0 ? `+${money(m.price_delta)}` : money(m.price_delta)}</span></div>
                    ))}
                    {!(g.modifiers || []).filter((m: any) => m.status !== 'INACTIVE').length && <div className="mb-empty">{t('Нет опций', 'Warýant ýok')}</div>}
                  </div>
                ))}
              </div>
              {!groups.filter(g => g.status !== 'INACTIVE').length && (
                <div className="cmd-stale"><AlertTriangle className="inline w-4 h-4 mr-1" />{t('У блюда ещё нет компонентов. Добавьте группы модификаторов во вкладке «Каталог».', 'Naharda entek komponent ýok. «Katalog» bölüminde modifikator toparlaryny goşuň.')}</div>
              )}
            </>
          ) : <div className="mb-empty">{t('Выберите блюдо, чтобы увидеть его компоненты.', 'Komponentleri görmek üçin nahar saýlaň.')}</div>}
        </div>
      )}

      {/* ================= DISH MEDIA PICKER ================= */}
      {mediaFor && (
        <div className="mb-modal" onClick={() => setMediaFor(null)}>
          <div className="mb-modal-body" onClick={e => e.stopPropagation()}>
            <div className="cmd-panel-head">
              <div className="cmd-panel-title"><ImagePlus /> {t('Фото блюда', 'Nahar suraty')}: {mediaFor.name_ru}</div>
              <button className="mb-icon boom-focusable" aria-label={t('Закрыть', 'Ýap')} onClick={() => setMediaFor(null)}><X className="w-4 h-4" /></button>
            </div>
            <p className="mb-muted mb-note">{t('Изображения берутся из Медиа-библиотеки. Одно фото — для ADMIN, POS и клиентского меню.', 'Suratlar Media kitaphanasyndan. Bir surat — ADMIN, POS we müşderi menýusy üçin.')}</p>
            <div className="mb-media-grid">
              <button className={`mb-media-cell boom-focusable ${!mediaFor.media_asset_id ? 'selected' : ''}`} disabled={saving === 'media'}
                onClick={() => void run('media', () => api.updateMenuItem(mediaFor.id, { media_asset_id: null }), () => setMediaFor(null))}>
                <span className="mb-media-none"><X className="w-4 h-4" /> {t('Без фото', 'Suratsyz')}</span>
              </button>
              {assets.map(a => (
                <button key={a.id} className={`mb-media-cell boom-focusable ${mediaFor.media_asset_id === a.id ? 'selected' : ''}`} disabled={saving === 'media'}
                  onClick={() => void run('media', () => api.updateMenuItem(mediaFor.id, { media_asset_id: a.id }), () => setMediaFor(null))}>
                  {a.kind === 'VIDEO'
                    ? <video src={a.url} poster={a.poster_url || undefined} muted className="mb-media-img" />
                    : <img src={a.url} alt={a.alt_ru || a.name} className="mb-media-img" />}
                  <span className="mb-media-name">{a.name}</span>
                </button>
              ))}
            </div>
            {!assets.length && <div className="mb-empty"><Tag className="inline w-4 h-4 mr-1" />{t('Медиа-библиотека пуста — загрузите файл в разделе «Медиа-библиотека».', 'Media kitaphanasy boş — «Media kitaphanasy» bölüminde ýükläň.')}</div>}
          </div>
        </div>
      )}
    </div>
  );
};
