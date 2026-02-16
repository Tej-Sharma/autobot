"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SessionResponse = {
  authenticated: boolean;
};

const authReturnPath = "/dashboard";

export default function LandingPage() {
  const [checkingSession, setCheckingSession] = useState(true);
  const authUrl = useMemo(
    () => `/api/auth/github?returnTo=${encodeURIComponent(authReturnPath)}`,
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const session = (await response.json()) as SessionResponse;
        if (!cancelled && session.authenticated) {
          window.location.replace("/dashboard");
          return;
        }
      } catch {
        // Show landing if session check fails.
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    };

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">AutoBot</div>
        <div className="links">
          <a
            className="muted"
            href="https://x.com/taayjuss"
            target="_blank"
            rel="noopener noreferrer"
          >
            X
          </a>
          <a
            className="muted"
            href="https://github.com/Tej-Sharma/autobot"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>

      <section className="panel">
        <h1 className="hero-title">
          Full-App QA on Every Pull Request
        </h1>
        <p className="hero-copy">
          Connect GitHub once, auto-run UI and backend checks on every PR, and
          see issues before merge.
        </p>
        <div className="hero-actions">
          <a className="button primary" href={authUrl}>
            Connect GitHub
          </a>
          <Link className="button" href="/dashboard">
            Open Dashboard
          </Link>
        </div>
        {checkingSession ? (
          <p className="muted" style={{ marginTop: 12 }}>
            Checking existing session...
          </p>
        ) : null}
      </section>

      <footer className="footer">
        <span>© 2026 Constella App, Inc.</span>
        <span className="muted">
          Backend APIs live in <code>autobot/src/consoleApi.ts</code>
        </span>
      </footer>
    </main>
  );
}
