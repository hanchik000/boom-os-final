import React, { useCallback, useEffect, useState } from 'react';
import { Layers3, Plus, Power, Trash2, ArrowUp, ArrowDown, Eye, Pencil, Check, X, Loader2, RotateCcw, Palette } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Visual Catalog / Banners administration (Stage 35.3 engine, completed in Stage 36).
//
// This composes the VISUAL layer only. Categories, dishes, prices and availability stay in the
// Menu Engine; a block can point AT a category or a dish but never carries a price, a stock
// figure or a discount of its own. BANNER, HERO, PROMOTION, CATEGORY, NEW_ITEMS and SPACER are
// the same block table with a different `type` -- there is no separate banner engine.
//
// Stage 36 adds what the create-only form left unreachable: editing an existing block (all of
// title/subtitle RU+TK, media, link target, channels, schedule, sort order, priority), and
// showing deactivated blocks so they can be brought back instead of re-created. Every write goes
// through the existing PATCH/DELETE routes (visual_catalog.manage + VISUAL_CATALOG_BLOCK_*
// audit); DELETE remains the existing soft deactivation.
// ---------------------------------------------------------------------------------------------

// Stage 39: the section vocabulary. REFERENCE_TYPES own no content of their own -- the editor
// hides their text/media fields entirely, because the server refuses to store them.
const TYPES = ['HERO', 'BANNER', 'TEXT', 'MEDIA', 'CTA', 'CATEGORY', 'MENU_ITEM', 'PROMOTION', 'NEW_ITEMS', 'SPACER'];
const REFERENCE_TYPES = ['MENU_ITEM', 'CATEGORY', 'PROMOTION'];
const PRESET_OPTIONS: Record<string, string[]> = {
  card_style: ['STANDARD', 'PREMIUM', 'COMPACT', 'IMAGE_FIRST'],
  density: ['COMPACT', 'NORMAL', 'SPACIOUS'],
  image_ratio: ['SQUARE', 'PORTRAIT', 'LANDSCAPE', 'WIDE', 'AUTO'],
  overlay: ['NONE', 'SOFT', 'STRONG'],
  alignment: ['LEFT', 'CENTER'],
};
// Stage 35.6: which customer-menu channels this block appears on. Empty = every channel.
const CHANNELS = ['ONLINE', 'QR', 'LOCAL', 'OFFLINE'];

const EMPTY = {
  type: 'BANNER', title_ru: '', title_tk: '', title_en: '', subtitle_ru: '', subtitle_tk: '', subtitle_en: '',
  cta_label_ru: '', cta_label_tk: '', cta_label_en: '',
  card_style: '', density: '', image_ratio: '', overlay: '', alignment: '',
  media_url: '', media_kind: 'IMAGE', media_asset_id: '', link_type: 'NONE',
  category_id: '', menu_item_id: '', external_url: '', sort_order: 0, priority: 0,
  active: true, schedule_start: '', schedule_end: '', channels: [] as string[],
};

const parseChannels = (v: any): string[] =>
  Array.isArray(v) ? v.map(String) : String(v || '').split(',').map(s => s.trim()).filter(Boolean);

const toForm = (b: any) => ({
  ...EMPTY,
  type: String(b.type || 'BANNER'),
  title_ru: b.title_ru || '', title_tk: b.title_tk || '', title_en: b.title_en || '',
  subtitle_ru: b.subtitle_ru || '', subtitle_tk: b.subtitle_tk || '', subtitle_en: b.subtitle_en || '',
  cta_label_ru: b.cta_label_ru || '', cta_label_tk: b.cta_label_tk || '', cta_label_en: b.cta_label_en || '',
  card_style: b.card_style || '', density: b.density || '', image_ratio: b.image_ratio || '',
  overlay: b.overlay || '', alignment: b.alignment || '',
  media_url: b.media_url || '', media_kind: b.media_kind || 'IMAGE',
  media_asset_id: b.media_asset_id || '',
  link_type: String(b.link_type || 'NONE'),
  category_id: b.category_id || '', menu_item_id: b.menu_item_id || '',
  external_url: b.external_url || '',
  sort_order: Number(b.sort_order || 0), priority: Number(b.priority || 0),
  active: Boolean(b.active),
  schedule_start: b.schedule_start ? String(b.schedule_start).slice(0, 16) : '',
  schedule_end: b.schedule_end ? String(b.schedule_end).slice(0, 16) : '',
  channels: parseChannels(b.channels),
});

