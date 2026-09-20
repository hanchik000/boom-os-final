import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Power, Trash2, Upload, Pencil, Check, X, Loader2, RotateCcw, Rotate3d } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Stage 35.4 Media Library, completed in Stage 36.
//
// The backend (server/routes/media-assets.ts) has always accepted name / alt_ru / alt_tk /
// focal_x / focal_y / poster_url / priority / active on PATCH, but the UI only exposed the
// active toggle, so half the asset record was unreachable from ADMIN. This view now edits the
// whole record through that SAME route -- no second media table, no second upload path, no new
// permission (menu.media.view to read, menu.media.manage to write) and no new audit action:
// every save lands as MENU_MEDIA_ASSET_UPDATED in the existing audit log.
//
// "Delete" here is the existing soft deactivation (active=false). Assets stay in the table
// because dishes, banners and catalog blocks reference them; nothing is hard-deleted.
// ---------------------------------------------------------------------------------------------

interface Draft { name: string; alt_ru: string; alt_tk: string; poster_url: string; focal_x: string; focal_y: string; priority: string; is360: boolean }

const toDraft = (a: any): Draft => ({
  name: String(a.name ?? ''),
  alt_ru: String(a.alt_ru ?? ''),
  alt_tk: String(a.alt_tk ?? ''),
  poster_url: String(a.poster_url ?? ''),
  focal_x: String(a.focal_x ?? 50),
  focal_y: String(a.focal_y ?? 50),
  priority: String(a.priority ?? 0),
  is360: a.kind === 'MEDIA_360',
});

