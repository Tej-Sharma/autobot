"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { Navbar } from "../components/Navbar";
import { Hero } from "../components/landing/Hero";
import { PipelineDemo } from "../components/landing/PipelineDemo";
// import { Integrations } from "../components/landing/Integrations";
import { HowItWorks } from "../components/landing/HowItWorks";
import { Footer } from "../components/Footer";

export default function LandingPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmitUrl(url: string) {
    setIsSubmitting(true);
    setError(null);
    posthog.capture("free_test_submitted", { url });

    // 1-free-run-per-URL gate: check localStorage
    try {
      const testedUrls: Record<string, string> = JSON.parse(
        localStorage.getItem("autobot_tested_urls") || "{}",
      );
      const hostname = new URL(url).hostname;
      if (testedUrls[hostname]) {
        posthog.capture("free_test_blocked_repeat", { url, hostname });
        setError(
          `You've already tested ${hostname}. Upgrade to Pro for unlimited testing.`,
        );
        setIsSubmitting(false);
        return;
      }
    } catch {
      // localStorage not available, continue
    }

    try {
      const res = await fetch("/api/qa/try", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          posthog.capture("free_test_rate_limited", { url });
          setError("Rate limit reached. Please try again tomorrow.");
        } else {
          posthog.capture("free_test_error", { url, error: data.error });
          setError(data.error || "Something went wrong. Please try again.");
        }
        return;
      }

      // Mark URL as tested
      try {
        const testedUrls: Record<string, string> = JSON.parse(
          localStorage.getItem("autobot_tested_urls") || "{}",
        );
        const hostname = new URL(url).hostname;
        testedUrls[hostname] = data.jobId;
        localStorage.setItem("autobot_tested_urls", JSON.stringify(testedUrls));
      } catch {
        // localStorage not available, continue
      }

      posthog.capture("free_test_started", { url, job_id: data.jobId });
      router.push(`/run/${data.jobId}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="bg-background-dark text-gray-200 antialiased font-mono min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative overflow-hidden">
        <div>
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 relative z-10">
            <Hero
              onSubmitUrl={handleSubmitUrl}
              isLoading={isSubmitting}
              error={error}
            />
            <PipelineDemo />
            {/* <Integrations /> */}
          </div>
        </div>

        <HowItWorks />
      </main>

      <Footer />
    </div>
  );
}
