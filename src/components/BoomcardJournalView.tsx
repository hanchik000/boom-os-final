import React, { useEffect, useState } from 'react';
import { Loader2, ScrollText, X, Search } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { LoadingState } from './ui';

// ---------------------------------------------------------------------------------------------
// Stage 34.12 -- the unified BOOMCARD Operations Journal, manager-facing.
//
// This screen computes NOTHING. Every row, every count and every amount arrives already computed
// by the server from the existing boomcoin_ledger / boomback_ledger / boomcard_events -- there is
// no client-side balance, total or category arithmetic anywhere in this file. A filter selection
// is a query parameter, not a calculation.
// ---------------------------------------------------------------------------------------------

const EVENT_TYPE_LABELS: Record<string, { ru: string; tk: string }> = {
  BOOMCOIN_EARNED: { ru: 'BOOMCOIN начислен', tk: 'BOOMCOIN hasaplandy' },
  BOOMCOIN_REDEEMED: { ru: 'BOOMCOIN списан', tk: 'BOOMCOIN pozuldy' },
  BOOMCOIN_ADJUSTED: { ru: 'BOOMCOIN корректировка', tk: 'BOOMCOIN düzetme' },
  BOOMCOIN_REVERSED: { ru: 'BOOMCOIN отменён', tk: 'BOOMCOIN yatyryldy' },
  BOOMBACK_EARNED: { ru: 'BOOMBACK начислен', tk: 'BOOMBACK hasaplandy' },
  BOOMBACK_REDEEMED: { ru: 'BOOMBACK списан', tk: 'BOOMBACK pozuldy' },
  BOOMBACK_ADJUSTED: { ru: 'BOOMBACK корректировка', tk: 'BOOMBACK düzetme' },
  BOOMBACK_REVERSED: { ru: 'BOOMBACK отменён', tk: 'BOOMBACK yatyryldy' },
  BREAKFAST_GRANTED: { ru: 'Завтрак начислен', tk: 'Ertirlik berildi' },
  BREAKFAST_REDEEMED: { ru: 'Завтрак использован', tk: 'Ertirlik ulanyldy' },
  BIRTHDAY_GIFT_GRANTED: { ru: 'Подарок ко дню рождения выдан', tk: 'Doglan gün sowgady berildi' },
  BIRTHDAY_GIFT_REDEEMED: { ru: 'Подарок ко дню рождения использован', tk: 'Doglan gün sowgady ulanyldy' },
  BOOMCARD_ACTIVATED: { ru: 'Карта активирована', tk: 'Kart işjeňleşdirildi' },
  BOOMCARD_RENEWED: { ru: 'Карта продлена', tk: 'Kart uzaldyldy' },
  BOOMCARD_DEACTIVATED: { ru: 'Карта деактивирована', tk: 'Kart öçürildi' },
  CANDIDATE_IDENTIFIED: { ru: 'Кандидат определён', tk: 'Dalaşgär anyklandy' },
};
const CATEGORY_STYLE: Record<string, string> = {
  OPERATIONAL_BENEFIT: 'bg-sky-500/20 text-sky-400',
  PAYMENT_SETTLEMENT: 'bg-amber-500/20 text-amber-400',
  CUSTOMER_REWARD: 'bg-emerald-500/20 text-emerald-400',
  LIFECYCLE: 'bg-slate-700 text-slate-300',
};
const CATEGORY_LABELS: Record<string, { ru: string; tk: string }> = {
  OPERATIONAL_BENEFIT: { ru: 'Операционная льгота', tk: 'Amal ýeňilligi' },
  PAYMENT_SETTLEMENT: { ru: 'Оплата/расчёт', tk: 'Töleg/hasaplaşyk' },
  CUSTOMER_REWARD: { ru: 'Награда гостю', tk: 'Myhman sylagy' },
  LIFECYCLE: { ru: 'Жизненный цикл карты', tk: 'Kartyň ömür aýlawy' },
};

function money(v: any) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : String(v); }

