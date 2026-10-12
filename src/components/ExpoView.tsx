import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, PackageCheck, RefreshCw, RotateCcw, TriangleAlert, Users2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { errorText } from '../humanErrors';
import { LoadingState, Modal, Notice } from './ui';
import { QUICK_RU, QUICK_TK } from './KitchenStationView';

// ----------------------------------------------------------------------------------------------
// Stage 42 -- the pass.
//
// One card per order, every station's part of it in one place, and a single handover action that
// only lights up when the whole order is genuinely ready. Releasing an incomplete order is a
// separate, named authority: the button appears only for someone who holds it AND the server
// refuses it anyway without that permission and a reason.
// ----------------------------------------------------------------------------------------------

const REFRESH_MS = 15000;

export const ExpoView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [override, setOverride] = useState<any | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [returning, setReturning] = useState<{ order: any; task: any } | null>(null);
  const [returnReason, setReturnReason] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!branchId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try { setOrders((await api.getExpoBoard(branchId)).orders || []); setError(''); }
    catch (e: any) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(() => { void load(true); }, REFRESH_MS); return () => window.clearInterval(t); }, [load]);

  const act = async (fn: () => Promise<any>, message?: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); await load(true); }
    catch (e: any) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const hhmm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString(ru ? 'ru-RU' : 'tk-TM', { hour: '2-digit', minute: '2-digit' }) : '—';
  const statusLabel = (s: string) => s === 'READY' ? (ru ? 'готово' : 'taýýar')
    : s === 'SERVED' ? (ru ? 'выдано' : 'berildi')
    : s === 'IN_PROGRESS' ? (ru ? 'готовится' : 'taýýarlanýar')
    : s === 'ACCEPTED' ? (ru ? 'принято' : 'kabul edildi')
    : (ru ? 'ожидает' : 'nobatda');

  if (!hasPermission('kitchen.expo.view')) {
    return <div className="p-8 text-slate-400">{ru ? 'У вас нет доступа к экрану выдачи.' : 'Beriş ekranyna elýeterliligiňiz ýok.'}</div>;
  }
  if (!branchId) {
    return <div className="p-8 text-slate-400">{ru ? 'Экран выдачи работает в филиале — у вашей учётной записи он не выбран.' : 'Beriş ekrany şahamçada işleýär — hasabyňyzda şahamça saýlanmadyk.'}</div>;
  }

  const canOverride = hasPermission('kitchen.expo.override');
  const canHandOver = hasPermission('kitchen.expo.handover');

  return (
    <div className="kitchen-screen boom-reduced-motion-safe" id="expo-view">
      <div className="kt-stations">
        <button className="kt-station-tab" onClick={() => void load()} aria-label={ru ? 'Обновить' : 'Täzele'}>
          <span className="kt-station-name"><RefreshCw className="w-5 h-5" /></span>
          <span className="kt-station-meta">{ru ? 'обновить' : 'täzele'}</span>
        </button>
        <div className="kt-load-tile" style={{ flex: '0 1 200px' }}>
          <div className="kt-load-label">{ru ? 'Полностью готовы' : 'Doly taýýar'}</div>
          <div className="kt-load-value">{orders.filter(o => o.all_ready).length}</div>
        </div>
        <div className="kt-load-tile" style={{ flex: '0 1 200px' }}>
          <div className="kt-load-label">{ru ? 'В работе' : 'Işde'}</div>
          <div className="kt-load-value">{orders.filter(o => !o.all_ready).length}</div>
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {loading && !orders.length ? <LoadingState /> : orders.length === 0 ? (
        <div className="kt-empty">{ru ? 'Сейчас кухня ничего не готовит.' : 'Häzir aşhana zat taýýarlamaýar.'}</div>
      ) : (
        <div className="kt-expo-grid">
          {orders.map(o => {
            const handed = (o.handovers || []).some((h: any) => h.kind === 'HANDED_OVER' || h.kind === 'INCOMPLETE_OVERRIDE');
            return (
              <div key={o.order_id} className={`kt-expo-card ${o.all_ready ? 'is-ready' : ''}`} data-order-id={o.order_id} data-ready={o.all_ready}>
                <div className="kt-expo-head">
                  <div>
                    <div className="kt-order">№{o.order_number}</div>
                    <div className="kt-where">
                      {o.table_code ? (ru ? `Стол ${o.table_code}` : `Stol ${o.table_code}`) : (ru ? 'С собой' : 'Özi bilen')}
                      {o.waiter_name ? ` · ${o.waiter_name}` : ''}
                    </div>
                  </div>
                  <div className="kt-expo-state">
                    {handed ? (ru ? 'передан' : 'berildi') : o.all_ready ? (ru ? 'полностью готов' : 'doly taýýar') : (ru ? 'собирается' : 'ýygnalýar')}
                  </div>
                </div>

                <div className="kt-expo-lines">
                  {o.items.map((i: any) => (
                    <div className="kt-expo-line" key={i.id}>
                      <span>{i.title_snapshot} ×{i.quantity}</span>
                      <span className="flex items-center gap-2">
                        <span className="kt-chip">{i.station_code || (ru ? 'без цеха' : 'bölümsiz')}</span>
                        <span className={`kt-chip ${i.status === 'READY' || i.status === 'SERVED' ? 'is-ready' : i.status === 'IN_PROGRESS' ? 'is-cooking' : ''}`}>{statusLabel(i.status)}</span>
                        {i.status === 'READY' && canHandOver && !handed && (
                          <button className="kt-btn is-quiet" style={{ minHeight: 32, padding: '4px 8px', flex: '0 0 auto' }}
                            title={ru ? 'Вернуть на доработку' : 'Täzeden işlemäge gaýtar'}
                            onClick={() => { setReturning({ order: o, task: i }); setReturnReason(''); }}>
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {(o.comments || []).slice(0, 3).map((c: any) => (
                  <div key={c.id} className={`kt-note ${c.after_start ? 'is-late-change' : ''}`}>
                    <TriangleAlert className="w-4 h-4 shrink-0" />
                    <span>{c.kind === 'FREE_TEXT' ? c.text : (ru ? QUICK_RU[c.kind] || c.kind : QUICK_TK[c.kind] || c.kind)}</span>
                  </div>
                ))}

                {o.serve_together && (
                  <div className="kt-note">
                    <Users2 className="w-4 h-4 shrink-0" />
                    <span>
                      {ru ? 'Официант просил подать вместе' : 'Ofisiant bilelikde bermegi sorady'}
                      {o.coordinated_ready_at && !o.all_ready && <b> — {ru ? 'ориентир' : 'gözükdiriji'} {hhmm(o.coordinated_ready_at)}</b>}
                    </span>
                  </div>
                )}
                <div className="kt-times">
                  {o.forecast_ready_at && !o.all_ready && <span><b>{ru ? 'Прогноз полной готовности' : 'Doly taýýarlyk çaklamasy'}:</b> {hhmm(o.forecast_ready_at)}</span>}
                  {handed && <span><b>{ru ? 'Передан' : 'Berildi'}:</b> {hhmm((o.handovers || [])[0]?.created_at)}</span>}
                </div>

                {!handed && canHandOver && (
                  <div className="kt-actions">
                    <button className="kt-btn is-done" id={`expo-handover-${o.order_number}`} disabled={busy || !o.all_ready}
                      onClick={() => void act(() => api.handOverOrder(o.order_id), ru ? 'Заказ передан официанту.' : 'Sargyt ofisianta berildi.')}>
                      <PackageCheck className="w-4 h-4" /> {ru ? 'Передать официанту' : 'Ofisianta ber'}
                    </button>
                    {!o.all_ready && canOverride && (
                      <button className="kt-btn is-alarm" disabled={busy} onClick={() => { setOverride(o); setOverrideReason(''); }}>
                        <TriangleAlert className="w-4 h-4" /> {ru ? 'Отдать неполный' : 'Doly däl ber'}
                      </button>
                    )}
                  </div>
                )}
                {handed && <div className="kt-times"><CheckCheck className="w-4 h-4" /> {ru ? 'Передача зафиксирована в журнале действий.' : 'Beriş hereket žurnalynda ýazyldy.'}</div>}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(override)}
        title={ru ? 'Отдать заказ не полностью?' : 'Sargydy doly däl bermeli?'}
        description={ru
          ? 'Так делают только в исключительном случае. Причина сохранится в журнале действий вместе с перечнем недостающих позиций.'
          : 'Bu diňe aýratyn ýagdaýda edilýär. Sebäp ýetmeýän pozisiýalar bilen bilelikde hereket žurnalynda saklanar.'}
        onClose={() => setOverride(null)}
        footer={<>
          <button className="btn-secondary" onClick={() => setOverride(null)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn-danger" disabled={busy || overrideReason.trim().length < 3}
            onClick={() => { const o = override; const reason = overrideReason.trim(); setOverride(null);
              if (o) void act(() => api.handOverOrder(o.order_id, { allow_incomplete: true, reason }), ru ? 'Передача зафиксирована как неполная.' : 'Beriş doly däl hökmünde ýazyldy.'); }}>
            {ru ? 'Отдать и зафиксировать' : 'Ber we ýazdyr'}
          </button>
        </>}
      >
        <label className="block">
          <span className="boom-label">{ru ? 'Причина' : 'Sebäp'}<span className="boom-req">*</span></span>
          <input className="field" value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
            placeholder={ru ? 'например, гость не может ждать' : 'meselem, myhman garaşyp bilmeýär'} />
        </label>
      </Modal>

      <Modal
        open={Boolean(returning)}
        title={ru ? 'Вернуть позицию на доработку?' : 'Pozisiýany täzeden işlemäge gaýtarmaly?'}
        description={returning ? `${returning.task.title_snapshot} ×${returning.task.quantity}` : undefined}
        onClose={() => setReturning(null)}
        footer={<>
          <button className="btn-secondary" onClick={() => setReturning(null)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn-danger" disabled={busy || returnReason.trim().length < 3}
            onClick={() => { const r = returning; const reason = returnReason.trim(); setReturning(null);
              if (r) void act(() => api.returnKitchenItem(r.order.order_id, r.task.id, reason), ru ? 'Позиция вернулась в цех.' : 'Pozisiýa bölüme gaýtaryldy.'); }}>
            {ru ? 'Вернуть в цех' : 'Bölüme gaýtar'}
          </button>
        </>}
      >
        <label className="block">
          <span className="boom-label">{ru ? 'Что не так' : 'Näme ýalňyş'}<span className="boom-req">*</span></span>
          <input className="field" value={returnReason} onChange={e => setReturnReason(e.target.value)}
            placeholder={ru ? 'например, остыло' : 'meselem, sowady'} />
        </label>
      </Modal>
    </div>
  );
};
