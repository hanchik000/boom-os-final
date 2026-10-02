import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X, Loader2, ImagePlus, Trash2, Rotate3d, Film, Info, Languages, Scale, Images, ChefHat } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { ConfirmDialog } from './ui';

// ---------------------------------------------------------------------------------------------
// Stage 37 -- the full dish editor.
//
// Stage 36's inline row editor could only reach name/price/sort/status, which is not enough to
// run a real menu. This is the whole customer-facing dish record in one place: RU/TK/EN content,
// structured weight, public ingredients, allergens and media.
//
// Two rules this file keeps:
//  1. It never computes a business value. Price and weight are sent as typed and echoed back as
//     the server stored them; there is no arithmetic in this component at all.
//  2. Public information is public. Allergens and ingredients here are the CUSTOMER-facing ones;
//     the recipe (ingredient quantities, cost, suppliers, stock) lives in the Recipe Engine and
//     is never read, written or displayed from this screen.
// ---------------------------------------------------------------------------------------------

const WEIGHT_UNITS = ['G', 'KG', 'ML', 'L', 'PCS'];
type Section = 'general' | 'public' | 'media' | 'kitchen';

export interface DishDraft {
  id: string;
  name_ru: string; name_tk: string; name_en: string;
  description_ru: string; description_tk: string; description_en: string;
  ingredients_ru: string; ingredients_tk: string; ingredients_en: string;
  weight_value: string; weight_unit: string;
  price: string; sort_order: string; status: string; category_id: string;
  media_asset_id: string | null;
  allergen_ids: string[];
  gallery_media_ids: string[];
}

// Postgres returns numerics unpadded ("95", "320.500"); this only formats for the eye.
const dec = (v: any, places = 2) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(places) : ''; };

export function toDishDraft(i: any): DishDraft {
  return {
    id: i.id,
    name_ru: i.name_ru || '', name_tk: i.name_tk || '', name_en: i.name_en || '',
    description_ru: i.description_ru || '', description_tk: i.description_tk || '', description_en: i.description_en || '',
    ingredients_ru: i.ingredients_ru || '', ingredients_tk: i.ingredients_tk || '', ingredients_en: i.ingredients_en || '',
    weight_value: i.weight_value === null || i.weight_value === undefined ? '' : String(Number(i.weight_value)),
    weight_unit: i.weight_unit || 'G',
    price: dec(i.price), sort_order: String(i.sort_order ?? 0), status: i.status || 'ACTIVE',
    category_id: i.category_id || '',
    media_asset_id: i.media_asset_id || null,
    allergen_ids: (i.allergens || []).map((a: any) => a.id),
    gallery_media_ids: (i.gallery || []).map((g: any) => g.id),
  };
}

interface Props {
  draft: DishDraft;
  assets: any[];
  categories: any[];
  /** Stage 42: the branch whose kitchen stations this dish can be routed to. */
  branchId?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export const MenuDishEditor: React.FC<Props> = ({ draft: initial, assets, categories, branchId: branchOfDish, onClose, onSaved }) => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const t = (r: string, k: string) => (ru ? r : k);

  const [d, setD] = useState<DishDraft>(initial);
  const [section, setSection] = useState<Section>('general');
  const [allergens, setAllergens] = useState<any[]>([]);
  // Stage 42: which station cooks this dish and how long it should take. This is CONFIGURATION of
  // the dish, so it lives in the dish editor rather than in a separate kitchen admin screen.
  const [stations, setStations] = useState<any[]>([]);
  const [routes, setRoutes] = useState<Array<{ station_id: string; standard_minutes: string; tolerance_minutes: string; is_secondary: boolean }>>([]);
  const [routesLoaded, setRoutesLoaded] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeSaved, setRouteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canManage = hasPermission('menu.manage');
  const set = <K extends keyof DishDraft>(k: K, v: DishDraft[K]) => setD(p => ({ ...p, [k]: v }));

