import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "./api";
import { PAGE_MODULE } from "./permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // On first load, restore the session if a token is stored.
  useEffect(() => {
    if (!getToken()) return;
    api.getMe()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  // authFetch fires this when the server rejects the token mid-session.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const signIn = useCallback(async (username, password) => {
    const { token, user: u } = await api.login(username, password);
    setToken(token);
    setUser(u);
  }, []);

  // After a password change the server issues a fresh token (all others die).
  const applyNewSession = useCallback(({ token, user: u }) => {
    setToken(token);
    setUser(u);
  }, []);

  const value = useMemo(() => {
    const level = (module) => {
      if (!user) return "none";
      if (user.is_admin) return "edit";
      return user.modules[module] || "none";
    };
    return {
      user,
      loading,
      signIn,
      signOut,
      applyNewSession,
      isAdmin: !!user?.is_admin,
      level,
      can: (module, need = "view") => {
        const have = level(module);
        return need === "view" ? have !== "none" : have === "edit";
      },
      canDo: (action) => !!user && (user.is_admin || user.actions.includes(action)),
      canOpenPage: (pageKey) => {
        if (!user) return false;
        const mod = PAGE_MODULE[pageKey];
        if (mod === "__admin__") return user.is_admin;
        return user.is_admin || (user.modules[mod] || "none") !== "none";
      },
      pageLevel: (pageKey) => level(PAGE_MODULE[pageKey]),
    };
  }, [user, loading, signIn, signOut, applyNewSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
