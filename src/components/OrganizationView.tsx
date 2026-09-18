import React, { useEffect, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Users, Layers3, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useLanguage } from '../context/LanguageContext';

type BranchNode = { id: string; name: string; code: string; status: string; franchise_id: string | null; employee_count: number };
type FranchiseNode = { id: string; name: string; code: string; legal_name: string; status: string; branch_count: number; active_branch_count: number; branches: BranchNode[] };

export const OrganizationView: React.FC = () => {
  const { language } = useLanguage();
  const [franchises, setFranchises] = useState<FranchiseNode[]>([]);
  const [unassigned, setUnassigned] = useState<BranchNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await api.getOrganizationTree();
      setFranchises(data.franchises as FranchiseNode[]);
      setUnassigned(data.unassigned_branches as unknown as BranchNode[]);
    } catch (e: any) {
      setError(e.message || (language === 'ru' ? 'Не удалось загрузить структуру.' : 'Gurluşy ýüklemek başartmady.'));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const toggle = (id: string) => setExpanded(v => ({ ...v, [id]: !v[id] }));
  const labels = language === 'ru'
    ? { title: 'Организационная структура', subtitle: 'Единая иерархия BOOM HQ → Франшиза → Филиал → Сотрудники', franchises: 'Франшиз', branches: 'Филиалов', employees: 'Сотрудников', unassigned: 'Филиалы без франшизы', empty: 'Нет данных', refresh: 'Обновить' }
    : { title: 'Guramaçylyk gurluşy', subtitle: 'Ýeke-täk BOOM HQ → Franşiza → Şahamça → Işgärler iýerarhiýasy', franchises: 'Franşiza', branches: 'Şahamça', employees: 'Işgär', unassigned: 'Franşizasyz şahamçalar', empty: 'Maglumat ýok', refresh: 'Täzele' };

  return <div id="organization-view" className="p-6 space-y-6 max-w-7xl mx-auto">
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2"><Layers3 className="w-5 h-5 text-amber-400" /><h2 className="text-lg font-bold text-white">{labels.title}</h2></div>
        <p className="text-xs text-slate-400 mt-1">{labels.subtitle}</p>
      </div>
      <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />{labels.refresh}</button>
    </div>

    {error && <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">{error}</div>}

    {!loading && !error && <div className="grid grid-cols-3 gap-3">
      <Stat label={labels.franchises} value={franchises.length} />
      <Stat label={labels.branches} value={franchises.reduce((n, f) => n + f.branches.length, 0) + unassigned.length} />
      <Stat label={labels.employees} value={franchises.reduce((n, f) => n + f.branches.reduce((m, b) => m + (b.employee_count || 0), 0), 0) + unassigned.reduce((n,b)=>n+(b.employee_count||0),0)} />
    </div>}

    <div className="space-y-3">
      {franchises.map(f => <div key={f.id} className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <button onClick={() => toggle(f.id)} className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-800/50">
          {expanded[f.id] ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"><Building2 className="w-4 h-4 text-amber-400" /></div>
          <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-semibold text-slate-100">{f.name}</span><span className="text-[10px] font-mono text-amber-400">{f.code}</span></div><div className="text-[11px] text-slate-500 truncate">{f.legal_name}</div></div>
          <div className="text-right text-[11px] text-slate-400">{f.active_branch_count}/{f.branch_count} {labels.branches.toLowerCase()}</div>
        </button>
        {expanded[f.id] && <div className="border-t border-slate-800 p-3 space-y-2">
          {f.branches.length ? f.branches.map(b => <div key={b.id} className="ml-8 flex items-center gap-3 rounded-lg bg-slate-950/50 border border-slate-800 p-3"><Building2 className="w-4 h-4 text-blue-400" /><div className="flex-1"><div className="text-sm font-medium text-slate-200">{b.name}</div><div className="text-[10px] font-mono text-slate-500">{b.code}</div></div><div className="flex items-center gap-1 text-xs text-slate-400"><Users className="w-3.5 h-3.5" />{b.employee_count}</div><Status value={b.status} /></div>) : <div className="ml-8 p-4 text-xs text-slate-500">{labels.empty}</div>}
        </div>}
      </div>)}
      {unassigned.length > 0 && <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4"><div className="text-xs font-semibold text-slate-300 mb-3">{labels.unassigned}</div>{unassigned.map(b => <div key={b.id} className="flex items-center gap-3 py-2"><Building2 className="w-4 h-4 text-slate-500" /><span className="text-sm text-slate-300 flex-1">{b.name}</span><span className="font-mono text-[10px] text-slate-500">{b.code}</span><Status value={b.status} /></div>)}</div>}
      {!franchises.length && !unassigned.length && !loading && <div className="p-10 text-center text-sm text-slate-500">{labels.empty}</div>}
    </div>
  </div>;
};

const Stat = ({ label, value }: { label: string; value: number }) => <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="text-2xl font-bold text-white mt-1">{value}</div></div>;
const Status = ({ value }: { value: string }) => <span className={`text-[10px] px-2 py-1 rounded-full border ${value === 'ACTIVE' ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10' : 'text-slate-400 border-slate-700 bg-slate-800'}`}>{value}</span>;
