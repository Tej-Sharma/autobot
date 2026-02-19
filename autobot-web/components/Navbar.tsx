"use client";

import Link from "next/link";

export function Navbar({ onConnectGitHub }: { onConnectGitHub?: () => void }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200 dark:border-white/10 bg-background-light/80 dark:bg-background-dark/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="text-2xl font-bold tracking-tighter dark:text-white flex items-center gap-2">
              <span className="material-icons text-gray-800 dark:text-white">
                smart_toy
              </span>
              AutoBot
            </div>
          </Link>
          <div className="hidden md:flex space-x-8 text-sm font-medium text-gray-600 dark:text-gray-400">
            <a className="hover:text-gray-900 dark:hover:text-white transition-colors" href="#">
              Product
            </a>
            <a className="hover:text-gray-900 dark:hover:text-white transition-colors" href="#">
              Integration
            </a>
            <a className="hover:text-gray-900 dark:hover:text-white transition-colors" href="#">
              Pricing
            </a>
            <a className="hover:text-gray-900 dark:hover:text-white transition-colors" href="#">
              Docs
            </a>
          </div>
          <div className="flex items-center space-x-4">
            <a
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              href="https://github.com/Tej-Sharma/autobot"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Source on GitHub"
            >
              <span className="hidden sm:inline">Open Source</span>
            </a>
            <button
              onClick={onConnectGitHub}
              className="bg-black dark:bg-white text-white dark:text-black px-4 py-2 rounded-full text-sm font-semibold hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
              type="button"
            >
              Connect GitHub now
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
