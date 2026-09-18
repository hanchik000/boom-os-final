import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '../types';
import { api, getStoredToken, setStoredToken } from '../api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (login: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permissionCode: string) => boolean;
  canAccessBranch: (branchId: string) => boolean;
  selectedBranchFilter: string;
  setSelectedBranchFilter: (id: string) => void;
  selectedFranchiseFilter: string;
  setSelectedFranchiseFilter: (id: string) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>('ALL');
  const [selectedFranchiseFilter, setSelectedFranchiseFilter] = useState<string>('ALL');

  const refreshUser = useCallback(async () => {
    const currentToken = getStoredToken();
    if (!currentToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.getCurrentUser();
      setUser(data.user);
    } catch (err) {
      console.warn('Session expired or invalid, logging out', err);
      setStoredToken(null);
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const stored = getStoredToken();
      if (stored) {
        await refreshUser();
      } else {
        setIsLoading(false);
      }
    }
    init();
  }, [refreshUser]);

  const login = async (loginId: string, pass: string) => {
    setIsLoading(true);
    try {
      const res = await api.login(loginId, pass);
      setStoredToken(res.token);
      setToken(res.token);
      setUser(res.user);
      setSelectedBranchFilter('ALL');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors on logout
    } finally {
      setStoredToken(null);
      setToken(null);
      setUser(null);
    }
  };

  const hasPermission = (permissionCode: string): boolean => {
    if (!user) return false;
    if (user.isSuperUser) return true;
    if (user.roleCodes?.includes('OWNER') || user.roleCodes?.includes('SUPER_ADMIN')) return true;
    return Boolean(user.permissions?.includes(permissionCode));
  };

  const canAccessBranch = (branchId: string): boolean => {
    if (!user) return false;
    if (user.isSuperUser) return true;
    if (user.roleCodes?.includes('OWNER') || user.roleCodes?.includes('SUPER_ADMIN')) return true;
    return Boolean(user.allowedBranchIds?.includes(branchId));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        hasPermission,
        canAccessBranch,
        selectedBranchFilter,
        setSelectedBranchFilter,
        selectedFranchiseFilter,
        setSelectedFranchiseFilter,
        refreshUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
