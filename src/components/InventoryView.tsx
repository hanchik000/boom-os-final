import React, { useEffect, useState } from 'react';
import { Boxes, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { errorText } from '../humanErrors';
import { EmptyState, LoadingState, Notice, Toolbar } from './ui';

const FIELDS = [
  { key: 'sku' as const, ru: 'Артикул', tk: 'Artikul', exampleRu: 'например, BUN-01', exampleTk: 'meselem, BUN-01', required: true },
  { key: 'name' as const, ru: 'Название', tk: 'Ady', exampleRu: 'например, Булочка', exampleTk: 'meselem, Bulka', required: true },
  { key: 'unit' as const, ru: 'Единица измерения', tk: 'Ölçeg birligi', exampleRu: 'шт, кг, л', exampleTk: 'sany, kg, l', required: true },
  { key: 'reorder_point' as const, ru: 'Минимальный остаток', tk: 'Iň az galyndy', exampleRu: '0', exampleTk: '0', required: false },
];

export const InventoryView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [branches,setBranches]=useState<any[]>([]); const [branchId,setBranchId]=useState(user?.branch_id||'');
  const [items,setItems]=useState<any[]>([]); const [low,setLow]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const [form,setForm]=useState({sku:'',name:'',unit:'pcs',reorder_point:'0'}); const [saving,setSaving]=useState(false);
  const load=async()=>{if(!branchId)return;setLoading(true);setError('');try{const r=await api.getInventoryItems(branchId,low);setItems(r.items||[]);}catch(e:any){setError(errorText(e));}finally{setLoading(false);}};
  useEffect(()=>{(async()=>{try{const r=await fetch('/api/branches',{headers:{Authorization:`Bearer ${localStorage.getItem('boom_os_auth_token')||''}`}});const d=await r.json();const bs=d.branches||[];setBranches(bs);if(!branchId&&bs[0])setBranchId(bs[0].id);}catch{}})();},[]);
  useEffect(()=>{load();},[branchId,low]);
  const create=async()=>{if(!branchId||!form.sku||!form.name||!form.unit)return;setSaving(true);setError('');try{await api.createInventoryItem({...form,branch_id:branchId});setForm({sku:'',name:'',unit:'pcs',reorder_point:'0'});await load();}catch(e:any){setError(e.message||'Не удалось создать позицию');}finally{setSaving(false);}};
  if(!hasPermission('inventory.view'))return <div className="p-8 text-slate-400">{ru?'У вас нет доступа к складу.':'Ammara elýeterliligiňiz ýok.'}</div>;
  return <div className="p-6 space-y-6">
    {/* Stage 41: the page title comes from the shell header, once. What stood here was a second
        title in English ("Inventory & Stock") describing the module rather than the work. */}
    <Toolbar left={<>
      <select className="field w-56" aria-label={ru?'Филиал':'Şahamça'} value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <label className="flex gap-2 items-center text-sm text-slate-300"><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/> {ru?'Только то, что заканчивается':'Diňe gutarýanlar'}</label>
    </>}>
      <button className="btn-secondary" onClick={load}><RefreshCw className="w-4 h-4"/>{ru?'Обновить':'Täzele'}</button>
    </Toolbar>
    {error&&<Notice kind="error">{error}</Notice>}
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden"><div className="px-4 py-3 border-b border-slate-800 boom-section-title">{ru?'Позиции склада':'Ammar pozisiýalary'}</div>{loading?<LoadingState/>:items.length===0?<EmptyState title={ru?'На складе пока ничего нет.':'Ammarda entek zat ýok.'} hint={ru?'Добавьте позицию справа — например, «Булочка» или «Говядина» — и склад начнёт считать остаток.':'Sagdaky formada pozisiýa goşuň — meselem, «Bulka» ýa-da «Sygyr eti» — ammar galyndyny hasaplap başlar.'}/>:<div className="divide-y divide-slate-800">{items.map(i=><div key={i.id} className="px-4 py-3 flex justify-between"><div><div className="text-white font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.sku} · {i.unit}</div></div><div className="text-right"><div className={`font-mono ${String(i.current_stock)<=String(i.reorder_point)?'text-amber-300':'text-slate-200'}`}>{i.current_stock}</div><div className="text-xs text-slate-500">{ru?'минимум':'iň az'} {i.reorder_point}</div></div></div>)}</div>}</div>
      {hasPermission('inventory.manage')&&<div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"><h3 className="boom-section-title"><Plus className="w-4 h-4 inline mr-2"/>{ru?'Добавить позицию':'Pozisiýa goş'}</h3>
        {/* Stage 41: the fields used to be labelled with their database column names -- sku, name,
            unit, reorder_point -- shown to the person as placeholders. */}
        {FIELDS.map(f=><label key={f.key} className="block"><span className="boom-label">{ru?f.ru:f.tk}{f.required&&<span className="boom-req">*</span>}</span><input value={form[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.value})} placeholder={ru?f.exampleRu:f.exampleTk} className="field"/>{f.key==='reorder_point'&&<span className="boom-help">{ru?'Когда остаток опустится до этого числа, позиция попадёт в «то, что заканчивается».':'Galyndy şu sana düşende, pozisiýa «gutarýanlar» sanawyna düşer.'}</span>}</label>)}
        <button className="btn w-full" disabled={saving} onClick={create}>{ru?'Добавить':'Goş'}</button><div className="text-xs text-slate-500 flex gap-2"><AlertTriangle className="w-3 h-3"/>{ru?'Приход и списание оформляются в движениях склада, а не правкой остатка вручную.':'Giriş we hasapdan öçürmek ammar hereketlerinde resmileşdirilýär, galyndyny elde üýtgetmek bilen däl.'}</div></div>}
    </div>
  </div>;
};
