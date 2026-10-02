import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Clock,
  AlertTriangle,
  UserCheck,
  History,
  X,
  CheckCircle2,
  Calendar,
  FileText,
  AlertCircle
} from 'lucide-react';
import { User, EmploymentStatus, DisciplinaryStatus, EmployeeStatusHistory } from '../types';
import { api } from '../api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { errorText } from '../humanErrors';
import { Notice } from './ui';

interface EmployeeStatusModalProps {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusUpdated?: () => void;
}

export const EmployeeStatusModal: React.FC<EmployeeStatusModalProps> = ({
  user,
  isOpen,
  onClose,
  onStatusUpdated
}) => {
  const { t, language } = useLanguage();
  const { user: currentUser, hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'update' | 'history'>('update');
  const [history, setHistory] = useState<EmployeeStatusHistory[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form inputs
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>('ACTIVE');
  const [disciplinaryStatus, setDisciplinaryStatus] = useState<DisciplinaryStatus>('NONE');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');

  const isSelf = currentUser?.id === user?.id;

  useEffect(() => {
    if (!isOpen || !user) return;

    setEmploymentStatus((user.employment_status || user.status || 'ACTIVE') as EmploymentStatus);
    setDisciplinaryStatus(user.disciplinary_status || 'NONE');
    setReason('');
    setNotes('');
    setEffectiveFrom(new Date().toISOString().split('T')[0]);
    setEffectiveUntil('');
    setErrorMessage(null);
    setSuccessMessage(null);

    loadHistory();
  }, [isOpen, user]);

  const loadHistory = async () => {
    if (!user) return;
    setIsLoadingHistory(true);
    try {
      const res = await api.getUserStatusHistory(user.id);
      setHistory(res.history || []);
    } catch (err: any) {
      console.error('Failed to load employee status history', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSelf) {
      setErrorMessage(t('employment.cannotChangeSelf'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await api.updateUserStatus(user.id, {
        employment_status: employmentStatus,
        disciplinary_status: disciplinaryStatus,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        effective_from: effectiveFrom || undefined,
        effective_until: effectiveUntil || undefined
      });

      setSuccessMessage(t('common.success'));
      await loadHistory();
      if (onStatusUpdated) onStatusUpdated();
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err: any) {
      setErrorMessage(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const getEmploymentBadgeColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'INTERN':
        return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
      case 'PROBATION':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'ON_LEAVE':
        return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
      case 'SUSPENDED':
        return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
      case 'TERMINATED':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const getDisciplinaryBadgeColor = (status: string) => {
    switch (status) {
      case 'NONE':
        return 'bg-slate-800 text-slate-400 border-slate-700';
      case 'WARNING':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'REPRIMAND':
        return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
      case 'FINAL_REPRIMAND':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  {user.full_name}
                </h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${getEmploymentBadgeColor(user.employment_status || user.status)}`}>
                  {user.employment_status || user.status}
                </span>
                {user.disciplinary_status && user.disciplinary_status !== 'NONE' && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${getDisciplinaryBadgeColor(user.disciplinary_status)}`}>
                    {user.disciplinary_status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {user.email} • {user.branch_name || 'HQ / Unassigned'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="boom-modal-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6">
          <button
            onClick={() => setActiveTab('update')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'update'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>{t('employment.changeStatus')}</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'history'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{t('employment.statusHistory')}</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
              {history.length}
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {errorMessage && (
            <Notice kind="error">{errorMessage}</Notice>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {isSelf && (
            <div className="mb-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>{t('employment.cannotChangeSelf')}</span>
            </div>
          )}

          {activeTab === 'update' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Employment Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t('employment.status')}
                  </label>
                  <select
                    value={employmentStatus}
                    disabled={isSelf}
                    onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  >
                    <option value="ACTIVE">{t('status.active')}</option>
                    <option value="INTERN">{t('status.intern')}</option>
                    <option value="PROBATION">{t('status.probation')}</option>
                    <option value="ON_LEAVE">{t('status.onLeave')}</option>
                    <option value="SUSPENDED">{t('status.suspended')}</option>
                    <option value="TERMINATED">{t('status.terminated')}</option>
                  </select>
                </div>

                {/* Disciplinary Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t('employment.disciplinary')}
                  </label>
                  <select
                    value={disciplinaryStatus}
                    disabled={isSelf}
                    onChange={(e) => setDisciplinaryStatus(e.target.value as DisciplinaryStatus)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  >
                    <option value="NONE">{t('status.none')}</option>
                    <option value="WARNING">{t('status.warning')}</option>
                    <option value="REPRIMAND">{t('status.reprimand')}</option>
                    <option value="FINAL_REPRIMAND">{t('status.finalReprimand')}</option>
                  </select>
                </div>
              </div>

              {/* Effective Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t('employment.effectiveFrom')}
                  </label>
                  <input
                    type="date"
                    disabled={isSelf}
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t('employment.effectiveUntil')} ({language === 'ru' ? 'опционально' : 'hökman däl'})
                  </label>
                  <input
                    type="date"
                    disabled={isSelf}
                    value={effectiveUntil}
                    onChange={(e) => setEffectiveUntil(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('employment.statusReason')}
                </label>
                <input
                  type="text"
                  disabled={isSelf}
                  placeholder={language === 'ru' ? 'Например: Завершение испытательного срока' : 'Mysal üçin: Synag möhletiniň tamamlanmagy'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {t('employment.notes')}
                </label>
                <textarea
                  rows={3}
                  disabled={isSelf}
                  placeholder={language === 'ru' ? 'Дополнительные служебные примечания руководства...' : 'Ýolbaşçylaryň goşmaça gulluk bellikleri...'}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50 resize-none"
                />
              </div>

              {/* Action */}
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary btn-sm"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isSelf}
                  className="btn btn-sm"
                >
                  {isSubmitting ? t('common.loading') : t('common.save')}
                </button>
              </div>
            </form>
          ) : (
            /* History Timeline */
            <div className="space-y-4">
              {isLoadingHistory ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  {t('common.loading')}
                </div>
              ) : history.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  {t('common.noData')}
                </div>
              ) : (
                <div className="relative border-l border-slate-800 ml-4 space-y-6">
                  {history.map((h) => (
                    <div key={h.id} className="relative pl-6">
                      {/* Timeline dot */}
                      <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-slate-900 border-2 border-amber-400"></span>
                      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] border ${getEmploymentBadgeColor(h.employment_status)}`}>
                              {h.employment_status}
                            </span>
                            {h.disciplinary_status && h.disciplinary_status !== 'NONE' && (
                              <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] border ${getDisciplinaryBadgeColor(h.disciplinary_status)}`}>
                                {h.disciplinary_status}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-400">
                            {new Date(h.created_at).toLocaleString()}
                          </span>
                        </div>

                        {h.reason && (
                          <p className="text-xs text-slate-200">
                            <strong>{t('common.reason')}:</strong> {h.reason}
                          </p>
                        )}

                        {h.notes && (
                          <p className="text-[11px] text-slate-400 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                            {h.notes}
                          </p>
                        )}

                        <div className="text-[10px] text-slate-500 flex items-center justify-between">
                          <span>{t('employment.effectiveFrom')}: {h.effective_from ? new Date(h.effective_from).toLocaleDateString() : '—'}</span>
                          {h.effective_until && (
                            <span>{t('employment.effectiveUntil')}: {new Date(h.effective_until).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
