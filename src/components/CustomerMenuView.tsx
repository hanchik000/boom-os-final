import React, { useEffect, useMemo, useState } from 'react';
import { Search, MapPin, ShoppingBag, Sparkles, Users, Wallet, X } from 'lucide-react';
import { api } from '../api';
import { useLanguage } from '../context/LanguageContext';

export const CustomerMenuView: React.FC = () => {
  const { language } = useLanguage();
  const [branches,setBranches]=useState<any[]>([]); const [branch,setBranch]=useState('');
  const [items,setItems]=useState<any[]>([]); const [q,setQ]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const [smart,setSmart]=useState<any[]>([]); const [recommendations,setRecommendations]=useState<any[]>([]); const [parsed,setParsed]=useState<any|null>(null);
  const lang=language==='tk'?'tk':'ru';
  useEffect(()=>{api.getPublicBranches().then(r=>{setBranches(r.branches); if(r.branches[0])setBranch(r.branches[0].id)}).catch(e=>setError(e.message));},[]);
  useEffect(()=>{if(!branch)return; api.getPublicMenu(branch,lang).then(r=>setItems(r.items)).catch(e=>setError(e.message));},[branch,lang]);
  const categories=useMemo(()=>Array.from(new Set(items.map(x=>x.category_name))),[items]);
  const runSearch=async()=>{
    if(!branch||!q.trim())return;
    setLoading(true);setError('');
    try{
      const r=await api.smartSearch(branch,q,lang);
      setSmart(r.items); setRecommendations(r.recommendations||[]); setParsed(r.parsed);
    }catch(e:any){setError(e.message||'Search failed')}
    finally{setLoading(false)}
  };
  const clearSearch=()=>{setSmart([]);setRecommendations([]);setParsed(null);setQ('')};
  const visible=smart.length?smart:items;
  const currency=branches.find(b=>b.id===branch)?.currency||'TMT';

  return <div className="min-h-screen bg-slate-950 text-white"><header className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-white/10"><div className="max-w-6xl mx-auto px-5 py-5 flex items-center justify-between"><div><div className="text-2xl font-black tracking-[.2em]">BOOM</div><div className="text-xs text-slate-400">CUSTOMER MENU</div></div><div className="flex items-center gap-2 text-sm text-slate-300"><MapPin className="w-4 h-4"/><select className="field" value={branch} onChange={e=>{setBranch(e.target.value);clearSearch()}}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div></div></header>
    <main className="max-w-6xl mx-auto px-5 py-8">
      <div className="max-w-3xl mx-auto text-center mb-8">
        <div className="inline-flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-widest"><Sparkles className="w-4 h-4"/> Smart Search</div>
        <h1 className="text-4xl md:text-5xl font-black mt-3">{lang==='ru'?'Что хотите заказать?':'Näme zakaz etmek isleýärsiňiz?'}</h1>
        <p className="text-slate-400 mt-3">{lang==='ru'?'Например: «Нас 6 человек, бюджет 2000 манат» или «Бургеры без лука до 1000 манат».':'Mysal: «6 adam, 2000 manat» ýa-da «Sogansyz burger, 1000 manat çenli».'}</p>
        <div className="mt-5 flex gap-2">
          <input className="field flex-1 text-base" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&runSearch()} placeholder={lang==='ru'?'Например: Нас 6 человек, бюджет 2000 манат':'Mysal: 6 adam, 2000 manat'}/>
          <button className="btn" onClick={runSearch} disabled={loading}><Search className="w-5 h-5"/></button>
        </div>
      </div>

      {error&&<div className="mb-5 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}

      {parsed&&(smart.length>0||recommendations.length>0)&&(
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {parsed.people&&<span className="flex items-center gap-1.5 text-slate-200"><Users className="w-4 h-4 text-amber-400"/> {lang==='ru'?`${parsed.people} человек`:`${parsed.people} adam`}</span>}
              {parsed.max_budget!==undefined&&<span className="flex items-center gap-1.5 text-slate-200"><Wallet className="w-4 h-4 text-amber-400"/> {lang==='ru'?'Бюджет':'Býujet'} {parsed.max_budget} {currency}</span>}
              {parsed.exclusions?.length>0&&<span className="text-slate-400">{lang==='ru'?'Без':'Aýyrma'}: {parsed.exclusions.join(', ')}</span>}
            </div>
            <button className="text-amber-400 text-sm flex items-center gap-1" onClick={clearSearch}><X className="w-3.5 h-3.5"/> {lang==='ru'?'Сбросить':'Arassala'}</button>
          </div>
        </div>
      )}

      {recommendations.length>0&&(
        <div className="mb-10">
          <h2 className="text-xl font-bold mb-4">{lang==='ru'?'Готовые комбинации':'Taýyn toplumlar'}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {recommendations.map((opt:any,idx:number)=>(
              <article key={idx} className="rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5">
                <h3 className="font-bold text-amber-300 mb-3">{opt.label}</h3>
                <ul className="space-y-1.5 text-sm">
                  {opt.items.map((line:any)=>(
                    <li key={line.id} className="flex justify-between text-slate-300"><span>{line.quantity} × {line.name}</span><span>{line.line_total} {currency}</span></li>
                  ))}
                </ul>
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                  <span className="text-2xl font-black">{opt.total} {currency}</span>
                  {opt.remaining_budget!==null&&<span className="text-xs text-emerald-400">{lang==='ru'?'Остаток':'Galyndy'}: {opt.remaining_budget} {currency}</span>}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {smart.length===0&&recommendations.length===0&&parsed&&(
        <div className="mb-8 p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400 text-sm">
          {lang==='ru'?'Ничего не подходит под этот запрос в рамках бюджета. Попробуйте увеличить бюджет или изменить пожелания.':'Bu soraga we býujete laýyk zat tapylmady. Býujeti köpeldiň ýa-da islegleri üýtgediň.'}
        </div>
      )}

      {smart.length>0&&<div className="mb-5 text-sm text-slate-400">{lang==='ru'?`Умный поиск нашёл ${smart.length} подходящих позиций.`:`Akylly gözleg ${smart.length} laýyk önüm tapdy.`}</div>}

      <div className="space-y-8">{categories.map(cat=>{const catItems=visible.filter(x=>x.category_name===cat); if(!catItems.length)return null; return <section key={cat}><h2 className="text-xl font-bold mb-3">{cat}</h2><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{catItems.map((x:any)=><article key={x.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex justify-between gap-4"><div><h3 className="font-bold text-lg">{x.name}</h3><p className="text-sm text-slate-400 mt-2">{x.description||''}</p>{x.reasons?.length>0&&<div className="mt-3 text-xs text-amber-300">{x.reasons.join(' · ')}</div>}</div><div className="font-bold whitespace-nowrap">{x.price} {currency}</div></div><button className="mt-5 w-full btn flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4"/> {lang==='ru'?'Заказать':'Sargyt et'}</button></article>)}</div></section>})}</div>
    </main>
  </div>;
};
