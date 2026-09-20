import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Ban, Check, Delete, ClipboardList, SplitSquareHorizontal, Merge, UserRound, LockKeyhole, Plus, ReceiptText, Send, UtensilsCrossed, LoaderCircle, Minus, RefreshCw, Sparkles, X } from 'lucide-react';
import { api, getStoredWaiterSession, setStoredWaiterSession } from '../api';
import { useBranding } from '../context/BrandingContext';

type CartLine = { id: string; name: string; price: string; quantity: number; modifierIds: string[]; modifierNames: string[]; comment?: string|null };

export const WaiterPOSView: React.FC = () => {
  const { branding }=useBranding();
  const [code,setCode]=useState(''); const [authorized,setAuthorized]=useState(false); const [waiter,setWaiter]=useState<any|null>(null);
  const [authError,setAuthError]=useState(''); const [authLoading,setAuthLoading]=useState(false); const [idle,setIdle]=useState(true);
  const [categories,setCategories]=useState<any[]>([]); const [items,setItems]=useState<any[]>([]); const [tables,setTables]=useState<any[]>([]);
  const [category,setCategory]=useState(''); const [cart,setCart]=useState<CartLine[]>([]); const [modifierPicker,setModifierPicker]=useState<any|null>(null); const [selectedModifiers,setSelectedModifiers]=useState<string[]>([]); const [table,setTable]=useState('');
  const [orderType,setOrderType]=useState<'DINE_IN'|'TAKEAWAY'>('DINE_IN'); const [sent,setSent]=useState(false); const [loadingData,setLoadingData]=useState(false); const [loadError,setLoadError]=useState('');
  const [deviceId]=useState(()=>{const k='boom_waiter_device_id'; const x=localStorage.getItem(k); if(x)return x; const v=crypto.randomUUID(); localStorage.setItem(k,v); return v;});
  // Stage 35.2 -- idle-screen POS media (promotional video/image loop). Presentation only: it
  // never carries a price or a product and is never part of the Order Core.
  const [posMedia,setPosMedia]=useState<any|null>(null);
  const [posMediaFailed,setPosMediaFailed]=useState(false);
  // Smart Search -- same backend engine as Customer Menu (/api/public/smart-search); the
  // waiter can add a whole recommended combination to the cart in one action.
  const [smartQuery,setSmartQuery]=useState(''); const [smartLoading,setSmartLoading]=useState(false); const [smartError,setSmartError]=useState('');
  const [smartItems,setSmartItems]=useState<any[]>([]); const [smartRecs,setSmartRecs]=useState<any[]>([]); const [smartParsed,setSmartParsed]=useState<any|null>(null); const [smartOpen,setSmartOpen]=useState(false);
  // Stage 34.1 -- "ОТКАЗ". The waiter may only REQUEST a cancellation: they choose the reason AND
  // what must happen to the products, and a manager decides. Nothing is finalised here, and the
  // product choice is never pre-selected -- an unchosen decision cannot be submitted.
  const [myOrders,setMyOrders]=useState<any[]>([]); const [myOrdersOpen,setMyOrdersOpen]=useState(false); const [myOrdersLoading,setMyOrdersLoading]=useState(false);
  const [refusal,setRefusal]=useState<any|null>(null); const [refusalReason,setRefusalReason]=useState(''); const [refusalComment,setRefusalComment]=useState('');
  const [refusalTreatment,setRefusalTreatment]=useState<''|'WRITE_OFF'|'NO_WRITE_OFF'>(''); const [refusalBusy,setRefusalBusy]=useState(false); const [refusalError,setRefusalError]=useState(''); const [refusalSent,setRefusalSent]=useState(false);
  const loadMyOrders=async()=>{setMyOrdersLoading(true);try{const r=await api.getMyWaiterOrders();setMyOrders(r.orders||[]);}catch(e:any){setRefusalError(e?.message||'Не удалось загрузить заказы.')}finally{setMyOrdersLoading(false)}};
  const openMyOrders=()=>{setMyOrdersOpen(true);setRefusalError('');void loadMyOrders()};
  const openRefusal=(o:any)=>{setRefusal(o);setRefusalReason('');setRefusalComment('');setRefusalTreatment('');setRefusalError('');setRefusalSent(false)};
  // Stage 34.9 -- guest identification from the waiter POS. Attaching a guest NEVER changes the
  // price: there is no automatic discount anywhere in BOOM OS. Everything shown here is the same
  // identity the cashier, the BOOMCARD cabinet and CRM see.
  const [guestOrder,setGuestOrder]=useState<any|null>(null); const [guestQuery,setGuestQuery]=useState(''); const [guestResults,setGuestResults]=useState<any[]>([]);
  const [guestName,setGuestName]=useState(''); const [guestPhone,setGuestPhone]=useState(''); const [guestBusy,setGuestBusy]=useState(false); const [guestError,setGuestError]=useState(''); const [guestIdentity,setGuestIdentity]=useState<any|null>(null);
  const openGuest=async(o:any)=>{setGuestOrder(o);setGuestQuery('');setGuestResults([]);setGuestName('');setGuestPhone('');setGuestError('');setGuestIdentity(null);if(o.customer_id){try{setGuestIdentity(await api.getWaiterCustomerIdentity(o.customer_id))}catch{setGuestIdentity(null)}}};
  const searchGuests=async(q:string)=>{setGuestQuery(q);if(q.trim().length<2){setGuestResults([]);return}try{setGuestResults((await api.searchWaiterCustomers(q.trim())).customers)}catch{setGuestResults([])}};
  const attachGuest=async(customerId:string|null)=>{if(!guestOrder||guestBusy)return;setGuestBusy(true);setGuestError('');try{await api.setWaiterOrderCustomer(guestOrder.id,customerId);await loadMyOrders();const fresh={...guestOrder,customer_id:customerId};setGuestOrder(fresh);setGuestIdentity(customerId?await api.getWaiterCustomerIdentity(customerId):null);}catch(e:any){setGuestError(e?.message||'Не удалось привязать клиента.')}finally{setGuestBusy(false)}};
  const createGuest=async()=>{if(!guestOrder||guestBusy||!guestName.trim())return;setGuestBusy(true);setGuestError('');try{const r=await api.createWaiterCustomer({name:guestName.trim(),phone:guestPhone.trim()||undefined});await attachGuest(r.customer.id);setGuestName('');setGuestPhone('');}catch(e:any){setGuestError(e?.message||'Не удалось создать клиента.')}finally{setGuestBusy(false)}};

  // Stage 34.4 -- split bill. The waiter decides HOW an order is divided; every amount shown is the
  // one the server computed for each separate check.
  const [splitOrder,setSplitOrder]=useState<any|null>(null); const [splitData,setSplitData]=useState<any|null>(null);
  const [splitCount,setSplitCount]=useState(2); const [splitBusy,setSplitBusy]=useState(false); const [splitError,setSplitError]=useState('');
  const loadSplit=async(orderId:string)=>{try{setSplitData(await api.getWaiterOrderBills(orderId));}catch(e:any){setSplitError(e?.message||'Не удалось загрузить счета.')}};
  const openSplit=async(o:any)=>{setSplitOrder(o);setSplitError('');setSplitCount(2);await loadSplit(o.id)};
  const doSplit=async(mode:'ITEMS'|'EQUAL')=>{if(!splitOrder||splitBusy)return;setSplitBusy(true);setSplitError('');try{await api.splitWaiterOrderBills(splitOrder.id,mode,splitCount);await loadSplit(splitOrder.id);}catch(e:any){setSplitError(e?.message||'Не удалось разделить счёт.')}finally{setSplitBusy(false)}};
  const doMove=async(itemId:string,billId:string|null)=>{if(!splitOrder||splitBusy)return;setSplitBusy(true);setSplitError('');try{await api.moveWaiterBillItem(splitOrder.id,itemId,billId);await loadSplit(splitOrder.id);}catch(e:any){setSplitError(e?.message||'Не удалось перенести позицию.')}finally{setSplitBusy(false)}};
  const doMerge=async()=>{if(!splitOrder||splitBusy)return;setSplitBusy(true);setSplitError('');try{await api.mergeWaiterOrderBills(splitOrder.id);await loadSplit(splitOrder.id);}catch(e:any){setSplitError(e?.message||'Не удалось объединить счета.')}finally{setSplitBusy(false)}};
  const submitRefusal=async()=>{if(!refusal||refusalBusy||!refusalReason.trim()||!refusalTreatment)return;setRefusalBusy(true);setRefusalError('');try{await api.requestWaiterOrderClosure(refusal.id,{reason:refusalReason.trim(),comment:refusalComment.trim()||null,inventory_treatment:refusalTreatment});setRefusalSent(true);await loadMyOrders();}catch(e:any){setRefusalError(e?.message||'Не удалось отправить запрос.')}finally{setRefusalBusy(false)}};

  useEffect(()=>{const t=window.setTimeout(()=>setIdle(false),3500); return()=>window.clearTimeout(t)},[authorized]);
  const loadOperationalData=async(branchId:string)=>{setLoadingData(true);setLoadError('');try{const [m,t]=await Promise.all([api.getMenu(branchId),api.getTables(branchId)]);setCategories(m.categories);setItems(m.items);setTables(t.tables);setCategory(c=>c&&m.categories.some(x=>x.id===c)?c:(m.categories[0]?.id||''));setTable(x=>x&&t.tables.some(y=>y.id===x)?x:(t.tables.find(y=>y.status==='AVAILABLE')?.id||t.tables[0]?.id||''));}catch(e:any){setLoadError(e?.message||'Не удалось загрузить меню и столы.')}finally{setLoadingData(false)}};
  useEffect(()=>{const token=getStoredWaiterSession(); if(!token)return; void api.getWaiterSession().then(async r=>{setWaiter(r.waiter);setAuthorized(true);setIdle(false);await loadOperationalData(r.session.branch_id); try { const m=await api.getCurrentWaiterPosMedia(); setPosMedia(m.primary||null); } catch { setPosMedia(null); } }).catch(()=>setStoredWaiterSession(null));},[]);
  const visibleItems=useMemo(()=>items.filter(x=>x.category_id===category),[items,category]);
  const cents=(v:string)=>{const [a,b='']=String(v).split('.');return BigInt(a)*100n+BigInt((b+'00').slice(0,2));};
  const money=(v:bigint)=>`${v/100n}.${(v%100n).toString().padStart(2,'0')}`;
  const subtotal=cart.reduce((sum,x)=>sum+cents(x.price)*BigInt(x.quantity),0n);
  const addLine=(item:any,modifierIds:string[]=[],modifierNames:string[]=[] ,modifierDelta='0')=>{setSent(false);const key=item.id+'|'+[...modifierIds].sort().join(',');setCart(c=>{const e=c.find(x=>x.id+'|'+[...x.modifierIds].sort().join(',')===key);return e?c.map(x=>x.id+'|'+[...x.modifierIds].sort().join(',')===key?{...x,quantity:x.quantity+1}:x):[...c,{id:item.id,name:item.name_ru,price:(Number(item.price)+Number(modifierDelta)).toFixed(2),quantity:1,modifierIds,modifierNames}]})};
  const add=async(item:any)=>{try{const r=await api.getMenuModifiers(item.id,waiter?.branch_id);const groups=r.groups||[];if(!groups.length){addLine(item);return;}setModifierPicker({item,groups});setSelectedModifiers([]);}catch{addLine(item)}};
  const runSmartSearch=async()=>{if(!waiter||!smartQuery.trim())return;setSmartLoading(true);setSmartError('');try{const r=await api.smartSearch(waiter.branch_id,smartQuery,'ru');setSmartItems(r.items);setSmartRecs(r.recommendations||[]);setSmartParsed(r.parsed);setSmartOpen(true);}catch(e:any){setSmartError(e?.message||'Не удалось выполнить поиск.')}finally{setSmartLoading(false)}};
  const closeSmartSearch=()=>{setSmartOpen(false);setSmartItems([]);setSmartRecs([]);setSmartParsed(null);setSmartQuery('')};
  // Every line of a recommendation is added from the REAL, already-loaded branch menu (by id),
  // never from the search response's own price text -- addLine() is the single cart-mutation
  // path already used by manual selection, so this can never diverge from it.
  const addCombination=(opt:any)=>{for(const line of opt.items){const real=items.find(i=>i.id===line.id); if(!real)continue; for(let i=0;i<line.quantity;i++) addLine(real);} closeSmartSearch();};
  const confirmModifiers=()=>{if(!modifierPicker)return;const item=modifierPicker.item;const selected=selectedModifiers.map(id=>modifierPicker.groups.flatMap((g:any)=>g.modifiers||[]).find((m:any)=>m.id===id)).filter(Boolean);const delta=selected.reduce((n:any,m:any)=>n+Number(m.price_delta||0),0);addLine(item,selectedModifiers,selected.map((m:any)=>m.name_ru),delta.toFixed(2));setModifierPicker(null);setSelectedModifiers([])};
  const removeOne=(id:string,modifierIds:string[]=[] )=>setCart(c=>c.flatMap(x=>x.id===id&&JSON.stringify([...x.modifierIds].sort())===JSON.stringify([...modifierIds].sort())?(x.quantity>1?[{...x,quantity:x.quantity-1}]:[]):[x]));
  const press=(d:string)=>{setAuthError('');if(code.length<4)setCode(v=>v+d)};
  const authorize=async()=>{if(code.length!==4||authLoading)return;setAuthLoading(true);try{const r=await api.authenticateWaiterCode(code,deviceId);setStoredWaiterSession(r.session.token);setWaiter(r.waiter);setAuthorized(true);setCode('');setIdle(false);await loadOperationalData(r.waiter.branch_id)}catch(e:any){setAuthError(e?.message||'Неверный код официанта');setCode('')}finally{setAuthLoading(false)}};
  const sendOrder=async()=>{if(!cart.length||!waiter||sent)return;if(orderType==='DINE_IN'&&!table)return;setSent(false);try{const key=crypto.randomUUID();await api.createWaiterOrder({order_type:orderType,table_id:orderType==='DINE_IN'?table:null,items:cart.map(x=>({menu_item_id:x.id,quantity:x.quantity,comment:x.comment||null,modifier_ids:x.modifierIds}))},key);setSent(true);setCart([]);}catch(e:any){setLoadError(e?.message||'Не удалось отправить заказ.')} };
  if(!authorized)return <div className="waiter-device" onClick={()=>setIdle(false)}>{idle?<button className="waiter-idle" onClick={()=>setIdle(false)} aria-label="Открыть экран официанта"><div className="boom-mark"><span>{branding.mark}</span></div><div className="idle-pulse"/><p>Коснитесь экрана, чтобы начать</p></button>:<div className="code-shell"><div className="device-topline"><span>{branding.product_name}</span><span>WAITER POS</span></div><div className="code-brand">{branding.mark}</div><h1>Код официанта</h1><p>Введите персональный 4-значный код</p><div className="code-dots">{[0,1,2,3].map(i=><span key={i} className={i<code.length?'filled':''}/>)}</div><div className="keypad">{['1','2','3','4','5','6','7','8','9'].map(d=><button key={d} onClick={()=>press(d)}>{d}</button>)}<button className="key-secondary" onClick={()=>setCode('')}><Delete/></button><button onClick={()=>press('0')}>0</button><button className="key-primary" disabled={code.length!==4||authLoading} onClick={()=>void authorize()}>{authLoading?<LoaderCircle className="animate-spin"/>:<Check/>}</button></div>{authError&&<div className="waiter-auth-error">{authError}</div>}<div className="secure-note"><LockKeyhole/> Код привязан к сотруднику и филиалу</div></div>}</div>;
  return <div className="waiter-pos"><header className="pos-header"><div className="pos-brand">{branding.logo_url?<img className="mini-boom" src={branding.logo_url} alt=""/>:<span className="mini-boom">{branding.mark}</span>}<div><strong>{branding.product_name}</strong><small>WAITER POS</small></div></div><div className="waiter-identity"><span>Официант</span><strong>{waiter?.full_name||'—'}</strong><em>{waiter?.employee_code||'—'}</em></div><button className="logout-device" onClick={openMyOrders}><ClipboardList/> Мои заказы</button><button className="logout-device" onClick={()=>{void api.logoutWaiter().catch(()=>undefined);setStoredWaiterSession(null);setAuthorized(false);setWaiter(null);setCode('');setCart([]);setIdle(true)}}><ArrowLeft/> Выйти</button></header>
    <main className="pos-grid"><section className="menu-panel"><div className="pos-title-row"><div><span className="eyebrow">{orderType}</span><h1>Новый заказ</h1></div><div className="table-select"><span>Тип заказа</span><select value={orderType} onChange={e=>{const v=e.target.value as 'DINE_IN'|'TAKEAWAY';setOrderType(v);if(v==='TAKEAWAY')setTable('')}}><option value="DINE_IN">В зале</option><option value="TAKEAWAY">С собой</option></select>{orderType==='DINE_IN'&&<><span>Стол</span><select value={table} onChange={e=>setTable(e.target.value)}>{tables.map(t=><option key={t.id} value={t.id}>{t.code} · {t.seats} мест · {t.status}</option>)}</select></>}</div></div>
        {posMedia&&!posMediaFailed&&<div className="pos-media-stage" aria-label="POS media">{posMedia.kind==='VIDEO'?<video src={posMedia.url} muted autoPlay loop playsInline onError={()=>setPosMediaFailed(true)} className="pos-media-content"/>:<img src={posMedia.url} alt="" onError={()=>setPosMediaFailed(true)} className="pos-media-content"/>}<div className="pos-media-vignette"/><div className="pos-media-label"><span>{branding.product_name}</span><b>{posMedia.name}</b></div></div>}
        <div className="flex gap-2 px-1 pb-3">
          <div className="relative flex-1">
            <Sparkles className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
            <input className="field pl-9" value={smartQuery} onChange={e=>setSmartQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void runSmartSearch()} placeholder="Например: на 4 человек до 1500 манат" />
          </div>
          <button className="btn" disabled={smartLoading||!smartQuery.trim()} onClick={()=>void runSmartSearch()}>{smartLoading?<LoaderCircle className="w-4 h-4 animate-spin"/>:'Найти'}</button>
          {smartOpen&&<button className="btn bg-slate-800 text-slate-200" onClick={closeSmartSearch}><X className="w-4 h-4"/></button>}
        </div>
        {smartError&&<div className="px-1 pb-2 text-red-400 text-xs">{smartError}</div>}
        {smartOpen ? (
          <div className="px-1 space-y-4 overflow-y-auto">
            {smartParsed&&(smartParsed.people||smartParsed.max_budget!==undefined)&&(
              <div className="text-xs text-slate-400">{smartParsed.people?`${smartParsed.people} человек`:''}{smartParsed.people&&smartParsed.max_budget!==undefined?' · ':''}{smartParsed.max_budget!==undefined?`бюджет ${smartParsed.max_budget}`:''}{smartParsed.exclusions?.length?` · без ${smartParsed.exclusions.join(', ')}`:''}</div>
            )}
            {smartRecs.length>0&&<div className="grid sm:grid-cols-2 gap-3">{smartRecs.map((opt:any,idx:number)=>(
              <div key={idx} className="rounded-xl border border-amber-500/30 bg-slate-900/70 p-4">
                <strong className="text-amber-300 text-sm">{opt.label}</strong>
                <ul className="mt-2 space-y-1 text-xs text-slate-300">{opt.items.map((l:any)=><li key={l.id} className="flex justify-between"><span>{l.quantity} × {l.name}</span><span>{l.line_total}</span></li>)}</ul>
                <div className="mt-3 flex items-center justify-between"><b className="text-white">{opt.total} TMT</b>{opt.remaining_budget!==null&&<span className="text-emerald-400 text-xs">остаток {opt.remaining_budget}</span>}</div>
                <button className="btn w-full mt-3 bg-amber-500 text-slate-950" onClick={()=>addCombination(opt)}>Добавить в заказ</button>
              </div>
            ))}</div>}
            <div className="menu-grid">{smartItems.map(item=><button className="menu-card" key={item.id} onClick={()=>{const real=items.find(i=>i.id===item.id); if(real) void add(real);}}><div className="food-icon"><UtensilsCrossed/></div><div className="menu-copy"><strong>{item.name}</strong><span>{item.description||''}</span><b>{item.price} TMT</b></div><Plus className="plus"/></button>)}</div>
            {!smartItems.length&&!smartRecs.length&&<div className="empty-order"><strong>Ничего не найдено под этот запрос и бюджет.</strong><span>Попробуйте изменить бюджет или пожелания.</span></div>}
          </div>
        ) : <>
        <div className="category-row">{categories.map(c=><button key={c.id} className={category===c.id?'active':''} onClick={()=>setCategory(c.id)}>{c.name_ru}</button>)}</div>{loadingData?<div className="empty-order"><LoaderCircle className="animate-spin"/><strong>Загрузка меню…</strong></div>:loadError?<div className="empty-order"><strong>{loadError}</strong><button onClick={()=>waiter&&void loadOperationalData(waiter.branch_id)}><RefreshCw/> Повторить</button></div>:<div className="menu-grid">{visibleItems.map(item=><button className="menu-card" key={item.id} onClick={()=>void add(item)}><div className="food-icon"><UtensilsCrossed/></div><div className="menu-copy"><strong>{item.name_ru}</strong><span>{item.description_ru||''}</span><b>{item.price} TMT</b></div><Plus className="plus"/></button>)}{!visibleItems.length&&<div className="empty-order"><strong>В этой категории пока нет блюд</strong><span>Добавьте позиции через Menu Engine.</span></div>}</div>}
        </>}
        </section>
      <aside className="order-panel"><div className="order-head"><div><span className="eyebrow">ORDER CORE</span><h2>{orderType==='DINE_IN'?`Стол ${tables.find(t=>t.id===table)?.code||'—'}`:'С собой'}</h2></div><ReceiptText/></div><div className="order-lines">{!cart.length?<div className="empty-order"><ReceiptText/><strong>Заказ пока пуст</strong><span>Выберите блюда слева</span></div>:cart.map(x=><div className="order-line" key={x.id}><div><strong>{x.name}</strong><span>{x.price} TMT × {x.quantity}{x.modifierNames.length?` · ${x.modifierNames.join(', ')}`:''}</span></div><div className="line-actions"><button onClick={()=>removeOne(x.id,x.modifierIds)}><Minus/></button><b>{x.quantity}</b><button onClick={()=>addLine(items.find(i=>i.id===x.id),x.modifierIds,x.modifierNames,(Number(x.price)-Number(items.find(i=>i.id===x.id)?.price||0)).toFixed(2))}><Plus/></button></div></div>)}</div><div className="order-bottom"><div className="total-row"><span>Промежуточный итог</span><strong>{money(subtotal)} TMT</strong></div><div className="total-row muted"><span>Сервисный сбор</span><span>Рассчитывается сервером</span></div><div className="total-row grand"><span>Итого</span><strong>{money(subtotal)} TMT</strong></div><button className="send-order" disabled={!cart.length||sent||loadingData||(orderType==='DINE_IN'&&!table)} onClick={()=>void sendOrder()}>{sent?<><Check/> Заказ отправлен</>:<><Send/> Отправить заказ</>}</button><p className="order-note">Итоговая цена рассчитывается сервером. Заказ получает статус «Ожидает подтверждения кассира».</p></div></aside></main>{guestOrder&&<div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={()=>{if(!guestBusy)setGuestOrder(null)}}><div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between"><div><h2 className="text-white text-xl font-bold">Клиент · #{guestOrder.order_number}</h2><p className="text-slate-400 text-sm">Привязка клиента не меняет цену заказа — скидка назначается отдельно и вручную.</p></div><button className="btn" onClick={()=>setGuestOrder(null)}><X className="w-4 h-4"/></button></div>
      {guestError&&<div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{guestError}</div>}
      {guestIdentity?<div className="rounded-xl border border-amber-500/30 bg-slate-950/60 p-3 space-y-1">
        <div className="flex items-center justify-between"><strong className="text-white">{guestIdentity.customer.name}</strong><button className="text-xs text-slate-400 hover:text-red-300" disabled={guestBusy} onClick={()=>void attachGuest(null)}>Открепить</button></div>
        <div className="text-xs text-slate-400">{guestIdentity.customer.phone||'телефон не указан'}</div>
        <div className="flex flex-wrap gap-2 text-[11px] pt-1">
          <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">BOOMCOIN: {guestIdentity.boomcoin.balance}</span>
          <span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">BOOMBACK: {guestIdentity.boomback.balance}</span>
          {guestIdentity.boomcard&&<span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">BOOMCARD: {guestIdentity.boomcard.status}</span>}
          {guestIdentity.credit&&<span className="px-2 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300">Долг: {guestIdentity.credit.current_balance}</span>}
        </div>
      </div>:<>
        <input className="field w-full" value={guestQuery} onChange={e=>void searchGuests(e.target.value)} placeholder="Имя или телефон"/>
        <div className="max-h-52 overflow-y-auto space-y-1">
          {guestResults.map((c:any)=><button key={c.id} className="w-full text-left px-3 py-2 rounded-lg border border-slate-800 hover:border-amber-500/40 text-sm" disabled={guestBusy} onClick={()=>void attachGuest(c.id)}><span className="text-white">{c.name}</span> <span className="text-slate-500 text-xs">{c.phone||''}</span></button>)}
          {guestQuery.trim().length>=2&&!guestResults.length&&<div className="text-slate-500 text-xs px-1">Ничего не найдено.</div>}
        </div>
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <div className="text-xs text-slate-400">Новый клиент</div>
          <input className="field w-full" value={guestName} onChange={e=>setGuestName(e.target.value)} placeholder="Имя (обязательно)"/>
          <input className="field w-full" value={guestPhone} onChange={e=>setGuestPhone(e.target.value)} placeholder="Телефон (необязательно)"/>
          <div className="flex justify-end"><button className="btn bg-amber-500 text-slate-950 font-semibold" disabled={guestBusy||!guestName.trim()} onClick={()=>void createGuest()}>Создать и привязать</button></div>
        </div>
      </>}
    </div></div>}{splitOrder&&<div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={()=>{if(!splitBusy){setSplitOrder(null);setSplitData(null)}}}><div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between"><div><h2 className="text-white text-xl font-bold">Счёт · #{splitOrder.order_number}</h2><p className="text-slate-400 text-sm">Заказ остаётся одной продажей — счета только делят его между гостями.</p></div><button className="btn" onClick={()=>{setSplitOrder(null);setSplitData(null)}}><X className="w-4 h-4"/></button></div>
      {splitError&&<div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{splitError}</div>}
      {!splitData?<div className="text-slate-400 text-sm">Загрузка…</div>:splitData.split_mode==='NONE'?<>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1"><span className="block text-xs text-slate-400">Сколько счетов</span><input className="field w-24" type="number" min={2} max={20} value={splitCount} onChange={e=>setSplitCount(Number(e.target.value))}/></label>
          <button className="btn bg-amber-500 text-slate-950 font-semibold" disabled={splitBusy} onClick={()=>void doSplit('ITEMS')}>Разделить по позициям</button>
          <button className="btn bg-slate-800 text-slate-200" disabled={splitBusy} onClick={()=>void doSplit('EQUAL')}>Разделить поровну</button>
        </div>
        <div className="text-xs text-slate-500">Итого по заказу: {splitData.order_final_amount} TMT</div>
      </>:<>
        <div className="flex items-center justify-between"><div className="text-xs text-slate-400">Режим: {splitData.split_mode==='EQUAL'?'поровну':'по позициям'} · Итого: {splitData.order_final_amount} TMT</div><button className="btn bg-slate-800 text-slate-200" disabled={splitBusy} onClick={()=>void doMerge()}><Merge className="w-4 h-4 inline mr-1"/>Объединить</button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {splitData.bills.map((b:any)=><div key={b.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <div className="flex items-center justify-between"><strong className="text-white">Счёт #{b.bill_number}</strong><span className="text-amber-300">{b.final_amount} TMT</span></div>
            <div className="text-[11px] text-slate-500">{b.status==='PAID'?'оплачен':'открыт'}{b.customer_name?` · ${b.customer_name}`:''}</div>
            {splitData.split_mode==='ITEMS'&&<ul className="space-y-1">{(b.items||[]).map((it:any)=><li key={it.id} className="flex justify-between items-center text-xs text-slate-300"><span>{it.quantity} × {it.title_snapshot}</span>{b.status!=='PAID'&&<button className="text-slate-500 hover:text-red-300" disabled={splitBusy} onClick={()=>void doMove(it.id,null)}>снять</button>}</li>)}{!(b.items||[]).length&&<li className="text-xs text-slate-600">пусто</li>}</ul>}
          </div>)}
        </div>
        {splitData.split_mode==='ITEMS'&&<div className="space-y-2">
          <div className="text-xs text-slate-400">Нераспределённые позиции</div>
          {splitData.unassigned_items.map((it:any)=><div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-2">
            <span className="text-sm text-slate-200">{it.quantity} × {it.title_snapshot} · {it.subtotal} TMT</span>
            <div className="flex gap-1">{splitData.bills.filter((b:any)=>b.status!=='PAID').map((b:any)=><button key={b.id} className="btn bg-slate-800 text-slate-200 text-xs" disabled={splitBusy} onClick={()=>void doMove(it.id,b.id)}>#{b.bill_number}</button>)}</div>
          </div>)}
          {!splitData.unassigned_items.length&&<div className="text-xs text-slate-600">Все позиции распределены.</div>}
        </div>}
      </>}
    </div></div>}{myOrdersOpen&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={()=>{if(!refusalBusy){setMyOrdersOpen(false);setRefusal(null)}}}><div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e=>e.stopPropagation()}>
      {!refusal?<>
        <div className="flex items-center justify-between"><div><h2 className="text-white text-xl font-bold">Мои активные заказы</h2><p className="text-slate-400 text-sm">Отказ отправляется менеджеру на подтверждение.</p></div><button className="btn" onClick={()=>setMyOrdersOpen(false)}><X className="w-4 h-4"/></button></div>
        {refusalError&&<div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{refusalError}</div>}
        {myOrdersLoading?<div className="text-slate-400 text-sm">Загрузка…</div>:!myOrders.length?<div className="text-slate-500 text-sm text-center py-8">Активных заказов нет.</div>:<div className="space-y-2">{myOrders.map(o=><div key={o.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
          <div className="min-w-0"><div className="text-white font-semibold">#{o.order_number}{o.table_code?` · Стол ${o.table_code}`:''}</div><div className="text-xs text-slate-400 mt-0.5">{o.status} · {o.final_amount} TMT{o.production_started_at?' · готовится/приготовлено':''}</div></div>
          <div className="flex gap-2 shrink-0">
            <button className="btn bg-slate-800 border border-slate-700 text-slate-200" onClick={()=>void openGuest(o)}><UserRound className="w-4 h-4 inline mr-1"/>Клиент</button>
            <button className="btn bg-slate-800 border border-slate-700 text-slate-200" onClick={()=>void openSplit(o)}><SplitSquareHorizontal className="w-4 h-4 inline mr-1"/>Счёт</button>
            {o.pending_closure?<span className="text-xs text-amber-300 self-center">Запрос на рассмотрении</span>:<button className="btn bg-red-600/20 border border-red-500/40 text-red-200" onClick={()=>openRefusal(o)}><Ban className="w-4 h-4 inline mr-1"/>ОТКАЗ</button>}
          </div>
        </div>)}</div>}
      </>:<>
        <div><h2 className="text-white text-xl font-bold">Отказ · #{refusal.order_number}</h2><p className="text-slate-400 text-sm">Официант не закрывает заказ сам — решение принимает менеджер.</p></div>
        {refusalSent?<><div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm p-3">Запрос отправлен менеджеру на подтверждение.</div><div className="flex justify-end"><button className="btn" onClick={()=>setRefusal(null)}>Готово</button></div></>:<>
          {refusalError&&<div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{refusalError}</div>}
          <label className="block space-y-1"><span className="text-xs text-slate-400">Причина (обязательно)</span><input className="field w-full" value={refusalReason} onChange={e=>setRefusalReason(e.target.value)} placeholder="Например: гость отказался"/></label>
          <label className="block space-y-1"><span className="text-xs text-slate-400">Комментарий</span><input className="field w-full" value={refusalComment} onChange={e=>setRefusalComment(e.target.value)}/></label>
          <div className="space-y-1"><span className="text-xs text-slate-400">Что делать с продуктами? (обязательно)</span>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={`p-3 rounded-lg border text-left text-sm ${refusalTreatment==='WRITE_OFF'?'border-amber-400 bg-amber-500/10 text-white':'border-slate-700 text-slate-300'}`} onClick={()=>setRefusalTreatment('WRITE_OFF')}>Списать продукты</button>
              <button type="button" className={`p-3 rounded-lg border text-left text-sm ${refusalTreatment==='NO_WRITE_OFF'?'border-amber-400 bg-amber-500/10 text-white':'border-slate-700 text-slate-300'}`} onClick={()=>setRefusalTreatment('NO_WRITE_OFF')}>Не списывать продукты</button>
            </div>
            <p className="text-[11px] text-slate-500">Если блюдо уже приготовлено, продукты не возвращаются на склад.</p>
          </div>
          <div className="flex gap-2 justify-end"><button className="btn" disabled={refusalBusy} onClick={()=>setRefusal(null)}>Назад</button><button className="btn bg-red-500 text-slate-950 font-semibold" disabled={refusalBusy||!refusalReason.trim()||!refusalTreatment} onClick={()=>void submitRefusal()}>Отправить запрос</button></div>
        </>}
      </>}
    </div></div>}{modifierPicker&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4"><div><h2 className="text-white text-xl font-bold">{modifierPicker.item.name_ru}</h2><p className="text-slate-400 text-sm">Выберите дополнительные параметры</p></div>{modifierPicker.groups.map((g:any)=><div key={g.id} className="space-y-2"><div className="flex justify-between text-sm"><strong className="text-white">{g.name_ru}</strong><span className="text-slate-400">{g.required?'обязательно':'необязательно'} · {g.min_select}–{g.max_select}</span></div><div className="grid grid-cols-2 gap-2">{(g.modifiers||[]).map((m:any)=><button key={m.id} className={`p-3 rounded-lg border text-left ${selectedModifiers.includes(m.id)?'border-amber-400 bg-amber-500/10 text-white':'border-slate-700 text-slate-300'}`} onClick={()=>setSelectedModifiers(v=>v.includes(m.id)?v.filter(x=>x!==m.id):[...v,m.id])}><div>{m.name_ru}</div><small>{m.price_delta} TMT</small></button>)}</div></div>)}<div className="flex gap-2 justify-end"><button className="btn" onClick={()=>setModifierPicker(null)}>Отмена</button><button className="btn bg-amber-500 text-slate-950" onClick={confirmModifiers}>Добавить</button></div></div></div>}</div>;
};
