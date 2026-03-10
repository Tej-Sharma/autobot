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
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white mb-6 leading-tight">
        Find Bugs Before
        <br />
        <span className="text-accent-cyan glow-text">
          Your Users Do
        </span>
      </h1>
      <p className="text-lg text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
        AI-powered QA testing in 30 seconds. No signup required.
      </p>

      <form onSubmit={handleSubmit} className="max-w-xl mx-auto mb-6">
        <div className="flex items-center border border-border-dark bg-surface-dark overflow-hidden">
          <span className="text-accent-cyan pl-4 pr-2 text-sm select-none">&gt;</span>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setValidationError(null);
            }}
            placeholder="https://your-app.com"
            className="flex-1 px-2 py-3.5 bg-transparent text-white placeholder-gray-600 outline-none text-sm"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="bg-accent-cyan text-black px-4 sm:px-6 py-3.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors disabled:opacity-60 disabled:hover:bg-accent-cyan whitespace-nowrap flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <span className="hidden sm:inline">Test My App</span>
                <span className="sm:hidden">Test</span>
              </>
            )}
          </button>
        </div>

        {displayError && (
          <p className="mt-3 text-sm text-red-400">{displayError}</p>
        )}
      </form>

      <div className="flex flex-wrap justify-center gap-6 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-sm text-accent-cyan">smart_toy</span>
          AI Uses Your App
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-sm text-accent-green">credit_card_off</span>
          No credit card
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-icons text-sm text-accent-amber">bolt</span>
          Results in 60s
        </span>
      </div>
    </div>
  );
}
