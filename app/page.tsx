"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, type ErrorInfo, type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { clientFetch as fetch } from "@/lib/client-polling.mjs";

type UiTheme = "dark" | "light";
type Membership = {
  active: boolean;
  planId: "day" | "monthly" | "yearly" | null;
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

function RabbitLoading({ retry }: { retry?: () => void }) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="auth-loading" aria-busy="true" aria-live="polite" role="status">
      <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
        <Image src="/rabbit-logo-loading.webp" alt="双兔助手 做T神器" width={48} height={48} priority unoptimized />
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{timedOut ? "加载超时，可能是页面缓存或网络阻塞" : "正在进入双兔助手…"}</span>
        {timedOut && <button type="button" onClick={() => { retry?.(); window.setTimeout(() => window.location.reload(), 3_000); }} style={{ border: "1px solid var(--line)", background: "transparent", color: "var(--teal)", padding: "8px 14px", cursor: "pointer" }}>重试并刷新</button>}
      </div>
    </main>
  );
}

class AuthenticatedErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[rabbit] authenticated app failed to render", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="auth-loading" role="alert">
          <div style={{ display: "grid", justifyItems: "center", gap: 14, maxWidth: 420, padding: 24, textAlign: "center" }}>
            <Image src="/rabbit-logo-loading.webp" alt="双兔助手" width={48} height={48} unoptimized />
            <strong style={{ color: "var(--text)" }}>操盘台加载失败</strong>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>页面脚本出现异常，请刷新重试。{this.state.error.message ? ` (${this.state.error.message})` : ""}</span>
            <button type="button" onClick={() => window.location.reload()} style={{ border: "1px solid var(--line)", background: "transparent", color: "var(--teal)", padding: "8px 14px", cursor: "pointer" }}>刷新页面</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
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
const PublicLanding = dynamic(
  () => import("./public-landing").then(module => module.default),
  { loading: () => <main className="public-site public-site-loading" aria-busy="true" /> },
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

export default function Home() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, getServerTheme);
  const [initialAuth, setInitialAuth] = useState<InitialAuth | null>(null);
  const [authScreen, setAuthScreen] = useState<"landing" | "account">("landing");
  const [moduleLoadError, setModuleLoadError] = useState<string | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (event.message || event.filename) setModuleLoadError(event.message || "脚本加载失败");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason || "脚本加载失败");
      if (/chunk|import|module|fetch|load/i.test(message)) setModuleLoadError(message);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/control/auth/session", { credentials: "include", cache: "no-store" });
          if (response.ok) {
            const payload = await response.json() as { user?: { displayName?: string; username?: string; role?: string; membership?: Membership | null } };
            const user = payload.user;
            const accountName = user?.displayName || user?.username;
            if (accountName) {
              const accountRole = user?.role || "member";
              setInitialAuth({ localAuth: true, demoMode: false, accountName, accountRole, accountMembership: user?.membership ?? null });
              try { localStorage.setItem("rabbit-account-role", accountRole); } catch {}
            }
          }
        } catch {}
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleTheme = () => {
    const next: UiTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("rabbit-ui-theme", next); } catch {}
    window.dispatchEvent(new Event("rabbit-theme-change"));
  };

  const enterDemo = () => {
    setInitialAuth({ localAuth: true, demoMode: true, accountName: "演示访客", accountRole: "member", accountMembership: null });
  };

  const handleAuthenticated = (name: string, isNew: boolean, remember: boolean, membership: Membership | null) => {
    const accountRole = localStorage.getItem("rabbit-account-role") || "member";
    setInitialAuth({ localAuth: true, demoMode: false, accountName: name, accountRole, accountMembership: membership });
    try {
      const persistent = isNew || remember;
      (persistent ? localStorage : sessionStorage).setItem("rabbit-auth-session", name);
      (persistent ? sessionStorage : localStorage).removeItem("rabbit-auth-session");
    } catch {}
  };

  if (initialAuth) {
    if (moduleLoadError) {
      return <main className="auth-loading" role="alert"><div style={{ display: "grid", justifyItems: "center", gap: 14, maxWidth: 420, padding: 24, textAlign: "center" }}><Image src="/rabbit-logo-loading.webp" alt="双兔助手" width={48} height={48} unoptimized /><strong style={{ color: "var(--text)" }}>操盘台脚本加载失败</strong><span style={{ color: "var(--muted)", fontSize: 12 }}>请刷新页面重试。{moduleLoadError ? ` (${moduleLoadError})` : ""}</span><button type="button" onClick={() => window.location.reload()} style={{ border: "1px solid var(--line)", background: "transparent", color: "var(--teal)", padding: "8px 14px", cursor: "pointer" }}>刷新页面</button></div></main>;
    }
    return <AuthenticatedErrorBoundary><AuthenticatedHome initialAuth={initialAuth} theme={theme} onToggleTheme={toggleTheme} onLogout={() => { setInitialAuth(null); setAuthScreen("account"); }} /></AuthenticatedErrorBoundary>;
  }
  if (authScreen === "landing") {
    return <PublicLanding onDemo={enterDemo} onAccount={() => setAuthScreen("account")} theme={theme} onToggleTheme={toggleTheme} />;
  }
  return <AuthView theme={theme} onToggleTheme={toggleTheme} onBack={() => setAuthScreen("landing")} onDemo={enterDemo} onAuthenticated={handleAuthenticated} />;
}
const AuthenticatedHome = dynamic<AuthenticatedHomeProps>(
  () => import("./authenticated-app").then(module => module.default),
  { loading: () => <RabbitLoading /> },
);
