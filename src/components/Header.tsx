import React, { useEffect, useState } from 'react';
import { Building2, Shield, Globe, Landmark } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api';
import { Branch, Franchise } from '../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenLoginModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  const { 
    user, 
    selectedBranchFilter, 
    setSelectedBranchFilter,
    selectedFranchiseFilter,
    setSelectedFranchiseFilter
  } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [franchises, setFranchises] = useState<Franchise[]>([]);

  useEffect(() => {
    if (user) {
      api.getBranches().then(res => setBranches(res.branches || [])).catch(() => {});
      api.getFranchises().then(res => setFranchises(res.franchises || [])).catch(() => {});
    }
  }, [user]);

  // Filter branches if a specific franchise is selected
  const visibleBranches = selectedFranchiseFilter === 'ALL'
    ? branches
    : branches.filter(b => b.franchise_id === selectedFranchiseFilter);


  return (
    <header id="boom-header" className="h-16 px-6 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between z-10">
      <div>
        <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          {title}
        </h1>
        {subtitle && <p className="text-xs text-slate-400 font-medium">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Language Switcher RU | TK */}
        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs font-bold">
          <button
            id="btn-lang-ru"
            onClick={() => setLanguage('ru')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              language === 'ru'
                ? 'bg-amber-500 text-slate-950 shadow-sm font-black'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Русский язык"
          >
            RU
          </button>
          <button
            id="btn-lang-tk"
            onClick={() => setLanguage('tk')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              language === 'tk'
                ? 'bg-amber-500 text-slate-950 shadow-sm font-black'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Türkmen dili"
          >
            TK
          </button>
        </div>

        {/* Franchise Scope Selector */}
        {user && (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400 font-medium">{t('header.franchiseFilter')}:</span>
            <select
              id="franchise-scope-select"
              value={selectedFranchiseFilter}
              onChange={(e) => {
                setSelectedFranchiseFilter(e.target.value);
                // Reset branch filter if it doesn't belong to the newly chosen franchise
                if (e.target.value !== 'ALL') {
                  setSelectedBranchFilter('ALL');
                }
              }}
              className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="ALL" className="bg-slate-900 text-white">
                {t('header.allFranchises')}
              </option>
              {franchises.map(f => (
                <option key={f.id} value={f.id} className="bg-slate-900 text-white">
                  {f.name} ({f.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Multi-Branch Selector */}
        {user && (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 font-medium">{t('header.branchFilter')}:</span>
            <select
              id="branch-scope-select"
              value={selectedBranchFilter}
              onChange={(e) => setSelectedBranchFilter(e.target.value)}
              className="bg-transparent text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[140px] truncate"
            >
              <option value="ALL" className="bg-slate-900 text-white">
                {user.isSuperUser ? t('header.allBranches') : t('header.allBranches')}
              </option>
              {visibleBranches.map(b => (
                <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* System Health Heartbeat */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-mono text-[11px]">KERNEL ACTIVE</span>
        </div>
      </div>
    </header>
  );
};
