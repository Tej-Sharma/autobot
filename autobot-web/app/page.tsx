"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "../components/Navbar";
import { Hero } from "../components/landing/Hero";
import { PipelineDemo } from "../components/landing/PipelineDemo";
import { Integrations } from "../components/landing/Integrations";
import { HowItWorks } from "../components/landing/HowItWorks";
import { Footer } from "../components/Footer";

export default function LandingPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmitUrl(url: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/qa/try", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError("Rate limit reached. Please try again tomorrow.");
        } else {
          setError(data.error || "Something went wrong. Please try again.");
        }
        return;
      }

      router.push(`/run/${data.jobId}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans transition-colors duration-300 min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative overflow-hidden">
        <div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[600px] bg-gradient-to-b from-purple-500/10 to-transparent blur-[120px] pointer-events-none" />
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 relative z-10">
            <Hero
              onSubmitUrl={handleSubmitUrl}
              isLoading={isSubmitting}
              error={error}
            />
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