export const BoomcardJournalView: React.FC = () => {
  const { user } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [eventType, setEventType] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [orderIdFilter, setOrderIdFilter] = useState('');

  const [detail, setDetail] = useState<any | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const filters = () => ({
    branch_id: branchId,
    ...(start ? { start: new Date(start).toISOString() } : {}),
    ...(end ? { end: new Date(end + 'T23:59:59').toISOString() } : {}),
    ...(eventType ? { event_type: eventType } : {}),
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
    ...(orderIdFilter ? { order_id: orderIdFilter } : {}),
  });

  const load = async () => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      const res = await api.getBoomcardJournal({ ...filters(), page, page_size: pageSize });
      setRows(res.rows); setTotal(res.total); setTotalPages(res.total_pages);
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
    finally { setLoading(false); }
  };
  const loadSummary = async () => {
    if (!branchId) return;
    try { setSummary(await api.getBoomcardJournalSummary(filters())); }
    catch (e: any) { setError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId, page, start, end, eventType, source, search, orderIdFilter]);
  useEffect(() => { setPage(1); }, [start, end, eventType, source, search, orderIdFilter]);
  useEffect(() => { if (summaryOpen) void loadSummary(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [summaryOpen, branchId, start, end]);

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); setSearch(searchInput.trim()); };

  const eventTypes = Object.keys(EVENT_TYPE_LABELS);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-300">
          <ScrollText className="w-4 h-4" />
          <span className="text-sm font-semibold">{ru ? 'Журнал операций BOOMCARD' : 'BOOMCARD amallar žurnaly'}</span>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => setSummaryOpen(true)}>{ru ? 'Сводка' : 'Jemleýji'}</button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{ru ? 'Период' : 'Döwür'}</span>
          <input type="date" className="field text-xs py-1" value={start} onChange={e => setStart(e.target.value)} />
          <span>—</span>
          <input type="date" className="field text-xs py-1" value={end} onChange={e => setEnd(e.target.value)} />
        </div>
        <select className="field text-xs py-1" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">{ru ? 'Все источники' : 'Ähli çeşmeler'}</option>
          <option value="BOOMCOIN_LEDGER">BOOMCOIN</option>
          <option value="BOOMBACK_LEDGER">BOOMBACK</option>
          <option value="BOOMCARD_EVENT">{ru ? 'Карта / завтрак / подарок' : 'Kart / ertirlik / sowgat'}</option>
        </select>
        <select className="field text-xs py-1" value={eventType} onChange={e => setEventType(e.target.value)}>
          <option value="">{ru ? 'Все типы событий' : 'Ähli waka görnüşleri'}</option>
          {eventTypes.map(t => <option key={t} value={t}>{ru ? EVENT_TYPE_LABELS[t].ru : EVENT_TYPE_LABELS[t].tk}</option>)}
        </select>
        <form onSubmit={submitSearch} className="flex items-center gap-1">
          <input className="field text-xs py-1 w-48" placeholder={ru ? 'Гость, телефон, карта, заказ…' : 'Myhman, telefon, kart, sargyt…'} value={searchInput} onChange={e => setSearchInput(e.target.value)} />
          <button type="submit" className="btn-secondary btn-sm"><Search className="w-3.5 h-3.5" /></button>
        </form>
        {(start || end || eventType || source || search || orderIdFilter) && (
          <button className="btn-secondary btn-sm" onClick={() => { setStart(''); setEnd(''); setEventType(''); setSource(''); setSearch(''); setSearchInput(''); setOrderIdFilter(''); }}>{ru ? 'Сбросить' : 'Arassala'}</button>
        )}
      </div>

      {loading && <LoadingState/>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Дата' : 'Sene'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Событие' : 'Waka'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Гость' : 'Myhman'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Заказ' : 'Sargyt'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Оператор' : 'Operator'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Кол-во' : 'Sany'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Сумма' : 'Mukdar'}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.source}-${r.source_id}`} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${CATEGORY_STYLE[r.event_category] || 'bg-slate-700 text-slate-300'}`}>{ru ? (CATEGORY_LABELS[r.event_category]?.ru || r.event_category) : (CATEGORY_LABELS[r.event_category]?.tk || r.event_category)}</span>
                      <span>{ru ? (EVENT_TYPE_LABELS[r.event_type]?.ru || r.event_type) : (EVENT_TYPE_LABELS[r.event_type]?.tk || r.event_type)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.customer_name || '—'}{r.customer_phone ? <span className="text-slate-500"> · {r.customer_phone}</span> : ''}</td>
                  <td className="px-3 py-2">{r.order_number || '—'}</td>
                  <td className="px-3 py-2">{r.operator_name || '—'}{r.operator_role ? <span className="text-slate-500"> · {r.operator_role}</span> : ''}</td>
                  <td className="px-3 py-2 text-right">{r.quantity ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.boomback_amount !== null ? <span className="text-amber-400">{money(r.boomback_amount)}</span>
                      : r.boomcoin_amount !== null ? <span className="text-emerald-400">{r.boomcoin_amount}</span>
                      : r.amount !== null ? money(r.amount) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right"><button className="btn-secondary btn-sm" onClick={() => setDetail(r)}>{ru ? 'Детали' : 'Jikme-jik'}</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет записей за период' : 'Döwürde ýazgy ýok'}</td></tr>}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-800 text-[11px] text-slate-400">
            <span>{ru ? `Всего: ${total}` : `Jemi: ${total}`}</span>
            <div className="flex items-center gap-2">
              <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{ru ? 'Назад' : 'Yza'}</button>
              <span>{page} / {totalPages}</span>
              <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{ru ? 'Вперёд' : 'Öňe'}</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <h2 className="text-white text-lg font-bold">{ru ? (EVENT_TYPE_LABELS[detail.event_type]?.ru || detail.event_type) : (EVENT_TYPE_LABELS[detail.event_type]?.tk || detail.event_type)}</h2>
              <button className="text-slate-400 hover:text-white" onClick={() => setDetail(null)}><X className="w-4 h-4" /></button>
            </div>
            <dl className="text-xs grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-slate-300">
              <dt className="text-slate-500">{ru ? 'Дата' : 'Sene'}</dt><dd>{new Date(detail.created_at).toLocaleString()}</dd>
              <dt className="text-slate-500">{ru ? 'Источник' : 'Çeşme'}</dt><dd>{detail.source} · {detail.source_id}</dd>
              <dt className="text-slate-500">{ru ? 'Гость' : 'Myhman'}</dt><dd>{detail.customer_name || '—'} {detail.customer_phone ? `(${detail.customer_phone})` : ''}</dd>
              <dt className="text-slate-500">BOOMCARD</dt><dd>{detail.card_number || '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Заказ' : 'Sargyt'}</dt><dd>{detail.order_number || '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Платёж' : 'Töleg'}</dt><dd>{detail.payment_id || '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Блюдо' : 'Nahar'}</dt><dd>{(ru ? detail.menu_item_name_ru : detail.menu_item_name_tk) || '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Кол-во' : 'Sany'}</dt><dd>{detail.quantity ?? '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Сумма' : 'Mukdar'}</dt><dd>{detail.amount !== null ? money(detail.amount) : '—'}</dd>
              <dt className="text-slate-500">BOOMBACK</dt><dd>{detail.boomback_amount !== null ? money(detail.boomback_amount) : '—'}</dd>
              <dt className="text-slate-500">BOOMCOIN</dt><dd>{detail.boomcoin_amount ?? '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Баланс до/после' : 'Balans öň/soň'}</dt><dd>{detail.balance_before !== null ? `${detail.balance_before} → ${detail.balance_after}` : '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Оператор' : 'Operator'}</dt><dd>{detail.operator_name || '—'} {detail.operator_role ? `(${detail.operator_role})` : ''}</dd>
              <dt className="text-slate-500">{ru ? 'Причина' : 'Sebäp'}</dt><dd>{detail.reason || '—'}</dd>
              <dt className="text-slate-500">{ru ? 'Статус' : 'Ýagdaý'}</dt><dd>{detail.status || '—'}</dd>
            </dl>
            {detail.order_id && <button className="btn-secondary btn-sm" onClick={() => setOrderIdFilter(detail.order_id)}>{ru ? 'Показать только этот заказ' : 'Diňe şu sargydy görkez'}</button>}
          </div>
        </div>
      )}

      {summaryOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <h2 className="text-white text-lg font-bold">{ru ? 'Сводка по журналу' : 'Žurnal boýunça jemleýji'}</h2>
              <button className="text-slate-400 hover:text-white" onClick={() => setSummaryOpen(false)}><X className="w-4 h-4" /></button>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-800/60 text-slate-400">
                <tr>
                  <th className="text-left px-2 py-1.5">{ru ? 'Событие' : 'Waka'}</th>
                  <th className="text-right px-2 py-1.5">{ru ? 'Кол-во' : 'Sany'}</th>
                  <th className="text-right px-2 py-1.5">BOOMBACK</th>
                  <th className="text-right px-2 py-1.5">BOOMCOIN</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.event_types || []).map((r: any) => (
                  <tr key={r.event_type} className="border-t border-slate-800 text-slate-200">
                    <td className="px-2 py-1.5">{ru ? (EVENT_TYPE_LABELS[r.event_type]?.ru || r.event_type) : (EVENT_TYPE_LABELS[r.event_type]?.tk || r.event_type)}</td>
                    <td className="px-2 py-1.5 text-right">{r.count}</td>
                    <td className="px-2 py-1.5 text-right text-amber-400">{Number(r.total_boomback_amount) > 0 ? money(r.total_boomback_amount) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-400">{Number(r.total_boomcoin_amount) > 0 ? r.total_boomcoin_amount : '—'}</td>
                  </tr>
                ))}
                {!(summary?.event_types || []).length && <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