export const VisualCatalogView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const t = (r: string, k: string) => (ru ? r : k);

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [blocks, setBlocks] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({ ...EMPTY });
  // Stage 39: the page-level design of this branch's Customer Menu.
  const [design, setDesign] = useState<any>(null);
  const [designPresets, setDesignPresets] = useState<Record<string, string[]>>({});
  const can = hasPermission('visual_catalog.manage');

  const load = useCallback(async () => {
    if (!branchId) return;
    setBusy(true);
    try {
      const r = await api.getVisualCatalog(branchId);
      setBlocks(r.blocks || []); setCategories(r.categories || []); setItems(r.items || []);
      setAssets((await api.getMediaAssets(branchId)).assets || []);
      const d = await api.getSiteDesign(branchId);
      setDesign(d.design); setDesignPresets(d.presets || {});
      setError('');
    } catch (e: any) { setError(e?.message || t('Не удалось загрузить каталог.', 'Katalog ýüklenmedi.')); }
    finally { setBusy(false); }
  }, [branchId, ru]);

  useEffect(() => {
    api.getBranches({ status: 'ACTIVE' })
      .then(r => { setBranches(r.branches || []); if (r.branches?.[0]) setBranchId(b => b || r.branches[0].id); })
      .catch(() => undefined);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, fn: () => Promise<any>) => {
    setSaving(id); setError('');
    try { await fn(); await load(); return true; }
    catch (e: any) { setError(e?.message || t('Операция не выполнена.', 'Amal ýerine ýetirilmedi.')); return false; }
    finally { setSaving(''); }
  };

  // The payload is identical for create and update, so a block never loses a field on edit.
  // A reference section sends NO content of its own. The server refuses it anyway (that is the
  // source-of-truth rule), but the editor does not even offer it, so the two never disagree.
  const payload = (f: any) => {
    const isRef = REFERENCE_TYPES.includes(f.type);
    return ({
    type: f.type,
    title_ru: isRef ? null : (f.title_ru.trim() || null), title_tk: isRef ? null : (f.title_tk.trim() || null), title_en: isRef ? null : (f.title_en.trim() || null),
    subtitle_ru: isRef ? null : (f.subtitle_ru.trim() || null), subtitle_tk: isRef ? null : (f.subtitle_tk.trim() || null), subtitle_en: isRef ? null : (f.subtitle_en.trim() || null),
    cta_label_ru: isRef ? null : (f.cta_label_ru.trim() || null), cta_label_tk: isRef ? null : (f.cta_label_tk.trim() || null), cta_label_en: isRef ? null : (f.cta_label_en.trim() || null),
    card_style: f.card_style || null, density: f.density || null, image_ratio: f.image_ratio || null,
    overlay: f.overlay || null, alignment: f.alignment || null,
    media_asset_id: isRef ? null : (f.media_asset_id || null),
    media_url: isRef || f.media_asset_id ? null : (f.media_url.trim() || null),
    media_kind: isRef ? null : (f.media_kind || null),
    link_type: f.link_type,
    category_id: f.link_type === 'CATEGORY' ? (f.category_id || null) : null,
    menu_item_id: f.link_type === 'ITEM' ? (f.menu_item_id || null) : null,
    external_url: f.link_type === 'EXTERNAL' ? (f.external_url.trim() || null) : null,
    sort_order: Number(f.sort_order) || 0,
    priority: Number(f.priority) || 0,
    active: Boolean(f.active),
    schedule_start: f.schedule_start ? new Date(f.schedule_start).toISOString() : null,
    schedule_end: f.schedule_end ? new Date(f.schedule_end).toISOString() : null,
    channels: f.channels,
  }); };

  const create = async () => {
    const okDone = await run('new', () => api.createVisualCatalogBlock({ ...payload(form), branch_id: branchId }));
    if (okDone) setForm({ ...EMPTY, type: form.type });
  };

  const saveEdit = async (b: any) => {
    const okDone = await run(b.id, () => api.updateVisualCatalogBlock(b.id, payload(editForm)));
    if (okDone) { setEditing(null); setEditForm({ ...EMPTY }); }
  };

  // Stage 39: ordering is PERSISTED SERVER-SIDE as one ordered list. The guest menu renders the
  // order this call stores; the browser never decides it. Sending the whole list makes a reorder
  // one atomic intent instead of two racing PATCHes.
  const move = async (list: any[], b: any, delta: number) => {
    const i = list.findIndex(x => x.id === b.id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    await run(b.id, () => api.reorderVisualCatalog(branchId, next.map(x => x.id)));
  };

  if (!hasPermission('visual_catalog.view')) {
    return <div className="p-8 text-slate-400">{t('Нет доступа к визуальному каталогу.', 'Wizual katalog elýeterli däl.')}</div>;
  }

  const visible = blocks
    .filter(b => showInactive || b.active)
    .sort((a, b) => (b.priority - a.priority) || (a.sort_order - b.sort_order));

  // The editable field set, reused verbatim for "create" and for "edit" so the two can never drift.
  const fields = (f: any, set: (next: any) => void, idPrefix: string) => (
    <>
      <div className="mb-form-grid">
        <select className="mb-input" value={f.type} onChange={e => set({ ...f, type: e.target.value })} aria-label={t('Тип блока', 'Blok görnüşi')}>
          {TYPES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        {REFERENCE_TYPES.includes(f.type) && (
          <span className="mb-muted mb-note mb-span2">
            {t('Секция-ссылка: название, описание, цена и фото берутся из Menu Engine. Здесь их задать нельзя — так не возникает второй источник правды.',
               'Salgylanýan bölüm: at, beýan, baha we surat Menu Engine-den alynýar.')}
          </span>
        )}
        {!REFERENCE_TYPES.includes(f.type) && (
          <select className="mb-input" value={f.media_asset_id} onChange={e => set({ ...f, media_asset_id: e.target.value, media_kind: assets.find(a => a.id === e.target.value)?.kind || f.media_kind })} aria-label={t('Медиа', 'Media')}>
            <option value="">{t('Медиа из библиотеки', 'Kitaphanadan media')}</option>
            {assets.filter(a => a.active).map(a => <option key={a.id} value={a.id}>{a.kind} · {a.name}</option>)}
          </select>
        )}
        {!REFERENCE_TYPES.includes(f.type) && <input className="mb-input" id={`${idPrefix}-title-ru`} placeholder="Title RU" value={f.title_ru} onChange={e => set({ ...f, title_ru: e.target.value })} aria-label="Title RU" />}
        {!REFERENCE_TYPES.includes(f.type) && <input className="mb-input" id={`${idPrefix}-title-tk`} placeholder="Title TK" value={f.title_tk} onChange={e => set({ ...f, title_tk: e.target.value })} aria-label="Title TK" />}
        {!REFERENCE_TYPES.includes(f.type) && <input className="mb-input" placeholder="Subtitle RU" value={f.subtitle_ru} onChange={e => set({ ...f, subtitle_ru: e.target.value })} aria-label="Subtitle RU" />}
        {!REFERENCE_TYPES.includes(f.type) && <input className="mb-input" placeholder="Subtitle TK" value={f.subtitle_tk} onChange={e => set({ ...f, subtitle_tk: e.target.value })} aria-label="Subtitle TK" />}
        <select className="mb-input" value={f.link_type} onChange={e => set({ ...f, link_type: e.target.value })} aria-label={t('Ссылка', 'Salgy')}>
          <option value="NONE">{t('Без ссылки', 'Salgysyz')}</option>
          <option value="CATEGORY">{t('Категория', 'Kategoriýa')}</option>
          <option value="ITEM">{t('Блюдо', 'Nahar')}</option>
          <option value="EXTERNAL">{t('Внешняя ссылка', 'Daşarky salgy')}</option>
        </select>
        {f.link_type === 'CATEGORY' && (
          <select className="mb-input" value={f.category_id} onChange={e => set({ ...f, category_id: e.target.value })} aria-label={t('Категория', 'Kategoriýa')}>
            <option value="">{t('— категория —', '— kategoriýa —')}</option>
            {categories.map(c => <option key={c.id} value={c.id}>{ru ? c.name_ru : c.name_tk}</option>)}
          </select>
        )}
        {f.link_type === 'ITEM' && (
          <select className="mb-input" value={f.menu_item_id} onChange={e => set({ ...f, menu_item_id: e.target.value })} aria-label={t('Блюдо', 'Nahar')}>
            <option value="">{t('— блюдо —', '— nahar —')}</option>
            {items.map(i => <option key={i.id} value={i.id}>{ru ? i.name_ru : i.name_tk}</option>)}
          </select>
        )}
        {f.link_type === 'EXTERNAL' && (
          <input className="mb-input" placeholder="https://…" value={f.external_url} onChange={e => set({ ...f, external_url: e.target.value })} aria-label={t('Внешняя ссылка', 'Daşarky salgy')} />
        )}
        <input className="mb-input" type="number" value={f.sort_order} onChange={e => set({ ...f, sort_order: e.target.value })} placeholder={t('Порядок', 'Tertip')} aria-label={t('Порядок', 'Tertip')} />
        <input className="mb-input" type="number" value={f.priority} onChange={e => set({ ...f, priority: e.target.value })} placeholder={t('Приоритет', 'Prioritet')} aria-label={t('Приоритет', 'Prioritet')} />
        <input className="mb-input" type="datetime-local" value={f.schedule_start} onChange={e => set({ ...f, schedule_start: e.target.value })} aria-label={t('Показ с', 'Görkeziş başy')} />
        <input className="mb-input" type="datetime-local" value={f.schedule_end} onChange={e => set({ ...f, schedule_end: e.target.value })} aria-label={t('Показ до', 'Görkeziş soňy')} />
        {!REFERENCE_TYPES.includes(f.type) && <>
          <input className="mb-input" placeholder="Title EN" value={f.title_en} onChange={e => set({ ...f, title_en: e.target.value })} aria-label="Title EN" />
          <input className="mb-input" placeholder="Subtitle EN" value={f.subtitle_en} onChange={e => set({ ...f, subtitle_en: e.target.value })} aria-label="Subtitle EN" />
          <input className="mb-input" placeholder={t('Кнопка RU', 'Düwme RU')} value={f.cta_label_ru} onChange={e => set({ ...f, cta_label_ru: e.target.value })} aria-label="CTA RU" />
          <input className="mb-input" placeholder={t('Кнопка TK', 'Düwme TK')} value={f.cta_label_tk} onChange={e => set({ ...f, cta_label_tk: e.target.value })} aria-label="CTA TK" />
          <input className="mb-input mb-span2" placeholder="CTA EN" value={f.cta_label_en} onChange={e => set({ ...f, cta_label_en: e.target.value })} aria-label="CTA EN" />
        </>}
        {/* Appearance presets. Empty means "inherit the page design" -- every value is one the
            server validates against a closed set, so no style string can ever be stored. */}
        {Object.entries(PRESET_OPTIONS).map(([key, opts]) => (
          <select key={key} className="mb-input" value={f[key] || ''} onChange={e => set({ ...f, [key]: e.target.value })} aria-label={key}>
            <option value="">{key} · {t('как на странице', 'sahypadaky ýaly')}</option>
            {opts.map(o => <option key={o} value={o}>{key}: {o}</option>)}
          </select>
        ))}
      </div>
      <div className="mb-form-row" style={{ marginTop: 8 }}>
        <span className="mb-muted mb-note">{t('Каналы (пусто = везде)', 'Kanallar (boş = hemme ýerde)')}</span>
        {CHANNELS.map(c => (
          <label key={c} className="mb-cb">
            <input type="checkbox" checked={f.channels.includes(c)} onChange={() => set({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x: string) => x !== c) : [...f.channels, c] })} />
            {c}
          </label>
        ))}
        <label className="mb-cb">
          <input type="checkbox" checked={f.active} onChange={() => set({ ...f, active: !f.active })} />
          {t('Активен', 'Işjeň')}
        </label>
      </div>
    </>
  );

  return (
    <div className="cmd-center">
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title"><Layers3 className="inline w-5 h-5 text-amber-400 mr-2" />{t('ВИЗУАЛЬНЫЙ КАТАЛОГ И БАННЕРЫ', 'WIZUAL KATALOG WE BANNERLER')}</h1>
          <p className="cmd-subtitle">{t('Композиция управляет только визуальным слоем. Меню, цены и доступность остаются в Menu Engine.', 'Kompozisiýa diňe wizual gatlagy dolandyrýar. Menýu, bahalar we elýeterlilik Menu Engine-de galýar.')}</p>
        </div>
        <div className="cmd-toolbar">
          <select className="mb-input" style={{ maxWidth: 240 }} value={branchId} onChange={e => setBranchId(e.target.value)} aria-label={t('Филиал', 'Şahamça')}>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
          </select>
          <label className="mb-cb">
            <input type="checkbox" checked={showInactive} onChange={() => setShowInactive(v => !v)} />
            {t('Показать выключенные', 'Öçürilenleri görkez')}
          </label>
          <button className="cmd-refresh-btn boom-focusable" disabled={busy} onClick={() => void load()} aria-label={t('Обновить', 'Täzele')}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('Обновить', 'Täzele')}
          </button>
        </div>
      </div>

      {error && <div className="cmd-error">{error}</div>}
      {!can && <div className="cmd-stale">{t('Режим просмотра: изменение каталога требует права visual_catalog.manage.', 'Diňe görmek: katalogy üýtgetmek visual_catalog.manage rugsadyny talap edýär.')}</div>}

      {/* ---------------- Stage 39: the page-level design of the Customer Menu ----------------
          Presets only. There is no field here that could hold CSS, HTML or a script -- the server
          validates every value against a closed set, so this editor is not an injection surface. */}
      <div className="cmd-panel">
        <div className="cmd-panel-title"><Palette className="w-4 h-4" /> {t('Дизайн сайта (внешний вид меню гостя)', 'Sahypanyň dizaýny')}</div>
        {design ? (
          <>
            <div className="mb-form-grid">
              {Object.entries(designPresets).map(([key, opts]) => (
                <select key={key} className="mb-input" value={design[key] || ''} disabled={!can}
                  onChange={e => setDesign({ ...design, [key]: e.target.value })} aria-label={`design ${key}`}>
                  {(opts as string[]).map(o => <option key={o} value={o}>{key}: {o}</option>)}
                </select>
              ))}
              <label className="mb-cb mb-span2">
                <input type="checkbox" checked={Boolean(design.show_hero)} disabled={!can} onChange={e => setDesign({ ...design, show_hero: e.target.checked })} />
                {t('Показывать hero-секцию', 'Hero bölümini görkez')}
              </label>
            </div>
            <p className="mb-muted mb-note" style={{ marginTop: 6 }}>
              {t('Дизайн управляет только внешним видом. Названия, цены и фото блюд приходят из Menu Builder.',
                 'Dizaýn diňe daşky görnüşi dolandyrýar. Atlar, bahalar we suratlar Menu Builder-den gelýär.')}
            </p>
            {can && (
              <div className="mb-form-row" style={{ marginTop: 10 }}>
                <button className="mb-btn gold boom-focusable" disabled={saving === 'design'} onClick={() => void run('design', () => api.updateSiteDesign(branchId, design))}>
                  {saving === 'design' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить дизайн', 'Dizaýny ýatda sakla')}
                </button>
              </div>
            )}
          </>
        ) : <div className="mb-empty">{t('Загрузка дизайна…', 'Dizaýn ýüklenýär…')}</div>}
      </div>

      {can && (
        <div className="cmd-panel">
          <div className="cmd-panel-title"><Plus className="w-4 h-4" /> {t('Добавить блок', 'Blok goş')}</div>
          {fields(form, setForm, 'vc-new')}
          <div className="mb-form-row" style={{ marginTop: 10 }}>
            <button className="mb-btn gold boom-focusable" disabled={saving === 'new'} onClick={() => void create()}>
              {saving === 'new' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} {t('Добавить', 'Goş')}
            </button>
          </div>
        </div>
      )}

      <div className="cmd-panel">
        <div className="cmd-panel-title">{t('Блоки каталога', 'Katalog bloklary')} · {visible.length}</div>
        <div className="space-y-3">
          {visible.map((b, i) => (
            <div key={b.id} className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-4 ${b.active ? '' : 'opacity-60'}`}>
              <div className="flex gap-4 items-center">
                <div className="w-28 h-20 rounded-xl bg-slate-950 overflow-hidden shrink-0 flex items-center justify-center">
                  {(b.asset_url || b.media_url)
                    ? <img src={b.asset_url || b.media_url} alt="" className="w-full h-full object-cover" style={{ objectPosition: `${b.asset_focal_x ?? 50}% ${b.asset_focal_y ?? 50}%` }} />
                    : <Layers3 className="w-7 h-7 text-slate-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-amber-400">{b.type}</span>
                    <span className="text-[10px] text-slate-600">#{b.sort_order} · prio {b.priority}</span>
                    {!b.active && <span className="mb-chip archived">{t('ВЫКЛ', 'ÖÇÜK')}</span>}
                  </div>
                  <div className="text-white font-bold truncate">{(ru ? b.title_ru : b.title_tk) || b.type}</div>
                  <div className="text-[11px] text-slate-500 truncate">{(ru ? b.subtitle_ru : b.subtitle_tk) || '—'}</div>
                  <div className="text-[11px] text-slate-500">
                    {b.link_type}{parseChannels(b.channels).length ? ` · ${parseChannels(b.channels).join(', ')}` : ` · ${t('все каналы', 'ähli kanallar')}`}
                    {b.schedule_start || b.schedule_end ? ` · ${t('по расписанию', 'tertip boýunça')}` : ''}
                  </div>
                </div>
                {can && (
                  <div className="mb-actions">
                    <button className="mb-icon boom-focusable" aria-label={t('Вверх', 'Ýokary')} onClick={() => void move(visible, b, -1)} disabled={i === 0 || saving === b.id}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button className="mb-icon boom-focusable" aria-label={t('Вниз', 'Aşak')} onClick={() => void move(visible, b, 1)} disabled={i === visible.length - 1 || saving === b.id}><ArrowDown className="w-3.5 h-3.5" /></button>
                    <button className="mb-icon boom-focusable" aria-label={t('Изменить', 'Üýtget')} onClick={() => { setEditing(editing === b.id ? null : b.id); setEditForm(toForm(b)); }}><Pencil className="w-3.5 h-3.5" /></button>
                    <button className="mb-icon boom-focusable" aria-label={b.active ? t('Выключить', 'Öçür') : t('Включить', 'Aç')} disabled={saving === b.id} onClick={() => void run(b.id, () => api.updateVisualCatalogBlock(b.id, { active: !b.active }))}><Power className="w-3.5 h-3.5" /></button>
                    {b.active && <button className="mb-icon danger boom-focusable" aria-label={t('Деактивировать', 'Deaktiwle')} disabled={saving === b.id} onClick={() => void run(b.id, () => api.deactivateVisualCatalogBlock(b.id))}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                )}
              </div>
              {can && editing === b.id && (
                <div className="mb-boxed">
                  {fields(editForm, setEditForm, `vc-${b.id}`)}
                  <div className="mb-form-row" style={{ marginTop: 10 }}>
                    <button className="mb-btn gold boom-focusable" disabled={saving === b.id} onClick={() => void saveEdit(b)}>
                      {saving === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить', 'Ýatda sakla')}
                    </button>
                    <button className="mb-btn boom-focusable" onClick={() => setEditing(null)}><X className="w-3 h-3" /> {t('Отмена', 'Ýatyr')}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!visible.length && !busy && (
            <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500">
              {t('Добавьте первый блок визуального каталога.', 'Ilkinji wizual katalog blokyny goşuň.')}
            </div>
          )}
        </div>
      </div>

      <div className="cmd-panel" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Eye className="w-4 h-4 text-amber-400 shrink-0" style={{ marginTop: 2 }} />
        <p className="cmd-subtitle" style={{ margin: 0 }}>
          {t('Публичный каталог использует реальные категории и блюда выбранного филиала. Визуальные блоки не создают цены, товары или заказы.', 'Jemgyýet katalogy saýlanan şahamçanyň hakyky kategoriýalaryny we naharlaryny ulanýar. Wizual bloklar baha, haryt ýa-da sargyt döretmeýär.')}
        </p>
      </div>
    </div>
  );
};
