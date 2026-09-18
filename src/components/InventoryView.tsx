import React, { useEffect, useState } from 'react';
import { Boxes, Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export const InventoryView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const [branches,setBranches]=useState<any[]>([]); const [branchId,setBranchId]=useState(user?.branch_id||'');
  const [items,setItems]=useState<any[]>([]); const [low,setLow]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const [form,setForm]=useState({sku:'',name:'',unit:'pcs',reorder_point:'0'}); const [saving,setSaving]=useState(false);
  const load=async()=>{if(!branchId)return;setLoading(true);setError('');try{const r=await api.getInventoryItems(branchId,low);setItems(r.items||[]);}catch(e:any){setError(e.message||'Не удалось загрузить остатки');}finally{setLoading(false);}};
  useEffect(()=>{(async()=>{try{const r=await fetch('/api/branches',{headers:{Authorization:`Bearer ${localStorage.getItem('boom_os_auth_token')||''}`}});const d=await r.json();const bs=d.branches||[];setBranches(bs);if(!branchId&&bs[0])setBranchId(bs[0].id);}catch{}})();},[]);
  useEffect(()=>{load();},[branchId,low]);
  const create=async()=>{if(!branchId||!form.sku||!form.name||!form.unit)return;setSaving(true);setError('');try{await api.createInventoryItem({...form,branch_id:branchId});setForm({sku:'',name:'',unit:'pcs',reorder_point:'0'});await load();}catch(e:any){setError(e.message||'Не удалось создать позицию');}finally{setSaving(false);}};
  if(!hasPermission('inventory.view'))return <div className="p-8 text-slate-400">Нет доступа к Inventory.</div>;
  return <div className="p-6 space-y-6">
    <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-white flex items-center gap-2"><Boxes className="text-amber-400"/>Inventory & Stock</h2><p className="text-sm text-slate-400 mt-1">Остатки, reorder point и контроль складских движений</p></div><button onClick={load} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200"><RefreshCw className="w-4 h-4 inline mr-2"/>Обновить</button></div>
    <div className="flex gap-3 items-center"><select value={branchId} onChange={e=>setBranchId(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm">{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><label className="flex gap-2 items-center text-sm text-slate-300"><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/> Только низкий остаток</label></div>
    {error&&<div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm">{error}</div>}
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden"><div className="px-4 py-3 border-b border-slate-800 text-sm font-semibold text-white">Stock Items</div>{loading?<div className="p-6 text-slate-400">Загрузка…</div>:items.length===0?<div className="p-8 text-center text-slate-500">Позиций пока нет.</div>:<div className="divide-y divide-slate-800">{items.map(i=><div key={i.id} className="px-4 py-3 flex justify-between"><div><div className="text-white font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.sku} · {i.unit}</div></div><div className="text-right"><div className={`font-mono ${String(i.current_stock)<=String(i.reorder_point)?'text-amber-300':'text-slate-200'}`}>{i.current_stock}</div><div className="text-xs text-slate-500">reorder {i.reorder_point}</div></div></div>)}</div>}</div>
      {hasPermission('inventory.manage')&&<div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-3"><h3 className="font-semibold text-white"><Plus className="w-4 h-4 inline mr-2"/>Новая складская позиция</h3>{(['sku','name','unit','reorder_point'] as const).map(k=><input key={k} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} placeholder={k} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"/>)}<button disabled={saving} onClick={create} className="w-full py-2 rounded-lg bg-amber-500 text-slate-950 font-semibold disabled:opacity-50">Создать</button><div className="text-xs text-slate-500 flex gap-2"><AlertTriangle className="w-3 h-3"/>Ручная корректировка выполняется через Stock Movements.</div></div>}
    </div>
  </div>;
};
