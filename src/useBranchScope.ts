import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './context/AuthContext';

// ---------------------------------------------------------------------------------------------
// Stage 44 -- which branch is this screen about?
//
// Branch-scoped screens (kitchen, pass, receipt, food cost, analytics, credit reports) all read
// `user.branch_id`. A cook or a branch manager has one, so those screens worked. An owner, a
// network manager or a franchise-level account has no branch of its own, and those screens either
// said "no branch assigned" or quietly rendered an empty shell with no explanation -- six dead
// ends for the very people who oversee the network.
//
// The order of preference below is the one the system already followed in InventoryView and
// KitchenControlView; this is that same rule in one place, nothing new:
//   1. the account's own branch -- a cook never chooses anything,
//   2. the scope chosen in the page header, when it is a single branch,
//   3. the first branch the account is allowed to see.
//
// `branches` is filled only for an account that may read the branch list, so a screen can offer a
// selector exactly when there is something to choose: a cook has no `branches.view` and is never
// asked to pick anything, while a manager who oversees several branches keeps the in-screen
// switch KitchenControlView already offered. Permissions are unchanged: the server still decides
// what each branch request returns.
// ---------------------------------------------------------------------------------------------
export function useBranchScope() {
  const { user, hasPermission, selectedBranchFilter } = useAuth();
  const [branches, setBranches] = useState<any[]>([]);
  const [branchId, setBranchId] = useState(user?.branch_id || '');

  useEffect(() => {
    if (user?.branch_id) setBranchId(prev => prev || user.branch_id!);
    if (!hasPermission('branches.view')) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.getBranches();
        if (cancelled) return;
        const list = r.branches || [];
        setBranches(list);
        setBranchId(prev => prev || user?.branch_id || (selectedBranchFilter !== 'ALL' ? selectedBranchFilter : list[0]?.id) || '');
      } catch {
        /* the screen shows its own "choose a branch" message */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.branch_id, hasPermission, selectedBranchFilter]);

  return { branchId, setBranchId, branches };
}
