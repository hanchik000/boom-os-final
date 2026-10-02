import React, { useEffect, useMemo, useState } from 'react';
import { Film, Image as ImageIcon, Upload, Power, Trash2, RefreshCw, MonitorPlay } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { errorText } from '../humanErrors';
import { ConfirmDialog, EmptyState, LoadingState, Notice, Toolbar } from './ui';

export const POSMediaView: React.FC = () => {
  const { hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const [branches,setBranches]=useState<any[]>([]); const [branchId,setBranchId]=useState(''); const [media,setMedia]=useState<any[]>([]); const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const [form,setForm]=useState({name:'',url:'',kind:'VIDEO',priority:0,sort_order:0,active:true,is_fallback:false,schedule_start:'',schedule_end:''});
  const canManage=hasPermission('pos.media.manage');
  const branch=useMemo(()=>branches.find(b=>b.id===branchId),[branches,branchId]);
  const load=async()=>{setLoading(true);setError('');try{const r=await api.getPosMedia(branchId||undefined);setMedia(r.media||[])}catch(e:any){setError(errorText(e))}finally{setLoading(false)}};
  useEffect(()=>{void api.getBranches({status:'ACTIVE'}).then(r=>{setBranches(r.branches||[]);if(!branchId&&r.branches?.length)setBranchId(r.branches[0].id)}).catch(()=>undefined)},[]);
  useEffect(()=>{void load()},[branchId]);
  const upload=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];e.target.value='';if(!file||busy)return;setBusy(true);setError('');try{await api.uploadPosMedia(file,branchId||null);await load()}catch(e:any){setError(errorText(e))}finally{setBusy(false)}};
  const create=async()=>{if(!form.name.trim()||!form.url.trim())return;setBusy(true);setError('');try{await api.createPosMedia({...form,branch_id:branchId||null,schedule_start:form.schedule_start||null,schedule_end:form.schedule_end||null});setForm({...form,name:'',url:''});await load()}catch(e:any){setError(errorText(e))}finally{setBusy(false)}};
  const toggle=async(m:any)=>{setBusy(true);try{await api.updatePosMedia(m.id,{active:!m.active});await load()}catch(e:any){setError(errorText(e))}finally{setBusy(false)}};
  // Stage 41: confirmed in the product's own dialog, like every other irreversible action.
  const [removing,setRemoving]=useState<any|null>(null);
  const deactivate=async(m:any)=>{setRemoving(null);setBusy(true);try{await api.deactivatePosMedia(m.id);await load()}catch(e:any){setError(errorText(e))}finally{setBusy(false)}};
  if(!hasPermission('pos.media.view')) return <div className="p-8 text-slate-400">{ru?'Нет доступа к медиаматериалам POS.':'POS media elýeterli däl.'}</div>;
  return <div className="p-8 space-y-6 max-w-7xl mx-auto">
    {/* Stage 41: the page title lives in the shell header, once, for every screen. What used to be
        here was a second title plus an internal build label ("Stage 35.2 · POS Media Engine") and a
        sentence about Order Core -- vocabulary from inside the system, shown to the person using it. */}
    <Toolbar left={<select className="field w-56" aria-label={ru?'Филиал':'Şahamça'} value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">{ru?'Все филиалы':'Ähli şahamçalar'}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name} · {b.code}</option>)}</select>}>
      <button className="btn-secondary" onClick={()=>void load()} title={ru?'Обновить':'Täzele'}><RefreshCw className="w-4 h-4"/>{ru?'Обновить':'Täzele'}</button>
    </Toolbar>
    {error&&<Notice kind="error">{error}</Notice>}
    {canManage&&<div className="grid lg:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3"><div className="flex items-center gap-2 text-white font-bold"><Upload className="w-4 h-4 text-amber-400"/>{ru?'Загрузить файл':'Faýl ýükle'}</div><p className="text-[11px] text-slate-500">MP4, WebM, JPG, PNG, WebP, GIF · максимум 100 MB.</p><label className="flex items-center justify-center min-h-24 rounded-xl border border-dashed border-slate-700 hover:border-amber-500/50 bg-slate-950/50 cursor-pointer text-sm text-slate-300"><input type="file" className="hidden" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp,image/gif" onChange={upload}/>{busy?'Загрузка…':ru?'Выбрать файл':'Faýl saýla'}</label></div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3"><div className="flex items-center gap-2 text-white font-bold"><MonitorPlay className="w-4 h-4 text-amber-400"/>{ru?'Добавить URL':'URL goş'}</div><input className="field" placeholder={ru?'Название':'Ady'} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/><input className="field" placeholder="https://…" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/><div className="flex gap-2"><select className="field" value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}><option value="VIDEO">VIDEO</option><option value="IMAGE">IMAGE</option><option value="GIF">GIF</option></select><input className="field" type="number" placeholder={ru?'Приоритет':'Ileri tutma'} value={form.priority} onChange={e=>setForm({...form,priority:Number(e.target.value)})}/><button className="btn" disabled={busy||!form.name.trim()||!form.url.trim()} onClick={()=>void create()}>{ru?'Добавить':'Goş'}</button></div></div>
    </div>}
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{loading?<div className="md:col-span-2 xl:col-span-3"><LoadingState/></div>:media.map(m=><div key={m.id} className={`rounded-2xl border ${m.active?'border-slate-800':'border-slate-800/50 opacity-60'} bg-slate-900/70 overflow-hidden`}><div className="aspect-video bg-slate-950 flex items-center justify-center">{m.kind==='VIDEO'?<video src={m.url} muted loop autoPlay playsInline className="w-full h-full object-cover"/>:<img src={m.url} alt={m.name} className="w-full h-full object-cover"/>}</div><div className="p-4 space-y-2"><div className="flex items-start justify-between gap-3"><div><strong className="text-white text-sm">{m.name}</strong><div className="text-[10px] text-slate-500 mt-1">{m.branch_name||'GLOBAL'} · {m.kind} · priority {m.priority}</div></div><span className={`text-[10px] px-2 py-1 rounded-full ${m.active?'bg-emerald-500/10 text-emerald-300':'bg-slate-800 text-slate-500'}`}>{m.active?'ACTIVE':'OFF'}</span></div>{canManage&&<div className="flex gap-2"><button className="btn-secondary btn-sm" onClick={()=>void toggle(m)}><Power className="w-3.5 h-3.5"/></button><button className="btn-danger btn-sm" onClick={()=>setRemoving(m)}><Trash2 className="w-3.5 h-3.5"/></button></div>}</div></div>)}{!loading&&!media.length&&<div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-slate-800"><EmptyState
      title={ru?'Для этого филиала пока нет материалов.':'Bu şahamça üçin entek material ýok.'}
      hint={ru?'Здесь показываются видео и изображения, которые крутятся на экранах POS.':'Bu ýerde POS ekranlarynda görkezilýän wideolar we suratlar bolar.'}/></div>}</div>
    <ConfirmDialog
      open={Boolean(removing)}
      title={ru?'Убрать материал с экранов?':'Materialy ekranlardan aýyrmaly?'}
      description={ru?'Материал перестанет показываться на экранах POS. Файл сохраняется, его можно включить снова.':'Material POS ekranlarynda görkezilmegini bes eder. Faýl saklanýar, ony täzeden açyp bolýar.'}
      confirmLabel={ru?'Убрать':'Aýyr'}
      busy={busy}
      onCancel={()=>setRemoving(null)}
      onConfirm={()=>{if(removing)void deactivate(removing)}}/>
  </div>;
};
