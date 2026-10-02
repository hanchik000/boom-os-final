import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChefHat, CreditCard, DollarSign, RefreshCw, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { Notice } from './ui';

export const OperationsView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const branchId = user?.branch_id || '';
  const [orders,setOrders]=useState<any[]>([]); const [payments,setPayments]=useState<any[]>([]); const [kds,setKds]=useState<any[]>([]); const [shift,setShift]=useState<any|null>(null);
  const [opening,setOpening]=useState('0'); const [actual,setActual]=useState('0'); const [payMethod,setPayMethod]=useState('CASH'); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const canOrders=hasPermission('orders.view'), canPayments=hasPermission('payments.view'), canKds=hasPermission('kds.view'), canShift=hasPermission('cash_shifts.view');
  // Stage 40 defect fix: this screen demanded ALL FOUR datasets in one Promise.all. A cashier holds
  // orders.view and payments.view but not kds.view, so the kitchen request was correctly refused,
  // the whole Promise.all rejected, and the page showed an error INSTEAD of the orders and payments
  // the cashier is entitled to see. Each dataset is now requested only by someone allowed to see it,
  // and one refusal no longer blanks out the rest of the screen. The server still authorises every
  // request exactly as before -- nothing here grants access, it only stops asking for what this
  // person may not have.
  const load=async()=>{if(!branchId)return;setError('');
    const fail=(e:any)=>{setError(e?.message||'Не удалось загрузить операции.');return null};
    const [o,p,k,s]=await Promise.all([
      canOrders?api.getOrders({branch_id:branchId}).catch(fail):Promise.resolve(null),
      canPayments?api.getPayments({branch_id:branchId}).catch(fail):Promise.resolve(null),
      canKds?api.getKds({branch_id:branchId}).catch(fail):Promise.resolve(null),
      canShift?api.getCurrentCashShift(branchId).catch(fail):Promise.resolve(null),
    ]);
    setOrders(o?.orders||[]);setPayments(p?.payments||[]);setKds(k?.tickets||[]);setShift(s?.shift||null);};
  useEffect(()=>{void load()},[branchId]);
  const pending=useMemo(()=>orders.filter(o=>['PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY'].includes(o.status)),[orders]);
  const payable=useMemo(()=>pending.filter(o=>o.status==='READY'&&!payments.some(p=>p.order_id===o.id&&p.status==='PAID')),[pending,payments]);
  const open=async()=>{setBusy(true);try{await api.openCashShift(branchId,opening);await load()}catch(e:any){setError(e?.message||'Не удалось открыть смену')}finally{setBusy(false)}};
  const close=async()=>{if(!shift)return;setBusy(true);try{await api.closeCashShift(shift.id,actual);await load()}catch(e:any){setError(e?.message||'Не удалось закрыть смену')}finally{setBusy(false)}};
  const confirmOrder=async(o:any)=>{setBusy(true);try{await api.confirmOrder(o.id);await load()}catch(e:any){setError(e?.message||'Не удалось подтвердить заказ')}finally{setBusy(false)}};
  const pay=async(o:any)=>{setBusy(true);try{await api.createPayment({order_id:o.id,method:payMethod,amount:String(o.final_amount)},crypto.randomUUID());await load()}catch(e:any){setError(e?.message||'Не удалось принять оплату')}finally{setBusy(false)}};
  const refund=async(p:any)=>{setBusy(true);try{await api.refundPayment(p.id);await load()}catch(e:any){setError(e?.message||'Не удалось оформить возврат')}finally{setBusy(false)}};
  const kdsNext=(status:string)=>status==='NEW'?'PREPARING':status==='PREPARING'?'READY':status==='READY'?'COMPLETED':'';
  const advance=async(t:any)=>{const next=kdsNext(t.status);if(!next)return;setBusy(true);try{await api.updateKdsStatus(t.id,next);await load()}catch(e:any){setError(e?.message||'Не удалось обновить KDS')}finally{setBusy(false)}};
  return <div className="p-6 space-y-6">{error&&<Notice kind="error">{error}</Notice>}
    <section className="grid md:grid-cols-3 gap-4">
      {canShift&&<div className="panel p-4"><div className="flex items-center gap-2 text-slate-300"><DollarSign className="w-4"/> Кассовая смена</div>{shift?<><div className="text-2xl font-bold text-white mt-2">OPEN</div><div className="text-sm text-slate-400 mt-1">Ожидаемо: {shift.expected_cash} TMT</div><div className="flex gap-2 mt-3"><input className="field" value={actual} onChange={e=>setActual(e.target.value)} placeholder="Фактическая наличность"/><button className="btn" disabled={busy||!hasPermission('cash_shifts.close')} onClick={()=>void close()}>Z</button></div></>:<div className="flex gap-2 mt-3"><input className="field" value={opening} onChange={e=>setOpening(e.target.value)} placeholder="Открывающая сумма"/><button className="btn" disabled={busy||!hasPermission('cash_shifts.open')} onClick={()=>void open()}>Открыть</button></div>}</div>}
      <div className="panel p-4"><div className="flex items-center gap-2 text-slate-300"><CreditCard className="w-4"/> К оплате</div><div className="text-3xl font-bold text-white mt-2">{payable.length}</div><p className="text-sm text-slate-400">Готовые заказы без оплаты</p></div>
      {canKds&&<div className="panel p-4"><div className="flex items-center gap-2 text-slate-300"><ChefHat className="w-4"/> Кухня</div><div className="text-3xl font-bold text-white mt-2">{kds.filter(t=>t.status!=='COMPLETED'&&t.status!=='CANCELLED').length}</div><p className="text-sm text-slate-400">Активные заказы на кухне</p></div>}
    </section>
    <section className="panel p-4"><h2 className="text-white text-lg font-bold mb-4">Кассир / подтверждение оплаты</h2><div className="space-y-2">{payable.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 border border-slate-800 rounded-lg p-3"><div><strong className="text-white">#{o.order_number}</strong><span className="ml-3 text-slate-400">{o.order_type} · {o.final_amount} {o.currency}</span><div className="text-xs text-slate-500">Статус: {o.status}</div></div><div className="flex gap-2">{o.status==='PENDING_CONFIRMATION'&&<button className="btn" disabled={busy||!hasPermission('orders.confirm')} onClick={()=>void confirmOrder(o)}><Check className="w-4"/> Подтвердить</button>}{o.status!=='PENDING_CONFIRMATION'&&<><select className="field" value={payMethod} onChange={e=>setPayMethod(e.target.value)}><option>CASH</option><option>CARD</option><option>ONLINE</option><option>BONUS</option><option>OTHER</option></select><button className="btn" disabled={busy||!hasPermission('payments.create')} onClick={()=>void pay(o)}><CreditCard className="w-4"/> Оплатить {o.final_amount}</button></>}</div></div>)}{!payable.length&&<p className="text-slate-500">Нет заказов, ожидающих оплаты.</p>}</div></section>
    {canKds&&<section className="panel p-4"><h2 className="text-white text-lg font-bold mb-4">Кухня</h2><div className="grid lg:grid-cols-3 gap-3">{kds.filter(t=>t.status!=='CANCELLED').map(t=><div key={t.id} className="border border-slate-800 rounded-xl p-4"><div className="flex justify-between"><strong className="text-white">#{t.order_number}</strong><span className="text-amber-300">{t.status}</span></div><div className="text-sm text-slate-400 mt-2">{t.order_type}{t.table_code?` · стол ${t.table_code}`:''} · {t.waiter_name||'—'}</div><div className="mt-3 space-y-1">{(t.items||[]).map((i:any)=><div key={i.id} className="text-sm text-slate-300">{i.title_snapshot} × {i.quantity}</div>)}</div>{kdsNext(t.status)&&<button className="btn w-full mt-3" disabled={busy||!hasPermission('kds.update')} onClick={()=>void advance(t)}><ChefHat className="w-4"/> {kdsNext(t.status)}</button>}</div>)}{!kds.length&&<p className="text-slate-500">Нет заказов на кухне.</p>}</div></section>}
    {canPayments&&<section className="panel p-4"><h2 className="text-white text-lg font-bold mb-4">Платежи</h2><div className="space-y-2">{payments.slice(0,50).map(p=><div key={p.id} className="flex items-center justify-between border-b border-slate-800 py-2"><div><span className="text-white">{p.method}</span><span className="text-slate-400 ml-3">{p.amount}</span><span className="text-slate-500 ml-3">{p.status}</span></div>{p.status==='PAID'&&<button className="btn" disabled={busy||!hasPermission('payments.refund')} onClick={()=>void refund(p)}><RefreshCw className="w-4"/> Возврат</button>}</div>)}{!payments.length&&<p className="text-slate-500">Платежей пока нет.</p>}</div></section>}
  </div>;
};
