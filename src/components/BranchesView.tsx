import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  MapPin,
  Phone,
  Clock,
  Coins,
  Users,
  Edit2,
  Trash2,
  CheckCircle2,
  X,
  AlertCircle,
  QrCode,
  Copy,
  RefreshCw
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api';
import { Branch } from '../types';
import { useAuth } from '../context/AuthContext';
import { errorText } from '../humanErrors';
import { ConfirmDialog, EmptyState, LoadingState, Notice, Toolbar } from './ui';

export const BranchesView: React.FC = () => {
  const { t, language } = useLanguage();
  const ru = language === 'ru';
  const { user: currentUser, hasPermission } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);
  const [deleteError, setDeleteError] = useState('');
  // Stage 35.6 -- QR menu entry. The token/URL is resolved and regenerated server-side; this
  // screen only displays what the server returns.
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [qrInfo, setQrInfo] = useState<{ qr_token: string | null; qr_url: string | null } | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);

  // Form
  const [form, setForm] = useState({
    name: '',
    code: '',
    address: '',
    phone: '',
    timezone: 'Asia/Ashgabat',
    currency: 'TMT',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE'
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      const res = await api.getBranches();
      setBranches(res.branches);
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const openCreate = () => {
    setForm({
      name: '',
      code: '',
      address: '',
      phone: '+7 (495) ',
      timezone: 'Asia/Ashgabat',
      currency: 'TMT',
      status: 'ACTIVE'
    });
    setFormError(null);
    setIsCreateOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditingBranch(b);
    setForm({
      name: b.name,
      code: b.code,
      address: b.address,
      phone: b.phone,
      timezone: b.timezone,
      currency: b.currency,
      status: b.status
    });
    setFormError(null);
  };

  const openQr = async (b: Branch) => {
    setQrBranch(b); setQrInfo(null); setQrCopied(false);
    try { setQrInfo(await api.getBranchQr(b.id)); } catch { setQrInfo({ qr_token: null, qr_url: null }); }
  };
  const regenerateQr = async () => {
    if (!qrBranch) return;
    setQrBusy(true);
    try { setQrInfo(await api.regenerateBranchQr(qrBranch.id)); setQrCopied(false); } finally { setQrBusy(false); }
  };
  const copyQrUrl = async () => {
    if (!qrInfo?.qr_url) return;
    try { await navigator.clipboard.writeText(qrInfo.qr_url); setQrCopied(true); } catch { /* clipboard may be unavailable */ }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      if (editingBranch) {
        await api.updateBranch(editingBranch.id, form);
        setEditingBranch(null);
      } else {
        await api.createBranch(form);
        setIsCreateOpen(false);
      }
      fetchBranches();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingBranch) return;
    try {
      await api.deleteBranch(deletingBranch.id);
      setDeletingBranch(null);
      fetchBranches();
    } catch (err: any) {
      setDeleteError(errorText(err));
    }
  };

  return (
    <div id="view-branches" className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Stage 41: the page title lives in the shell header. What stood here was a second title and
          an English paragraph about "branch identifiers" -- infrastructure vocabulary, in a language
          the people using this screen do not work in. */}
      <Toolbar>
        {hasPermission('branches.create') && (
          <button id="btn-create-branch-modal" className="btn" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            <span>{t('ui.openNewBranch')}</span>
          </button>
        )}
      </Toolbar>

      {/* Branches Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full"><LoadingState/></div>
        ) : branches.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-800"><EmptyState
            title={ru ? 'Филиалов пока нет.' : 'Entek şahamça ýok.'}
            hint={ru ? 'Филиал — это ресторан сети: свои столы, касса, склад и меню.' : 'Şahamça — ulgamyň restorany: öz stollary, kassasy, ammary we menýusy.'}
            action={hasPermission('branches.create') ? <button className="btn" onClick={openCreate}><Plus className="w-4 h-4" />{t('ui.openNewBranch')}</button> : undefined}/></div>
        ) : (
          branches.map((b) => (
            <div
              key={b.id}
              className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="font-mono text-xs font-bold text-amber-400 tracking-wider">
                      {b.code}
                    </div>
                    <h3 className="font-extrabold text-base text-white mt-0.5">{b.name}</h3>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    b.status === 'ACTIVE'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                  }`}>
                    {b.status}
                  </span>
                </div>

                <div className="space-y-2 text-xs text-slate-300">
                  <div className="flex items-start gap-2 text-slate-400">
                    <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
                    <span className="leading-snug">{b.address}</span>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400">
                    <Phone className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <span>{b.phone}</span>
                  </div>

                  <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-400 font-mono">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{b.timezone}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Coins className="w-3 h-3 text-slate-500" />
                      <span>{b.currency}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-semibold text-slate-200">{b.staff_count ?? 0}</span> staff members
                </div>

                <div className="flex items-center gap-1">
                  {hasPermission('branches.update') && (
                    <button
                      onClick={() => void openQr(b)}
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                      title="QR menu"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {hasPermission('branches.update') && (
                    <button
                      onClick={() => openEdit(b)}
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                      title={t('ui.editBranch')}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {hasPermission('branches.delete') && (
                    <button
                      onClick={() => setDeletingBranch(b)}
                      className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
                      title={t('ui.deactivateBranch')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create / Edit Modal */}
      {(isCreateOpen || editingBranch) && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-400" />
                <span>{isCreateOpen ? 'Register New Branch' : `Edit Branch: ${editingBranch?.name}`}</span>
              </h3>
              <button
                onClick={() => { setIsCreateOpen(false); setEditingBranch(null); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <Notice kind="error">{formError}</Notice>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.branchCode')}</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BB-CITY-04"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.branchName')}</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BOOMBURGER City Mall"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.physicalAddress')}</label>
                <input
                  type="text"
                  required
                  placeholder="Street name, building, city"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Contact Phone *</label>
                  <input
                    type="text"
                    required
                    placeholder="+7 (495) 000-00-00"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.timezone')}</label>
                  <input
                    type="text"
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.currencyCode')}</label>
                  <input
                    type="text"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsCreateOpen(false); setEditingBranch(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-sm"
                >
                  {isSubmitting ? 'Saving...' : isCreateOpen ? 'Open Branch' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stage 41: the same confirmation every irreversible action in BOOM OS now uses -- it says in
          plain words what happens, in both languages, instead of an English sentence and a browser
          alert(). Deactivation itself is unchanged: it is still the server's soft-delete. */}
      <ConfirmDialog
        open={Boolean(deletingBranch)}
        title={ru ? 'Отключить филиал?' : 'Şahamçany öçürmeli?'}
        description={deletingBranch
          ? (ru
            ? `Филиал «${deletingBranch.name}» (${deletingBranch.code}) перестанет отображаться на кассах и терминалах. История заказов и отчёты сохраняются, филиал можно включить снова.`
            : `«${deletingBranch.name}» (${deletingBranch.code}) şahamçasy kassalarda we terminallarda görkezilmez. Sargyt taryhy we hasabatlar saklanýar, şahamçany täzeden açyp bolýar.`)
          : undefined}
        confirmLabel={ru ? 'Отключить' : 'Öçür'}
        onCancel={() => { setDeletingBranch(null); setDeleteError(''); }}
        onConfirm={() => { void handleDelete(); }}
      />
      {deleteError && <div className="fixed bottom-6 right-6 z-50 max-w-sm"><Notice kind="error">{deleteError}</Notice></div>}

      {/* Stage 35.6 -- QR menu entry */}
      {qrBranch && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{ru ? 'QR-меню' : 'QR menýu'} — {qrBranch.name}</h3>
                  <p className="text-[11px] text-slate-500">{qrBranch.code}</p>
                </div>
              </div>
              <button onClick={() => setQrBranch(null)} className="boom-modal-close"><X className="w-4 h-4" /></button>
            </div>
            {qrInfo === null ? (
              <LoadingState/>
            ) : qrInfo.qr_url ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500">{ru ? 'Распечатайте эту ссылку как QR-код на столе. Филиал определяется на сервере — гость не может подменить его сканированием.' : 'Bu salgyny stol üçin QR kod görnüşinde çap ediň. Şahamça serwerde kesgitlenýär — myhman ony skan arkaly çalşyp bilmeýär.'}</p>
                <div className="flex items-center gap-2">
                  <input readOnly value={qrInfo.qr_url} className="flex-1 field text-xs" onFocus={e => e.currentTarget.select()} />
                  <button onClick={() => void copyQrUrl()} className="btn-secondary btn-sm" title={ru ? 'Скопировать ссылку' : 'Salgyny göçür'} aria-label={ru ? 'Скопировать ссылку' : 'Salgyny göçür'}><Copy className="w-3.5 h-3.5" /></button>
                </div>
                {qrCopied && <div className="text-[11px] text-emerald-400">{ru ? 'Ссылка скопирована.' : 'Salgy göçürildi.'}</div>}
              </div>
            ) : (
              <p className="text-xs text-slate-400">{ru ? 'Для этого филиала QR-код ещё не создан.' : 'Bu şahamça üçin QR kod entek döredilmedi.'}</p>
            )}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button className="btn-secondary" onClick={() => setQrBranch(null)}>{t('common.close')}</button>
              <button className="btn" onClick={() => void regenerateQr()} disabled={qrBusy}>
                <RefreshCw className={`w-3.5 h-3.5 ${qrBusy ? 'animate-spin' : ''}`} />
                {qrInfo?.qr_token ? (ru ? 'Создать заново' : 'Täzeden döret') : (ru ? 'Создать QR-код' : 'QR kod döret')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
