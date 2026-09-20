import React,{useEffect,useMemo,useState} from 'react';
import {ArrowRight,ChevronDown,Search,Sparkles,UtensilsCrossed,QrCode,WifiOff,Rotate3d} from 'lucide-react';
import {api} from '../api';
import {useLanguage} from '../context/LanguageContext';
import {useBranding} from '../context/BrandingContext';
import {CustomerDishSheet,UNIT_LABEL} from './CustomerDishSheet';

// ---------------------------------------------------------------------------------------------
// Stage 35.6 -- ONE customer menu for ONLINE, QR, LOCAL and OFFLINE. All four read the SAME
// Visual Catalog + Menu Engine data through the SAME public endpoint; only the `channel` query
// param changes which manager-targeted blocks are shown, and a QR visit resolves its branch
// SERVER-SIDE from an opaque token -- the client never supplies a branch id for that flow, so a
// scanned code can never be redirected onto another branch's data.
//
// No price, no promotional price and no availability is ever computed here: `price`/`promo_price`
// arrive already computed by the server (the Promotion Engine), and this component only renders
// what it is given.
// ---------------------------------------------------------------------------------------------

type Channel = 'ONLINE' | 'QR' | 'LOCAL' | 'OFFLINE';

function detectChannel(hasQr: boolean): Channel {
  const params = new URLSearchParams(window.location.search);
  const explicit = (params.get('channel') || '').toUpperCase();
  if (['ONLINE', 'QR', 'LOCAL', 'OFFLINE'].includes(explicit)) return explicit as Channel;
  if (hasQr) return 'QR';
  // A LAN-local visit (no public hostname) is treated as LOCAL by default; everything else is
  // ONLINE. This is presentation targeting only -- it changes nothing about price or ordering.
  const h = window.location.hostname;
  if (h === 'localhost' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return 'LOCAL';
  return 'ONLINE';
}

function money(v: any) { const n = Number(v ?? 0); return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00'); }

export const VisualCustomerMenuView:React.FC=()=>{
 const {language}=useLanguage(); const ru=language==='ru'; const {branding}=useBranding();
 // Stage 37: the dish sheet -- gallery, 360, weight, allergens, public ingredients and the
 // configurable components, all straight from the public Menu Engine payload.
 const [dish,setDish]=useState<any|null>(null);
 const qrToken=useMemo(()=>new URLSearchParams(window.location.search).get('qr')||'',[]);
 const [online,setOnline]=useState(typeof navigator==='undefined'?true:navigator.onLine);
 const [channel]=useState<Channel>(()=>detectChannel(Boolean(qrToken)));
 const [qrError,setQrError]=useState('');
 const [branches,setBranches]=useState<any[]>([]),[branch,setBranch]=useState(''),[branchLocked,setBranchLocked]=useState(false),[data,setData]=useState<any>({blocks:[],categories:[],items:[]}),[activeCat,setActiveCat]=useState(''),[q,setQ]=useState('');

 useEffect(()=>{if('serviceWorker' in navigator) void navigator.serviceWorker.register('/boom-offline.js').catch(()=>{}); const on=()=>setOnline(true), off=()=>setOnline(false); window.addEventListener('online',on); window.addEventListener('offline',off); return ()=>{window.removeEventListener('online',on);window.removeEventListener('offline',off)}},[]);

 // QR: the branch is resolved server-side from the token. It is never overridable by the branch
 // selector below -- a QR visit locks the branch to what the server says the token belongs to.
 useEffect(()=>{
   if(!qrToken)return;
   api.resolveQrBranch(qrToken).then(r=>{setBranch(r.branch.id);setBranchLocked(true);setBranches([r.branch])}).catch(()=>setQrError(ru?'Этот QR-код не распознан.':'Bu QR kod tanalmady.'));
 },[qrToken,ru]);

 // Stage 36: `?branch=` only PRESELECTS the guest's own branch picker (used by the ADMIN menu
 // preview). It is validated against the public branch list, and it is ignored entirely on a QR
 // visit, where the branch stays whatever the server resolved from the token.
 useEffect(()=>{if(qrToken)return; api.getPublicBranches().then(r=>{const list=r.branches||[];setBranches(list);const want=new URLSearchParams(window.location.search).get('branch')||'';const pick=list.find((b:any)=>b.id===want)||list[0];if(pick)setBranch(pick.id)})},[qrToken]);
 useEffect(()=>{if(branch)api.getPublicVisualCatalog(branch,ru?'ru':'tk',channel).then(setData)},[branch,ru,channel]);

 const items=useMemo(()=>activeCat?data.items.filter((i:any)=>i.category_id===activeCat):data.items,[data.items,activeCat]); const filtered=items.filter((i:any)=>!q||`${i.name_ru} ${i.name_tk} ${i.description_ru||''} ${i.description_tk||''}`.toLowerCase().includes(q.toLowerCase()));
 const scroll=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});
 const openBlock=(b:any)=>{
   if(b.link_type==='CATEGORY' && b.category_id){setActiveCat(b.category_id);scroll('menu');return;}
   if(b.link_type==='ITEM' && b.menu_item_id){setActiveCat(data.items.find((i:any)=>i.id===b.menu_item_id)?.category_id||'');scroll('menu');return;}
   if(b.link_type==='EXTERNAL' && b.external_url){try{const u=new URL(b.external_url,window.location.origin);if(u.protocol==='http:'||u.protocol==='https:')window.open(u.href,'_blank','noopener,noreferrer')}catch{}}
   if(b.link_type==='PROMOTION'){scroll('menu');}
 };

 if(qrToken && qrError) return <div className="min-h-screen bg-[#070707] text-white flex items-center justify-center p-6"><div className="text-center max-w-sm"><QrCode className="w-10 h-10 text-amber-400 mx-auto mb-4"/><p className="text-slate-300">{qrError}</p></div></div>;

 return <div className="min-h-screen bg-[#070707] text-white overflow-x-hidden boom-reduced-motion-safe"><header className="sticky top-0 z-30 backdrop-blur-xl bg-[#070707]/85 border-b border-white/10"><div className="max-w-7xl mx-auto px-5 py-4 flex items-center gap-4">{branding.logo_url?<img src={branding.logo_url} alt={branding.product_name} className="w-10 h-10 rounded-xl object-cover"/>:<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-300 to-amber-700 text-black font-black flex items-center justify-center">{branding.mark}</div>}<div className="mr-auto"><div className="font-black tracking-[.22em]">BOOM MENU</div><div className="text-[10px] text-slate-500 uppercase tracking-[.18em]">Premium dining experience{channel==='QR'?' · QR':channel==='LOCAL'?' · LOCAL':''}</div></div>{branchLocked?<div className="text-xs text-slate-300 flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-3 py-2"><QrCode className="w-3.5 h-3.5 text-amber-400"/>{branches[0]?.name}</div>:<select className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs" value={branch} onChange={e=>setBranch(e.target.value)}>{branches.map(b=><option className="bg-slate-900" key={b.id} value={b.id}>{b.name}</option>)}</select>}</div></header>
 <main className="max-w-7xl mx-auto px-5 pb-20">{!online&&<div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-200 flex items-center gap-2"><WifiOff className="w-4 h-4 shrink-0"/>{ru?"Офлайн-режим: показаны последние доступные данные меню и медиа.":"Oflaýn režim: menýunyň we medianyň soňky elýeterli maglumatlary görkezilýär."}</div>}<section className="pt-8"><div className="flex items-center gap-3 overflow-x-auto pb-3 no-scrollbar">{data.categories.map((c:any)=><button key={c.id} onClick={()=>{setActiveCat(c.id);scroll('menu')}} className={`shrink-0 rounded-full px-5 py-3 text-sm border transition ${activeCat===c.id?'bg-white text-black border-white':'bg-white/[.04] border-white/10 text-white/75 hover:border-amber-400/60'}`}>{ru?c.name_ru:c.name_tk}</button>)}</div></section>
 <section className="relative mt-4 min-h-[56vh] flex items-end rounded-[2rem] overflow-hidden border border-white/10 bg-gradient-to-br from-zinc-900 via-black to-zinc-950"><div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(212,175,55,.22),transparent_34%)]"/><div className="relative z-10 p-8 md:p-14 max-w-2xl"><div className="text-amber-300 text-xs uppercase tracking-[.28em] mb-4">{branding.network_name || branding.product_name}</div><h1 className="text-5xl md:text-7xl font-black leading-[.9] tracking-tight">{ru?'Вкус, который выглядит как событие.':'Tagam — wakanyň özi ýaly.'}</h1><p className="mt-6 text-slate-300 max-w-lg">{ru?'Откройте меню. Выберите настроение. Всё остальное — настоящее меню вашего филиала.':'Menýuny açyň. Keýpiňizi saýlaň. Galany saýlanan şahamçanyň hakyky menýusy.'}</p></div></section>
 <section className="mt-8 grid md:grid-cols-2 gap-5">{data.blocks.map((b:any)=><button key={b.id} onClick={()=>openBlock(b)} className="group relative text-left min-h-52 rounded-3xl overflow-hidden border border-white/10 bg-zinc-900">{b.media_url&&(b.media_kind==='VIDEO'?<video src={b.media_url} poster={b.poster_url||undefined} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 transition duration-700 boom-motion"/>:<img src={b.media_url} alt={b.media_alt||b.title||''} style={{objectPosition:`${b.focal_x??50}% ${b.focal_y??50}%`}} className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 transition duration-700 boom-motion"/>)}<div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent"/><div className="relative min-h-52 p-7 flex flex-col justify-end"><div className="text-[10px] uppercase tracking-[.2em] text-amber-300">{b.type}</div><div className="text-2xl font-black mt-1">{b.title||b.type}</div>{b.subtitle&&<div className="text-sm text-slate-300 mt-1">{b.subtitle}</div>}<div className="mt-4 text-xs text-white/60 flex items-center gap-2">{ru?'Открыть':'Aç'} <ArrowRight className="w-4 h-4"/></div></div></button>)}</section>
 <section id="menu" className="pt-16"><div className="flex flex-wrap items-end gap-4 mb-7"><div className="mr-auto"><div className="text-amber-300 text-[10px] uppercase tracking-[.24em]">{ru?'Меню':'Menýu'}</div><h2 className="text-4xl font-black mt-1">{activeCat?(data.categories.find((c:any)=>c.id===activeCat)?.[ru?'name_ru':'name_tk']||'Menu'):(ru?'Основное меню':'Esasy menýu')}</h2></div><div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-slate-500"/><input value={q} onChange={e=>setQ(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-amber-400/60" placeholder={ru?'Поиск блюда':'Tagam gözle'} /></div></div><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">{filtered.map((i:any)=><button key={i.id} onClick={()=>setDish(i)} aria-label={i.name||i.name_ru} className="relative text-left rounded-3xl border border-white/10 bg-white/[.035] p-5 hover:-translate-y-1 hover:border-amber-400/40 transition duration-300 boom-motion boom-focusable">{i.promo_price&&<div className="absolute top-3 left-3 z-10 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 text-black text-[10px] font-black px-3 py-1 uppercase tracking-wide">{i.promo_badge||(ru?'Акция':'BOOM DEAL')}</div>}{(i.gallery||[]).some((g:any)=>g.kind==='MEDIA_360')&&<div className="absolute top-3 right-3 z-10 rounded-full bg-black/70 p-1.5 text-amber-300" title="360"><Rotate3d className="w-3.5 h-3.5"/></div>}<div className="aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center">{i.media_url?(i.media_kind==='VIDEO'?<video src={i.media_url} poster={i.media_poster_url||undefined} muted loop playsInline className="w-full h-full object-cover"/>:<img src={i.media_url} alt={i.media_alt||i.name||i.name_ru} style={{objectPosition:`${i.media_focal_x??50}% ${i.media_focal_y??50}%`}} className="w-full h-full object-cover"/>):<UtensilsCrossed className="w-9 h-9 text-white/15"/>}</div><div className="mt-4 flex items-start gap-3"><div className="mr-auto min-w-0"><h3 className="font-black text-lg">{i.name||(ru?i.name_ru:i.name_tk)}</h3><p className="text-xs text-slate-500 mt-1 line-clamp-2">{i.description??(ru?i.description_ru:i.description_tk)}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">{i.weight_value&&<span className="rounded-full border border-white/10 px-2 py-0.5">{Number(i.weight_value)} {UNIT_LABEL[i.weight_unit]?.[ru?'ru':'tk']||String(i.weight_unit||'').toLowerCase()}</span>}{(i.modifier_groups||[]).length>0&&<span className="rounded-full border border-amber-400/25 text-amber-200/80 px-2 py-0.5">{ru?'собрать по-своему':'öz islegiňe görä'}</span>}{(i.allergens||[]).length>0&&<span className="rounded-full border border-white/10 px-2 py-0.5">{ru?'аллергены':'allergenler'}: {i.allergens.length}</span>}</div></div><div className="text-right whitespace-nowrap">{i.promo_price?<><div className="text-xs text-slate-500 line-through">{money(i.price)}</div><div className="font-black text-amber-300">{money(i.promo_price)}</div></>:<div className="font-black text-amber-300">{money(i.price)}</div>}</div></div></button>)}</div></section></main>{dish&&<CustomerDishSheet item={dish} lang={ru?'ru':'tk'} onClose={()=>setDish(null)}/>}</div>;
};
