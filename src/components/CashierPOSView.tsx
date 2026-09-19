import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserRound, Lock, Unlock, RefreshCw, Search, Printer, Copy, CheckCircle2, XCircle, StickyNote, ChefHat, Receipt as ReceiptIcon, Loader2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

// ---------------------------------------------------------------------------------------------
// Cashier POS -- a real cashier workstation built on the existing Order Core / Payment Core /
// Cash Shift / Print engine. No values shown here are computed by the frontend: subtotal,
// service charge, discount and total always come from the order/payment rows the server
// returns. This view only formats and displays them.
// ---------------------------------------------------------------------------------------------

const POS_TOKEN_KEY = 'boom_cashier_pos_token';
const POS_BRANCH_KEY = 'boom_cashier_pos_branch';
const PAYMENT_METHODS = ['CASH', 'CARD', 'ONLINE', 'BONUS', 'OTHER', 'CREDIT'];
const QUICK_NOTES_RU = ['Без лука', 'Без соли', 'Соус отдельно', 'Острый соус', 'Без кетчупа', 'Без майонеза'];
const QUICK_NOTES_TK = ['Sogansyz', 'Duzsuz', 'Sous aýratyn', 'Ýiti sous', 'Ketçupsyz', 'Maýonezsiz'];

function money(v: any) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : String(v ?? '0.00');
}
function fmtTime(v?: string | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return v; }
}
function fmtDateTime(v?: string | null) {
  if (!v) return '—';
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

function friendlyError(e: any, ru: boolean): string {
  const code = e?.code || '';
  const map: Record<string, [string, string]> = {
    POS_SESSION_REQUIRED: ['POS-сессия истекла. Разблокируйте POS снова.', 'POS sessiýasy gutardy. POS-y ýene açyň.'],
    POS_SESSION_INVALID: ['POS-сессия истекла. Разблокируйте POS снова.', 'POS sessiýasy gutardy. POS-y ýene açyň.'],
    ORDER_NOT_READY_FOR_PAYMENT: ['Заказ ещё не готов к оплате.', 'Sargyt heniz töleg üçin taýyn däl.'],
    KDS_NOT_READY_FOR_PAYMENT: ['Кухня ещё не завершила приготовление.', 'Kухня heniz taýýarlygy gutarmady.'],
    PAYMENT_AMOUNT_MUST_EQUAL_REMAINING: ['Заказ уже оплачен или сумма изменилась. Обновляю…', 'Sargyt eýýäm tölenen ýa-da mukdar üýtgedi. Täzelenýär…'],
    OPEN_SHIFT_REQUIRED: ['Смена закрыта. Откройте смену перед приёмом оплаты.', 'Çalyşyk ýapyk. Töleg kabul etmezden ozal çalyşygy açyň.'],
    BRANCH_ACCESS_DENIED: ['Этот заказ относится к другому филиалу.', 'Bu sargyt başga şahamça degişli.'],
    SHIFT_ALREADY_OPEN: ['Смена уже открыта.', 'Çalyşyk eýýäm açyk.'],
    SHIFT_NOT_OPEN: ['Смена уже закрыта.', 'Çalyşyk eýýäm ýapyk.'],
    INVALID_CREDENTIALS: ['Неверный пароль.', 'Nädogry parol.'],
    INVALID_OPERATOR_PASSWORD: ['Неверный пароль.', 'Nädogry parol.'],
    CREDIT_ACCOUNT_REQUIRED: ['Выберите клиента или сотрудника для кредита.', 'Kredit üçin müşderini ýa-da işgäri saýlaň.'],
    CREDIT_ACCOUNT_NOT_FOUND: ['Кредитный счёт не найден.', 'Kredit hasaby tapylmady.'],
    CREDIT_LIMIT_EXCEEDED: ['Превышен кредитный лимит. Требуется менеджер.', 'Kredit çägi aşyldy. Menejer gerek.'],
    CREDIT_ISSUE_PERMISSION_REQUIRED: ['Нет прав на выдачу кредита.', 'Kredit bermäge rugsat ýok.'],
    REPAYMENT_EXCEEDS_BALANCE: ['Сумма погашения больше долга.', 'Üzülýän mukdar bergiden köp.'],
    PAYROLL_DEDUCTION_REQUIRES_APPROVAL: ['Удержание из зарплаты требует менеджера.', 'Aýlykdan tutma menejeri talap edýär.'],
  };
  const found = map[code];
  if (found) return ru ? found[0] : found[1];
  return e?.message || (ru ? 'Произошла ошибка. Попробуйте снова.' : 'Ýalňyşlyk ýüze çykdy. Gaýtadan synanyň.');
}

export const CashierPOSView: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { language } = useLanguage();
  const ru = language === 'ru';
  const branchId = user?.branch_id || '';
  const isCashierRole = Boolean(user?.roleCodes?.includes('CASHIER')) && !user?.isSuperUser;

  // ---- POS operator session (short-lived token, only meaningfully required for CASHIER role)
  const [posToken, setPosToken] = useState<string | null>(() => {
    const t = localStorage.getItem(POS_TOKEN_KEY);
    const b = localStorage.getItem(POS_BRANCH_KEY);
    return t && b === branchId ? t : null;
  });
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const posLocked = isCashierRole && !posToken;

  const doUnlock = async () => {
    if (unlockBusy || !unlockPassword) return;
    setUnlockBusy(true); setUnlockError('');
    try {
      const r = await api.unlockOperatorPos({ password: unlockPassword, branch_id: branchId, device_id: 'cashier-pos-web' });
      setPosToken(r.session_token);
      localStorage.setItem(POS_TOKEN_KEY, r.session_token);
      localStorage.setItem(POS_BRANCH_KEY, branchId);
      setUnlockOpen(false); setUnlockPassword('');
    } catch (e: any) {
      setUnlockError(friendlyError(e, ru));
    } finally { setUnlockBusy(false); }
  };
  const doLock = async () => {
    try { await api.lockOperatorPos(branchId); } catch { /* best-effort */ }
    setPosToken(null);
    localStorage.removeItem(POS_TOKEN_KEY);
    localStorage.removeItem(POS_BRANCH_KEY);
  };

  // ---- Cash shift
  const [shift, setShift] = useState<any | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [openingCash, setOpeningCash] = useState('0.00');
  const [actualCash, setActualCash] = useState('0.00');
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [shiftError, setShiftError] = useState('');

  const loadShift = useCallback(async () => {
    if (!branchId) return;
    try { const r = await api.getCurrentCashShift(branchId); setShift(r.shift); } catch { /* ignore */ }
  }, [branchId]);

  const openShift = async () => {
    setShiftBusy(true); setShiftError('');
    try { await api.openCashShift(branchId, openingCash); await loadShift(); }
    catch (e: any) { setShiftError(friendlyError(e, ru)); }
    finally { setShiftBusy(false); }
  };
  const closeShift = async () => {
    if (!shift) return;
    setShiftBusy(true); setShiftError('');
    try { await api.closeCashShift(shift.id, actualCash); setCloseConfirmOpen(false); await loadShift(); }
    catch (e: any) { setShiftError(friendlyError(e, ru)); }
    finally { setShiftBusy(false); }
  };

  // ---- Active orders
  // Stage 34.4 -- separate checks. A split order is settled one bill at a time; the amounts shown
  // are the ones the server computed for each bill.
  const [bills, setBills] = useState<any[]>([]);
  const [splitMode, setSplitMode] = useState('NONE');
  const [payingBill, setPayingBill] = useState<any | null>(null);

  // Stage 34.3 -- guest identification and MANUAL discounts. Attaching a guest never changes the
  // price, and every amount shown here is the one the server computed and returned.
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountPresets, setDiscountPresets] = useState<string[]>([]);
  const [discountMax, setDiscountMax] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountBusy, setDiscountBusy] = useState(false);
  const [discountError, setDiscountError] = useState('');

  // Stage 34.1 -- "ЗАКРЫТО ЗАВЕДЕНИЕМ". The cashier may only REQUEST it; a manager approves.
  // The product decision (write off / do not write off) is always picked here explicitly, never
  // defaulted and never inferred from whether money is being refunded.
  const [closureOpen, setClosureOpen] = useState(false);
  const [closureReason, setClosureReason] = useState('');
  const [closureComment, setClosureComment] = useState('');
  const [closureTreatment, setClosureTreatment] = useState<'' | 'WRITE_OFF' | 'NO_WRITE_OFF'>('');
  const [closureRefund, setClosureRefund] = useState(false);
  const [closureBusy, setClosureBusy] = useState(false);
  const [closureError, setClosureError] = useState('');
  const [closureSent, setClosureSent] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'READY' | 'UNPAID' | 'DINE_IN' | 'TAKEAWAY'>('ALL');

  const loadOrders = useCallback(async (silent = false) => {
    if (!branchId) return;
    if (!silent) setOrdersLoading(true);
    setOrdersError('');
    try {
      const [o, p] = await Promise.all([api.getOrders({ branch_id: branchId }), api.getPayments({ branch_id: branchId })]);
      setOrders(o.orders); setPayments(p.payments);
    } catch (e: any) {
      setOrdersError(friendlyError(e, ru));
    } finally { if (!silent) setOrdersLoading(false); }
  }, [branchId, ru]);

  useEffect(() => { void loadOrders(); void loadShift(); }, [loadOrders, loadShift]);
  // Lightweight polling so new READY orders appear without a full reload.
  useEffect(() => {
    const id = window.setInterval(() => { void loadOrders(true); void loadShift(); }, 4000);
    return () => window.clearInterval(id);
  }, [loadOrders, loadShift]);

  const paidOrderIds = useMemo(() => new Set(payments.filter(p => p.status === 'PAID').map(p => p.order_id)), [payments]);
  const activeOrders = useMemo(() => orders.filter(o => !['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(o.status)), [orders]);
  const visibleOrders = useMemo(() => {
    let list = activeOrders;
    if (filter === 'READY') list = list.filter(o => o.status === 'READY');
    else if (filter === 'UNPAID') list = list.filter(o => !paidOrderIds.has(o.id));
    else if (filter === 'DINE_IN' || filter === 'TAKEAWAY') list = list.filter(o => o.order_type === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(o => String(o.order_number).toLowerCase().includes(q) || String(o.table_code || '').toLowerCase().includes(q) || String(o.waiter_name || '').toLowerCase().includes(q));
    return list;
  }, [activeOrders, filter, paidOrderIds, search]);

  // ---- Selected order detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true); setDetailError('');
    try { const r = await api.getOrder(id); setDetail(r.order); }
    catch (e: any) { setDetailError(friendlyError(e, ru)); }
    finally { setDetailLoading(false); }
  }, [ru]);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const selectedPaid = useMemo(() => detail ? payments.find(p => p.order_id === detail.id && p.status === 'PAID') : undefined, [detail, payments]);

  // ---- Notes
  const [customerNoteDraft, setCustomerNoteDraft] = useState('');
  const [internalNoteDraft, setInternalNoteDraft] = useState('');
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  useEffect(() => {
    setCustomerNoteDraft(detail?.notes || '');
    setInternalNoteDraft(detail?.internal_notes || '');
    setNotesSaved(false);
  }, [detail?.id, detail?.notes, detail?.internal_notes]);

  const saveNotes = async () => {
    if (!detail) return;
    setNotesBusy(true);
    try {
      const r = await api.updateOrderNotes(detail.id, { customer_note: customerNoteDraft || null, internal_note: internalNoteDraft || null });
      setDetail(r.order); setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 1500);
    } catch (e: any) { setDetailError(friendlyError(e, ru)); }
    finally { setNotesBusy(false); }
  };

  const [itemNoteDrafts, setItemNoteDrafts] = useState<Record<string, string>>({});
  const [itemNoteBusy, setItemNoteBusy] = useState<string | null>(null);
  const saveItemNote = async (itemId: string, text: string) => {
    if (!detail) return;
    setItemNoteBusy(itemId);
    try {
      await api.updateOrderItemNote(detail.id, itemId, text || null);
      await loadDetail(detail.id);
    } catch (e: any) { setDetailError(friendlyError(e, ru)); }
    finally { setItemNoteBusy(null); }
  };

  // ---- Payment
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payMethod, setPayMethod] = useState('CASH');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [successPayment, setSuccessPayment] = useState<any | null>(null);
  const [successOrder, setSuccessOrder] = useState<any | null>(null);

  // ---- Credit sale sub-flow (CUSTOMER or STAFF receivable, settles through the same payment)
  const [creditKind, setCreditKind] = useState<'CUSTOMER' | 'EMPLOYEE'>('CUSTOMER');
  const [creditPhone, setCreditPhone] = useState('');
  const [creditName, setCreditName] = useState('');
  const [creditEmployeeSearch, setCreditEmployeeSearch] = useState('');
  const [creditEmployeeResults, setCreditEmployeeResults] = useState<any[]>([]);
  const [creditAccount, setCreditAccount] = useState<any | null>(null); // {account, owner, available_credit}
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState('');

  const resetCreditFlow = () => {
    setCreditKind('CUSTOMER'); setCreditPhone(''); setCreditName(''); setCreditEmployeeSearch('');
    setCreditEmployeeResults([]); setCreditAccount(null); setCreditError('');
  };

  const searchCreditEmployees = async (q: string) => {
    setCreditEmployeeSearch(q);
    if (q.trim().length < 2) { setCreditEmployeeResults([]); return; }
    try { const r = await api.getEmployees({ branch_id: branchId, search: q }); setCreditEmployeeResults(r.employees || []); } catch { /* ignore */ }
  };

  const resolveCreditCustomer = async () => {
    if (creditBusy || !creditPhone.trim() || !creditName.trim()) return;
    setCreditBusy(true); setCreditError('');
    try {
      const c = await api.createCustomer({ branch_id: branchId, name: creditName.trim(), phone: creditPhone.trim() });
      const a = await api.createCreditAccount({ branch_id: branchId, type: 'CUSTOMER', customer_id: c.customer.id });
      const full = await api.getCreditAccount(a.account.id);
      setCreditAccount(full);
    } catch (e: any) { setCreditError(friendlyError(e, ru)); }
    finally { setCreditBusy(false); }
  };

  const resolveCreditEmployee = async (employeeId: string) => {
    if (creditBusy) return;
    setCreditBusy(true); setCreditError('');
    try {
      const a = await api.createCreditAccount({ branch_id: branchId, type: 'EMPLOYEE', employee_id: employeeId });
      const full = await api.getCreditAccount(a.account.id);
      setCreditAccount(full);
    } catch (e: any) { setCreditError(friendlyError(e, ru)); }
    finally { setCreditBusy(false); }
  };

  function payBlockedReason(o: any): string | null {
    if (!o) return null;
    if (isCashierRole && !posToken) return ru ? 'Требуется POS-сессия. Разблокируйте POS.' : 'POS sessiýasy gerek. POS-y açyň.';
    if (!shift || shift.status !== 'OPEN') return ru ? 'Смена закрыта. Откройте смену перед приёмом оплаты.' : 'Çalyşyk ýapyk. Töleg kabul etmezden ozal çalyşygy açyň.';
    if (paidOrderIds.has(o.id) || o.status === 'COMPLETED') return ru ? 'Заказ уже оплачен.' : 'Sargyt eýýäm tölenen.';
    if (o.status !== 'READY') return ru ? 'Заказ ещё не готов.' : 'Sargyt heniz taýyn däl.';
    return null;
  }

  const pay = async () => {
    if (!detail || paying) return;
    if (payMethod === 'CREDIT' && !creditAccount) { setPayError(friendlyError({ code: 'CREDIT_ACCOUNT_REQUIRED' }, ru)); return; }
    setPaying(true); setPayError('');
    const idemKey = payingBill ? `cashier-pay-bill-${payingBill.id}` : `cashier-pay-${detail.id}`;
    try {
      const r = await api.createPayment({ order_id: detail.id, ...(payingBill ? { bill_id: payingBill.id } : {}), method: payMethod, amount: String(payingBill ? payingBill.final_amount : detail.final_amount), ...(payMethod === 'CREDIT' && creditAccount ? { credit_account_id: creditAccount.account.id } : {}) }, idemKey, isCashierRole ? (posToken || undefined) : undefined);
      setSuccessPayment(r.payment);
      setSuccessOrder(detail);
      setPayDialogOpen(false);
      if (payMethod === 'CREDIT' && creditAccount) { try { setCreditAccount(await api.getCreditAccount(creditAccount.account.id)); } catch { /* best-effort refresh */ } }
      await Promise.all([loadOrders(true), loadShift()]);
      if (detail) await loadDetail(detail.id);
    } catch (e: any) {
      // A network timeout is not a known failure -- refresh real state before assuming anything.
      try {
        const [o, p] = await Promise.all([api.getOrder(detail.id), api.getPayments({ branch_id: branchId })]);
        const alreadyPaid = p.payments.find(x => x.order_id === detail.id && x.status === 'PAID');
        if (alreadyPaid) {
          setSuccessPayment(alreadyPaid); setSuccessOrder(o.order); setPayDialogOpen(false);
          await loadOrders(true); await loadShift();
        } else {
          setPayError(friendlyError(e, ru));
        }
      } catch { setPayError(friendlyError(e, ru)); }
    } finally { setPaying(false); }
  };

  const submitClosure = async () => {
    if (!detail || closureBusy || !closureReason.trim() || !closureTreatment) return;
    setClosureBusy(true); setClosureError('');
    try {
      await api.requestOrderClosure(detail.id, { type: 'CLOSED_BY_ESTABLISHMENT', reason: closureReason.trim(), comment: closureComment.trim() || null, inventory_treatment: closureTreatment, refund_requested: closureRefund });
      setClosureSent(true);
      await loadOrders(true);
    } catch (e: any) { setClosureError(friendlyError(e, ru)); }
    finally { setClosureBusy(false); }
  };
  const openClosure = () => { setClosureReason(''); setClosureComment(''); setClosureTreatment(''); setClosureRefund(Boolean(selectedPaid)); setClosureError(''); setClosureSent(false); setClosureOpen(true); };

  useEffect(() => { void api.getDiscountOptions().then(r => { setDiscountPresets(r.presets); setDiscountMax(r.max_percent); }).catch(() => undefined); }, []);

  useEffect(() => {
    if (!detail) { setBills([]); setSplitMode('NONE'); return; }
    let cancelled = false;
    void api.getOrderBills(detail.id).then(r => { if (!cancelled) { setBills(r.bills || []); setSplitMode(r.split_mode); } }).catch(() => { if (!cancelled) { setBills([]); setSplitMode('NONE'); } });
    return () => { cancelled = true; };
  }, [detail?.id, detail?.updated_at]);

  const searchCustomers = async (q: string) => {
    setCustomerQuery(q);
    if (q.trim().length < 2) { setCustomerResults([]); return; }
    try { setCustomerResults((await api.getCustomers({ branch_id: branchId, search: q.trim() })).customers); } catch { setCustomerResults([]); }
  };
  const attachCustomer = async (customerId: string | null) => {
    if (!detail || customerBusy) return;
    setCustomerBusy(true); setCustomerError('');
    try { await api.setOrderCustomer(detail.id, customerId); setCustomerOpen(false); await loadDetail(detail.id); await loadOrders(true); }
    catch (e: any) { setCustomerError(friendlyError(e, ru)); }
    finally { setCustomerBusy(false); }
  };
  const createAndAttach = async () => {
    if (!detail || customerBusy || !newCustomerName.trim() || !newCustomerPhone.trim()) return;
    setCustomerBusy(true); setCustomerError('');
    try {
      const r = await api.createCustomer({ branch_id: branchId, name: newCustomerName.trim(), phone: newCustomerPhone.trim() });
      await api.setOrderCustomer(detail.id, r.customer.id);
      setNewCustomerName(''); setNewCustomerPhone(''); setCustomerOpen(false);
      await loadDetail(detail.id); await loadOrders(true);
    } catch (e: any) { setCustomerError(friendlyError(e, ru)); }
    finally { setCustomerBusy(false); }
  };
  const applyDiscount = async (percent: string) => {
    if (!detail || discountBusy || !percent.trim()) return;
    setDiscountBusy(true); setDiscountError('');
    try { await api.applyOrderDiscount(detail.id, { percent: percent.trim(), reason: discountReason.trim() || null }); setDiscountOpen(false); setDiscountPercent(''); setDiscountReason(''); await loadDetail(detail.id); await loadOrders(true); }
    catch (e: any) { setDiscountError(friendlyError(e, ru)); }
    finally { setDiscountBusy(false); }
  };
  const removeDiscount = async () => {
    if (!detail || discountBusy) return;
    setDiscountBusy(true); setDiscountError('');
    try { await api.removeOrderDiscount(detail.id); await loadDetail(detail.id); await loadOrders(true); }
    catch (e: any) { setDiscountError(friendlyError(e, ru)); }
    finally { setDiscountBusy(false); }
  };

  // ---- Receipt preview / print / reprint
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<any | null>(null);
  const [receiptPayment, setReceiptPayment] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [lastPrintJob, setLastPrintJob] = useState<any | null>(null);

  const openReceipt = async (order: any, payment: any) => {
    setReceiptOrder(order); setReceiptPayment(payment); setReceiptOpen(true); setLastPrintJob(null);
    try {
      const r = await api.getPrintProfiles(branchId);
      setProfile(r.profiles.find((p: any) => p.name === 'CUSTOMER_RECEIPT') || null);
    } catch { setProfile(null); }
  };
  const printReceipt = async () => {
    if (!receiptOrder || printBusy || !hasPermission('print.execute')) return;
    setPrintBusy(true);
    try {
      const r = await api.createPrintJob({ branch_id: branchId, order_id: receiptOrder.id, print_type: 'CUSTOMER_RECEIPT' });
      setLastPrintJob(r.job);
      window.print();
    } catch (e: any) { setDetailError(friendlyError(e, ru)); }
    finally { setPrintBusy(false); }
  };
  const reprintReceipt = async () => {
    if (!lastPrintJob || printBusy || !hasPermission('print.reprint')) return;
    setPrintBusy(true);
    try {
      const r = await api.reprintJob(lastPrintJob.id);
      setLastPrintJob(r.job);
      window.print();
    } catch (e: any) { setDetailError(friendlyError(e, ru)); }
    finally { setPrintBusy(false); }
  };

  const config = useMemo(() => { try { return profile?.config_json ? JSON.parse(profile.config_json) : {}; } catch { return {}; } }, [profile]);
  const show = (key: string, def = true) => (config[key] === undefined ? def : Boolean(config[key]));

  if (!branchId) {
    return <div className="p-6 text-slate-400">{ru ? 'У вас нет назначенного филиала.' : 'Şahamça bellenilmedi.'}</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-4 text-sm">
          <div><span className="text-slate-500">{ru ? 'Филиал' : 'Şahamça'}: </span><strong className="text-white">{user?.branch_name || branchId}</strong></div>
          <div><span className="text-slate-500">{ru ? 'Кассир' : 'Kassir'}: </span><strong className="text-white">{user?.full_name}</strong></div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">{ru ? 'Смена' : 'Çalyşyk'}:</span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${shift?.status === 'OPEN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{shift?.status === 'OPEN' ? (ru ? 'ОТКРЫТА' : 'AÇYK') : (ru ? 'ЗАКРЫТА' : 'ÝAPYK')}</span>
            {shift?.status === 'OPEN' && <span className="text-slate-400">· {money(shift.expected_cash)} TMT</span>}
            {shift?.status === 'OPEN' && hasPermission('cash_shifts.close') && (
              <button className="text-[11px] font-semibold text-red-400 hover:text-red-300 underline" onClick={() => setCloseConfirmOpen(true)}>{ru ? 'закрыть' : 'ýap'}</button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCashierRole && (posToken ? (
            <button className="btn bg-slate-800 text-slate-200 flex items-center gap-1.5" onClick={() => void doLock()}><Lock className="w-3.5 h-3.5" /> {ru ? 'Заблокировать POS' : 'POS-y gulplamak'}</button>
          ) : (
            <button className="btn bg-amber-500 text-slate-950 flex items-center gap-1.5" onClick={() => setUnlockOpen(true)}><Unlock className="w-3.5 h-3.5" /> {ru ? 'Разблокировать POS' : 'POS-y açmak'}</button>
          ))}
          <button className="btn bg-slate-800 text-slate-200 flex items-center gap-1.5" onClick={() => { void loadOrders(); void loadShift(); }}><RefreshCw className="w-3.5 h-3.5" /> {ru ? 'Обновить' : 'Täzelemek'}</button>
        </div>
      </div>

      {posLocked && (
        <div className="mx-5 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-sm p-3">
          {ru ? 'POS session expired. Please unlock POS again.' : 'POS sessiýasy gutardy. POS-y ýene açyň.'}
        </div>
      )}
      {shift?.status !== 'OPEN' && (
        <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm p-3">
          <span>{ru ? 'SHIFT CLOSED — откройте смену для приёма оплат.' : 'SHIFT CLOSED — töleg kabul etmek üçin çalyşygy açyň.'}</span>
          <div className="flex items-center gap-2">
            <input className="field w-32" value={openingCash} onChange={e => setOpeningCash(e.target.value)} />
            <button className="btn bg-amber-500 text-slate-950" disabled={shiftBusy || !hasPermission('cash_shifts.open')} onClick={() => void openShift()}>{ru ? 'Открыть смену' : 'Çalyşygy açmak'}</button>
          </div>
        </div>
      )}
      {shiftError && <div className="mx-5 mt-2 text-xs text-red-400">{shiftError}</div>}

      {/* MAIN AREA */}
      <div className="flex-1 flex min-h-0">
        {/* Active orders */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-slate-800">
          <div className="p-4 space-y-3 border-b border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="field pl-9" placeholder={ru ? 'Поиск: № заказа, стол, официант' : 'Gözleg: sargyt belgisi, stol, ofisiant'} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'READY', 'UNPAID', 'DINE_IN', 'TAKEAWAY'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded text-xs font-semibold ${filter === f ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
                  {f === 'ALL' ? (ru ? 'Все' : 'Ähli') : f === 'READY' ? (ru ? 'Готовы' : 'Taýyn') : f === 'UNPAID' ? (ru ? 'Не оплачены' : 'Tölenmedik') : f === 'DINE_IN' ? (ru ? 'В зале' : 'Zalda') : (ru ? 'С собой' : 'Ýany bilen')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {ordersError && <div className="text-red-400 text-sm p-2">{ordersError}</div>}
            {ordersLoading ? (
              <div className="flex items-center gap-2 text-slate-500 p-4"><Loader2 className="w-4 h-4 animate-spin" /> {ru ? 'Загрузка…' : 'Ýüklenýär…'}</div>
            ) : visibleOrders.length === 0 ? (
              <div className="text-slate-500 text-sm p-4">{ru ? 'Нет активных заказов.' : 'Aktiw sargyt ýok.'}</div>
            ) : visibleOrders.map(o => {
              const paid = paidOrderIds.has(o.id);
              return (
                <button key={o.id} onClick={() => setSelectedId(o.id)} className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === o.id ? 'border-amber-500 bg-amber-500/5' : 'border-slate-800 bg-slate-900 hover:border-slate-700'}`}>
                  <div className="flex items-center justify-between">
                    <strong className="text-white">#{o.order_number}</strong>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${o.status === 'READY' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{o.status}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-2">
                    <span>{o.order_type === 'DINE_IN' ? `${ru ? 'Стол' : 'Stol'} ${o.table_code || '—'}` : (ru ? 'С собой' : 'Ýany bilen')}</span>
                    <span>· {o.waiter_name || '—'}</span>
                    <span>· {fmtTime(o.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-slate-300 text-sm">{money(o.final_amount)} {o.currency}</span>
                    {paid ? <span className="text-[10px] font-bold text-emerald-400">{ru ? 'ОПЛАЧЕН' : 'TÖLENEN'}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL -- selected order */}
        <div className="w-[420px] flex-shrink-0 flex flex-col overflow-y-auto">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm p-6 text-center">{ru ? 'Выберите заказ слева' : 'Çepden sargyt saýlaň'}</div>
          ) : detailLoading && !detail ? (
            <div className="flex-1 flex items-center justify-center text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : detail ? (
            <div className="p-4 space-y-4">
              {detailError && <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{detailError}</div>}
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-bold text-lg">#{detail.order_number}</h3>
                  <span className="text-xs text-slate-400">{detail.status}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {detail.order_type === 'DINE_IN' ? `${ru ? 'Стол' : 'Stol'} ${detail.table_code || '—'}` : (ru ? 'С собой' : 'Ýany bilen')} · {detail.waiter_name || '—'} · {fmtDateTime(detail.created_at)}
                </div>
              </div>

              {/* Stage 34.3: guest + manual discount. Identification alone never changes the price. */}
              {!['CANCELLED', 'REFUNDED', 'CLOSED_BY_ESTABLISHMENT', 'COMPLETED'].includes(detail.status) && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400 inline-flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5" />{detail.customer_name || (ru ? 'Клиент не выбран' : 'Müşderi saýlanmady')}</div>
                    <div className="flex gap-1.5">
                      <button className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-300" onClick={() => { setCustomerError(''); setCustomerQuery(''); setCustomerResults([]); setCustomerOpen(true); }}>{ru ? 'Поиск клиента' : 'Müşderi gözlemek'}</button>
                      {detail.customer_id && <button className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400" onClick={() => void attachCustomer(null)}>{ru ? 'Открепить' : 'Aýyrmak'}</button>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400">{ru ? 'Скидка' : 'Arzanladyş'}: <b className="text-white">{money(detail.discount)}</b></div>
                    {Math.round(parseFloat(detail.discount || '0') * 100) > 0
                      ? <button className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-300" disabled={discountBusy} onClick={() => void removeDiscount()}>{ru ? 'Убрать скидку' : 'Arzanladyşy aýyrmak'}</button>
                      : <button className="text-xs px-2 py-1 rounded border border-amber-500/40 text-amber-300" onClick={() => { setDiscountError(''); setDiscountOpen(true); }}>+ {ru ? 'Скидка' : 'Arzanladyş'}</button>}
                  </div>
                  {discountError && <div className="text-[11px] text-red-400">{discountError}</div>}
                </div>
              )}

              {/* Items */}
              <div className="space-y-2">
                {(detail.items || []).filter((i: any) => i.status === 'ACTIVE').map((item: any) => (
                  <div key={item.id} className="border border-slate-800 rounded-lg p-2.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white">{item.title_snapshot}</span>
                      <span className="text-slate-300">{item.quantity} × {money(item.price_snapshot)}</span>
                    </div>
                    {(item.modifiers || []).length > 0 && (
                      <div className="text-xs text-slate-500 mt-0.5">{item.modifiers.map((m: any) => m.name_snapshot).join(', ')}</div>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-slate-400 text-xs">{money(item.subtotal)} TMT</span>
                    </div>
                    {item.comment ? (
                      <div className="mt-1.5 flex items-center justify-between text-xs bg-slate-800/60 rounded px-2 py-1">
                        <span className="text-slate-300 italic">"{item.comment}"</span>
                        <button className="text-slate-500 hover:text-amber-400" onClick={() => saveItemNote(item.id, '')} disabled={itemNoteBusy === item.id}>{ru ? 'убрать' : 'aýyr'}</button>
                      </div>
                    ) : (
                      <div className="mt-1.5">
                        <div className="flex gap-1 flex-wrap mb-1">
                          {(ru ? QUICK_NOTES_RU : QUICK_NOTES_TK).map(qn => (
                            <button key={qn} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200" onClick={() => saveItemNote(item.id, qn)} disabled={itemNoteBusy === item.id}>{qn}</button>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <input className="field text-xs py-1" placeholder={ru ? 'Заметка к позиции…' : 'Pozisiýa bellik…'} value={itemNoteDrafts[item.id] || ''} onChange={e => setItemNoteDrafts(v => ({ ...v, [item.id]: e.target.value }))} />
                          <button className="btn text-xs py-1" disabled={itemNoteBusy === item.id || !itemNoteDrafts[item.id]} onClick={() => saveItemNote(item.id, itemNoteDrafts[item.id])}>{ru ? 'OK' : 'OK'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Totals -- server-authoritative, never recomputed here */}
              <div className="border-t border-slate-800 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-slate-400"><span>{ru ? 'Промежуточный итог' : 'Aralyk jemi'}</span><span>{money(detail.subtotal)} {detail.currency}</span></div>
                {Number(detail.discount) > 0 && <div className="flex justify-between text-slate-400"><span>{ru ? 'Скидка' : 'Arzanladyş'}</span><span>-{money(detail.discount)}</span></div>}
                {Number(detail.service_charge) > 0 && <div className="flex justify-between text-slate-400"><span>{ru ? 'Сервисный сбор' : 'Hyzmat tölegi'}</span><span>{money(detail.service_charge)}</span></div>}
                <div className="flex justify-between text-white font-bold text-base pt-1"><span>{ru ? 'ИТОГО' : 'JEMI'}</span><span>{money(detail.final_amount)} {detail.currency}</span></div>
              </div>

              {/* Notes */}
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400"><StickyNote className="w-3.5 h-3.5" /> {ru ? 'Заметка заказа' : 'Sargyt belligi'}</div>
                <textarea className="field text-xs" rows={2} placeholder={ru ? 'Клиентская заметка (может попасть в чек)' : 'Müşderi belligi (çeke düşüp biler)'} value={customerNoteDraft} onChange={e => setCustomerNoteDraft(e.target.value)} />
                <textarea className="field text-xs" rows={2} placeholder={ru ? 'Внутренняя заметка (только для персонала)' : 'Içerki bellik (diňe işgärler üçin)'} value={internalNoteDraft} onChange={e => setInternalNoteDraft(e.target.value)} />
                <button className="btn text-xs" disabled={notesBusy} onClick={() => void saveNotes()}>{notesBusy ? '…' : notesSaved ? (ru ? 'Сохранено ✓' : 'Ýatda saklandy ✓') : (ru ? 'Сохранить заметки' : 'Belliklary ýatda saklamak')}</button>
              </div>

              {/* Pay / receipt actions */}
              <div className="border-t border-slate-800 pt-3 space-y-2">
                {(() => { const reason = payBlockedReason(detail); return reason ? (
                  <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-2">{reason}</div>
                ) : null; })()}
                {splitMode !== 'NONE' ? (
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400">{ru ? 'Отдельные счета' : 'Aýratyn hasaplar'} · {splitMode === 'EQUAL' ? (ru ? 'поровну' : 'deň') : (ru ? 'по позициям' : 'pozisiýalar boýunça')}</div>
                    {bills.map(b => (
                      <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-2">
                        <div className="min-w-0">
                          <div className="text-sm text-white">{ru ? 'Счёт' : 'Hasap'} #{b.bill_number} · {money(b.final_amount)}</div>
                          <div className="text-[11px] text-slate-500">{b.customer_name || (ru ? 'без клиента' : 'müşderisiz')}{Math.round(parseFloat(b.discount || '0') * 100) > 0 ? ` · ${ru ? 'скидка' : 'arzanladyş'} ${money(b.discount)}` : ''}</div>
                        </div>
                        {b.status === 'PAID'
                          ? <span className="text-xs text-emerald-400 shrink-0">{ru ? 'оплачен' : 'tölendi'}</span>
                          : <button className="btn bg-emerald-500 text-slate-950 text-xs font-bold shrink-0" disabled={Boolean(payBlockedReason(detail))} onClick={() => { setPayingBill(b); setPayMethod('CASH'); setPayError(''); resetCreditFlow(); setPayDialogOpen(true); }}>{ru ? 'Оплатить' : 'Tölemek'}</button>}
                      </div>
                    ))}
                  </div>
                ) : selectedPaid ? (
                  <div className="flex gap-2">
                    <button className="btn flex-1 flex items-center justify-center gap-1.5" onClick={() => void openReceipt(detail, selectedPaid)}><ReceiptIcon className="w-4 h-4" /> {ru ? 'Чек' : 'Çek'}</button>
                  </div>
                ) : (
                  <button className="btn w-full bg-emerald-500 text-slate-950 font-bold py-2.5" disabled={Boolean(payBlockedReason(detail))} onClick={() => { setPayingBill(null); setPayMethod('CASH'); setPayError(''); resetCreditFlow(); setPayDialogOpen(true); }}>
                    {ru ? `ОПЛАТИТЬ ${money(detail.final_amount)}` : `TÖLEG ${money(detail.final_amount)}`}
                  </button>
                )}
                {!['CANCELLED', 'REFUNDED', 'CLOSED_BY_ESTABLISHMENT'].includes(detail.status) && (
                  <button className="btn w-full bg-purple-600/20 border border-purple-500/40 text-purple-200 font-semibold py-2" onClick={openClosure}>
                    {ru ? 'ЗАКРЫТО ЗАВЕДЕНИЕМ' : 'KÄRHANA TARAPYNDAN ÝAPYLDY'}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Today's payments */}
      <div className="border-t border-slate-800 max-h-56 overflow-y-auto">
        <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider sticky top-0 bg-slate-950">{ru ? "Сегодняшние платежи" : 'Şu günki tölegler'}</div>
        <table className="w-full text-xs">
          <tbody>
            {payments.slice(0, 30).map(p => {
              const o = orders.find(x => x.id === p.order_id);
              return (
                <tr key={p.id} className="border-t border-slate-800/60">
                  <td className="px-4 py-1.5 text-slate-400">{fmtTime(p.created_at)}</td>
                  <td className="px-2 py-1.5 text-slate-300">#{o?.order_number || p.order_id.slice(-6)}</td>
                  <td className="px-2 py-1.5 text-slate-400">{p.method}</td>
                  <td className="px-2 py-1.5 text-white">{money(p.amount)}</td>
                  <td className="px-2 py-1.5 text-slate-500">{p.cashier_user_id === user?.id ? (ru ? 'вы' : 'siz') : ''}</td>
                  <td className="px-4 py-1.5"><span className={p.status === 'PAID' ? 'text-emerald-400' : 'text-red-400'}>{p.status}</span></td>
                </tr>
              );
            })}
            {!payments.length && <tr><td className="px-4 py-3 text-slate-600" colSpan={6}>{ru ? 'Платежей пока нет.' : 'Töleg ýok.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---- Unlock POS dialog ---- */}
      {unlockOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4">
            <h2 className="text-white text-lg font-bold">{ru ? 'Разблокировать POS' : 'POS-y açmak'}</h2>
            <input type="password" autoFocus className="field" placeholder={ru ? 'Пароль' : 'Parol'} value={unlockPassword} onChange={e => setUnlockPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && void doUnlock()} />
            {unlockError && <div className="text-red-400 text-xs">{unlockError}</div>}
            <div className="flex gap-2 justify-end">
              <button className="btn bg-slate-800 text-slate-200" onClick={() => { setUnlockOpen(false); setUnlockPassword(''); setUnlockError(''); }}>{ru ? 'Отмена' : 'Ýatyr'}</button>
              <button className="btn bg-amber-500 text-slate-950" disabled={unlockBusy || !unlockPassword} onClick={() => void doUnlock()}>{unlockBusy ? '…' : (ru ? 'РАЗБЛОКИРОВАТЬ POS' : 'POS-Y AÇMAK')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Close shift confirm ---- */}
      {closeConfirmOpen && shift && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4">
            <h2 className="text-white text-lg font-bold">{ru ? 'Закрыть смену?' : 'Çalyşygy ýapmalymy?'}</h2>
            <p className="text-slate-400 text-sm">{ru ? 'Ожидаемая наличность' : 'Garaşylýan nagt'}: {money(shift.expected_cash)} TMT</p>
            <input className="field" value={actualCash} onChange={e => setActualCash(e.target.value)} placeholder={ru ? 'Фактическая наличность' : 'Hakyky nagt'} />
            <div className="flex gap-2 justify-end">
              <button className="btn bg-slate-800 text-slate-200" onClick={() => setCloseConfirmOpen(false)}>{ru ? 'Отмена' : 'Ýatyr'}</button>
              <button className="btn bg-red-500 text-white" disabled={shiftBusy} onClick={() => void closeShift()}>{ru ? 'Закрыть смену (Z)' : 'Çalyşygy ýap (Z)'}</button>
            </div>
          </div>
        </div>
      )}
      {/* ---- Payment dialog ---- */}
      {customerOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !customerBusy && setCustomerOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-white text-lg font-bold">{ru ? 'Поиск клиента' : 'Müşderi gözlemek'}</h2>
            <p className="text-slate-400 text-xs">{ru ? 'Привязка клиента не меняет цену заказа — скидка назначается отдельно и вручную.' : 'Müşderini baglamak sargydyň bahasyny üýtgetmeýär — arzanladyş aýratyn we el bilen berilýär.'}</p>
            {customerError && <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{customerError}</div>}
            <input className="field w-full" value={customerQuery} onChange={e => void searchCustomers(e.target.value)} placeholder={ru ? 'Имя или телефон' : 'At ýa-da telefon'} />
            <div className="max-h-52 overflow-y-auto space-y-1">
              {customerResults.map(c => (
                <button key={c.id} className="w-full text-left px-3 py-2 rounded-lg border border-slate-800 hover:border-amber-500/40 text-sm" disabled={customerBusy} onClick={() => void attachCustomer(c.id)}>
                  <span className="text-white">{c.name}</span> <span className="text-slate-500 text-xs">{c.phone}</span>
                </button>
              ))}
              {customerQuery.trim().length >= 2 && !customerResults.length && <div className="text-slate-500 text-xs px-1">{ru ? 'Ничего не найдено.' : 'Hiç zat tapylmady.'}</div>}
            </div>
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="text-xs text-slate-400">{ru ? 'Новый клиент' : 'Täze müşderi'}</div>
              <input className="field w-full" value={newCustomerName} onChange={e => setNewCustomerName(e.target.value)} placeholder={ru ? 'Имя' : 'At'} />
              <input className="field w-full" value={newCustomerPhone} onChange={e => setNewCustomerPhone(e.target.value)} placeholder={ru ? 'Телефон' : 'Telefon'} />
              <div className="flex gap-2 justify-end">
                <button className="btn" disabled={customerBusy} onClick={() => setCustomerOpen(false)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
                <button className="btn bg-amber-500 text-slate-950 font-semibold" disabled={customerBusy || !newCustomerName.trim() || !newCustomerPhone.trim()} onClick={() => void createAndAttach()}>{ru ? 'Создать и привязать' : 'Döretmek we baglamak'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {discountOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !discountBusy && setDiscountOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-white text-lg font-bold">{ru ? 'Скидка на заказ' : 'Sargyda arzanladyş'} · #{detail.order_number}</h2>
              <p className="text-slate-400 text-xs mt-1">{ru ? `Сумму рассчитывает сервер. Максимум без отдельного разрешения — ${discountMax}%.` : `Möçberi serwer hasaplaýar. Aýratyn rugsatsyz iň ýokary — ${discountMax}%.`}</p>
            </div>
            {discountError && <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{discountError}</div>}
            <div className="flex flex-wrap gap-2">
              {discountPresets.map(p => (
                <button key={p} className={`px-3 py-2 rounded-lg border text-sm ${discountPercent === p ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-300'}`} onClick={() => setDiscountPercent(p)}>{p}%</button>
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">{ru ? 'Другой процент' : 'Başga göterim'}</span>
              <input className="field w-full" value={discountPercent} onChange={e => setDiscountPercent(e.target.value)} placeholder="0" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">{ru ? 'Причина' : 'Sebäp'}</span>
              <input className="field w-full" value={discountReason} onChange={e => setDiscountReason(e.target.value)} />
            </label>
            <div className="flex gap-2 justify-end">
              <button className="btn" disabled={discountBusy} onClick={() => setDiscountOpen(false)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
              <button className="btn bg-amber-500 text-slate-950 font-semibold" disabled={discountBusy || !discountPercent.trim()} onClick={() => void applyDiscount(discountPercent)}>{ru ? 'Применить' : 'Ulanmak'}</button>
            </div>
          </div>
        </div>
      )}

      {closureOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => !closureBusy && setClosureOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="text-white text-lg font-bold">{ru ? 'Закрыто заведением' : 'Kärhana tarapyndan ýapyldy'} · #{detail.order_number}</h2>
              <p className="text-slate-400 text-xs mt-1">{ru ? 'Кассир только отправляет запрос — решение принимает менеджер.' : 'Kassir diňe haýyş iberýär — karary menejer kabul edýär.'}</p>
            </div>
            {closureSent ? (
              <>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm p-3">{ru ? 'Запрос отправлен менеджеру на подтверждение.' : 'Haýyş menejere tassyklamaga iberildi.'}</div>
                <div className="flex justify-end"><button className="btn" onClick={() => setClosureOpen(false)}>{ru ? 'Закрыть' : 'Ýap'}</button></div>
              </>
            ) : (
              <>
                {closureError && <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs p-2">{closureError}</div>}
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">{ru ? 'Причина (обязательно)' : 'Sebäp (hökmany)'}</span>
                  <input className="field w-full" value={closureReason} onChange={e => setClosureReason(e.target.value)} placeholder={ru ? 'Например: жалоба на качество' : 'Meselem: hil boýunça şikaýat'} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">{ru ? 'Комментарий' : 'Teswir'}</span>
                  <input className="field w-full" value={closureComment} onChange={e => setClosureComment(e.target.value)} />
                </label>
                <div className="space-y-1">
                  <span className="text-xs text-slate-400">{ru ? 'Что делать с продуктами? (обязательно)' : 'Önümler bilen näme etmeli? (hökmany)'}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={`p-3 rounded-lg border text-left text-sm ${closureTreatment === 'WRITE_OFF' ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-300'}`} onClick={() => setClosureTreatment('WRITE_OFF')}>{ru ? 'Списать продукты' : 'Önümleri hasapdan aýyrmak'}</button>
                    <button type="button" className={`p-3 rounded-lg border text-left text-sm ${closureTreatment === 'NO_WRITE_OFF' ? 'border-amber-400 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-300'}`} onClick={() => setClosureTreatment('NO_WRITE_OFF')}>{ru ? 'Не списывать продукты' : 'Önümleri hasapdan aýyrmazlyk'}</button>
                  </div>
                  <p className="text-[11px] text-slate-500">{ru ? 'Приготовленные блюда не возвращаются на склад — возврат денег не равен возврату ингредиентов.' : 'Taýýarlanan tagamlar ammara gaýtarylmaýar — pul gaýtarmak önümleri gaýtarmak däldir.'}</p>
                </div>
                {selectedPaid && (
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={closureRefund} onChange={e => setClosureRefund(e.target.checked)} />
                    {ru ? 'Вернуть деньги гостю' : 'Myhmana puly gaýtarmak'}
                  </label>
                )}
                <div className="flex gap-2 justify-end">
                  <button className="btn" disabled={closureBusy} onClick={() => setClosureOpen(false)}>{ru ? 'Отмена' : 'Goý bolsun'}</button>
                  <button className="btn bg-purple-500 text-slate-950 font-semibold" disabled={closureBusy || !closureReason.trim() || !closureTreatment} onClick={() => void submitClosure()}>{ru ? 'Отправить запрос' : 'Haýyş ibermek'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {payDialogOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4">
            {/* A split order is settled one separate check at a time; the figures are the bill's own. */}
            <h2 className="text-white text-lg font-bold">{ru ? 'Оплата' : 'Töleg'} #{detail.order_number}{payingBill ? ` · ${ru ? 'счёт' : 'hasap'} #${payingBill.bill_number}` : ''}</h2>
            <div className="space-y-1 text-sm border-y border-slate-800 py-3">
              <div className="flex justify-between text-slate-400"><span>{ru ? 'Промежуточный итог' : 'Aralyk jemi'}</span><span>{money((payingBill || detail).subtotal)}</span></div>
              {Number((payingBill || detail).discount) > 0 && <div className="flex justify-between text-slate-400"><span>{ru ? 'Скидка' : 'Arzanladyş'}</span><span>-{money((payingBill || detail).discount)}</span></div>}
              {Number((payingBill || detail).service_charge) > 0 && <div className="flex justify-between text-slate-400"><span>{ru ? 'Сервисный сбор' : 'Hyzmat tölegi'}</span><span>{money((payingBill || detail).service_charge)}</span></div>}
              <div className="flex justify-between text-white font-bold text-lg pt-1"><span>{ru ? 'ИТОГО' : 'JEMI'}</span><span>{money((payingBill || detail).final_amount)} {detail.currency}</span></div>
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1.5">{ru ? 'Способ оплаты' : 'Töleg usuly'}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setPayMethod(m)} className={`py-2 rounded text-xs font-semibold ${payMethod === m ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>{m}</button>
                ))}
              </div>
            </div>
            {payMethod === 'CREDIT' && (
              <div className="space-y-2 border-t border-slate-800 pt-3">
                <div className="grid grid-cols-2 gap-1.5">
                  <button className={`py-1.5 rounded text-xs font-semibold ${creditKind === 'CUSTOMER' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`} onClick={() => { setCreditKind('CUSTOMER'); setCreditAccount(null); }}>{ru ? 'КЛИЕНТ' : 'MÜŞDERI'}</button>
                  <button className={`py-1.5 rounded text-xs font-semibold ${creditKind === 'EMPLOYEE' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`} onClick={() => { setCreditKind('EMPLOYEE'); setCreditAccount(null); }}>{ru ? 'СОТРУДНИК' : 'IŞGÄR'}</button>
                </div>
                {!creditAccount && creditKind === 'CUSTOMER' && (
                  <div className="space-y-1.5">
                    <input className="field text-xs" placeholder={ru ? 'Телефон' : 'Telefon'} value={creditPhone} onChange={e => setCreditPhone(e.target.value)} />
                    <input className="field text-xs" placeholder={ru ? 'Имя' : 'Ady'} value={creditName} onChange={e => setCreditName(e.target.value)} />
                    <button className="btn w-full text-xs" disabled={creditBusy || !creditPhone.trim() || !creditName.trim()} onClick={() => void resolveCreditCustomer()}>{creditBusy ? '…' : (ru ? 'Найти / создать клиента' : 'Müşderini tap / döret')}</button>
                  </div>
                )}
                {!creditAccount && creditKind === 'EMPLOYEE' && (
                  <div className="space-y-1.5">
                    <input className="field text-xs" placeholder={ru ? 'Поиск сотрудника' : 'Işgäri gözle'} value={creditEmployeeSearch} onChange={e => void searchCreditEmployees(e.target.value)} />
                    {creditEmployeeResults.length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {creditEmployeeResults.map((emp: any) => (
                          <button key={emp.id} disabled={creditBusy} className="w-full text-left text-xs bg-slate-800 hover:bg-slate-700 rounded px-2 py-1.5 text-slate-200" onClick={() => void resolveCreditEmployee(emp.id)}>{emp.full_name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {creditAccount && (
                  <div className="rounded-lg bg-slate-800/60 p-2.5 text-xs space-y-1">
                    <div className="font-semibold text-white">{creditAccount.owner?.name || creditAccount.owner?.full_name} {creditAccount.owner?.phone ? `· ${creditAccount.owner.phone}` : ''}</div>
                    <div className="flex justify-between text-slate-400"><span>{ru ? 'Лимит' : 'Çäk'}</span><span>{money(creditAccount.account.credit_limit)}</span></div>
                    <div className="flex justify-between text-slate-400"><span>{ru ? 'Текущий долг' : 'Häzirki bergi'}</span><span>{money(creditAccount.account.current_balance)}</span></div>
                    <div className="flex justify-between text-slate-400"><span>{ru ? 'Доступно' : 'Elýeterli'}</span><span>{money(creditAccount.available_credit)}</span></div>
                    <div className="flex justify-between text-white font-bold pt-1 border-t border-slate-700"><span>{ru ? 'Новый долг' : 'Täze bergi'}</span><span>{money(Number(creditAccount.account.current_balance) + Number(detail.final_amount))}</span></div>
                    {Number(detail.final_amount) > Number(creditAccount.available_credit) && (
                      <div className="text-amber-400">{hasPermission('credit.manage_limit') ? (ru ? 'Превышение лимита — разрешено менеджеру.' : 'Çäk aşyldy — menejer üçin rugsat edilýär.') : (ru ? 'Превышение лимита. Требуется менеджер.' : 'Çäk aşyldy. Menejer gerek.')}</div>
                    )}
                    <button className="btn w-full text-xs mt-1" onClick={() => setCreditAccount(null)}>{ru ? 'Изменить' : 'Üýtget'}</button>
                  </div>
                )}
                {creditError && <div className="text-red-400 text-xs">{creditError}</div>}
              </div>
            )}
            {payError && <div className="text-red-400 text-xs">{payError}</div>}
            <div className="flex gap-2 justify-end">
              <button className="btn bg-slate-800 text-slate-200" disabled={paying} onClick={() => setPayDialogOpen(false)}>{ru ? 'Отмена' : 'Ýatyr'}</button>
              <button className="btn bg-emerald-500 text-slate-950 flex items-center gap-1.5" disabled={paying || (payMethod === 'CREDIT' && !creditAccount)} onClick={() => void pay()}>
                {paying ? <><Loader2 className="w-4 h-4 animate-spin" /> {ru ? 'ОПЛАТА…' : 'TÖLENÝÄR…'}</> : <><CheckCircle2 className="w-4 h-4" /> {payMethod === 'CREDIT' ? (ru ? 'ПОДТВЕРДИТЬ КРЕДИТ' : 'KREDITI TASSYKLA') : (ru ? 'ПОДТВЕРДИТЬ' : 'TASSYKLA')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Payment success ---- */}
      {successPayment && successOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-emerald-600/40 p-6 space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-white text-xl font-bold">{ru ? 'ОПЛАТА ПРОШЛА УСПЕШНО' : 'TÖLEG ÜSTÜNLIKLI'}</h2>
            <p className="text-slate-400 text-sm">{ru ? 'Заказ' : 'Sargyt'} #{successOrder.order_number}</p>
            <div className="text-3xl font-black text-white">{money(successPayment.amount)} {successOrder.currency}</div>
            <div className="text-xs text-slate-500">{successPayment.method} · {fmtTime(successPayment.created_at)}</div>
            {successPayment.method === 'CREDIT' && creditAccount && (
              <div className="rounded-lg bg-slate-800/60 p-2.5 text-xs space-y-1 text-left">
                <div className="font-semibold text-white">{creditAccount.owner?.name || creditAccount.owner?.full_name}</div>
                <div className="flex justify-between text-slate-400"><span>{ru ? 'Новый долг' : 'Täze bergi'}</span><span>{money(creditAccount.account.current_balance)}</span></div>
                <div className="flex justify-between text-slate-400"><span>{ru ? 'Доступно' : 'Elýeterli'}</span><span>{money(creditAccount.available_credit)}</span></div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button className="btn flex-1 flex items-center justify-center gap-1.5" onClick={() => { void openReceipt(successOrder, successPayment); }}><Printer className="w-4 h-4" /> {ru ? 'ЧЕК' : 'ÇEK'}</button>
              <button className="btn flex-1 bg-amber-500 text-slate-950" onClick={() => { setSuccessPayment(null); setSuccessOrder(null); setSelectedId(null); resetCreditFlow(); }}>{ru ? 'НОВЫЙ ЗАКАЗ' : 'TÄZE SARGYT'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Receipt preview / print / reprint ---- */}
      {receiptOpen && receiptOrder && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl bg-white text-slate-900 p-5 font-mono text-xs space-y-1" id="cashier-receipt-print-area">
            {config.logo_url && show('logo') && <img src={config.logo_url} alt="" className="h-10 mx-auto mb-1" />}
            <div className="text-center font-bold text-sm">{config.business_name || 'BOOM OS'}</div>
            <div className="text-center">{user?.branch_name || ''}</div>
            {config.address && <div className="text-center">{config.address}</div>}
            {config.phone && <div className="text-center">{config.phone}</div>}
            {config.header_text && <div className="text-center italic">{config.header_text}</div>}
            <div className="border-t border-dashed border-slate-400 my-2" />
            <div>{ru ? 'Заказ' : 'Sargyt'} #{receiptOrder.order_number}</div>
            <div>{fmtDateTime(receiptPayment?.created_at || receiptOrder.created_at)}</div>
            {show('show_waiter') && <div>{ru ? 'Официант' : 'Ofisiant'}: {receiptOrder.waiter_name || '—'}</div>}
            {show('show_cashier') && <div>{ru ? 'Кассир' : 'Kassir'}: {user?.full_name}</div>}
            {show('show_table') && receiptOrder.table_code && <div>{ru ? 'Стол' : 'Stol'}: {receiptOrder.table_code}</div>}
            <div className="border-t border-dashed border-slate-400 my-2" />
            {(receiptOrder.items || []).filter((i: any) => i.status === 'ACTIVE').map((item: any) => (
              <div key={item.id}>
                <div className="flex justify-between"><span>{item.title_snapshot} x{item.quantity}</span><span>{money(item.subtotal)}</span></div>
                {show('show_modifiers') && (item.modifiers || []).length > 0 && <div className="pl-2 text-[10px] text-slate-600">{item.modifiers.map((m: any) => m.name_snapshot).join(', ')}</div>}
                {show('show_unit_price') && <div className="pl-2 text-[10px] text-slate-500">{money(item.price_snapshot)} × {item.quantity}</div>}
              </div>
            ))}
            <div className="border-t border-dashed border-slate-400 my-2" />
            <div className="flex justify-between"><span>{ru ? 'Промежуточный итог' : 'Aralyk jemi'}</span><span>{money(receiptOrder.subtotal)}</span></div>
            {show('show_discount') && Number(receiptOrder.discount) > 0 && <div className="flex justify-between"><span>{ru ? 'Скидка' : 'Arzanladyş'}</span><span>-{money(receiptOrder.discount)}</span></div>}
            {show('show_service_charge') && Number(receiptOrder.service_charge) > 0 && <div className="flex justify-between"><span>{ru ? 'Сервисный сбор' : 'Hyzmat tölegi'}</span><span>{money(receiptOrder.service_charge)}</span></div>}
            <div className="flex justify-between font-bold text-sm border-t border-slate-400 pt-1 mt-1"><span>{ru ? 'ИТОГО' : 'JEMI'}</span><span>{money(receiptOrder.final_amount)}</span></div>
            {show('show_payment_method') && receiptPayment && <div className="flex justify-between mt-1"><span>{ru ? 'Оплата' : 'Töleg'}</span><span>{receiptPayment.method}</span></div>}
            {receiptPayment?.method === 'CREDIT' && creditAccount && (
              <div className="mt-1 pl-2 text-[10px] space-y-0.5">
                <div>{creditAccount.account.type === 'CUSTOMER' ? (ru ? 'Клиент' : 'Müşderi') : (ru ? 'Сотрудник' : 'Işgär')}: {creditAccount.owner?.name || creditAccount.owner?.full_name} {creditAccount.owner?.phone ? `(${creditAccount.owner.phone})` : ''}</div>
                <div className="flex justify-between"><span>{ru ? 'Сумма в кредит' : 'Kredit mukdary'}</span><span>{money(receiptPayment.amount)}</span></div>
                <div className="flex justify-between"><span>{ru ? 'Текущий долг' : 'Häzirki bergi'}</span><span>{money(creditAccount.account.current_balance)}</span></div>
              </div>
            )}
            {show('show_customer_note') && receiptOrder.notes && <div className="mt-2 italic">{receiptOrder.notes}</div>}
            <div className="border-t border-dashed border-slate-400 my-2" />
            {config.footer_text && <div className="text-center">{config.footer_text}</div>}
            <div className="text-center font-bold mt-1">{config.thank_you_text || (ru ? 'Спасибо за заказ!' : 'Sargydyňyz üçin sag boluň!')}</div>
          </div>
        </div>
      )}
      {receiptOpen && (
        <div className="fixed bottom-4 right-4 z-[60] flex gap-2 print:hidden">
          <button className="btn bg-slate-800 text-slate-200" onClick={() => setReceiptOpen(false)}><XCircle className="w-4 h-4" /></button>
          {!lastPrintJob ? (
            <button className="btn bg-amber-500 text-slate-950 flex items-center gap-1.5" disabled={printBusy || !hasPermission('print.execute')} onClick={() => void printReceipt()}><Printer className="w-4 h-4" /> {ru ? 'ПЕЧАТЬ ЧЕКА' : 'ÇEK ÇAP ET'}</button>
          ) : (
            <button className="btn bg-slate-800 text-slate-200 flex items-center gap-1.5" disabled={printBusy || !hasPermission('print.reprint')} onClick={() => void reprintReceipt()}><Copy className="w-4 h-4" /> {ru ? 'ПОВТОРНАЯ ПЕЧАТЬ' : 'GAÝTA ÇAP ET'}</button>
          )}
        </div>
      )}
    </div>
  );
};
