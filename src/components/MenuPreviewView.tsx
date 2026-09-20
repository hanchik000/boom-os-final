import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone, QrCode, ExternalLink, Loader2, RotateCcw, Copy, Check, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Stage 36 -- ADMIN Customer Menu Preview / QR Menu Preview.
//
// This is NOT a second customer menu. It embeds the REAL guest screen (`/?screen=customer`) at
// the real URL a guest would open, so what an administrator sees here is, byte for byte, what the
// public menu renders: the same public API, the same Visual Catalog blocks, the same Promotion
// Engine prices. Nothing is re-implemented, re-priced or re-formatted in this file.
//
// The QR tab embeds the branch's REAL qr_url, whose token the server resolves to a branch on its
// own side. The token is never constructed here and the branch selector cannot override it --
// that is exactly the server-side QR resolution this preview is meant to demonstrate. QR tokens
// are issued and rotated in Branches (branches.update); this screen only reads and displays them.
// ---------------------------------------------------------------------------------------------

type Tab = 'customer' | 'qr';
const CHANNELS = ['ONLINE', 'QR', 'LOCAL', 'OFFLINE'] as const;
const DEVICES: Array<{ id: string; ru: string; tk: string; w: number }> = [
  { id: 'phone', ru: 'Телефон', tk: 'Telefon', w: 390 },
  { id: 'tablet', ru: 'Планшет', tk: 'Planşet', w: 834 },
  { id: 'desktop', ru: 'Десктоп', tk: 'Desktop', w: 0 },
];

