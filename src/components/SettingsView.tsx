import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Plus,
  Edit2,
  CheckCircle2,
  X,
  AlertCircle,
  FileCode,
  User,
  Clock
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { EmptyState, LoadingState, Notice, Toolbar } from './ui';
import { api } from '../api';
import { SystemSetting } from '../types';
import { useAuth } from '../context/AuthContext';
import { errorText } from '../humanErrors';

export const SettingsView: React.FC = () => {
  const { t, language } = useLanguage();
  const ru = language === 'ru';
  const { hasPermission } = useAuth();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [editingSetting, setEditingSetting] = useState<SystemSetting | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form
  const [form, setForm] = useState({
    key: '',
    value: '',
    type: 'string' as 'string' | 'number' | 'boolean' | 'json',
    description: ''
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await api.getSettings();
      setSettings(res.settings);
    } catch (err) {
      console.error('Failed to load system settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const openEdit = (s: SystemSetting) => {
    setEditingSetting(s);
    setForm({
      key: s.key,
      value: s.value,
      type: s.type,
      description: s.description || ''
    });
    setFormError(null);
  };

  const openCreate = () => {
    setForm({
      key: '',
      value: '',
      type: 'string',
      description: ''
    });
    setFormError(null);
    setIsCreateOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      if (editingSetting) {
        await api.updateSetting(editingSetting.key, {
          value: form.value,
          description: form.description
        });
        setEditingSetting(null);
      } else {
        await api.createSetting(form);
        setIsCreateOpen(false);
      }
      fetchSettings();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="view-settings" className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Stage 41: one page header, in the shell, plus the standard toolbar with the primary action. */}
      <Toolbar>
        {hasPermission('settings.update') && (
          <button id="btn-create-setting-modal" className="btn" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            <span>{t('ui.addConfigurationKey')}</span>
          </button>
        )}
      </Toolbar>

      {/* Settings Table */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase font-bold text-[10px] tracking-wider bg-slate-950/40">
                <th className="py-3 px-4">{t('ui.configurationKey')}</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">{t('ui.configuredValue')}</th>
                <th className="py-3 px-4">Description</th>
                <th className="py-3 px-4">{t('ui.lastModified')}</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6}><LoadingState/></td>
                </tr>
              ) : settings.length === 0 ? (
                <tr>
                  <td colSpan={6}><EmptyState title={ru ? 'Параметров пока нет.' : 'Entek parametr ýok.'} hint={ru ? 'Здесь хранятся общие параметры сети — их меняют редко.' : 'Bu ýerde ulgamyň umumy parametrleri saklanýar — olar seýrek üýtgedilýär.'}/></td>
                </tr>
              ) : (
                settings.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Key */}
                    <td className="py-3.5 px-4 font-mono font-bold text-amber-400">
                      {s.key}
                    </td>

                    {/* Type */}
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        {s.type}
                      </span>
                    </td>

                    {/* Value */}
                    <td className="py-3.5 px-4 font-mono text-slate-200 max-w-xs truncate">
                      {s.value}
                    </td>

                    {/* Description */}
                    <td className="py-3.5 px-4 text-slate-400 max-w-sm">
                      {s.description || '—'}
                    </td>

                    {/* Modified */}
                    <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                      <div>{new Date(s.updated_at).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500">by {s.updater_name || 'System'}</div>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      {hasPermission('settings.update') && (
                        <button
                          onClick={() => openEdit(s)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors"
                          title="Edit Setting"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {(isCreateOpen || editingSetting) && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>{isCreateOpen ? 'Add Configuration Key' : `Edit Setting: ${editingSetting?.key}`}</span>
              </h3>
              <button
                onClick={() => { setIsCreateOpen(false); setEditingSetting(null); }}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <Notice kind="error">{formError}</Notice>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.keyName')}</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingSetting)}
                  placeholder="e.g. system.tax_rate"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.valueType')}</label>
                  <select
                    disabled={Boolean(editingSetting)}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="json">json</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{t('ui.value')}</label>
                  <input
                    type="text"
                    required
                    placeholder={t('ui.enterValue')}
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Explain purpose of this parameter..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setIsCreateOpen(false); setEditingSetting(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn btn-sm"
                >
                  {isSubmitting ? 'Saving...' : isCreateOpen ? 'Create Setting' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
