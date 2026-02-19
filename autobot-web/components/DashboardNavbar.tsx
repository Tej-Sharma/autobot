"use client";

import Link from "next/link";
import { GitHubIcon } from "./icons/GitHubIcon";

interface DashboardNavbarProps {
  avatarUrl: string;
  login: string;
  onLogout: () => void;
}

export function DashboardNavbar({ avatarUrl, login, onLogout }: DashboardNavbarProps) {
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
          <div className="flex items-center space-x-4">
            <a
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
              href="https://github.com/Tej-Sharma/autobot"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Source on GitHub"
            >
              <GitHubIcon />
              <span className="hidden sm:inline">Open Source</span>
            </a>
            <div className="flex items-center gap-3">
              {avatarUrl && (
                <img
                  alt="user"
                  className="h-8 w-8 rounded-full ring-1 ring-purple-400/50"
                  src={avatarUrl}
                />
              )}
              {login && (
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300 hidden sm:inline font-mono">
                  @{login}
                </span>
              )}
            </div>
            <button
              onClick={onLogout}
              className="rounded-full border border-gray-300 dark:border-white/10 text-sm px-4 py-2 bg-white/80 dark:bg-surface-dark/80 hover:bg-gray-100 dark:hover:bg-white/10 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
