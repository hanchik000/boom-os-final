import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChefHat, CheckCheck, CircleDot, Clock, HandHelping, Play, RefreshCw, Users2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useBranchScope } from '../useBranchScope';
import { useLanguage } from '../context/LanguageContext';
import { errorText } from '../humanErrors';
import { agoFragment, timeAgoLabel } from '../freshness';
import { ConfirmDialog, EmptyState, LoadingState, Modal, Notice } from './ui';

// ----------------------------------------------------------------------------------------------
// Stage 42 -- the station screen.
//
// One station, four columns, one tap per decision. Every time on this screen was computed by the
// server: this component never estimates how long something will take and never decides that an
// item is late. It shows what the kitchen API returned and sends back what the cook pressed.
// ----------------------------------------------------------------------------------------------

const COLUMNS = [
  { key: 'QUEUED', ru: 'Входящие', tk: 'Gelýän' },
  { key: 'ACCEPTED', ru: 'Приняты', tk: 'Kabul edildi' },
  { key: 'IN_PROGRESS', ru: 'Готовятся', tk: 'Taýýarlanýar' },
  { key: 'READY', ru: 'Готовы', tk: 'Taýýar' },
] as const;

const HELP_REASONS = [
  { code: 'STAFF', ru: 'Не хватает людей', tk: 'Işgär ýetmeýär' },
  { code: 'EQUIPMENT', ru: 'Оборудование', tk: 'Enjam' },
  { code: 'INGREDIENTS', ru: 'Закончились продукты', tk: 'Önümler gutardy' },
  { code: 'UNCLEAR_ITEM', ru: 'Непонятная позиция', tk: 'Düşnüksiz pozisiýa' },
  { code: 'URGENT', ru: 'Нужна помощь срочно', tk: 'Gyssagly kömek' },
  { code: 'OTHER', ru: 'Другое', tk: 'Başga' },
];

const REFRESH_MS = 15000;

