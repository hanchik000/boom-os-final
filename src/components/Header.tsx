import React, { useEffect, useState } from 'react';
import { Building2, Shield, Globe, Landmark, Menu, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api';
import { Branch, Franchise } from '../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onOpenLoginModal: () => void;
  /** Stage 44: opens the navigation drawer. Only shown at phone width, where the sidebar is hidden. */
  onOpenNav?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, onOpenNav, onOpenLoginModal }) => {
  const { 
    user, 
    selectedBranchFilter, 
    setSelectedBranchFilter,
    selectedFranchiseFilter,
    setSelectedFranchiseFilter,
    hasPermission
  } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const ru = language === 'ru';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [franchises, setFranchises] = useState<Franchise[]>([]);

  // Stage 40 defect fix: the branch and franchise lists were fetched for EVERY role on every page
  // load. A waiter has no branches.view and a cashier no franchises.view, so their first screen
  // always fired requests the server correctly refused -- silent in the UI (the catch swallowed
  // them) but a 403 on every load and a console error for anyone looking. Each request is now
  // only made by someone who may actually see the result; the server-side permissions are
  // unchanged and still authoritative.
  useEffect(() => {
    if (!user) return;
    if (hasPermission('branches.view')) {
      api.getBranches().then(res => setBranches(res.branches || [])).catch(() => {});
    } else {
      setBranches([]);
    }
    if (hasPermission('franchises.view')) {
      api.getFranchises().then(res => setFranchises(res.franchises || [])).catch(() => {});
    } else {
      setFranchises([]);
    }
  }, [user, hasPermission]);

  // Filter branches if a specific franchise is selected
  const visibleBranches = selectedFranchiseFilter === 'ALL'
    ? branches
    : branches.filter(b => b.franchise_id === selectedFranchiseFilter);


  return (
    <header id="boom-header" className="min-h-16 px-4 sm:px-6 py-2 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap z-10">
      <div className="flex items-center gap-3 min-w-0">
        {/* Stage 44: the only way to the navigation on a phone, where the sidebar is a drawer. */}
        <button
          id="btn-open-nav"
          type="button"
          className="btn-secondary btn-sm boom-nav-trigger"
          aria-label={t('nav.menuButton')}
          onClick={() => onOpenNav?.()}
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2 truncate">
          {title}
          </h1>
          {subtitle && <p className="text-xs text-slate-400 font-medium truncate max-sm:hidden">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
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

        {/* Franchise Scope Selector -- Stage 40: hidden when there is nothing to choose between,
            so no one is shown a control that cannot do anything. */}
        {user && franchises.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
            <Landmark className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400 font-medium max-sm:hidden">{t('header.franchiseFilter')}:</span>
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

        {/* Multi-Branch Selector -- Stage 40: hidden when there is nothing to choose between. */}
        {user && visibleBranches.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 font-medium max-sm:hidden">{t('header.branchFilter')}:</span>
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

        {/* The way in. Without an account the navigation shows almost nothing and every panel
            reads zero, so a signed-out person needs this button in front of them -- App already
            passed the handler down, but nothing ever rendered it. */}
        {!user && (
          <button id="btn-open-login" type="button" className="btn btn-sm" onClick={onOpenLoginModal}>
            <LogIn className="w-4 h-4" /> {ru ? 'Войти' : 'Gir'}
          </button>
        )}

        {/* System Health Heartbeat */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="font-mono text-[11px]">KERNEL ACTIVE</span>
        </div>
      </div>
    </header>
  );
};