export const MenuPreviewView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const t = (r: string, k: string) => (ru ? r : k);

  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<Tab>('customer');
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('ONLINE');
  const [device, setDevice] = useState('phone');
  const [qr, setQr] = useState<{ qr_token: string | null; qr_url: string | null } | null>(null);
  const [qrError, setQrError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nonce, setNonce] = useState(0);

  const canReadQr = hasPermission('branches.update');

  useEffect(() => {
    api.getBranches({ status: 'ACTIVE' })
      .then(r => { setBranches(r.branches || []); if (r.branches?.[0]) setBranchId(b => b || r.branches[0].id); })
      .catch(() => undefined);
  }, []);

  const loadQr = useCallback(async () => {
    if (!branchId || !canReadQr) { setQr(null); return; }
    setBusy(true); setQrError('');
    try { setQr(await api.getBranchQr(branchId)); }
    catch (e: any) { setQr(null); setQrError(e?.message || t('Не удалось получить QR-ссылку филиала.', 'Şahamçanyň QR salgysy alynmady.')); }
    finally { setBusy(false); }
  }, [branchId, canReadQr, ru]);

  useEffect(() => { void loadQr(); }, [loadQr]);

  // The customer preview points at the SAME public entry point a guest uses. `branch` only
  // preselects the guest's own branch picker; it grants no access of any kind.
  const customerSrc = useMemo(
    () => `/?screen=customer&channel=${channel}${branchId ? `&branch=${encodeURIComponent(branchId)}` : ''}&preview=${nonce}`,
    [channel, branchId, nonce],
  );
  // The QR preview uses the branch's real token path, so the branch comes from the server.
  const qrSrc = useMemo(() => {
    if (!qr?.qr_token) return '';
    return `/?screen=customer&qr=${encodeURIComponent(qr.qr_token)}&preview=${nonce}`;
  }, [qr?.qr_token, nonce]);

  const src = tab === 'customer' ? customerSrc : qrSrc;
  const width = DEVICES.find(d => d.id === device)?.w || 0;

  const copy = async () => {
    if (!qr?.qr_url) return;
    try { await navigator.clipboard.writeText(qr.qr_url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  if (!hasPermission('menu.view')) {
    return <div className="p-8 text-slate-400">{t('Нет доступа к предпросмотру меню.', 'Menýu deslapky görnüşi elýeterli däl.')}</div>;
  }

  return (
    <div className="cmd-center">
      <div className="cmd-topbar">
        <div>
          <h1 className="cmd-title"><MonitorSmartphone className="inline w-5 h-5 text-amber-400 mr-2" />{t('ПРЕДПРОСМОТР МЕНЮ', 'MENÝU DESLAPKY GÖRNÜŞI')}</h1>
          <p className="cmd-subtitle">{t('Настоящий гостевой экран выбранного филиала — те же данные, цены и блоки, что видит гость.', 'Saýlanan şahamçanyň hakyky myhman ekrany — myhmanyň görýän maglumatlary, bahalary we bloklary.')}</p>
        </div>
        <div className="cmd-toolbar">
          <select className="mb-input" style={{ maxWidth: 240 }} value={branchId} onChange={e => setBranchId(e.target.value)} aria-label={t('Филиал', 'Şahamça')}>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
          </select>
          <button className="cmd-refresh-btn boom-focusable" disabled={busy} onClick={() => { setNonce(n => n + 1); void loadQr(); }} aria-label={t('Обновить', 'Täzele')}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t('Обновить', 'Täzele')}
          </button>
        </div>
      </div>

      <div className="cmd-panel">
        <div className="mb-form-row">
          <button className={`mb-btn boom-focusable ${tab === 'customer' ? 'gold' : ''}`} onClick={() => setTab('customer')}>
            <MonitorSmartphone className="w-3.5 h-3.5" /> {t('Меню гостя', 'Myhman menýusy')}
          </button>
          <button className={`mb-btn boom-focusable ${tab === 'qr' ? 'gold' : ''}`} onClick={() => setTab('qr')}>
            <QrCode className="w-3.5 h-3.5" /> {t('QR-меню', 'QR menýu')}
          </button>
          <span style={{ marginLeft: 'auto' }} />
          {tab === 'customer' && (
            <select className="mb-input" style={{ maxWidth: 150 }} value={channel} onChange={e => setChannel(e.target.value as any)} aria-label={t('Канал', 'Kanal')}>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="mb-input" style={{ maxWidth: 150 }} value={device} onChange={e => setDevice(e.target.value)} aria-label={t('Устройство', 'Enjam')}>
            {DEVICES.map(d => <option key={d.id} value={d.id}>{ru ? d.ru : d.tk}</option>)}
          </select>
          {src && (
            <a className="mb-btn boom-focusable" href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5" /> {t('Открыть', 'Aç')}
            </a>
          )}
        </div>

        {tab === 'qr' && (
          <div className="mb-boxed">
            {!canReadQr && <div className="cmd-stale">{t('QR-ссылка филиала требует права branches.update.', 'Şahamçanyň QR salgysy branches.update rugsadyny talap edýär.')}</div>}
            {qrError && <div className="cmd-error">{qrError}</div>}
            {canReadQr && !qrError && !qr?.qr_token && !busy && (
              <div className="mb-form-row">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="mb-muted mb-note">{t('У филиала ещё нет QR-кода. Создайте его в разделе «Филиалы».', 'Şahamçanyň QR kody ýok. Ony «Şahamçalar» bölüminde dörediň.')}</span>
              </div>
            )}
            {qr?.qr_url && (
              <div className="mb-form-row">
                <input className="mb-input" readOnly value={qr.qr_url} aria-label={t('QR-ссылка', 'QR salgysy')} />
                <button className="mb-btn boom-focusable" onClick={() => void copy()}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? t('Скопировано', 'Göçürildi') : t('Копировать', 'Göçür')}
                </button>
              </div>
            )}
            <p className="cmd-subtitle mb-note" style={{ marginTop: 8 }}>
              {t('Филиал определяется сервером по токену QR. Изменить его из браузера нельзя.', 'Şahamça QR tokeni boýunça serwer tarapyndan kesgitlenýär. Ony brauzerden üýtgetmek mümkin däl.')}
            </p>
          </div>
        )}
      </div>

      <div className="cmd-panel">
        <div className="cmd-panel-title">{tab === 'customer' ? t('Гостевой экран', 'Myhman ekrany') : t('QR-вход гостя', 'Myhmanyň QR girişi')}</div>
        {src ? (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <iframe
              key={src}
              title={t('Предпросмотр меню', 'Menýu deslapky görnüşi')}
              src={src}
              style={{
                width: width ? `${width}px` : '100%',
                maxWidth: '100%',
                height: '78vh',
                border: '1px solid var(--boom-border)',
                borderRadius: 16,
                background: '#000',
              }}
            />
          </div>
        ) : (
          <div className="mb-empty">{t('Предпросмотр недоступен: нет QR-кода у филиала.', 'Deslapky görnüş elýeterli däl: şahamçanyň QR kody ýok.')}</div>
        )}
      </div>
    </div>
  );
};
