import React, { useEffect, useState } from 'react';
import { Loader2, BarChart3, LayoutGrid, Clock, Grid2x2, X } from 'lucide-react';
import { api } from '../api';
import { useBranchScope } from '../useBranchScope';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState, LoadingState } from './ui';

// ---------------------------------------------------------------------------------------------
// Stage 34.11 -- Food & Sales analytics for managers.
//
// This screen computes NOTHING. Every number below -- revenue, cost, margin, margin %, average
// check, the medians the matrix is measured against -- arrives already computed from
// /api/analytics, which derives it from the Order Core. The screen chooses a period and a sort
// and renders what comes back.
//
// It also states no verdicts. The matrix shows each dish against the published medians and leaves
// the reading of it to the manager; nothing here calls a dish best or worst.
// ---------------------------------------------------------------------------------------------

type Tab = 'sales' | 'dishes' | 'categories' | 'time' | 'matrix';

export const AnalyticsView: React.FC = () => {
  const { language } = useLanguage();
  const ru = language === 'ru';
  const { branchId, setBranchId, branches } = useBranchScope();

  const [tab, setTab] = useState<Tab>('sales');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [sort, setSort] = useState<'REVENUE' | 'UNITS' | 'MARGIN'>('REVENUE');

  const [sales, setSales] = useState<any | null>(null);
  const [dishes, setDishes] = useState<any | null>(null);
  const [categories, setCategories] = useState<any | null>(null);
  const [time, setTime] = useState<any | null>(null);
  const [matrix, setMatrix] = useState<any | null>(null);
  const [drill, setDrill] = useState<any | null>(null);
  const [drillBusy, setDrillBusy] = useState(false);

  const period = () => ({ branch_id: branchId, ...(start ? { start: new Date(start).toISOString() } : {}), ...(end ? { end: new Date(end + 'T23:59:59').toISOString() } : {}) });

  const load = async (t: Tab) => {
    if (!branchId) return;
    setLoading(true); setError('');
    try {
      if (t === 'sales') setSales(await api.getAnalyticsSales(period()));
      if (t === 'dishes') setDishes(await api.getAnalyticsDishes({ ...period(), sort }));
      if (t === 'categories') setCategories(await api.getAnalyticsCategories(period()));
      if (t === 'time') setTime(await api.getAnalyticsTime(period()));
      if (t === 'matrix') setMatrix(await api.getAnalyticsMatrix(period()));
    } catch (e: any) { setError(e?.message || (ru ? 'Ошибка загрузки' : 'Ýükleme ýalňyşlygy')); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(tab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, branchId, start, end, sort]);

  const openDish = async (menuItemId: string) => {
    setDrillBusy(true); setDrill(null);
    try { setDrill(await api.getAnalyticsDish(menuItemId, period())); }
    catch (e: any) { setError(e?.message || (ru ? 'Ошибка' : 'Ýalňyşlyk')); }
    finally { setDrillBusy(false); }
  };

  const tabs: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'sales', label: ru ? 'Продажи' : 'Satuwlar', icon: BarChart3 },
    { id: 'dishes', label: ru ? 'Блюда' : 'Naharlar', icon: LayoutGrid },
    { id: 'categories', label: ru ? 'Категории' : 'Kategoriýalar', icon: LayoutGrid },
    { id: 'time', label: ru ? 'По времени' : 'Wagt boýunça', icon: Clock },
    { id: 'matrix', label: ru ? 'Матрица меню' : 'Menýu matrisasy', icon: Grid2x2 },
  ];

  const card = (label: string, value: string, sub?: string, tone = 'text-white') => (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-black ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );

  const weekdayName = (n: number) => (ru
    ? ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][n]
    : ['', 'Du', 'Si', 'Ça', 'Pe', 'An', 'Şe', 'Ýe'][n]) || String(n);

  // Stage 44: without a branch this screen rendered an empty shell and explained nothing. The
  // shared rule chooses the branch (see useBranchScope); when there is genuinely none to show, the
  // screen says so and says where to choose one.
  if (!branchId) {
    return (
      <div className="p-6">
        <EmptyState
          title={ru ? 'Филиал не выбран.' : 'Şahamça saýlanmadyk.'}
          hint={ru
            ? 'Аналитика считается по заказам конкретного филиала. Выберите филиал в шапке страницы или попросите администратора привязать вашу учётную запись к филиалу.'
            : 'Analitika anyk şahamçanyň sargytlary boýunça hasaplanýar. Sahypanyň ýokarsynda şahamçany saýlaň ýa-da hasabyňyzy şahamça baglamagy administratordan soraň.'}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        {branches.length > 1 && (
          <select
            id="analytics-branch-pick"
            className="field w-56 text-xs"
            aria-label={ru ? 'Филиал' : 'Şahamça'}
            value={branchId}
            onChange={e => setBranchId(e.target.value)}
          >
            {branches.map(b => <option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}
          </select>
        )}
        {tabs.map(tb => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)} className={`btn text-xs flex items-center gap-1.5 ${tab === tb.id ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {tb.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{ru ? 'Период' : 'Döwür'}</span>
        <input type="date" className="field text-xs py-1" value={start} onChange={e => setStart(e.target.value)} />
        <span>—</span>
        <input type="date" className="field text-xs py-1" value={end} onChange={e => setEnd(e.target.value)} />
        {(start || end) && <button className="btn-secondary btn-sm" onClick={() => { setStart(''); setEnd(''); }}>{ru ? 'Сегодня' : 'Şu gün'}</button>}
        {tab === 'dishes' && (
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">{ru ? 'Сортировка' : 'Tertip'}</span>
            {(['REVENUE', 'UNITS', 'MARGIN'] as const).map(sv => (
              <button key={sv} onClick={() => setSort(sv)} className={`px-2 py-1 rounded text-[10px] font-semibold ${sort === sv ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                {sv === 'REVENUE' ? (ru ? 'Выручка' : 'Girdeji') : sv === 'UNITS' ? (ru ? 'Количество' : 'Sany') : (ru ? 'Маржа' : 'Marža')}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <LoadingState/>}
      {error && <div className="text-red-400 text-sm">{error}</div>}

      {!loading && tab === 'sales' && sales && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {card(ru ? 'Чистая выручка' : 'Arassa girdeji', sales.net_revenue, `${sales.orders} ${ru ? 'заказов' : 'sargyt'}`, 'text-emerald-400')}
            {card(ru ? 'Средний чек' : 'Ortaça çek', sales.average_check)}
            {card(ru ? 'Скидки' : 'Arzanladyşlar', sales.discounts, undefined, 'text-amber-400')}
            {card(ru ? 'Сервисный сбор' : 'Hyzmat ýygymy', sales.service_charge)}
          </div>
          {/* Two different questions, never added together -- see the module header. */}
          <div className="text-[11px] text-slate-500">
            {ru
              ? `Выручка по позициям (до скидок, без сервисного сбора): ${sales.item_revenue}. Продано позиций: ${sales.units_sold}, из них бесплатных: ${sales.give_away_units}.`
              : `Pozisiýalar boýunça girdeji (arzanladyşdan öň, hyzmat ýygymsyz): ${sales.item_revenue}. Satylan pozisiýa: ${sales.units_sold}, olardan mugt: ${sales.give_away_units}.`}
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              { title: ru ? 'По типу заказа' : 'Sargyt görnüşi boýunça', rows: sales.by_order_type, key: 'order_type', value: 'net_revenue' },
              { title: ru ? 'По источнику' : 'Çeşme boýunça', rows: sales.by_source, key: 'source', value: 'net_revenue' },
              { title: ru ? 'По способу оплаты' : 'Töleg usuly boýunça', rows: sales.by_payment_method, key: 'method', value: 'amount' },
            ].map(block => (
              <div key={block.title} className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/60 text-slate-400 text-[11px] font-semibold">{block.title}</div>
                <table className="w-full text-xs">
                  <tbody>
                    {(block.rows || []).map((r: any, i: number) => (
                      <tr key={i} className="border-t border-slate-800 text-slate-200">
                        <td className="px-3 py-1.5">{r[block.key]}</td>
                        <td className="px-3 py-1.5 text-right">{r[block.value]}</td>
                      </tr>
                    ))}
                    {!(block.rows || []).length && <tr><td className="px-3 py-4 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === 'dishes' && dishes && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Блюдо' : 'Nahar'}</th>
                <th className="text-left px-3 py-2">{ru ? 'Категория' : 'Kategoriýa'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Кол-во' : 'Sany'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Выручка' : 'Girdeji'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Себестоимость' : 'Öz bahasy'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа' : 'Marža'}</th>
                <th className="text-right px-3 py-2">%</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {dishes.dishes.map((d: any) => (
                <tr key={d.menu_item_id} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2">
                    {ru ? d.name_ru : d.name_tk}
                    {d.give_away_units > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[9px] font-semibold">{ru ? `БЕСПЛАТНО ${d.give_away_units}` : `MUGT ${d.give_away_units}`}</span>}
                    {d.units_without_cost > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 text-[9px] font-semibold">{ru ? `БЕЗ С/С ${d.units_without_cost}` : `BAHASYZ ${d.units_without_cost}`}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{ru ? d.category_ru : d.category_tk}</td>
                  <td className="px-3 py-2 text-right">{d.units_sold}</td>
                  <td className="px-3 py-2 text-right">{d.revenue}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{d.cost}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-400">{d.margin}</td>
                  <td className="px-3 py-2 text-right">{d.margin_percent ?? '—'}</td>
                  <td className="px-3 py-2 text-right"><button className="btn-secondary btn-sm" onClick={() => void openDish(d.menu_item_id)}>{ru ? 'Детали' : 'Jikme-jik'}</button></td>
                </tr>
              ))}
              {!dishes.dishes.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет продаж за период' : 'Döwürde satuw ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'categories' && categories && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="text-left px-3 py-2">{ru ? 'Категория' : 'Kategoriýa'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Блюд' : 'Nahar'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Кол-во' : 'Sany'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Выручка' : 'Girdeji'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Доля' : 'Paýy'}</th>
                <th className="text-right px-3 py-2">{ru ? 'Маржа' : 'Marža'}</th>
                <th className="text-right px-3 py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {categories.categories.map((c: any) => (
                <tr key={c.category_id || 'none'} className="border-t border-slate-800 text-slate-200">
                  <td className="px-3 py-2">{(ru ? c.name_ru : c.name_tk) || (ru ? 'Без категории' : 'Kategoriýasyz')}</td>
                  <td className="px-3 py-2 text-right">{c.dishes}</td>
                  <td className="px-3 py-2 text-right">{c.units_sold}</td>
                  <td className="px-3 py-2 text-right">{c.revenue}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{c.revenue_share_percent ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-400">{c.margin}</td>
                  <td className="px-3 py-2 text-right">{c.margin_percent ?? '—'}</td>
                </tr>
              ))}
              {!categories.categories.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет продаж за период' : 'Döwürde satuw ýok'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === 'time' && time && (
        <div className="grid md:grid-cols-2 gap-3">
          {[
            { title: ru ? 'По часам' : 'Sagat boýunça', rows: time.by_hour, label: (r: any) => `${String(r.hour).padStart(2, '0')}:00` },
            { title: ru ? 'По дням недели' : 'Hepde günleri boýunça', rows: time.by_weekday, label: (r: any) => weekdayName(r.weekday) },
            { title: ru ? 'По дням' : 'Günler boýunça', rows: time.by_day, label: (r: any) => r.day },
          ].map(block => (
            <div key={block.title} className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/60 text-slate-400 text-[11px] font-semibold">{block.title} <span className="text-slate-500">({time.period.timezone})</span></div>
              <table className="w-full text-xs">
                <tbody>
                  {(block.rows || []).map((r: any, i: number) => (
                    <tr key={i} className="border-t border-slate-800 text-slate-200">
                      <td className="px-3 py-1.5">{block.label(r)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{r.orders}</td>
                      <td className="px-3 py-1.5 text-right">{r.net_revenue}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{r.average_check}</td>
                    </tr>
                  ))}
                  {!(block.rows || []).length && <tr><td className="px-3 py-4 text-center text-slate-500">{ru ? 'Нет данных' : 'Maglumat ýok'}</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'matrix' && matrix && (
        <div className="space-y-2">
          {/* The medians are published, and no dish is labelled. */}
          <div className="text-[11px] text-slate-500">
            {ru
              ? `Каждое блюдо показано относительно медианы по количеству (${matrix.medians.units_sold}) и по марже (${matrix.medians.margin_percent}%). Оценку делает управляющий — система не называет блюда лучшими или худшими.`
              : `Her nahar sany (${matrix.medians.units_sold}) we marža (${matrix.medians.margin_percent}%) mediany bilen deňeşdirilýär. Baha bermek dolandyryjynyňky — ulgam nahary iň gowy ýa iň erbet diýip atlandyrmaýar.`}
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800/60 text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2">{ru ? 'Блюдо' : 'Nahar'}</th>
                  <th className="text-right px-3 py-2">{ru ? 'Кол-во' : 'Sany'}</th>
                  <th className="text-left px-3 py-2">{ru ? 'Против медианы кол-ва' : 'Sany medianyna garşy'}</th>
                  <th className="text-right px-3 py-2">{ru ? 'Маржа %' : 'Marža %'}</th>
                  <th className="text-left px-3 py-2">{ru ? 'Против медианы маржи' : 'Marža medianyna garşy'}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.dishes.map((d: any) => (
                  <tr key={d.menu_item_id} className="border-t border-slate-800 text-slate-200">
                    <td className="px-3 py-2">{ru ? d.name_ru : d.name_tk}</td>
                    <td className="px-3 py-2 text-right">{d.units_sold}</td>
                    <td className="px-3 py-2 text-slate-400">{d.above_median_popularity ? '≥' : '<'} {matrix.medians.units_sold}</td>
                    <td className="px-3 py-2 text-right">{d.margin_percent ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{d.above_median_margin === null ? '—' : `${d.above_median_margin ? '≥' : '<'} ${matrix.medians.margin_percent}%`}</td>
                  </tr>
                ))}
                {!matrix.dishes.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">{ru ? 'Нет продаж за период' : 'Döwürde satuw ýok'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(drillBusy || drill) && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-3">
            {drillBusy && <LoadingState/>}
            {drill && (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-white text-lg font-bold">{ru ? drill.menu_item.name_ru : drill.menu_item.name_tk}</h2>
                    {drill.summary && (
                      <div className="text-xs text-slate-400">
                        {ru ? 'Кол-во' : 'Sany'}: {drill.summary.units_sold} · {ru ? 'Выручка' : 'Girdeji'}: {drill.summary.revenue} · {ru ? 'Маржа' : 'Marža'}: {drill.summary.margin} ({drill.summary.margin_percent ?? '—'}%)
                      </div>
                    )}
                  </div>
                  <button className="text-slate-400 hover:text-white" onClick={() => setDrill(null)}><X className="w-4 h-4" /></button>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-800/60 text-slate-400">
                    <tr>
                      <th className="text-left px-2 py-1.5">{ru ? 'Дата' : 'Sene'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Заказ' : 'Sargyt'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Тип' : 'Görnüş'}</th>
                      <th className="text-left px-2 py-1.5">{ru ? 'Официант' : 'Ofisiant'}</th>
                      <th className="text-right px-2 py-1.5">{ru ? 'Кол-во' : 'Sany'}</th>
                      <th className="text-right px-2 py-1.5">{ru ? 'Сумма' : 'Mukdar'}</th>
                      <th className="text-right px-2 py-1.5">{ru ? 'С/с' : 'Öz bahasy'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.lines.map((l: any) => (
                      <tr key={l.id} className="border-t border-slate-800 text-slate-200">
                        <td className="px-2 py-1.5">{new Date(l.created_at).toLocaleString()}</td>
                        <td className="px-2 py-1.5">{l.order_number}</td>
                        <td className="px-2 py-1.5">{l.order_type}</td>
                        <td className="px-2 py-1.5">{l.waiter_name || '—'}</td>
                        <td className="px-2 py-1.5 text-right">{l.quantity}</td>
                        <td className="px-2 py-1.5 text-right">
                          {l.subtotal}
                          {l.is_give_away && <span className="ml-1 px-1 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[9px] font-semibold">{ru ? 'БЕСПЛ.' : 'MUGT'}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-400">{l.recipe_cost_snapshot ?? '—'}</td>
                      </tr>
                    ))}
                    {!drill.lines.length && <tr><td colSpan={7} className="px-2 py-6 text-center text-slate-500">{ru ? 'Нет продаж за период' : 'Döwürde satuw ýok'}</td></tr>}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