export const KitchenStationView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  // Stage 44: a cook has their own branch; an owner has none, and for them this screen used to be
  // a dead end. The shared rule in useBranchScope decides which kitchen is shown.
  const { branchId, setBranchId, branches } = useBranchScope();
  const [stations, setStations] = useState<any[]>([]);
  const [stationId, setStationId] = useState<string>('');
  const [queue, setQueue] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [problemFor, setProblemFor] = useState<any | null>(null);
  const [problemText, setProblemText] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpReason, setHelpReason] = useState('STAFF');
  const [helpComment, setHelpComment] = useState('');
  const [confirmReady, setConfirmReady] = useState<any | null>(null);
  // Stage 44: a kitchen screen stays open all shift, so the cook has to be able to tell живой
  // board from a frozen one. `lastUpdatedAt` is written only after a successful read, the ticker
  // re-renders the label, and a failed refresh leaves the board standing with a stale notice over
  // it instead of blanking it. Same convention as the manager command centre (Stage 35.9).
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const loadStations = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    try {
      const r = await api.getKitchenStations(branchId);
      const cooking = (r.stations || []).filter((s: any) => !s.is_expo);
      setStations(cooking);
      setStationId(prev => prev || cooking[0]?.id || '');
    } catch (e: any) { setError(errorText(e)); }
  }, [branchId]);

  const loadQueue = useCallback(async (silent = false) => {
    if (!branchId || !stationId) return;
    if (!silent) setLoading(true);
    try {
      const r = await api.getKitchenQueue(branchId, stationId);
      setQueue(r);
      setError('');
      setLastUpdatedAt(Date.now());
    } catch (e: any) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [branchId, stationId]);

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);
  // The kitchen screen is left open all shift, so it refreshes itself. Reading the queue is also
  // what recomputes the forecast server-side; the alert dedupe key makes that safe to repeat.
  // Stage 44: polling pauses while the tab is hidden and reads once immediately on return, so a
  // screen that was in the background never shows yesterday's queue as if it were current.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => { if (timer === null) timer = window.setInterval(() => { void loadQueue(true); }, REFRESH_MS); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { void loadQueue(true); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [loadQueue]);

  // Stage 44: the "N назад" ticker -- display only, paused while the tab is hidden, never fetches.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => { if (timer === null) timer = window.setInterval(() => setTick(x => x + 1), 1000); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  const act = async (fn: () => Promise<any>, message?: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); if (message) setNotice(message); await loadQueue(true); }
    catch (e: any) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = { QUEUED: [], ACCEPTED: [], IN_PROGRESS: [], READY: [] };
    for (const t of queue?.tasks || []) if (map[t.status]) map[t.status].push(t);
    return map;
  }, [queue]);

  const minutesLeft = (iso: string | null) => {
    if (!iso) return null;
    return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  };
  const hhmm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString(ru ? 'ru-RU' : 'tk-TM', { hour: '2-digit', minute: '2-digit' }) : '—';

  if (!hasPermission('kds.view')) {
    return <div className="p-8 text-slate-400">{ru ? 'У вас нет доступа к экрану кухни.' : 'Aşhana ekranyna elýeterliligiňiz ýok.'}</div>;
  }
  if (!branchId) {
    return (
      <div className="p-8">
        <EmptyState
          title={ru ? 'Филиал не выбран.' : 'Şahamça saýlanmadyk.'}
          hint={ru
            ? 'Экран кухни показывает заказы одного филиала. Выберите филиал в шапке страницы или попросите администратора привязать вашу учётную запись к филиалу.'
            : 'Aşhana ekrany bir şahamçanyň sargytlaryny görkezýär. Sahypanyň ýokarsynda şahamçany saýlaň ýa-da hasabyňyzy şahamça baglamagy administratordan soraň.'}
        />
      </div>
    );
  }

  const card = (task: any) => {
    const left = minutesLeft(task.forecast_ready_at);
    const delayClass = task.delay_state === 'CRITICAL' ? 'is-critical' : task.delay_state === 'LATE' ? 'is-late' : task.delay_state === 'WARNING' ? 'is-warning' : '';
    const soft = task.forecast_confidence === 'PRELIMINARY';
    return (
      <div key={task.id} className={`kt-card ${delayClass}`} data-task-id={task.id} data-delay={task.delay_state}>
        <div className="kt-card-top">
          <span className="kt-order">№{task.order_number}</span>
          <span className="kt-where">{task.table_code ? (ru ? `Стол ${task.table_code}` : `Stol ${task.table_code}`) : (ru ? 'С собой' : 'Özi bilen')}</span>
        </div>
        <div className="kt-title">{task.title_snapshot} <span className="kt-qty">×{task.quantity}</span></div>
        {Boolean(task.modifiers?.length) && (
          <div className="kt-mods">{task.modifiers.map((m: string, i: number) => <span key={i} className="kt-mod">{m}</span>)}</div>
        )}
        {(task.comments || []).map((c: any) => (
          <div key={c.id} className={`kt-note ${c.after_start ? 'is-late-change' : ''}`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              {c.kind === 'FREE_TEXT' ? c.text : (ru ? QUICK_RU[c.kind] || c.kind : QUICK_TK[c.kind] || c.kind)}
              {c.after_start && <b> — {ru ? 'пришло после начала готовки' : 'taýýarlyk başlanandan soň geldi'}</b>}
            </span>
          </div>
        ))}
        {task.serve_together && (
          <div className="kt-note">
            <Users2 className="w-4 h-4 shrink-0" />
            <span>
              {ru ? 'Подать вместе со всем заказом' : 'Ähli sargyt bilen bilelikde beriň'}
              {task.coordinated_ready_at && task.status !== 'READY' && (
                <b> — {ru ? 'начинать в' : 'başlamaly'} {hhmm(task.forecast_start_at)}, {ru ? 'отдать в' : 'bermeli'} {hhmm(task.coordinated_ready_at)}</b>
              )}
            </span>
          </div>
        )}
        <div className="kt-times">
          <span><b>{ru ? 'Принят' : 'Kabul'}:</b> {hhmm(task.created_at)}</span>
          {task.status !== 'READY' && left !== null && (
            <span className={soft ? 'kt-forecast-soft' : ''}>
              <b>{ru ? 'Прогноз' : 'Çaklama'}:</b> {hhmm(task.forecast_ready_at)} ({left <= 0 ? (ru ? 'уже пора' : 'eýýäm wagty') : `${left} ${ru ? 'мин' : 'min'}`})
              {soft && ` · ${ru ? 'предварительно' : 'deslapky'}`}
            </span>
          )}
          {task.ready_at && <span><b>{ru ? 'Готово' : 'Taýýar'}:</b> {hhmm(task.ready_at)}</span>}
          {task.started_at && !task.ready_at && <span><b>{ru ? 'В работе с' : 'Işde'}:</b> {hhmm(task.started_at)}</span>}
        </div>
        {task.delay_reason && <div className="kt-note is-late-change"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{task.delay_reason}</span></div>}
        <div className="kt-actions">
          {task.status === 'QUEUED' && hasPermission('kds.update') && (
            <button className="kt-btn" disabled={busy} onClick={() => void act(() => api.setKitchenTaskStatus(task.id, 'ACCEPTED'))}>
              <CircleDot className="w-4 h-4" /> {ru ? 'Принять' : 'Kabul et'}
            </button>
          )}
          {(task.status === 'QUEUED' || task.status === 'ACCEPTED') && hasPermission('kds.update') && (
            <button className="kt-btn is-primary" disabled={busy} onClick={() => void act(() => api.setKitchenTaskStatus(task.id, 'IN_PROGRESS'))}>
              <Play className="w-4 h-4" /> {ru ? 'Начать' : 'Başla'}
            </button>
          )}
          {task.status === 'IN_PROGRESS' && hasPermission('kds.update') && (
            <button className="kt-btn is-done" disabled={busy} onClick={() => setConfirmReady(task)}>
              <CheckCheck className="w-4 h-4" /> {ru ? 'Готово' : 'Taýýar'}
            </button>
          )}
          {task.status !== 'READY' && hasPermission('kds.update') && (
            <button className="kt-btn is-alarm" disabled={busy} onClick={() => { setProblemFor(task); setProblemText(''); }}>
              <AlertTriangle className="w-4 h-4" /> {ru ? 'Проблема' : 'Mesele'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const load = queue?.load;
  return (
    <div className="kitchen-screen boom-reduced-motion-safe" id="kitchen-station-view">
      <div className="kt-stations">
        {/* Stage 44: only shown to someone who may look at more than one branch -- a cook sees
            their own kitchen and nothing to choose. */}
        {branches.length > 1 && (
          <label className="kt-station-tab" id="kt-branch-pick">
            <span className="kt-station-name">
              <select
                className="kt-branch-select"
                aria-label={ru ? 'Филиал' : 'Şahamça'}
                value={branchId}
                onChange={e => { setBranchId(e.target.value); setStationId(''); }}
              >
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </span>
            <span className="kt-station-meta">{ru ? 'филиал' : 'şahamça'}</span>
          </label>
        )}
        {stations.map(s => (
          <button
            key={s.id}
            id={`kt-station-${s.code}`}
            className={`kt-station-tab ${s.id === stationId ? 'is-active' : ''}`}
            onClick={() => setStationId(s.id)}
          >
            <span className="kt-station-name">{ru ? s.name_ru : s.name_tk}</span>
            <span className="kt-station-meta">{s.code}</span>
          </button>
        ))}
        <button
          id="kt-station-unassigned"
          className={`kt-station-tab ${stationId === 'UNASSIGNED' ? 'is-active' : ''}`}
          onClick={() => setStationId('UNASSIGNED')}
        >
          <span className="kt-station-name">{ru ? 'Требует назначения' : 'Bellemeli'}</span>
          <span className="kt-station-meta">{ru ? 'без цеха' : 'bölümsiz'}</span>
        </button>
        {/* Stage 44: the refresh control also says how old the board is, so nobody cooks from a
            frozen screen. The label reflects the last SUCCESSFUL read only. */}
        <button className="kt-station-tab" onClick={() => void loadQueue()} aria-label={ru ? 'Обновить' : 'Täzele'}>
          <span className="kt-station-name"><RefreshCw className="w-5 h-5" /></span>
          <span className="kt-station-meta" id="kt-last-updated" aria-live="polite" data-tick={tick}>
            {lastUpdatedAt ? timeAgoLabel(lastUpdatedAt, ru) : (ru ? 'обновить' : 'täzele')}
          </span>
        </button>
        {hasPermission('kitchen.help.request') && (
          <button id="kt-help" className="kt-station-tab" onClick={() => setHelpOpen(true)}>
            <span className="kt-station-name"><HandHelping className="w-5 h-5" /></span>
            <span className="kt-station-meta">{ru ? 'нужна помощь' : 'kömek gerek'}</span>
          </button>
        )}
      </div>

      {/* Stage 44: a failed refresh with a board already on screen is a stale notice, not an
          empty screen -- the cook keeps the last real queue and is told how old it is. A failure
          with nothing to show yet stays the hard error. */}
      {error && queue && (
        <div className="kt-stale" id="kt-stale">
          {ru ? 'Не удалось обновить очередь.' : 'Nobaty täzeläp bolmady.'}{' '}
          {lastUpdatedAt ? (ru ? `Показаны данные от ${agoFragment(lastUpdatedAt, true)}.` : `${agoFragment(lastUpdatedAt, false)} maglumatlar görkezilýär.`) : ''}
        </div>
      )}
      {error && !queue && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {load && (
        <div className="kt-load">
          <div className="kt-load-tile"><div className="kt-load-label">{ru ? 'Готовится' : 'Taýýarlanýar'}</div><div className="kt-load-value">{load.active_tasks}</div></div>
          <div className="kt-load-tile"><div className="kt-load-label">{ru ? 'Ожидает' : 'Nobatda'}</div><div className="kt-load-value">{load.waiting_tasks}</div></div>
          <div className={`kt-load-tile ${load.remaining_minutes > 30 ? 'is-warn' : ''}`}>
            <div className="kt-load-label">{ru ? 'Работы осталось' : 'Galan iş'}</div>
            <div className="kt-load-value">{load.remaining_minutes} <span style={{ fontSize: 14 }}>{ru ? 'мин' : 'min'}</span></div>
          </div>
          <div className={`kt-load-tile ${load.delayed_tasks ? 'is-bad' : ''}`}>
            <div className="kt-load-label">{ru ? 'С задержкой' : 'Gijä galan'}</div><div className="kt-load-value">{load.delayed_tasks}</div>
          </div>
        </div>
      )}

      {loading && !queue ? <LoadingState /> : (
        <div className="kt-board">
          {COLUMNS.map(col => (
            <div className="kt-column" key={col.key} data-column={col.key}>
              <div className="kt-column-head">
                <span>{ru ? col.ru : col.tk}</span>
                <span className="kt-column-count">{byStatus[col.key].length}</span>
              </div>
              {byStatus[col.key].length ? byStatus[col.key].map(card) : (
                <div className="kt-empty">
                  {col.key === 'QUEUED'
                    ? (ru ? 'Новых позиций нет.' : 'Täze pozisiýa ýok.')
                    : col.key === 'READY'
                      ? (ru ? 'Готовых позиций нет — они уходят на выдачу.' : 'Taýýar pozisiýa ýok — olar beriş bölümine geçýär.')
                      : (ru ? 'Пусто.' : 'Boş.')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmReady)}
        title={ru ? 'Отметить позицию готовой?' : 'Pozisiýany taýýar bellemeli?'}
        description={confirmReady
          ? (ru
            ? `«${confirmReady.title_snapshot}» ×${confirmReady.quantity} уйдёт на выдачу. Заказ станет готовым только когда закончат все цеха.`
            : `«${confirmReady.title_snapshot}» ×${confirmReady.quantity} beriş bölümine geçer. Sargyt ähli bölümler gutaranda taýýar bolar.`)
          : undefined}
        confirmLabel={ru ? 'Готово' : 'Taýýar'}
        tone="primary"
        busy={busy}
        onCancel={() => setConfirmReady(null)}
        onConfirm={() => { const t = confirmReady; setConfirmReady(null); if (t) void act(() => api.setKitchenTaskStatus(t.id, 'READY'), ru ? 'Позиция отмечена готовой.' : 'Pozisiýa taýýar bellenildi.'); }}
      />

      <Modal
        open={Boolean(problemFor)}
        title={ru ? 'Что не так с позицией?' : 'Pozisiýa näme boldy?'}
        description={problemFor ? `${problemFor.title_snapshot} ×${problemFor.quantity} · №${problemFor.order_number}` : undefined}
        onClose={() => setProblemFor(null)}
        footer={<>
          <button className="btn-secondary" onClick={() => setProblemFor(null)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn" disabled={busy || problemText.trim().length < 3}
            onClick={() => { const t = problemFor; const text = problemText.trim(); setProblemFor(null); if (t) void act(() => api.reportKitchenProblem(t.id, text), ru ? 'Менеджер получил сообщение.' : 'Menejer habary aldy.'); }}>
            {ru ? 'Сообщить менеджеру' : 'Menejere habar ber'}
          </button>
        </>}
      >
        <label className="block">
          <span className="boom-label">{ru ? 'Опишите проблему' : 'Meseläni ýazyň'}<span className="boom-req">*</span></span>
          <textarea className="field" rows={3} value={problemText} onChange={e => setProblemText(e.target.value)}
            placeholder={ru ? 'например, нет соуса для этого блюда' : 'meselem, bu nahar üçin sous ýok'} />
        </label>
      </Modal>

      <Modal
        open={helpOpen}
        title={ru ? 'Запросить помощь' : 'Kömek sora'}
        description={ru ? 'Запрос уйдёт менеджеру кухни с указанием цеха и времени.' : 'Haýyş bölüm we wagt bilen aşhana menejerine gider.'}
        onClose={() => setHelpOpen(false)}
        footer={<>
          <button className="btn-secondary" onClick={() => setHelpOpen(false)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn" disabled={busy}
            onClick={() => { const reason = helpReason, comment = helpComment.trim(); setHelpOpen(false); setHelpComment('');
              void act(() => api.requestKitchenHelp({ branch_id: branchId, station_id: stationId === 'UNASSIGNED' ? null : stationId, reason, comment: comment || undefined }), ru ? 'Запрос отправлен менеджеру.' : 'Haýyş menejere iberildi.'); }}>
            {ru ? 'Отправить' : 'Iber'}
          </button>
        </>}
      >
        <div className="flex flex-col gap-2">
          {HELP_REASONS.map(r => (
            <label key={r.code} className="flex items-center gap-2 text-sm">
              <input type="radio" name="kt-help-reason" checked={helpReason === r.code} onChange={() => setHelpReason(r.code)} />
              {ru ? r.ru : r.tk}
            </label>
          ))}
          <label className="block mt-2">
            <span className="boom-label">{ru ? 'Комментарий' : 'Bellik'}</span>
            <input className="field" value={helpComment} onChange={e => setHelpComment(e.target.value)}
              placeholder={ru ? 'например, закончилось масло' : 'meselem, ýag gutardy'} />
          </label>
        </div>
      </Modal>
    </div>
  );
};

// The quick notes a waiter can send, in the kitchen's own words. Kept next to the screen that
// displays them so the two never drift apart.
export const QUICK_RU: Record<string, string> = {
  NO_ONION: 'Без лука', NO_SAUCE: 'Без соуса', NOT_SPICY: 'Не остро', ALLERGY_CHECK: 'Аллергия — уточнить',
  GUEST_WAITING: 'Гость ждёт', SERVE_TOGETHER: 'Подать вместе', URGENT: 'Срочно', FREE_TEXT: 'Комментарий',
};
export const QUICK_TK: Record<string, string> = {
  NO_ONION: 'Sogansyz', NO_SAUCE: 'Soussyz', NOT_SPICY: 'Ýiti däl', ALLERGY_CHECK: 'Allergiýa — anyklaň',
  GUEST_WAITING: 'Myhman garaşýar', SERVE_TOGETHER: 'Bilelikde beriň', URGENT: 'Gyssagly', FREE_TEXT: 'Bellik',
};
