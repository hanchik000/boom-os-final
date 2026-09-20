import React, { useCallback, useEffect, useState } from 'react';
import { Palette, Check, Loader2, RefreshCw, ImagePlus, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useBranding } from '../context/BrandingContext';

// ---------------------------------------------------------------------------------------------
// Stage 36 -- ADMIN Branding.
//
// One source of truth: the six BRANDING_* rows in the EXISTING system_settings table. This view
// is a thin editor over the existing GET /api/settings and PUT /api/settings/:key routes, which
// already carry the settings.view / settings.update permissions (Owner/SuperAdmin) and already
// write a SETTINGS_UPDATED audit record on every change. No new table, no new permission, no new
// audit system, and no branding literal anywhere else in the app.
//
// Logo/favicon images are chosen from the existing Stage 35.4 Media Library rather than a second
// uploader -- a logo is just a media asset, and its URL is what gets stored.
// ---------------------------------------------------------------------------------------------

const FIELDS = [
  { key: 'BRANDING_PRODUCT_NAME', ru: 'Название продукта', tk: 'Önümiň ady', kind: 'text' as const },
  { key: 'BRANDING_NETWORK_NAME', ru: 'Название сети', tk: 'Ulgamyň ady', kind: 'text' as const },
  { key: 'BRANDING_MARK', ru: 'Знак (1–2 символа)', tk: 'Belgi (1–2 harp)', kind: 'text' as const },
  { key: 'BRANDING_LOGO_URL', ru: 'Основной логотип', tk: 'Esasy logotip', kind: 'media' as const },
  { key: 'BRANDING_LOGO_DARK_URL', ru: 'Логотип для светлого фона', tk: 'Açyk fon üçin logotip', kind: 'media' as const },
  { key: 'BRANDING_FAVICON_URL', ru: 'Favicon', tk: 'Favicon', kind: 'media' as const },
];

