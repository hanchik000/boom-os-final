import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCheck, Gauge, RefreshCw, Settings2, TriangleAlert } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useBranchScope } from '../useBranchScope';
import { useLanguage } from '../context/LanguageContext';
import { errorText } from '../humanErrors';
import { agoFragment, timeAgoLabel } from '../freshness';
import { EmptyState, LoadingState, Modal, Notice, Toolbar } from './ui';
import { QUICK_RU, QUICK_TK } from './KitchenStationView';

// ----------------------------------------------------------------------------------------------
// Stage 42 -- the kitchen manager's screen: how loaded each station is, what is late, what the
// floor has said, who has asked for help, and which orders are waiting at the pass.
//
// Every figure comes from /api/kitchen/load and /api/kitchen/alerts. This component performs no
// arithmetic on business data: it formats what the server measured.
// ----------------------------------------------------------------------------------------------

const REFRESH_MS = 30000;

export const KitchenControlView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const { branchId, setBranchId, branches } = useBranchScope();
  const [load, setLoad] = useState<any | null>(null);
  const [alerts, setAlerts] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resolving, setResolving] = useState<any | null>(null);
  const [resolution, setResolution] = useState('');
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limits, setLimits] = useState({ warning_ratio: '0.8', late_ratio: '1', critical_ratio: '1.5', escalate_minutes: '5' });
  // Stage 43: a limit can be set for the branch, for one station, or for a whole dish category.
  const [limitScope, setLimitScope] = useState<{ kind: 'BRANCH' | 'STATION' | 'CATEGORY'; id: string }>({ kind: 'BRANCH', id: '' });
  const [categories, setCategories] = useState<any[]>([]);
  const [savedLimits, setSavedLimits] = useState<any[]>([]);


  const refresh = useCallback(async (silent = false) => {
    if (!branchId) { setLoading(false); return; }
    if (!silent) setLoading(true);
    try {
      const [l, a] = await Promise.all([api.getKitchenLoad(branchId), hasPermission('kitchen.alerts.view') ? api.getKitchenAlerts(branchId) : Promise.resolve(null)]);
      setLoad(l); setAlerts(a); setError(''); setLastUpdatedAt(Date.now());
      if (hasPermission('kitchen.thresholds.manage')) {
        try {
          const [cats, th] = await Promise.all([api.getMenuAdmin(branchId), api.getKitchenThresholds(branchId)]);
          setCategories(cats.categories || []);
          setSavedLimits(th.thresholds || []);
        } catch { /* the load screen still works without the limits editor */ }
      }
      if (l?.thresholds) {
        setLimits({
          warning_ratio: String(l.thresholds.warning_ratio), late_ratio: String(l.thresholds.late_ratio),
          critical_ratio: String(l.thresholds.critical_ratio), escalate_minutes: String(l.thresholds.escalate_minutes),
        });
      }
    } catch (e: any) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [branchId, hasPermission]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Stage 44: polling pauses while the tab is hidden and reads once immediately on return, and the
  // screen states how old its numbers are -- a manager acts on these figures.
  useEffect(() => {
    let timer: number | null = null;
    const start = () => { if (timer === null) timer = window.setInterval(() => { void refresh(true); }, REFRESH_MS); };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { void refresh(true); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [refresh]);

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
    try { await fn(); if (message) setNotice(message); await refresh(true); }
    catch (e: any) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(ru ? 'ru-RU' : 'tk-TM', { hour: '2-digit', minute: '2-digit' });
  const alertTitle = (a: any) => {
    if (a.type === 'HELP_REQUEST') return ru ? 'Запрос помощи' : 'Kömek haýyşy';
    if (a.type === 'PROBLEM') return ru ? 'Проблема в цехе' : 'Bölümde mesele';
    if (a.type === 'DELAY_ESCALATED') return ru ? 'Напоминание: заказ всё ещё не готов' : 'Ýatlatma: sargyt henizem taýýar däl';
    if (a.type === 'DELAY_CRITICAL') return ru ? 'Критическая задержка' : 'Kritiki gijä galma';
    if (a.type === 'DELAY_LATE') return ru ? 'Задержка' : 'Gijä galma';
    if (a.type === 'DELAY_WARNING') return ru ? 'Скоро задержка' : 'Ýakynda gijä galma';
    if (a.type === 'ITEM_RETURNED') return ru ? 'Позиция возвращена' : 'Pozisiýa gaýtaryldy';
    if (a.type === 'COMMENT_AFTER_START') return ru ? 'Уточнение после начала готовки' : 'Taýýarlyk başlanandan soň düşündiriş';
    if (a.type === 'ORDER_HANDED_OVER_INCOMPLETE') return ru ? 'Заказ отдан не полностью' : 'Sargyt doly däl berildi';
    if (a.type === 'ORDER_HANDED_OVER') return ru ? 'Заказ передан' : 'Sargyt berildi';
    return a.type;
  };
  const helpReasonLabel = (r: string) => ({
    STAFF: ru ? 'не хватает людей' : 'işgär ýetmeýär', EQUIPMENT: ru ? 'оборудование' : 'enjam',
    INGREDIENTS: ru ? 'закончились продукты' : 'önümler gutardy', UNCLEAR_ITEM: ru ? 'непонятная позиция' : 'düşnüksiz pozisiýa',
    URGENT: ru ? 'срочно' : 'gyssagly', OTHER: ru ? 'другое' : 'başga',
  } as Record<string, string>)[r] || r;

  if (!hasPermission('kds.view')) {
    return <div className="p-8 text-slate-400">{ru ? 'У вас нет доступа к данным кухни.' : 'Aşhana maglumatlaryna elýeterliligiňiz ýok.'}</div>;
  }

  // Stage 44: with no branch this screen rendered nothing at all and explained nothing.
  if (!branchId) {
    return (
      <div className="p-8">
        <EmptyState
          title={ru ? 'Филиал не выбран.' : 'Şahamça saýlanmadyk.'}
          hint={ru
            ? 'Загрузка кухни считается по одному филиалу. Выберите филиал в шапке страницы или попросите администратора привязать вашу учётную запись к филиалу.'
            : 'Aşhananyň ýüki bir şahamça boýunça hasaplanýar. Sahypanyň ýokarsynda şahamçany saýlaň ýa-da hasabyňyzy şahamça baglamagy administratordan soraň.'}
        />
      </div>
    );
  }

  return (
    <div className="kitchen-screen boom-reduced-motion-safe" id="kitchen-control-view">
      <Toolbar left={branches.length > 1 ? (
        <select className="field w-56" aria-label={ru ? 'Филиал' : 'Şahamça'} value={branchId} onChange={e => setBranchId(e.target.value)}>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
        </select>
      ) : undefined}>
        {hasPermission('kitchen.thresholds.manage') && (
          <button className="btn-secondary" onClick={() => setLimitsOpen(true)}><Settings2 className="w-4 h-4" />{ru ? 'Пределы задержки' : 'Gijä galma çäkleri'}</button>
        )}
        <span className="kt-last-updated" id="kitchen-control-last-updated" aria-live="polite" data-tick={tick}>
          {lastUpdatedAt ? timeAgoLabel(lastUpdatedAt, ru) : ''}
        </span>
        <button className="btn-secondary" onClick={() => void refresh()}><RefreshCw className="w-4 h-4" />{ru ? 'Обновить' : 'Täzele'}</button>
      </Toolbar>

      {/* Stage 44: a failed refresh keeps the last real numbers on screen and dates them. */}
      {error && load && (
        <div className="kt-stale" id="kitchen-control-stale">
          {ru ? 'Не удалось обновить данные кухни.' : 'Aşhananyň maglumatlaryny täzeläp bolmady.'}{' '}
          {lastUpdatedAt ? (ru ? `Показаны данные от ${agoFragment(lastUpdatedAt, true)}.` : `${agoFragment(lastUpdatedAt, false)} maglumatlar görkezilýär.`) : ''}
        </div>
      )}
      {error && !load && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {loading && !load ? <LoadingState /> : !load ? null : (
        <>
          <div className="kt-scroll">
            <table className="kt-table" id="kitchen-load-table">
              <thead>
                <tr>
                  <th>{ru ? 'Цех' : 'Bölüm'}</th>
                  <th>{ru ? 'Готовится' : 'Taýýarlanýar'}</th>
                  <th>{ru ? 'Ожидает' : 'Nobatda'}</th>
                  <th>{ru ? 'Работы осталось' : 'Galan iş'}</th>
                  <th>{ru ? 'Ожидание гостя' : 'Myhmanyň garaşmagy'}</th>
                  <th>{ru ? 'Сделано за период' : 'Döwürde edildi'}</th>
                  <th>{ru ? 'В час' : 'Sagatda'}</th>
                  <th>{ru ? 'Медиана' : 'Mediana'}</th>
                  <th>{ru ? 'В норматив' : 'Kadada'}</th>
                  <th>{ru ? 'С задержкой' : 'Gijä galan'}</th>
                  <th>{ru ? 'Узкое место' : 'Dar ýer'}</th>
                </tr>
              </thead>
              <tbody>
                {load.stations.map((s: any) => (
                  <tr key={s.station.id} data-station={s.station.code}>
                    <td><b>{ru ? s.station.name_ru : s.station.name_tk}</b><div className="kt-station-meta">{s.station.code}</div></td>
                    <td>{s.active_tasks}</td>
                    <td>{s.waiting_tasks}</td>
                    <td>{s.remaining_minutes} {ru ? 'мин' : 'min'}</td>
                    <td>{s.forecast_wait_minutes} {ru ? 'мин' : 'min'}</td>
                    <td>{s.completed_in_window}</td>
                    <td>{s.throughput_per_hour}</td>
                    <td>{s.median_minutes === null ? '—' : `${s.median_minutes} ${ru ? 'мин' : 'min'}`}</td>
                    <td>{s.within_norm_share === null ? '—' : `${s.within_norm_share}%`}</td>
                    <td className={s.delayed_tasks ? 'text-red-300' : ''}>{s.delayed_tasks}</td>
                    <td>{s.bottleneck_items.length ? `${s.bottleneck_items[0].title_snapshot} · ${Math.round(s.bottleneck_items[0].minutes)} ${ru ? 'мин' : 'min'}` : '—'}</td>
                  </tr>
                ))}
                {load.unassigned.waiting_tasks + load.unassigned.active_tasks > 0 && (
                  <tr data-station="UNASSIGNED">
                    <td><b>{ru ? 'Требует назначения' : 'Bellemeli'}</b></td>
                    <td>{load.unassigned.active_tasks}</td>
                    <td>{load.unassigned.waiting_tasks}</td>
                    <td colSpan={8}>{ru ? 'У этих позиций не настроен цех — назначьте его в «Блюда и цены».' : 'Bu pozisiýalaryň bölümi düzülmedik — ony «Tagamlar we bahalar» bölüminde belläň.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="kt-station-meta">
            {ru ? 'Период' : 'Döwür'}: {hhmm(load.window.from)} — {hhmm(load.window.to)} · {ru ? 'предел задержки' : 'gijä galma çägi'} ×{load.thresholds.late_ratio}
          </div>
        </>
      )}

      {alerts && (
        <>
          <div className="kt-column-head" style={{ marginTop: 8 }}>
            <span><BellRing className="w-4 h-4 inline mr-2" />{ru ? 'Требует решения' : 'Çözgüt gerek'}</span>
            <span className="kt-column-count">{alerts.alerts.length}</span>
          </div>
          <div className="kt-alerts" id="kitchen-alerts">
            {alerts.alerts.length === 0 ? (
              <EmptyState title={ru ? 'Открытых вопросов нет.' : 'Açyk sorag ýok.'}
                hint={ru ? 'Здесь появляются задержки, проблемы цехов и запросы помощи.' : 'Bu ýerde gijä galmalar, bölüm meseleleri we kömek haýyşlary görkeziler.'} />
            ) : alerts.alerts.map((a: any) => (
              <div key={a.id} className={`kt-alert ${a.severity === 'CRITICAL' ? 'is-critical' : a.severity === 'HIGH' ? 'is-high' : ''}`} data-alert-type={a.type}>
                <div>
                  <div><b>{alertTitle(a)}</b>{a.station_code ? ` · ${a.station_code}` : ''}{a.order_number ? ` · №${a.order_number}` : ''}</div>
                  <div className="kt-alert-meta">
                    {a.type === 'HELP_REQUEST' ? helpReasonLabel(a.reason) : (ru ? a.message_ru : a.message_tk) || a.reason || ''}
                    {' · '}{hhmm(a.created_at)}{a.created_by_name ? ` · ${a.created_by_name}` : ''}
                  </div>
                </div>
                {hasPermission('kitchen.alerts.resolve') && (
                  <button className="btn-secondary" disabled={busy} onClick={() => { setResolving(a); setResolution(''); }}>
                    <CheckCheck className="w-4 h-4" />{ru ? 'Решено' : 'Çözüldi'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {Boolean(alerts.comments.length) && (
            <>
              <div className="kt-column-head"><span><TriangleAlert className="w-4 h-4 inline mr-2" />{ru ? 'Сообщения от официантов' : 'Ofisiantlardan habarlar'}</span><span className="kt-column-count">{alerts.comments.length}</span></div>
              <div className="kt-alerts">
                {alerts.comments.map((c: any) => (
                  <div key={c.id} className={`kt-alert ${c.after_start ? 'is-high' : ''}`}>
                    <div>
                      <div><b>№{c.order_number}</b> · {c.kind === 'FREE_TEXT' ? c.text : (ru ? QUICK_RU[c.kind] || c.kind : QUICK_TK[c.kind] || c.kind)}</div>
                      <div className="kt-alert-meta">
                        {c.author_name || (ru ? 'официант' : 'ofisiant')} · {hhmm(c.created_at)}
                        {c.after_start ? ` · ${ru ? 'после начала готовки' : 'taýýarlyk başlanandan soň'}` : ''}
                      </div>
                    </div>
                    {hasPermission('kds.update') && (
                      <button className="btn-secondary" disabled={busy} onClick={() => void act(() => api.ackKitchenComment(c.id))}>{ru ? 'Прочитано' : 'Okaldy'}</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {Boolean(alerts.awaiting_expo.length) && (
            <>
              <div className="kt-column-head"><span><Gauge className="w-4 h-4 inline mr-2" />{ru ? 'Ждут выдачи' : 'Berilmegine garaşýar'}</span><span className="kt-column-count">{alerts.awaiting_expo.length}</span></div>
              <div className="kt-alerts">
                {alerts.awaiting_expo.map((o: any) => (
                  <div key={o.id} className="kt-alert">
                    <div><b>№{o.order_number}</b> · {ru ? 'готово' : 'taýýar'} {o.ready_items}/{o.items}</div>
                    <div className="kt-alert-meta">{o.ready_items === o.items ? (ru ? 'можно передавать' : 'bermek bolýar') : (ru ? 'ещё готовится' : 'entek taýýarlanýar')}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={Boolean(resolving)}
        title={ru ? 'Что было сделано?' : 'Näme edildi?'}
        description={resolving ? alertTitle(resolving) : undefined}
        onClose={() => setResolving(null)}
        footer={<>
          <button className="btn-secondary" onClick={() => setResolving(null)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn" disabled={busy}
            onClick={() => { const a = resolving; const text = resolution.trim(); setResolving(null);
              if (a) void act(() => api.resolveKitchenAlert(a.id, text || undefined), ru ? 'Решение сохранено.' : 'Çözgüt saklandy.'); }}>
            {ru ? 'Сохранить' : 'Sakla'}
          </button>
        </>}
      >
        <label className="block">
          <span className="boom-label">{ru ? 'Решение' : 'Çözgüt'}</span>
          <input className="field" value={resolution} onChange={e => setResolution(e.target.value)}
            placeholder={ru ? 'например, перевели повара на гриль' : 'meselem, nahar bişirijini grile geçirdik'} />
          <span className="boom-help">{ru ? 'Сохраняется в журнале действий вместе с вашим именем и временем.' : 'Adyňyz we wagt bilen hereket žurnalynda saklanýar.'}</span>
        </label>
      </Modal>

      <Modal
        open={limitsOpen}
        title={ru ? 'Когда считать задержкой' : 'Haçan gijä galma hasaplamaly'}
        description={ru
          ? 'Доли от прогнозного времени позиции: 0.8 — предупредить, 1.0 — задержка, 1.5 — критично. Так один предел работает и для напитка, и для стейка.'
          : 'Pozisiýanyň çaklama wagtynyň paýlary: 0.8 — duýduryş, 1.0 — gijä galma, 1.5 — kritiki. Şeýlelikde bir çäk içgi üçin hem, steýk üçin hem işleýär.'}
        onClose={() => setLimitsOpen(false)}
        footer={<>
          <button className="btn-secondary" onClick={() => setLimitsOpen(false)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
          <button className="btn" disabled={busy}
            onClick={() => { setLimitsOpen(false); void act(() => api.setKitchenThresholds({
              branch_id: branchId,
              station_id: limitScope.kind === 'STATION' ? limitScope.id : null,
              category_id: limitScope.kind === 'CATEGORY' ? limitScope.id : null,
              warning_ratio: Number(limits.warning_ratio), late_ratio: Number(limits.late_ratio),
              critical_ratio: Number(limits.critical_ratio), escalate_minutes: Number(limits.escalate_minutes),
            }), ru ? 'Пределы сохранены.' : 'Çäkler saklandy.'); }}>
            {ru ? 'Сохранить' : 'Sakla'}
          </button>
        </>}
      >
        <label className="block mb-3">
          <span className="boom-label">{ru ? 'Для чего эти пределы' : 'Bu çäkler näme üçin'}</span>
          <select className="field" value={`${limitScope.kind}:${limitScope.id}`}
            onChange={e => { const [kind, id] = e.target.value.split(':'); setLimitScope({ kind: kind as any, id: id || '' }); }}>
            <option value="BRANCH:">{ru ? 'Весь филиал (по умолчанию)' : 'Tutuş şahamça (deslapky)'}</option>
            {(load?.stations || []).map((s2: any) => (
              <option key={s2.station.id} value={`STATION:${s2.station.id}`}>
                {ru ? `Цех: ${s2.station.name_ru}` : `Bölüm: ${s2.station.name_tk}`}
              </option>
            ))}
            {categories.map((c: any) => (
              <option key={c.id} value={`CATEGORY:${c.id}`}>
                {ru ? `Категория: ${c.name_ru}` : `Kategoriýa: ${c.name_tk}`}
              </option>
            ))}
          </select>
          <span className="boom-help">
            {ru
              ? 'Самая точная настройка побеждает: цех+категория, затем категория, затем цех, затем филиал.'
              : 'Iň takyk sazlama ýeňýär: bölüm+kategoriýa, soňra kategoriýa, soňra bölüm, soňra şahamça.'}
          </span>
        </label>
        {Boolean(savedLimits.length) && (
          <div className="kt-station-meta" style={{ marginBottom: 10 }}>
            {ru ? 'Уже настроено' : 'Eýýäm düzülen'}: {savedLimits.map((t: any) =>
              `${t.category_name_ru ? (ru ? t.category_name_ru : t.category_name_tk) : t.station_code || (ru ? 'филиал' : 'şahamça')} ×${Number(t.late_ratio)}`
            ).join(' · ')}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {([['warning_ratio', ru ? 'Предупреждение' : 'Duýduryş'], ['late_ratio', ru ? 'Задержка' : 'Gijä galma'],
             ['critical_ratio', ru ? 'Критично' : 'Kritiki'], ['escalate_minutes', ru ? 'Напоминать каждые, мин' : 'Her näçe minutda ýatlatmaly']] as const).map(([key, label]) => (
            <label key={key} className="block">
              <span className="boom-label">{label}</span>
              <input className="field" type="number" step="0.1" min="0" value={(limits as any)[key]}
                onChange={e => setLimits({ ...limits, [key]: e.target.value })} />
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
};
