"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "../components/Navbar";
import { Hero } from "../components/landing/Hero";
import { PipelineDemo } from "../components/landing/PipelineDemo";
import { Integrations } from "../components/landing/Integrations";
import { HowItWorks } from "../components/landing/HowItWorks";
import { Footer } from "../components/Footer";

const AUTH_RETURN_PATH = "/dashboard";
const GITHUB_AUTH_TARGET = `/api/auth/github?returnTo=${encodeURIComponent(AUTH_RETURN_PATH)}`;

function startAuth() {
  window.location.href = GITHUB_AUTH_TARGET;
}

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/session", {
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => r.json())
      .then((session) => {
        if (session?.authenticated) {
          router.replace("/dashboard");
        }
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans transition-colors duration-300 min-h-screen flex flex-col">
      <Navbar onConnectGitHub={startAuth} />

      <main className="flex-grow relative overflow-hidden">
        <div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-gradient-to-b from-purple-500/10 to-transparent blur-[120px] pointer-events-none" />
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 relative z-10">
            <Hero onConnectGitHub={startAuth} />
            <PipelineDemo />
            <Integrations />
          </div>
        </div>

        <HowItWorks />
      </main>

      <Footer />
    </div>
  );
}
