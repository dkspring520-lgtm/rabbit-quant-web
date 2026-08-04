"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { clientFetch as fetch } from "@/lib/client-polling.mjs";

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

function RabbitLoading() {
  return (
    <main className="auth-loading" aria-busy="true" aria-live="polite" role="status">
      <div style={{ display: "grid", justifyItems: "center", gap: 14 }}>
        <Image src="/rabbit-logo-compact.png" alt="双兔助手 做T神器" width={48} height={48} priority />
        <span style={{ color: "var(--muted)", fontSize: 11 }}>正在进入双兔助手…</span>
      </div>
    </main>
  );
}

const PublicLanding = dynamic(() => import("./public-landing"), {
  loading: () => <RabbitLoading />,
});

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
  () => import("./authenticated-app").then(module => module.AuthView),
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

export default function Home() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, getServerTheme);
  const [authReady, setAuthReady] = useState(false);
  const [initialAuth, setInitialAuth] = useState<InitialAuth | null>(null);
  const [authScreen, setAuthScreen] = useState<"landing" | "account">("landing");

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
        setAuthReady(true);
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

  if (!authReady) return <RabbitLoading />;
  if (initialAuth) {
    return <AuthenticatedHome initialAuth={initialAuth} theme={theme} onToggleTheme={toggleTheme} onLogout={() => { setInitialAuth(null); setAuthScreen("account"); }} />;
  }
  if (authScreen === "landing") {
    return <PublicLanding onDemo={enterDemo} onAccount={() => setAuthScreen("account")} theme={theme} onToggleTheme={toggleTheme} />;
  }
  return <AuthView theme={theme} onToggleTheme={toggleTheme} onBack={() => setAuthScreen("landing")} onDemo={enterDemo} onAuthenticated={handleAuthenticated} />;
}
