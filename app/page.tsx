"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import PublicLanding from "./public-landing";

type UiTheme = "dark" | "light";
type Membership = {
  active: boolean;
  expiresAt: string | null;
  referralCode: string | null;
  referralCredits: number;
  referralReviews: number;
  referralRewardDays: number;
};
type InitialAuth = {
  localAuth: true;
  demoMode: boolean;
  accountName: string;
  accountRole: string;
  accountMembership: Membership | null;
};

function RabbitLoading({ message = "正在进入双兔助手…" }: { message?: string }) {
  return (
    <main className="auth-loading" aria-busy="true" aria-live="polite" role="status">
      <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
        <Image src="/rabbit-logo-loading.webp" alt="双兔助手 做T神器" width={48} height={48} priority unoptimized />
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{message}</span>
      </div>
    </main>
  );
}

type AuthViewProps = {
  onAuthenticated: (name: string, isNew: boolean, remember: boolean, membership: Membership | null) => void;
  onBack: () => void;
  onDemo: () => void;
  theme: UiTheme;
  onToggleTheme: () => void;
};

type AuthenticatedHomeProps = {
  initialAuth: InitialAuth;
  theme: UiTheme;
  onToggleTheme: () => void;
  onLogout: () => void;
};

const AuthView = dynamic<AuthViewProps>(
  () => import("./auth-view").then(module => module.AuthView),
  { loading: () => <RabbitLoading /> },
);

const AuthenticatedHome = dynamic<AuthenticatedHomeProps>(
  () => import("./authenticated-app").then(module => module.default),
  { loading: () => <RabbitLoading /> },
);

function readTheme(): UiTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribeTheme(listener: () => void) {
  window.addEventListener("rabbit-theme-change", listener);
  return () => window.removeEventListener("rabbit-theme-change", listener);
}

function getServerTheme(): UiTheme {
  return "dark";
}

function readAuthSessionHint(): { accountName: string; accountRole: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const accountName = window.sessionStorage.getItem("rabbit-auth-session")
      || window.localStorage.getItem("rabbit-auth-session");
    if (!accountName) return null;
    return {
      accountName,
      accountRole: window.localStorage.getItem("rabbit-account-role") || "member",
    };
  } catch {
    return null;
  }
}

function clearAuthSessionHint() {
  try {
    window.sessionStorage.removeItem("rabbit-auth-session");
    window.localStorage.removeItem("rabbit-auth-session");
  } catch {}
}

export default function Home() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, getServerTheme);
  const [initialAuth, setInitialAuth] = useState<InitialAuth | null>(null);
  const [authScreen, setAuthScreen] = useState<"landing" | "account">("landing");
  const [sessionState, setSessionState] = useState<"idle" | "verifying" | "expired">("idle");
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const authHint = readAuthSessionHint();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    // Returning users can download the large console chunk while the session is verified.
    if (authHint) {
      void import("./authenticated-app");
      queueMicrotask(() => {
        if (active) setSessionState("verifying");
      });
    }

    void (async () => {
      try {
        const response = await window.fetch("/api/control/auth/session", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!active) return;
        if (response.ok) {
          const payload = await response.json() as { user?: { displayName?: string; username?: string; role?: string; membership?: Membership | null } };
          const user = payload.user;
          const accountName = user?.displayName || user?.username;
          if (accountName) {
            const accountRole = user?.role || "member";
            void import("./authenticated-app");
            setInitialAuth({ localAuth: true, demoMode: false, accountName, accountRole, accountMembership: user?.membership ?? null });
            setSessionState("idle");
            setAuthNotice(null);
            try { localStorage.setItem("rabbit-account-role", accountRole); } catch {}
          } else if (authHint) {
            clearAuthSessionHint();
            setInitialAuth(null);
            setSessionState("expired");
            setAuthScreen("account");
            setAuthNotice("登录状态已失效，请重新登录");
          }
        } else if ((response.status === 401 || response.status === 403) && authHint) {
          clearAuthSessionHint();
          setInitialAuth(null);
          setSessionState("expired");
          setAuthScreen("account");
          setAuthNotice("登录状态已失效，请重新登录");
        } else if (authHint) {
          clearAuthSessionHint();
          setInitialAuth(null);
          setSessionState("expired");
          setAuthScreen("account");
          setAuthNotice("登录状态暂不可用，请重新登录");
        }
      } catch {
        if (!active || !authHint) return;
        clearAuthSessionHint();
        setInitialAuth(null);
        setSessionState("expired");
        setAuthScreen("account");
        setAuthNotice("登录状态验证超时，请重新登录");
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  const toggleTheme = () => {
    const next: UiTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("rabbit-ui-theme", next); } catch {}
    window.dispatchEvent(new Event("rabbit-theme-change"));
  };

  const enterDemo = () => {
    setSessionState("idle");
    setAuthNotice(null);
    setInitialAuth({ localAuth: true, demoMode: true, accountName: "演示访客", accountRole: "member", accountMembership: null });
  };

  const handleAuthenticated = (name: string, isNew: boolean, remember: boolean, membership: Membership | null) => {
    const accountRole = localStorage.getItem("rabbit-account-role") || "member";
    setSessionState("idle");
    setAuthNotice(null);
    setInitialAuth({ localAuth: true, demoMode: false, accountName: name, accountRole, accountMembership: membership });
    try {
      const persistent = isNew || remember;
      (persistent ? localStorage : sessionStorage).setItem("rabbit-auth-session", name);
      (persistent ? sessionStorage : localStorage).removeItem("rabbit-auth-session");
    } catch {}
  };

  if (!initialAuth && sessionState === "verifying") {
    return <RabbitLoading message="正在验证登录状态…" />;
  }
  if (initialAuth) {
    return <AuthenticatedHome initialAuth={initialAuth} theme={theme} onToggleTheme={toggleTheme} onLogout={() => { setInitialAuth(null); setAuthScreen("account"); }} />;
  }
  if (authScreen === "landing") {
    return <PublicLanding onDemo={enterDemo} onAccount={() => setAuthScreen("account")} theme={theme} onToggleTheme={toggleTheme} />;
  }
  return (
    <>
      {authNotice && (
        <div role="status" aria-live="polite" style={{ position: "fixed", top: 16, left: "50%", zIndex: 20, transform: "translateX(-50%)", padding: "8px 14px", border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)", borderRadius: 999, background: "color-mix(in srgb, var(--danger) 14%, var(--panel))", color: "var(--danger)", fontSize: 12, whiteSpace: "nowrap" }}>
          {authNotice}
        </div>
      )}
      <AuthView theme={theme} onToggleTheme={toggleTheme} onBack={() => { setAuthNotice(null); setAuthScreen("landing"); }} onDemo={enterDemo} onAuthenticated={handleAuthenticated} />
    </>
  );
}
