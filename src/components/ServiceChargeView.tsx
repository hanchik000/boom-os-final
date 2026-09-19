import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Percent, RefreshCw, Plus, Trash2, History, Coins, Send, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

type Member = { user_id: string; percent: string };
type Category = { category: string; percent: string; mode: 'COMMON' | 'INDIVIDUAL'; strategy: string; members: Member[] };

const ALL_CATEGORIES = ['BAR', 'KITCHEN', 'WAITERS', 'MANAGERS', 'OTHER'];

export const ServiceChargeView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const canManage = hasPermission('service_charge.manage');

  const [tab, setTab] = useState<'config' | 'history' | 'ledger'>('config');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [strategies, setStrategies] = useState<string[]>(['EQUAL', 'BY_SALES', 'BY_ORDERS', 'BY_HOURS']);
  const [percent, setPercent] = useState('0.00');
  const [takeaway, setTakeaway] = useState('0.00');
  const [delivery, setDelivery] = useState('0.00');
  const [categories, setCategories] = useState<Category[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [totals, setTotals] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [distFrom, setDistFrom] = useState('');
  const [distTo, setDistTo] = useState('');

  const load = useCallback(async () => {
    if (!branchId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [cfg, hist, led, users] = await Promise.all([
        api.getServiceCharge(branchId),
        api.getServiceChargeHistory(branchId),
        api.getServiceChargeLedger(branchId),
        api.getUsers({ branch_id: branchId }).catch(() => ({ users: [] as any[] })),
      ]);
      setStrategies(cfg.strategies || strategies);
      setPercent(String(cfg.config?.percent ?? '0.00'));
      setTakeaway(String(cfg.config?.takeaway_percent ?? '0.00'));
      setDelivery(String(cfg.config?.delivery_percent ?? '0.00'));
      setCategories((cfg.config?.categories || []).map((c: any) => ({
        category: c.category, percent: String(c.percent), mode: c.mode, strategy: c.strategy,
        members: (c.members || []).map((m: any) => ({ user_id: m.user_id, percent: String(m.percent) })),
      })));
      setVersions(hist.versions || []);
      setLedger(led.ledger || []); setTotals(led.totals || []);
      setEmployees((users as any).users || []);
    } catch (e: any) { setError(e?.message || 'Failed to load'); }
    finally { setLoading(false); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);

  // Mirrors the server rule exactly, but only as guidance -- the backend is the authority and
  // refuses an over-allocation regardless of what this form allows.
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const categorySum = useMemo(() => categories.reduce((s, c) => s + num(c.percent), 0), [categories]);
  const overAllocated = categorySum > num(percent) + 1e-9;
  const memberIssue = useMemo(() => categories.find(c => c.mode === 'INDIVIDUAL' && c.members.reduce((s, m) => s + num(m.percent), 0) > num(c.percent) + 1e-9), [categories]);

  const setCategory = (idx: number, patch: Partial<Category>) => setCategories(cs => cs.map((c, i) => i === idx ? { ...c, ...patch } : c));
  const addCategory = () => {
    const free = ALL_CATEGORIES.find(c => !categories.some(x => x.category === c));
    if (free) setCategories(cs => [...cs, { category: free, percent: '0.00', mode: 'COMMON', strategy: 'EQUAL', members: [] }]);
  };

  const publish = async () => {
    if (!branchId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.publishServiceCharge(branchId, { percent, takeaway_percent: takeaway, delivery_percent: delivery, categories });
      setNotice(ru ? 'Новая версия конфигурации опубликована. Прошлые заказы не пересчитываются.' : 'Täze wersiýa çap edildi. Öňki sargytlar gaýtadan hasaplanmaýar.');
      await load();
    } catch (e: any) { setError(e?.message || 'Failed to publish'); }
    finally { setBusy(false); }
  };

  const distribute = async () => {
    if (!branchId || busy || !distFrom || !distTo) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api.distributeServiceCharge(branchId, new Date(distFrom).toISOString(), new Date(distTo).toISOString());
      setNotice((ru ? `Распределено строк: ${r.distributed.length}. Пропущено пулов: ${r.skipped.length}.` : `Paýlanan setirler: ${r.distributed.length}. Geçirilen pullar: ${r.skipped.length}.`));
      await load();
    } catch (e: any) { setError(e?.message || 'Failed to distribute'); }
    finally { setBusy(false); }
  };

  if (!hasPermission('service_charge.view')) return null;

  const catLabel = (c: string) => ({ BAR: ru ? 'Бар' : 'Bar', KITCHEN: ru ? 'Кухня' : 'Aşhana', WAITERS: ru ? 'Официанты' : 'Ofisiantlar', MANAGERS: ru ? 'Менеджеры' : 'Menejerler', OTHER: ru ? 'Прочие' : 'Beýlekiler' } as Record<string, string>)[c] || c;
  const strategyLabel = (s: string) => ({ EQUAL: ru ? 'Поровну' : 'Deň', BY_SALES: ru ? 'По продажам' : 'Satuw boýunça', BY_ORDERS: ru ? 'По заказам' : 'Sargyt boýunça', BY_HOURS: ru ? 'По часам' : 'Sagat boýunça' } as Record<string, string>)[s] || s;
  const employeeName = (uid: string) => employees.find(e => e.id === uid)?.full_name || uid;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><Percent className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">{ru ? 'Сервисный сбор' : 'Hyzmat ýygymy'}</h2></div>
          <p className="text-sm text-slate-400 mt-1">{ru ? 'Распределение сервисного сбора — это не зарплата и не KPI. Оно перемещает только те деньги, которые заказ действительно собрал.' : 'Hyzmat ýygymynyň paýlanyşy aýlyk ýa-da KPI däldir. Ol diňe sargydyň hakykatda ýygnan puluny paýlaýar.'}</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="flex gap-2">
        {([['config', ru ? 'Конфигурация' : 'Konfigurasiýa'], ['history', ru ? 'История версий' : 'Wersiýa taryhy'], ['ledger', ru ? 'Начисления' : 'Hasaplamalar']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${tab === k ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm p-3">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm p-3">{notice}</div>}
      {loading && <div className="text-sm text-slate-500">{ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>}

      {!loading && tab === 'config' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-3 gap-3">
            {([[ru ? 'В зале (%)' : 'Zalda (%)', percent, setPercent], [ru ? 'С собой (%)' : 'Ýany bilen (%)', takeaway, setTakeaway], [ru ? 'Доставка (%)' : 'Eltip bermek (%)', delivery, setDelivery]] as const).map(([label, value, setter], i) => (
              <label key={i} className="block space-y-1">
                <span className="text-xs text-slate-400">{label}</span>
                <input className="field w-full" value={value} disabled={!canManage} onChange={e => (setter as any)(e.target.value)} />
              </label>
            ))}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">{ru ? 'Категории распределения' : 'Paýlaýyş kategoriýalary'}</h3>
              <div className="text-xs text-slate-400">{ru ? 'Распределено' : 'Paýlandy'}: <b className={overAllocated ? 'text-red-400' : 'text-emerald-400'}>{categorySum.toFixed(2)}%</b> {ru ? 'из' : '/'} {num(percent).toFixed(2)}% · {ru ? 'остаток заведению' : 'galyndy kärhana'}: {Math.max(0, num(percent) - categorySum).toFixed(2)}%</div>
            </div>

            {categories.map((c, idx) => (
              <div key={idx} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="field" value={c.category} disabled={!canManage} onChange={e => setCategory(idx, { category: e.target.value })}>
                    {ALL_CATEGORIES.map(x => <option key={x} value={x}>{catLabel(x)}</option>)}
                  </select>
                  <input className="field w-24" value={c.percent} disabled={!canManage} onChange={e => setCategory(idx, { percent: e.target.value })} />
                  <span className="text-xs text-slate-500">%</span>
                  <select className="field" value={c.mode} disabled={!canManage} onChange={e => setCategory(idx, { mode: e.target.value as any })}>
                    <option value="COMMON">{ru ? 'Общее распределение' : 'Umumy paýlanyş'}</option>
                    <option value="INDIVIDUAL">{ru ? 'Индивидуальное начисление' : 'Şahsy hasaplama'}</option>
                  </select>
                  {c.mode === 'COMMON' && (
                    <select className="field" value={c.strategy} disabled={!canManage} onChange={e => setCategory(idx, { strategy: e.target.value })}>
                      {strategies.map(s => <option key={s} value={s}>{strategyLabel(s)}</option>)}
                    </select>
                  )}
                  {canManage && <button className="ml-auto p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-red-300" onClick={() => setCategories(cs => cs.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}
                </div>

                <div className="space-y-2">
                  {c.members.map((m, mi) => (
                    <div key={mi} className="flex items-center gap-2">
                      <select className="field flex-1" value={m.user_id} disabled={!canManage} onChange={e => setCategory(idx, { members: c.members.map((x, i) => i === mi ? { ...x, user_id: e.target.value } : x) })}>
                        <option value="">{ru ? '— сотрудник —' : '— işgär —'}</option>
                        {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                      </select>
                      {c.mode === 'INDIVIDUAL' && <><input className="field w-24" value={m.percent} disabled={!canManage} onChange={e => setCategory(idx, { members: c.members.map((x, i) => i === mi ? { ...x, percent: e.target.value } : x) })} /><span className="text-xs text-slate-500">%</span></>}
                      {canManage && <button className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:text-red-300" onClick={() => setCategory(idx, { members: c.members.filter((_, i) => i !== mi) })}><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  ))}
                  {canManage && <button className="text-xs text-amber-300 inline-flex items-center gap-1" onClick={() => setCategory(idx, { members: [...c.members, { user_id: '', percent: '0.00' }] })}><Plus className="w-3 h-3" />{ru ? 'Добавить сотрудника' : 'Işgär goşmak'}</button>}
                  {c.mode === 'INDIVIDUAL' && <p className="text-[11px] text-slate-500">{ru ? 'Сотрудник с 0% ничего не получает — это допустимая настройка, а не ошибка.' : '0% bolan işgär hiç zat almaýar — bu ýalňyşlyk däl, rugsat edilen sazlama.'}</p>}
                  {c.mode === 'COMMON' && <p className="text-[11px] text-slate-500">{ru ? 'Общий процент категории собирается в пул по каждому заказу и распределяется позже по выбранной стратегии.' : 'Kategoriýanyň umumy göterimi her sargyt boýunça pula ýygnalýar we soňra saýlanan strategiýa boýunça paýlanýar.'}</p>}
                </div>
              </div>
            ))}

            {canManage && categories.length < ALL_CATEGORIES.length && <button className="text-sm text-amber-300 inline-flex items-center gap-1" onClick={addCategory}><Plus className="w-4 h-4" />{ru ? 'Добавить категорию' : 'Kategoriýa goşmak'}</button>}
          </div>

          {overAllocated && <div className="text-sm text-red-400">{ru ? 'Сумма категорий не может превышать общий сервисный сбор.' : 'Kategoriýalaryň jemi umumy hyzmat ýygymyndan köp bolup bilmez.'}</div>}
          {memberIssue && <div className="text-sm text-red-400">{ru ? `Индивидуальные начисления в категории ${catLabel(memberIssue.category)} превышают процент категории.` : `${catLabel(memberIssue.category)} kategoriýasyndaky şahsy hasaplamalar kategoriýanyň göteriminden köp.`}</div>}

          {canManage && (
            <button className="btn bg-amber-500 text-slate-950 font-bold px-5 py-2.5 inline-flex items-center gap-2" disabled={busy || overAllocated || Boolean(memberIssue)} onClick={() => void publish()}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{ru ? 'Опубликовать новую версию' : 'Täze wersiýa çap etmek'}
            </button>
          )}
        </div>
      )}

      {!loading && tab === 'history' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 flex items-center gap-1"><History className="w-3 h-3" />{ru ? 'Конфигурация не редактируется — каждая публикация создаёт новую версию, а прежняя архивируется. Старые заказы никогда не пересчитываются.' : 'Konfigurasiýa üýtgedilmeýär — her çap ediş täze wersiýa döredýär, öňkisi arhiwlenýär. Köne sargytlar hiç haçan gaýtadan hasaplanmaýar.'}</p>
          {versions.map(v => (
            <div key={v.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded-md text-xs border ${v.status === 'ACTIVE' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{v.status}</span>
                <span className="text-white font-semibold">{v.percent}% · {ru ? 'с собой' : 'ýany bilen'} {v.takeaway_percent}% · {ru ? 'доставка' : 'eltip bermek'} {v.delivery_percent}%</span>
                <span className="text-xs text-slate-500">{v.scope}</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">{v.effective_from} → {v.effective_to || (ru ? 'действует' : 'hereket edýär')} · {v.created_by_name || '—'}</div>
              <div className="text-xs text-slate-400 mt-1">{(v.categories || []).map((c: any) => `${catLabel(c.category)} ${c.percent}% (${c.mode === 'INDIVIDUAL' ? (ru ? 'индив.' : 'şahsy') : strategyLabel(c.strategy)})`).join(' · ') || '—'}</div>
            </div>
          ))}
          {!versions.length && <div className="text-slate-500 text-sm">{ru ? 'Версий пока нет.' : 'Entek wersiýa ýok.'}</div>}
        </div>
      )}

      {!loading && tab === 'ledger' && (
        <div className="space-y-4">
          {canManage && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-white"><Coins className="w-4 h-4 text-amber-400" />{ru ? 'Распределить пулы за период' : 'Döwür boýunça pullary paýlamak'}</div>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="space-y-1"><span className="block text-xs text-slate-400">{ru ? 'С' : 'Başlangyç'}</span><input type="datetime-local" className="field" value={distFrom} onChange={e => setDistFrom(e.target.value)} /></label>
                <label className="space-y-1"><span className="block text-xs text-slate-400">{ru ? 'По' : 'Ahyry'}</span><input type="datetime-local" className="field" value={distTo} onChange={e => setDistTo(e.target.value)} /></label>
                <button className="btn bg-amber-500 text-slate-950 font-semibold" disabled={busy || !distFrom || !distTo} onClick={() => void distribute()}>{ru ? 'Распределить' : 'Paýlamak'}</button>
              </div>
              <p className="text-[11px] text-slate-500">{ru ? 'Пул, у которого все участники имеют нулевой вес, не распределяется вслепую — он остаётся пулом и показывается в отчёте.' : 'Ähli agzalarynyň agramy nol bolan pul körlük bilen paýlanmaýar — ol pul bolup galýar we hasabatda görkezilýär.'}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-xs">
            {totals.map((t, i) => <span key={i} className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">{t.target_type} · {t.status}: <b className="text-white">{t.total}</b></span>)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-slate-400"><tr>
                {[ru ? 'Заказ' : 'Sargyt', ru ? 'Категория' : 'Kategoriýa', ru ? 'Тип' : 'Görnüş', ru ? 'Сотрудник' : 'Işgär', ru ? 'Стратегия' : 'Strategiýa', ru ? 'Сумма' : 'Möçber', ru ? 'Статус' : 'Ýagdaý'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {ledger.map(r => (
                  <tr key={r.id} className="border-t border-slate-800/70">
                    <td className="px-3 py-1.5 text-slate-300">#{r.order_number || '—'}</td>
                    <td className="px-3 py-1.5 text-slate-300">{r.category ? catLabel(r.category) : '—'}</td>
                    <td className="px-3 py-1.5 text-slate-400">{r.target_type}</td>
                    <td className="px-3 py-1.5 text-slate-300">{r.user_name || (r.target_type === 'ESTABLISHMENT' ? (ru ? 'Заведение' : 'Kärhana') : r.user_id ? employeeName(r.user_id) : '—')}</td>
                    <td className="px-3 py-1.5 text-slate-400">{r.strategy ? strategyLabel(r.strategy) : '—'}</td>
                    <td className="px-3 py-1.5 text-white font-semibold">{r.amount}</td>
                    <td className="px-3 py-1.5 text-slate-400">{r.status}</td>
                  </tr>
                ))}
                {!ledger.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">{ru ? 'Начислений пока нет.' : 'Entek hasaplama ýok.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