export const MediaLibraryView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const t = (r: string, k: string) => (ru ? r : k);

  const [branches, setBranches] = useState<any[]>([]);
  const [branch, setBranch] = useState('');
  const [assets, setAssets] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const can = hasPermission('menu.media.manage');

  const load = useCallback(async () => {
    if (!branch) return;
    setBusy(true);
    try { setAssets((await api.getMediaAssets(branch)).assets || []); setError(''); }
    catch (e: any) { setError(e?.message || t('Не удалось загрузить медиатеку.', 'Media kitaphanasy ýüklenmedi.')); }
    finally { setBusy(false); }
  }, [branch, ru]);

  useEffect(() => {
    api.getBranches({ status: 'ACTIVE' })
      .then(r => { setBranches(r.branches || []); if (r.branches?.[0]) setBranch(b => b || r.branches[0].id); })
      .catch(() => undefined);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, fn: () => Promise<any>) => {
    setSaving(id); setError('');
    try { await fn(); await load(); }
    catch (e: any) { setError(e?.message || t('Операция не выполнена.', 'Amal ýerine ýetirilmedi.')); }
    finally { setSaving(''); }
  };

  const startEdit = (a: any) => { setEditing(a.id); setDraft(toDraft(a)); };
  const cancelEdit = () => { setEditing(null); setDraft(null); };

  const saveEdit = async (a: any) => {
    if (!draft) return;
    const clamp = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d; };
    const name = draft.name.trim();
    if (!name) { setError(t('Название не может быть пустым.', 'Ady boş bolup bilmez.')); return; }
    await run(a.id, () => api.updateMediaAsset(a.id, {
      name,
      alt_ru: draft.alt_ru.trim() || null,
      alt_tk: draft.alt_tk.trim() || null,
      poster_url: draft.poster_url.trim() || null,
      focal_x: clamp(draft.focal_x, 50),
      focal_y: clamp(draft.focal_y, 50),
      priority: Number.isFinite(Number(draft.priority)) ? Number(draft.priority) : 0,
      // Only sent for an image asset; the server refuses the change for any other kind.
      ...((a.kind === 'IMAGE' || a.kind === 'MEDIA_360') ? { kind: draft.is360 ? 'MEDIA_360' : 'IMAGE' } : {}),
    }));
    cancelEdit();
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setError(''); setBusy(true);
    try { await api.uploadMediaAsset(file, branch); await load(); }
    catch (e: any) { setError(e?.message || t('Загрузка не удалась.', 'Ýüklemek başartmady.')); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };

  if (!hasPermission('menu.media.view')) {
    return <div className="p-8 text-slate-400">{t('Нет доступа к медиа-библиотеке.', 'Media kitaphanasy elýeterli däl.')}</div>;
  }

  return (
    <div className="cmd-center">
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title"><ImagePlus className="inline w-5 h-5 text-amber-400 mr-2" />{t('МЕДИА-БИБЛИОТЕКА', 'MEDIA KITAPHANASY')}</h1>
          <p className="cmd-subtitle">{t('Единый источник изображений и видео для меню, блюд, баннеров и визуального каталога.', 'Menýu, naharlar, bannerler we wizual katalog üçin bitewi surat we wideo çeşmesi.')}</p>
        </div>
        <div className="cmd-toolbar">
          <select className="mb-input" style={{ maxWidth: 220 }} value={branch} onChange={e => setBranch(e.target.value)} aria-label={t('Филиал', 'Şahamça')}>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {can && (
            <>
              <input ref={ref} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" onChange={e => void upload(e.target.files?.[0])} />
              <button className="mb-btn gold boom-focusable" disabled={busy || !branch} onClick={() => ref.current?.click()}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {t('Загрузить', 'Ýükle')}
              </button>
            </>
          )}
          <button className="cmd-refresh-btn boom-focusable" disabled={busy} onClick={() => void load()} aria-label={t('Обновить', 'Täzele')}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('Обновить', 'Täzele')}
          </button>
        </div>
      </div>

      {error && <div className="cmd-error">{error}</div>}
      {!can && <div className="cmd-stale">{t('Режим просмотра: изменение медиа требует права menu.media.manage.', 'Diňe görmek: media üýtgetmek menu.media.manage rugsadyny talap edýär.')}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {assets.map(a => {
          const isEditing = editing === a.id;
          const d = isEditing && draft ? draft : toDraft(a);
          return (
            <article key={a.id} className={`rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/70 ${a.active ? '' : 'opacity-60'}`}>
              <div className="aspect-video bg-black relative">
                {a.kind === 'VIDEO'
                  ? <video src={a.url} poster={a.poster_url || undefined} muted loop playsInline controls className="w-full h-full object-cover" />
                  : <img src={a.url} alt={ru ? a.alt_ru || a.name : a.alt_tk || a.name} className="w-full h-full object-cover" style={{ objectPosition: `${d.focal_x}% ${d.focal_y}%` }} />}
                <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-black/70 text-[10px] text-amber-300 inline-flex items-center gap-1">
                  {a.kind === 'MEDIA_360' && <Rotate3d className="w-3 h-3" />}{a.kind === 'MEDIA_360' ? '360' : a.kind}
                </div>
                {!a.active && <div className="absolute top-3 right-3 mb-chip archived">{t('ВЫКЛ', 'ÖÇÜK')}</div>}
              </div>
              <div className="p-4">
                {isEditing ? (
                  <div className="mb-form-grid">
                    <input className="mb-input mb-span2" value={d.name} onChange={e => setDraft(v => v && { ...v, name: e.target.value })} placeholder={t('Название', 'Ady')} aria-label={t('Название', 'Ady')} />
                    <input className="mb-input mb-span2" value={d.alt_ru} onChange={e => setDraft(v => v && { ...v, alt_ru: e.target.value })} placeholder="alt RU" aria-label="alt RU" />
                    <input className="mb-input mb-span2" value={d.alt_tk} onChange={e => setDraft(v => v && { ...v, alt_tk: e.target.value })} placeholder="alt TK" aria-label="alt TK" />
                    <input className="mb-input mb-span2" value={d.poster_url} onChange={e => setDraft(v => v && { ...v, poster_url: e.target.value })} placeholder={t('Постер (для видео)', 'Poster (wideo üçin)')} aria-label={t('Постер', 'Poster')} />
                    <input className="mb-input" type="number" min={0} max={100} value={d.focal_x} onChange={e => setDraft(v => v && { ...v, focal_x: e.target.value })} placeholder="focal X %" aria-label="focal X" />
                    <input className="mb-input" type="number" min={0} max={100} value={d.focal_y} onChange={e => setDraft(v => v && { ...v, focal_y: e.target.value })} placeholder="focal Y %" aria-label="focal Y" />
                    <input className="mb-input mb-span2" type="number" value={d.priority} onChange={e => setDraft(v => v && { ...v, priority: e.target.value })} placeholder={t('Приоритет', 'Prioritet')} aria-label={t('Приоритет', 'Prioritet')} />
                    {/* Stage 37: a 360 asset is an ordinary equirectangular IMAGE -- what makes it
                        360 is this declaration, never the file type. Only an image can be marked,
                        so a normal photo never silently becomes a 360 asset and a video never can. */}
                    {(a.kind === 'IMAGE' || a.kind === 'MEDIA_360') && (
                      <label className="mb-cb mb-span2">
                        <input type="checkbox" checked={d.is360} onChange={e => setDraft(v => v && { ...v, is360: e.target.checked })} aria-label={t('360-материал', '360 material')} />
                        <Rotate3d className="w-3.5 h-3.5 text-amber-400" /> {t('Это 360-материал (равнопромежуточная проекция)', 'Bu 360 material (ekwirektangulýar proýeksiýa)')}
                      </label>
                    )}
                    <div className="mb-span2 mb-form-row">
                      <button className="mb-btn gold boom-focusable" disabled={saving === a.id} onClick={() => void saveEdit(a)}>
                        {saving === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить', 'Ýatda sakla')}
                      </button>
                      <button className="mb-btn boom-focusable" onClick={cancelEdit}><X className="w-3 h-3" /> {t('Отмена', 'Ýatyr')}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-bold text-white truncate">{a.name}</div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">
                      {a.mime_type} · {a.size_bytes ? `${Math.round(Number(a.size_bytes) / 1024 / 1024)} MB` : '—'} · focal {d.focal_x}/{d.focal_y} · prio {d.priority}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">alt RU: {a.alt_ru || '—'} · alt TK: {a.alt_tk || '—'}</div>
                    <div className="text-[11px] text-slate-500 truncate">{a.branch_name || t('Общий (все филиалы)', 'Umumy (ähli şahamçalar)')}</div>
                    <div className="mt-4 mb-form-row">
                      {can && <button className="mb-btn boom-focusable" onClick={() => startEdit(a)}><Pencil className="w-3 h-3" /> {t('Изменить', 'Üýtget')}</button>}
                      {can && (
                        <button className="mb-btn boom-focusable" disabled={saving === a.id} onClick={() => void run(a.id, () => api.updateMediaAsset(a.id, { active: !a.active }))}>
                          <Power className="w-3 h-3" /> {a.active ? t('Выключить', 'Öçür') : t('Включить', 'Aç')}
                        </button>
                      )}
                      {can && a.active && (
                        <button className="mb-icon danger boom-focusable" disabled={saving === a.id} aria-label={t('Деактивировать', 'Deaktiwle')} onClick={() => void run(a.id, () => api.deactivateMediaAsset(a.id))}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </article>
          );
        })}
        {!assets.length && !busy && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500">
            <ImagePlus className="w-8 h-8 mx-auto mb-3" />{t('Медиатека пока пуста.', 'Media kitaphanasy boş.')}
          </div>
        )}
      </div>
    </div>
  );
};
