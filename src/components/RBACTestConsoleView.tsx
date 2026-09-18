import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Layers,
  ArrowRight,
  UserCheck,
  Building,
  Key,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { RBACTestResult } from '../types';

export const RBACTestConsoleView: React.FC = () => {
  const { t } = useLanguage();
  const { token, hasPermission } = useAuth();

  // Dropdown options
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [franchises, setFranchises] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  // Form selections
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRoleId, setSelectedRoleId] = useState<string>(''); // empty means keep actual user roles
  const [selectedFranchiseId, setSelectedFranchiseId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [selectedPermission, setSelectedPermission] = useState<string>('users.view');
  const [runMatrix, setRunMatrix] = useState<boolean>(true);

  // Simulation execution state
  const [isSimulating, setIsSimulating] = useState(false);
  const [testResult, setTestResult] = useState<RBACTestResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  // Fetch options
  const fetchOptions = async () => {
    setIsLoadingOptions(true);
    try {
      const res = await fetch('/api/rbac/options', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setRoles(data.roles || []);
        setFranchises(data.franchises || []);
        setBranches(data.branches || []);
        setPermissions(data.permissions || []);

        // Pre-select first user and first branch for instant test readiness
        if (data.users?.length > 0 && !selectedUserId) {
          setSelectedUserId(data.users[0].id);
        }
        if (data.branches?.length > 0 && !selectedBranchId) {
          setSelectedBranchId(data.branches[0].id);
          if (data.branches[0].franchise_id) {
            setSelectedFranchiseId(data.branches[0].franchise_id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load RBAC simulation options', err);
    } finally {
      setIsLoadingOptions(false);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, [token]);

  // When user selects a branch, auto-select its franchise if not already chosen
  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    const branch = branches.find(b => b.id === branchId);
    if (branch && branch.franchise_id) {
      setSelectedFranchiseId(branch.franchise_id);
    }
  };

  // Run the simulation test
  const handleRunTest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUserId) return;

    setIsSimulating(true);
    setSimulationError(null);

    try {
      const res = await fetch('/api/rbac/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          user_id: selectedUserId,
          role_id: selectedRoleId || undefined,
          franchise_id: selectedFranchiseId || undefined,
          branch_id: selectedBranchId || undefined,
          permission: selectedPermission || undefined,
          test_matrix: runMatrix
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setSimulationError(data.message || 'Simulation execution failed');
        return;
      }

      setTestResult(data);
    } catch (err: any) {
      setSimulationError(err.message || 'An unexpected error occurred during RBAC test');
    } finally {
      setIsSimulating(false);
    }
  };

  // Quick Preset Simulations
  const runPreset = (userId: string, roleId: string, branchId: string, perm: string) => {
    setSelectedUserId(userId);
    setSelectedRoleId(roleId);
    handleBranchChange(branchId);
    setSelectedPermission(perm);
    setTimeout(() => handleRunTest(), 50);
  };

  const selectedUser = users.find(u => u.id === selectedUserId);
  const selectedBranch = branches.find(b => b.id === selectedBranchId);
  const selectedFranchise = franchises.find(f => f.id === selectedFranchiseId);

  return (
    <div id="rbac-test-console" className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Read-Only Guarantee Notice */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <span className="text-xs font-mono font-bold text-amber-400 tracking-wider uppercase">
              RBAC Authorization Simulation Engine
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
              100% READ-ONLY
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Simulates: <strong className="text-white">User + Role + Franchise + Branch + Permission</strong>.
            This test console strictly verifies policy boundaries and cannot alter roles, permissions, or database records.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <Layers className="w-4 h-4 text-amber-500" />
          <span>FRANCHISE → BRANCH → EMPLOYEE</span>
        </div>
      </div>

      {/* Main Grid: Form & Real-Time Test Outcome */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Test Configuration Form */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>{t('ui.simulationParameters')}</span>
              </h3>
              <button
                onClick={fetchOptions}
                className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
                title={t('ui.refreshOptions')}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <form onSubmit={handleRunTest} className="mt-4 space-y-4 text-xs">
              {/* 1. Select User */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                  <span>1. SELECT USER *</span>
                  {selectedUser && (
                    <span className="text-[10px] font-mono text-slate-400 font-normal">
                      Status: {selectedUser.status}
                    </span>
                  )}
                </label>
                <select
                  id="rbac-select-user"
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choose User --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.email}) [{u.status}]
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Select Role (Simulated or Real) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                  <span>2. SELECT ROLE (Simulate Alternate Role)</span>
                  <span className="text-[10px] font-mono text-amber-400 font-normal">
                    {selectedRoleId ? 'Simulating custom role' : 'Using actual user role'}
                  </span>
                </label>
                <select
                  id="rbac-select-role"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Keep Current Assigned Roles --</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Select Franchise */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  3. SELECT FRANCHISE (Holding Level)
                </label>
                <select
                  id="rbac-select-franchise"
                  value={selectedFranchiseId}
                  onChange={(e) => setSelectedFranchiseId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Any / Universal Franchise --</option>
                  {franchises.map((f) => (
                    <option key={f.id} value={f.id}>
                      [{f.code}] {f.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Select Branch */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1 flex items-center justify-between">
                  <span>4. SELECT BRANCH (Location Level)</span>
                  {selectedBranch && selectedBranch.franchise_id && (
                    <span className="text-[10px] font-mono text-blue-400">
                      Belongs to: {franchises.find(f => f.id === selectedBranch.franchise_id)?.code || 'Franchise'}
                    </span>
                  )}
                </label>
                <select
                  id="rbac-select-branch"
                  value={selectedBranchId}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- No specific branch (Global) --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.code}] {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Select Permission / Action */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  5. SELECT PERMISSION / ACTION *
                </label>
                <select
                  id="rbac-select-permission"
                  required
                  value={selectedPermission}
                  onChange={(e) => setSelectedPermission(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                >
                  {permissions.map((p) => (
                    <option key={p.id} value={p.code}>
                      {p.code} — {p.name} ({p.module})
                    </option>
                  ))}
                </select>
              </div>

              {/* Matrix Checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="checkbox-test-matrix"
                  checked={runMatrix}
                  onChange={(e) => setRunMatrix(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 focus:ring-offset-0"
                />
                <label htmlFor="checkbox-test-matrix" className="text-xs text-slate-300 cursor-pointer">
                  Run Full Capability Matrix (inspect all 13 core actions)
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="btn-run-rbac-simulation"
                disabled={isSimulating || !selectedUserId}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-lg shadow-amber-500/10 uppercase tracking-wider"
              >
                {isSimulating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>[ TEST ACCESS ]</span>
              </button>
            </form>
          </div>

          {/* Quick Simulation Presets */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
            <span className="text-[11px] font-mono text-slate-400 uppercase font-bold block">
              Quick Test Scenarios
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  const owner = users.find(u => u.email.includes('owner'));
                  if (owner && branches[0]) {
                    setSelectedUserId(owner.id);
                    setSelectedRoleId('');
                    handleBranchChange(branches[0].id);
                    setSelectedPermission('users.create');
                    setTimeout(() => handleRunTest(), 50);
                  }
                }}
                className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left text-[11px] text-slate-300 transition-colors"
              >
                <span className="font-bold text-amber-400 block">OWNER Universal</span>
                <span className="text-slate-500 text-[10px]">users.create across branch</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const cashier = users.find(u => u.email.includes('cashier') || u.full_name.includes('Aygul'));
                  const otherBranch = branches[branches.length - 1];
                  if (cashier && otherBranch) {
                    setSelectedUserId(cashier.id);
                    setSelectedRoleId('');
                    handleBranchChange(otherBranch.id);
                    setSelectedPermission('branches.update');
                    setTimeout(() => handleRunTest(), 50);
                  }
                }}
                className="p-2 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left text-[11px] text-slate-300 transition-colors"
              >
                <span className="font-bold text-rose-400 block">Cashier Isolation</span>
                <span className="text-slate-500 text-[10px]">Foreign branch check</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Simulation Result & Reason Diagnostic */}
        <div className="lg:col-span-7 space-y-4">
          {simulationError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <span>{simulationError}</span>
            </div>
          )}

          {testResult ? (
            <div className="space-y-4">
              {/* Primary Decision Banner */}
              <div
                id="rbac-test-result-banner"
                className={`p-6 rounded-xl border flex flex-col gap-3 shadow-xl transition-all ${
                  testResult.allowed
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-100'
                    : 'bg-rose-950/40 border-rose-500/40 text-rose-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {testResult.allowed ? (
                      <CheckCircle className="w-8 h-8 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-8 h-8 text-rose-400 flex-shrink-0" />
                    )}
                    <div>
                      <span className="text-[11px] font-mono tracking-widest uppercase font-bold text-slate-400 block">
                        Evaluation Verdict
                      </span>
                      <h2
                        id="rbac-status-heading"
                        className={`text-2xl font-black tracking-tight ${
                          testResult.allowed ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {testResult.status}
                      </h2>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs">
                    <span className="text-slate-400 block">Tested Permission:</span>
                    <span className="font-bold text-white bg-slate-900/80 px-2.5 py-1 rounded border border-slate-700">
                      {testResult.simulation_params.permission}
                    </span>
                  </div>
                </div>

                {/* Diagnostic Reason */}
                <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs leading-relaxed">
                  <span className="font-bold text-slate-400 uppercase font-mono block mb-1">
                    System Reasoning:
                  </span>
                  <p id="rbac-result-reason" className="text-slate-200 font-medium">
                    {testResult.reason}
                  </p>
                </div>

                {/* Scope Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                  <div>
                    <span className="text-slate-400 block font-mono">User:</span>
                    <span className="font-semibold text-white truncate block">
                      {testResult.simulation_params.user.full_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono">Role:</span>
                    <span className="font-bold text-amber-400 truncate block">
                      {testResult.resolved_role}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono">Franchise:</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {testResult.simulation_params.franchise?.name || 'Universal'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-mono">Branch:</span>
                    <span className="font-semibold text-slate-200 truncate block">
                      {testResult.simulation_params.branch?.name || 'Global'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Capability Matrix Results */}
              {testResult.matrix_results && testResult.matrix_results.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-200">
                        Capability Matrix for {testResult.simulation_params.user.full_name}
                      </h4>
                      <p className="text-xs text-slate-400">
                        Evaluated against role <strong className="text-amber-400">[{testResult.resolved_role}]</strong> in branch <strong className="text-blue-400">[{testResult.simulation_params.branch?.code || 'Global'}]</strong>
                      </p>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {testResult.matrix_results.filter(m => m.allowed).length}/{testResult.matrix_results.length} Granted
                    </span>
                  </div>

                  <div className="divide-y divide-slate-800/80 max-h-[380px] overflow-y-auto">
                    {testResult.matrix_results.map((mat) => (
                      <div
                        key={mat.permission}
                        className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-300 font-semibold">{mat.permission}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({mat.module})</span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">{mat.reason}</p>
                        </div>

                        <span
                          className={`font-mono text-[10px] font-bold px-2 py-1 rounded flex-shrink-0 ${
                            mat.allowed
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {mat.allowed ? 'GRANTED' : 'DENIED'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Blank state waiting for first run */
            <div className="p-12 bg-slate-900 border border-slate-800 rounded-xl text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-amber-400">
                <Play className="w-6 h-6 fill-current" />
              </div>
              <h3 className="text-sm font-bold text-slate-200">{t('ui.simulationReady')}</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Select your parameters on the left and click <strong className="text-amber-400">[ TEST ACCESS ]</strong> to simulate real-time authorization checks without altering database state.
              </p>
              <button
                onClick={() => handleRunTest()}
                disabled={isLoadingOptions || !selectedUserId}
                className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors"
              >
                Run Default Simulation
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