export const BrandingView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const { branding, reloadBranding } = useBranding();
  const ru = language === 'ru';
  const t = (r: string, k: string) => (ru ? r : k);
  const canManage = hasPermission('settings.update');

  const [values, setValues] = useState<Record<string, string>>({});
  const [assets, setAssets] = useState<any[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const r = await api.getSettings();
      const next: Record<string, string> = {};
      for (const f of FIELDS) next[f.key] = String((r.settings || []).find((s: any) => s.key === f.key)?.value ?? '');
      setValues(next);
    } catch (e: any) { setError(e?.message || t('Не удалось загрузить настройки.', 'Sazlamalar ýüklenip bilmedi.')); }
    finally { setBusy(false); }
  }, [ru]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!hasPermission('menu.media.view')) return;
    void api.getMediaAssets().then(r => setAssets((r.assets || []).filter((a: any) => a.active && a.kind !== 'VIDEO'))).catch(() => setAssets([]));
  }, [hasPermission, pickerFor]);

  const save = async (key: string, value: string) => {
    setSaving(key); setError(''); setOk('');
    try {
      await api.updateSetting(key, { value });
      setValues(v => ({ ...v, [key]: value }));
      await reloadBranding();               // every surface picks the change up immediately
      setOk(t('Сохранено. Изменение записано в журнал аудита.', 'Ýatda saklandy. Üýtgeşme audit ýazgysyna düşdi.'));
      setTimeout(() => setOk(''), 2500);
    } catch (e: any) { setError(e?.message || t('Не удалось сохранить.', 'Ýatda saklanmady.')); }
    finally { setSaving(''); }
  };

  if (!hasPermission('settings.view')) {
    return <div className="p-8 text-slate-400">{t('Нет доступа к настройкам брендинга.', 'Brending sazlamalary elýeterli däl.')}</div>;
  }

  return (
    <div className="cmd-center">
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title"><Palette className="inline w-5 h-5 text-amber-400 mr-2" />{t('БРЕНДИНГ', 'BRENDING')}</h1>
          <p className="cmd-subtitle">{t('Единый источник правды для логотипа и названий во всех интерфейсах BOOM OS.', 'BOOM OS ähli interfeýsleri üçin logotipiň we atlaryň bitewi çeşmesi.')}</p>
        </div>
        <div className="cmd-toolbar">
          <button className="cmd-refresh-btn boom-focusable" disabled={busy} onClick={() => void load()} aria-label={t('Обновить', 'Täzele')}>
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('Обновить', 'Täzele')}
          </button>
        </div>
      </div>

      {error && <div className="cmd-error">{error}</div>}
      {ok && <div className="cmd-stale" style={{ borderColor: 'rgba(34,197,94,.3)', background: 'rgba(34,197,94,.07)', color: 'var(--boom-success)' }}>{ok}</div>}
      {!canManage && <div className="cmd-stale">{t('Режим просмотра: изменение брендинга требует права settings.update.', 'Diňe görmek: brendingi üýtgetmek settings.update rugsadyny talap edýär.')}</div>}

      {/* live preview of the shared branding, exactly as the sidebar renders it */}
      <div className="cmd-panel">
        <div className="cmd-panel-title">{t('Предпросмотр', 'Deslapky görnüş')}</div>
        <div className="mb-base">
          {branding.logo_url
            ? <img src={branding.logo_url} alt={branding.product_name} className="w-12 h-12 rounded-xl object-cover" />
            : <span className="mb-thumb"><b style={{ color: 'var(--boom-gold)' }}>{branding.mark}</b></span>}
          <div>
            <b className="text-white">{branding.product_name}</b>
            <div className="mb-muted">{branding.network_name || t('— сеть не указана —', '— ulgam görkezilmedi —')}</div>
          </div>
        </div>
      </div>

      <div className="cmd-panel">
        <div className="cmd-panel-title">{t('Параметры', 'Parametrler')}</div>
        {FIELDS.map(f => (
          <div key={f.key} className="mb-brand-row">
            <label className="mb-brand-label" htmlFor={`brand-${f.key}`}>
              {ru ? f.ru : f.tk}
              <span className="mb-muted mb-note"> · {f.key}</span>
            </label>
            <div className="mb-form-row grow">
              <input
                id={`brand-${f.key}`}
                className="mb-input"
                value={values[f.key] ?? ''}
                disabled={!canManage}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.kind === 'media' ? 'https://… / /uploads/menu-media/…' : ''}
              />
              {f.kind === 'media' && canManage && hasPermission('menu.media.view') && (
                <button className="mb-btn boom-focusable" onClick={() => setPickerFor(f.key)} aria-label={t('Выбрать из медиа-библиотеки', 'Media kitaphanasyndan saýla')}>
                  <ImagePlus className="w-3.5 h-3.5" /> {t('Из библиотеки', 'Kitaphanadan')}
                </button>
              )}
              {canManage && (
                <button className="mb-btn gold boom-focusable" disabled={saving === f.key} onClick={() => void save(f.key, values[f.key] ?? '')}>
                  {saving === f.key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('Сохранить', 'Ýatda sakla')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {pickerFor && (
        <div className="mb-modal" onClick={() => setPickerFor(null)}>
          <div className="mb-modal-body" onClick={e => e.stopPropagation()}>
            <div className="cmd-panel-head">
              <div className="cmd-panel-title"><ImagePlus /> {t('Медиа-библиотека', 'Media kitaphanasy')}</div>
              <button className="mb-icon boom-focusable" aria-label={t('Закрыть', 'Ýap')} onClick={() => setPickerFor(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="mb-media-grid">
              {assets.map(a => (
                <button key={a.id} className="mb-media-cell boom-focusable" onClick={() => { const k = pickerFor; setPickerFor(null); if (k) void save(k, a.url); }}>
                  <img src={a.url} alt={a.alt_ru || a.name} className="mb-media-img" />
                  <span className="mb-media-name">{a.name}</span>
                </button>
              ))}
            </div>
            {!assets.length && <div className="mb-empty">{t('Нет изображений. Загрузите файл в «Медиа-библиотеке».', 'Surat ýok. «Media kitaphanasynda» ýükläň.')}</div>}
          </div>
        </div>
      )}
    </div>
  );
};
