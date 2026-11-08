/**
 * 认证上下文
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { authApi } from '../api/client';
import type { User, MembershipInfo } from '../types';

interface AuthContextType {
  user: User | null;
  membership: MembershipInfo | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const staticSite = import.meta.env.VITE_STATIC === '1';

const localVisitor: User = {
  id: 0,
  username: '访客',
  email: '仅保存在当前浏览器',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  last_login_at: null,
  login_count: 0,
};

const localMembership: MembershipInfo = {
  isPremium: true,
  hoursRemaining: 0,
  loginsRemaining: 0,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化时检查登录状态
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    if (staticSite) {
      setUser(localVisitor);
      setMembership(localMembership);
      setIsLoading(false);
      return;
    }
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await authApi.getMe();
      if (response.data.success) {
        setUser(response.data.data.user);
        setMembership(response.data.data.membership);
      }
    } catch (error) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    if (staticSite) {
      setUser(localVisitor);
      setMembership(localMembership);
      return;
    }
    const response = await authApi.login({ username, password });
    if (response.data.success) {
      const { user: userData, tokens } = response.data.data;
      setUser(userData);
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      // 获取会员信息
      await refreshUser();
    }
  };

  const register = async (username: string, email: string, password: string) => {
    if (staticSite) {
      setUser(localVisitor);
      setMembership(localMembership);
      return;
    }
    const response = await authApi.register({ username, email, password });
    if (response.data.success) {
      const { user: userData, tokens } = response.data.data;
      setUser(userData);
      setMembership({
        isPremium: false,
        hoursRemaining: 24,
        loginsRemaining: 10,
      });
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
    }
  };

  const logout = async () => {
    if (staticSite) {
      setUser(localVisitor);
      setMembership(localMembership);
      return;
    }
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch (error) {
        // 忽略登出错误
      }
    }
    setUser(null);
    setMembership(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  };

  const refreshUser = async () => {
    try {
      const response = await authApi.getMe();
      if (response.data.success) {
        setMembership(response.data.data.membership);
      }
    } catch (error) {
      // 忽略刷新错误
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        membership,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