  useEffect(() => { api.getAllergens().then(r => setAllergens(r.allergens || [])).catch(() => setAllergens([])); }, []);

  const byId = useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const gallery = d.gallery_media_ids.map(id => byId.get(id)).filter(Boolean);

  // The server validates weight as an inseparable pair; say so before the round trip.
  const weightIssue = d.weight_value.trim() !== '' && !(Number(d.weight_value) > 0)
    ? t('Вес должен быть положительным числом.', 'Agram položitel san bolmaly.')
    : '';

  const save = useCallback(async () => {
    if (weightIssue) { setError(weightIssue); return; }
    setSaving(true); setError('');
    try {
      await api.updateMenuItem(d.id, {
        name_ru: d.name_ru, name_tk: d.name_tk, name_en: d.name_en,
        description_ru: d.description_ru, description_tk: d.description_tk, description_en: d.description_en,
        ingredients_ru: d.ingredients_ru, ingredients_tk: d.ingredients_tk, ingredients_en: d.ingredients_en,
        // Sending an empty value clears BOTH halves server-side, which is why the unit rides along.
        weight_value: d.weight_value.trim() === '' ? null : d.weight_value,
        weight_unit: d.weight_unit,
        price: d.price, sort_order: d.sort_order, status: d.status,
        // Stage 39: moving a dish between categories is Menu CONTENT, edited here -- never by
        // editing a Visual Catalog section.
        category_id: d.category_id || undefined,
        media_asset_id: d.media_asset_id,
        allergen_ids: d.allergen_ids,
        gallery_media_ids: d.gallery_media_ids,
      });
      await onSaved();
      onClose();
    } catch (e: any) { setError(e?.message || t('Не удалось сохранить блюдо.', 'Nahar ýatda saklanmady.')); }
    finally { setSaving(false); }
  }, [d, weightIssue, onSaved, onClose, ru]);

