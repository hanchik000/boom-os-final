import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  Building2,
  User,
  Filter,
  Eye,
  Calendar,
  X,
  FileCode,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState, LoadingState, SearchInput, Toolbar } from './ui';
import { api } from '../api';
import { AuditLog, Branch } from '../types';
import { useAuth } from '../context/AuthContext';

export const AuditView: React.FC = () => {
  const { t, language } = useLanguage();
  const ru = language === 'ru';
  const [moreFilters, setMoreFilters] = useState(false);
  const { selectedBranchFilter } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [distinctActions, setDistinctActions] = useState<string[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState(selectedBranchFilter !== 'ALL' ? selectedBranchFilter : '');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Selected Log for inspection
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const [logRes, branchRes] = await Promise.all([
        api.getAuditLogs({
          search: search || undefined,
          branch_id: branchFilter || (selectedBranchFilter !== 'ALL' ? selectedBranchFilter : undefined),
          action: actionFilter || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          limit: 100
        }),
        api.getBranches()
      ]);
      setLogs(logRes.logs);
      setTotal(logRes.total);
      setDistinctActions(logRes.distinctActions);
      setBranches(branchRes.branches);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [search, branchFilter, actionFilter, startDate, endDate, selectedBranchFilter]);

  const resetFilters = () => {
    setSearch('');
    setBranchFilter('');
    setActionFilter('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div id="view-audit" className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Stage 41: one page header (in the shell) and one toolbar. What stood here was a second title,
          an English paragraph and two internal badges ("Immutable Ledger", "Append-Only Security
          Trail") -- engineering vocabulary on a screen a manager opens to see who changed a price.
          The rarely used date range moved behind "Дополнительные фильтры", per the same rule the rest
          of the system follows: the common filters first, the rare ones one click away. */}
      <Toolbar left={<>
        <SearchInput id="audit-search-input" value={search} onChange={setSearch}
          placeholder={ru ? 'Поиск по действию или объекту…' : 'Hereket ýa-da obýekt boýunça gözleg…'} />
        <select
          id="audit-action-filter"
          aria-label={ru ? 'Тип действия' : 'Hereket görnüşi'}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="">{t('ui.allActionTypes')}</option>
          {distinctActions.map((act) => (
            <option key={act} value={act}>{act}</option>
          ))}
        </select>
        <select
          id="audit-branch-filter"
          aria-label={ru ? 'Филиал' : 'Şahamça'}
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="field w-auto"
        >
          <option value="">{t('ui.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
          ))}
        </select>
        <button type="button" id="audit-more-filters" className="btn-ghost btn-sm" aria-expanded={moreFilters}
          onClick={() => setMoreFilters(v => !v)}>
          {ru ? 'Дополнительные фильтры' : 'Goşmaça süzgüçler'}
        </button>
        {moreFilters && <>
          <input id="audit-start-date" type="date" className="field w-auto" aria-label={ru ? 'С даты' : 'Senesinden'}
            value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input id="audit-end-date" type="date" className="field w-auto" aria-label={ru ? 'По дату' : 'Senesine çenli'}
            value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </>}
      </>}>
        <span className="text-xs text-slate-400">{ru ? 'Записей' : 'Ýazgy'}: <strong className="text-amber-400">{total}</strong></span>
        <button className="btn-secondary" onClick={fetchLogs} title={t('ui.refreshLogs')}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          {ru ? 'Обновить' : 'Täzele'}
        </button>
      </Toolbar>

      {/* Audit Logs Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[10px] tracking-wider bg-slate-950/40">
                <th className="py-3 px-4">{t('ui.dateTime')}</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">{t('ui.objectEntity')}</th>
                <th className="py-3 px-4">{t('ui.objectId')}</th>
                <th className="py-3 px-4 text-right">{t('ui.payloadDiff')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7}><LoadingState/></td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7}><EmptyState title={ru ? 'Записей за этот период нет.' : 'Bu döwür üçin ýazgy ýok.'} hint={ru ? 'Здесь появляется каждое изменение: кто, что и когда изменил.' : 'Bu ýerde her üýtgeşme görkezilýär: kim, näme we haçan üýtgetdi.'}/></td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Timestamp */}
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>

                    {/* User */}
                    <td className="py-3 px-4">
                      {log.user_name ? (
                        <div>
                          <div className="font-bold text-slate-200">{log.user_name}</div>
                          <div className="text-[10px] text-slate-500">{log.user_email}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">System / Kernel</span>
                      )}
                    </td>

                    {/* Branch */}
                    <td className="py-3 px-4 text-slate-300">
                      {log.branch_name ? (
                        <div>
                          <span className="font-semibold block">{log.branch_name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{log.branch_code}</span>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">HQ Central</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-800 text-amber-400 border border-slate-700">
                        {log.action}
                      </span>
                    </td>

                    {/* Entity Type */}
                    <td className="py-3 px-4 text-slate-300 font-mono">
                      {log.entity_type}
                    </td>

                    {/* Entity ID */}
                    <td className="py-3 px-4 text-slate-400 font-mono text-[10px]">
                      {log.entity_id || '—'}
                    </td>

                    {/* View Diff Action */}
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-[11px]"
                        title="View Before / After JSON"
                      >
                        <Eye className="w-3 h-3 text-amber-400" />
                        <span>{t('ui.inspect')}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Diff Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-bold text-white">{t('ui.auditDetails')}</h3>
              </div>
              <button onClick={() => setSelectedLog(null)} className="boom-modal-close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs p-3 bg-slate-950 rounded-xl border border-slate-800/80 font-mono">
                <div>
                  <div className="text-slate-500 text-[10px] uppercase">Action</div>
                  <div className="text-amber-400 font-bold">{selectedLog.action}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] uppercase">Entity</div>
                  <div className="text-slate-200">{selectedLog.entity_type}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] uppercase">Client IP</div>
                  <div className="text-slate-300">{selectedLog.ip_address || 'internal'}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px] uppercase">Timestamp</div>
                  <div className="text-slate-300 text-[11px]">{new Date(selectedLog.created_at).toLocaleTimeString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Prior State (Old Values)</span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-rose-300/90 overflow-x-auto max-h-56">
                    {selectedLog.old_values ? JSON.stringify(selectedLog.old_values, null, 2) : 'null (No previous state)'}
                  </pre>
                </div>

                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>New State (New Values)</span>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-emerald-300/90 overflow-x-auto max-h-56">
                    {selectedLog.new_values ? JSON.stringify(selectedLog.new_values, null, 2) : 'null (Entity removed or unchanged)'}
                  </pre>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
