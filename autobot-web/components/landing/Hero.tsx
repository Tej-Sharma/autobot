"use client";

import { useState } from "react";

interface HeroProps {
  onSubmitUrl: (url: string) => void;
  isLoading: boolean;
  error?: string | null;
}

export function Hero({ onSubmitUrl, isLoading, error }: HeroProps) {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const trimmed = url.trim();
    if (!trimmed) {
      setValidationError("Please enter a URL");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    } catch {
      setValidationError("Please enter a valid URL");
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setValidationError("URL must use http or https");
      return;
    }

    onSubmitUrl(parsed.href);
  }

  const displayError = validationError || error;

  return (
    <div className="text-center max-w-4xl mx-auto mb-20">
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 dark:text-white mb-6 leading-tight">
        Find Bugs Before
        <br />
        <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-transparent">
          Your Users Do
        </span>
      </h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
        AI-powered QA testing in 30 seconds. No signup required.
      </p>

      <form onSubmit={handleSubmit} className="max-w-xl mx-auto mb-6">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-accent-purple to-accent-blue rounded-full opacity-40 group-hover:opacity-60 blur transition-opacity duration-300" />
          <div className="relative flex items-center bg-white dark:bg-surface-dark rounded-full border border-gray-200 dark:border-border-dark overflow-hidden">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setValidationError(null);
              }}
              placeholder="https://your-app.com"
              className="flex-1 px-6 py-4 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none text-base"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading}
              className="mr-1.5 bg-gradient-to-r from-accent-purple to-accent-blue text-white px-6 py-3 rounded-full text-sm font-semibold hover:scale-105 transition-transform disabled:opacity-60 disabled:hover:scale-100 whitespace-nowrap flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Testing...
                </>
              ) : (
                "Test My App — Free"
              )}
            </button>
          </div>
        </div>

        {displayError && (
          <p className="mt-3 text-sm text-red-500 dark:text-red-400">{displayError}</p>
        )}
      </form>

      <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-base text-accent-purple">photo_camera</span>
          Screenshots + AI Analysis
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-base text-accent-blue">credit_card_off</span>
          No credit card
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-base text-green-500">bolt</span>
          Results in 60s
        </span>
      </div>
    </div>
  );
}