  // Stage 41: unsaved changes are no longer thrown away silently. Clicking outside the editor, the
  // close control or Cancel used to discard everything typed, with no warning -- on a form that can
  // hold a whole dish record. The dirty check compares against the draft this editor opened with.
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(initial), [d, initial]);
  const [confirmExit, setConfirmExit] = useState(false);
  const requestClose = useCallback(() => { if (dirty) { setConfirmExit(true); } else { onClose(); } }, [dirty, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    if (section !== 'kitchen' || routesLoaded || !d.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const branchId = branchOfDish;
        const [st, rt] = await Promise.all([
          branchId ? api.getKitchenStations(branchId) : Promise.resolve({ stations: [] as any[] }),
          branchId ? api.getKitchenRoutes(branchId) : Promise.resolve({ item_routes: [] as any[], category_routes: [] as any[] }),
        ]);
        if (cancelled) return;
        setStations((st.stations || []).filter((x: any) => !x.is_expo));
        setRoutes((rt.item_routes || []).filter((r: any) => r.menu_item_id === d.id).map((r: any) => ({
          station_id: r.station_id, standard_minutes: String(Number(r.standard_minutes)), tolerance_minutes: String(Number(r.tolerance_minutes)), is_secondary: Boolean(r.is_secondary),
        })));
      } catch { /* the editor still works without the kitchen configuration */ }
      finally { if (!cancelled) setRoutesLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [section, routesLoaded, d.id, branchOfDish]);

  const saveRoutes = useCallback(async () => {
    if (routeBusy) return;
    setRouteBusy(true); setError(''); setRouteSaved(false);
    try {
      await api.setKitchenItemRoutes(d.id, routes.map(r => ({
        station_id: r.station_id, standard_minutes: Number(r.standard_minutes), tolerance_minutes: Number(r.tolerance_minutes), is_secondary: r.is_secondary,
      })));
      setRouteSaved(true);
    } catch (e: any) { setError(e?.message || t('Не удалось сохранить настройки кухни.', 'Aşhana sazlamalary saklanmady.')); }
    finally { setRouteBusy(false); }
  }, [routes, d.id, routeBusy, t]);

  const tab = (id: Section, icon: React.ReactNode, label: string) => (
    <button className={`mb-btn boom-focusable ${section === id ? 'gold' : ''}`} onClick={() => setSection(id)}>{icon} {label}</button>
  );

  return (
    <div className="mb-modal" onClick={requestClose}>
      <div className="mb-modal-body" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('Редактор блюда', 'Nahar redaktory')}>
        <div className="cmd-panel-head">
          <div className="cmd-panel-title">{d.name_ru || t('Блюдо', 'Nahar')}</div>
          <button className="mb-icon boom-focusable" aria-label={t('Закрыть', 'Ýap')} onClick={requestClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="mb-form-row" style={{ marginBottom: 10 }}>
          {tab('general', <Languages className="w-3.5 h-3.5" />, t('Основное', 'Esasy'))}
          {tab('public', <Info className="w-3.5 h-3.5" />, t('Публичная информация', 'Jemgyýetçilik maglumaty'))}
          {tab('media', <Images className="w-3.5 h-3.5" />, t('Медиа', 'Media'))}
          {tab('kitchen', <ChefHat className="w-3.5 h-3.5" />, t('Кухня', 'Aşhana'))}
        </div>

        {error && <div className="cmd-error">{error}</div>}
        {!canManage && <div className="cmd-stale">{t('Режим просмотра: изменение меню требует права menu.manage.', 'Diňe görmek: menýuny üýtgetmek menu.manage rugsadyny talap edýär.')}</div>}

        {section === 'general' && (
          <div className="mb-form-grid">
            <input className="mb-input" value={d.name_ru} onChange={e => set('name_ru', e.target.value)} placeholder={t('Название RU', 'Ady RU')} aria-label="name RU" />
            <input className="mb-input" value={d.name_tk} onChange={e => set('name_tk', e.target.value)} placeholder={t('Название TK', 'Ady TK')} aria-label="name TK" />
            <input className="mb-input mb-span2" id="dish-name-en" value={d.name_en} onChange={e => set('name_en', e.target.value)} placeholder={t('Название EN (необязательно — иначе показывается RU)', 'Ady EN (hökman däl — bolmasa RU görkezilýär)')} aria-label="name EN" />
            <input className="mb-input mb-span2" value={d.description_ru} onChange={e => set('description_ru', e.target.value)} placeholder={t('Описание RU', 'Beýany RU')} aria-label="description RU" />
            <input className="mb-input mb-span2" value={d.description_tk} onChange={e => set('description_tk', e.target.value)} placeholder={t('Описание TK', 'Beýany TK')} aria-label="description TK" />
            <input className="mb-input mb-span2" value={d.description_en} onChange={e => set('description_en', e.target.value)} placeholder={t('Описание EN', 'Beýany EN')} aria-label="description EN" />
            <input className="mb-input" value={d.price} onChange={e => set('price', e.target.value)} placeholder={t('Цена', 'Baha')} inputMode="decimal" aria-label={t('Цена', 'Baha')} />
            <input className="mb-input" value={d.sort_order} onChange={e => set('sort_order', e.target.value)} placeholder="#" aria-label={t('Порядок', 'Tertip')} />
            <select className="mb-input mb-span2" value={d.category_id} onChange={e => set('category_id', e.target.value)} aria-label={t('Категория', 'Kategoriýa')}>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name_ru}</option>)}
            </select>
            <select className="mb-input mb-span2" value={d.status} onChange={e => set('status', e.target.value)} aria-label={t('Статус', 'Ýagdaý')}>
              <option value="ACTIVE">{t('В продаже', 'Satuwda')}</option>
              <option value="INACTIVE">{t('Снято с продажи (архив)', 'Satuwdan aýryldy (arhiw)')}</option>
            </select>
            <p className="mb-muted mb-note mb-span2">{t('Цену принимает и проверяет сервер. Итог заказа считается только на сервере.', 'Bahany serwer kabul edýär we barlaýar. Sargydyň jemi diňe serwerde hasaplanýar.')}</p>
          </div>
        )}

        {section === 'public' && (
          <>
            <div className="mb-form-grid">
              <div className="mb-form-row mb-span2">
                <Scale className="w-3.5 h-3.5 text-amber-400" />
                <input className="mb-input mb-input-sm" value={d.weight_value} onChange={e => set('weight_value', e.target.value)} placeholder={t('Вес', 'Agram')} inputMode="decimal" aria-label={t('Вес', 'Agram')} />
                <select className="mb-input mb-input-sm" value={d.weight_unit} onChange={e => set('weight_unit', e.target.value)} aria-label={t('Единица', 'Birlik')}>
                  {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <span className="mb-muted mb-note">{t('Пусто — вес не показывается гостю.', 'Boş — agram myhmana görkezilmeýär.')}</span>
              </div>
              <input className="mb-input mb-span2" value={d.ingredients_ru} onChange={e => set('ingredients_ru', e.target.value)} placeholder={t('Состав для гостя RU — напр. говядина, чеддер, салат', 'Myhman üçin düzümi RU')} aria-label="ingredients RU" />
              <input className="mb-input mb-span2" value={d.ingredients_tk} onChange={e => set('ingredients_tk', e.target.value)} placeholder={t('Состав для гостя TK', 'Myhman üçin düzümi TK')} aria-label="ingredients TK" />
              <input className="mb-input mb-span2" value={d.ingredients_en} onChange={e => set('ingredients_en', e.target.value)} placeholder={t('Состав для гостя EN', 'Myhman üçin düzümi EN')} aria-label="ingredients EN" />
            </div>
            <p className="mb-muted mb-note" style={{ marginTop: 6 }}>
              {t('Это публичный состав, а не рецепт. Граммовки, себестоимость, поставщики и остатки остаются в Recipe Engine и гостю не показываются.',
                 'Bu jemgyýetçilik düzümi, resept däl. Mukdarlar, öz bahasy, üpjün edijiler we galyndylar Recipe Engine-de galýar.')}
            </p>
            <div className="mb-boxed">
              <div className="mb-brand-label">{t('Аллергены (публичная информация)', 'Allergenler (jemgyýetçilik maglumaty)')}</div>
              <div className="mb-allergens">
                {allergens.map(a => {
                  const on = d.allergen_ids.includes(a.id);
                  return (
                    <label key={a.id} className={`mb-allergen ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} disabled={!canManage}
                        onChange={() => set('allergen_ids', on ? d.allergen_ids.filter(x => x !== a.id) : [...d.allergen_ids, a.id])} />
                      {ru ? a.label_ru : language === 'tk' ? a.label_tk : a.label_en}
                    </label>
                  );
                })}
                {!allergens.length && <span className="mb-muted mb-note">{t('Справочник аллергенов не загружен.', 'Allergen sanawy ýüklenmedi.')}</span>}
              </div>
            </div>
          </>
        )}

        {section === 'kitchen' && (
          <>
            <div className="mb-boxed">
              <div className="mb-brand-label">{t('Цех и нормативное время', 'Bölüm we kada wagty')}</div>
              <p className="mb-muted mb-note">
                {t('Кухня распределяет позиции по цехам именно по этой настройке. Если цех не выбран, система берёт правило категории, а если и его нет — позиция попадёт в очередь «Требует назначения». Название блюда ни на что не влияет.',
                   'Aşhana pozisiýalary şu sazlama boýunça bölümlere paýlaýar. Bölüm saýlanmasa, ulgam kategoriýanyň düzgünini alýar, ol hem ýok bolsa — pozisiýa «Bellemeli» nobatyna düşer. Naharyň ady hiç zada täsir etmeýär.')}
              </p>
              {!routesLoaded ? (
                <span className="mb-muted mb-note">{t('Загружаем цеха…', 'Bölümler ýüklenýär…')}</span>
              ) : !stations.length ? (
                <span className="mb-muted mb-note">{t('В этом филиале ещё нет цехов.', 'Bu şahamçada entek bölüm ýok.')}</span>
              ) : (
                <>
                  {routes.map((r, idx) => (
                    <div className="mb-form-row" key={idx} style={{ marginTop: 8 }}>
                      <select className="mb-input" value={r.station_id} disabled={!canManage}
                        onChange={e => setRoutes(routes.map((x, i) => i === idx ? { ...x, station_id: e.target.value } : x))}>
                        {stations.map(st => <option key={st.id} value={st.id}>{ru ? st.name_ru : st.name_tk}</option>)}
                      </select>
                      <input className="mb-input mb-input-sm" type="number" min="1" max="240" value={r.standard_minutes} disabled={!canManage}
                        aria-label={t('Нормативное время, мин', 'Kada wagty, min')}
                        onChange={e => setRoutes(routes.map((x, i) => i === idx ? { ...x, standard_minutes: e.target.value } : x))} />
                      <input className="mb-input mb-input-sm" type="number" min="0" max="120" value={r.tolerance_minutes} disabled={!canManage}
                        aria-label={t('Допустимое отклонение, мин', 'Rugsat edilýän tapawut, min')}
                        onChange={e => setRoutes(routes.map((x, i) => i === idx ? { ...x, tolerance_minutes: e.target.value } : x))} />
                      <label className="mb-cb">
                        <input type="checkbox" checked={r.is_secondary} disabled={!canManage}
                          onChange={e => setRoutes(routes.map((x, i) => i === idx ? { ...x, is_secondary: e.target.checked } : x))} />
                        {t('дополнительный этап', 'goşmaça etap')}
                      </label>
                      {canManage && (
                        <button className="mb-icon danger boom-focusable" aria-label={t('Убрать цех', 'Bölümi aýyr')}
                          onClick={() => setRoutes(routes.filter((_, i) => i !== idx))}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  ))}
                  {canManage && routes.length < 4 && (
                    <button className="mb-add boom-focusable" onClick={() => setRoutes([...routes, { station_id: stations[0].id, standard_minutes: '5', tolerance_minutes: '2', is_secondary: routes.length > 0 }])}>
                      + {t('Добавить цех', 'Bölüm goş')}
                    </button>
                  )}
                  <div className="mb-form-row" style={{ marginTop: 10 }}>
                    {canManage && (
                      <button className="mb-btn gold boom-focusable" disabled={routeBusy} onClick={() => void saveRoutes()}>
                        {routeBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить настройки кухни', 'Aşhana sazlamalaryny sakla')}
                      </button>
                    )}
                    {routeSaved && <span className="mb-muted mb-note" style={{ color: 'var(--boom-success)' }}>{t('Сохранено.', 'Saklandy.')}</span>}
                  </div>
                  <p className="mb-muted mb-note" style={{ marginTop: 8 }}>
                    {t('Нормативное время — это ожидание до появления реальных данных. Как только позиции начнут готовиться, прогноз будет считаться по фактическому времени этого цеха.',
                       'Kada wagty — hakyky maglumatlar ýygnalýança garaşylýan wagt. Pozisiýalar taýýarlanyp başlandan soň çaklama şu bölümiň hakyky wagty boýunça hasaplanar.')}
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {section === 'media' && (
          <>
            <div className="mb-boxed">
              <div className="mb-brand-label">{t('Главное изображение', 'Esasy surat')}</div>
              <div className="mb-media-grid">
                <button className={`mb-media-cell boom-focusable ${!d.media_asset_id ? 'selected' : ''}`} onClick={() => set('media_asset_id', null)}>
                  <span className="mb-media-none"><ImagePlus className="w-5 h-5" />{t('Без фото', 'Suratsyz')}</span>
                </button>
                {assets.filter(a => a.kind !== 'MEDIA_360').map(a => (
                  <button key={a.id} className={`mb-media-cell boom-focusable ${d.media_asset_id === a.id ? 'selected' : ''}`} onClick={() => set('media_asset_id', a.id)}>
                    {a.kind === 'VIDEO'
                      ? <video src={a.url} poster={a.poster_url || undefined} muted className="mb-media-img" />
                      : <img src={a.url} alt={a.alt_ru || a.name} className="mb-media-img" />}
                    <span className="mb-media-name">{a.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-boxed">
              <div className="mb-brand-label">{t('Галерея, видео и 360', 'Galereýa, wideo we 360')}</div>
              {gallery.length > 0 && (
                <div className="mb-media-grid">
                  {gallery.map((a: any) => (
                    <div key={a.id} className="mb-media-cell selected">
                      {a.kind === 'VIDEO'
                        ? <video src={a.url} poster={a.poster_url || undefined} muted className="mb-media-img" />
                        : <img src={a.url} alt={a.alt_ru || a.name} className="mb-media-img" />}
                      <span className="mb-media-name">
                        {a.kind === 'MEDIA_360' && <Rotate3d className="inline w-3 h-3 mr-1 text-amber-400" />}
                        {a.kind === 'VIDEO' && <Film className="inline w-3 h-3 mr-1 text-amber-400" />}
                        {a.name}
                      </span>
                      {canManage && (
                        <button className="mb-icon danger boom-focusable" style={{ margin: 6 }} aria-label={t('Убрать из галереи', 'Galereýadan aýyr')}
                          onClick={() => set('gallery_media_ids', d.gallery_media_ids.filter(x => x !== a.id))}><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canManage && (
                <>
                  <div className="mb-brand-label" style={{ marginTop: 10 }}>{t('Добавить из медиа-библиотеки', 'Media kitaphanasyndan goş')}</div>
                  <div className="mb-media-grid">
                    {assets.filter(a => !d.gallery_media_ids.includes(a.id) && a.id !== d.media_asset_id).map(a => (
                      <button key={a.id} className="mb-media-cell boom-focusable" onClick={() => set('gallery_media_ids', [...d.gallery_media_ids, a.id])}>
                        {a.kind === 'VIDEO'
                          ? <video src={a.url} poster={a.poster_url || undefined} muted className="mb-media-img" />
                          : <img src={a.url} alt={a.alt_ru || a.name} className="mb-media-img" />}
                        <span className="mb-media-name">
                          {a.kind === 'MEDIA_360' && <Rotate3d className="inline w-3 h-3 mr-1 text-amber-400" />}
                          {a.name}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mb-muted mb-note" style={{ marginTop: 6 }}>
                    {t('360-материал помечается в «Медиа-библиотеке». Обычная фотография не становится 360 автоматически.',
                       '360 materialy «Media kitaphanasynda» bellenilýär. Adaty surat awtomatiki 360 bolmaýar.')}
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {canManage && (
          <div className="mb-form-row" style={{ marginTop: 12 }}>
            <button className="mb-btn gold boom-focusable" disabled={saving || Boolean(weightIssue)} onClick={() => void save()}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить блюдо', 'Nahary ýatda sakla')}
            </button>
            <button className="mb-btn boom-focusable" onClick={requestClose}><X className="w-3 h-3" /> {t('Отмена', 'Goý bolsun')}</button>
            {weightIssue && <span className="mb-muted mb-note" style={{ color: 'var(--boom-danger)' }}>{weightIssue}</span>}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmExit}
        title={t('Есть несохранённые изменения.', 'Ýatda saklanmadyk üýtgeşmeler bar.')}
        description={t('Если выйти сейчас, изменения этого блюда не сохранятся.', 'Häzir çyksaňyz, bu naharyň üýtgeşmeleri ýatda saklanmaz.')}
        confirmLabel={t('Выйти без сохранения', 'Saklaman çyk')}
        cancelLabel={t('Остаться', 'Galmak')}
        onCancel={() => setConfirmExit(false)}
        onConfirm={() => { setConfirmExit(false); onClose(); }}/>
    </div>
  );
};
