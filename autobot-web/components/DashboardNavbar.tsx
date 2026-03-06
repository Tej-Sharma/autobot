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
    <nav className="sticky top-0 z-50 border-b border-border-dark bg-background-dark/90 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link href="/" className="flex items-center gap-2">
            <div className="text-xl font-bold tracking-tight text-accent-cyan flex items-center gap-2 font-mono">
              <span className="material-icons text-accent-cyan text-xl">
                terminal
              </span>
              autobot
            </div>
          </Link>
          <div className="flex items-center space-x-4">
            <a
              className="inline-flex items-center gap-2 text-sm font-mono text-gray-500 hover:text-accent-cyan transition-colors"
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
                  className="h-8 w-8 border border-accent-cyan/30"
                  src={avatarUrl}
                />
              )}
              {login && (
                <span className="text-sm font-mono text-gray-400 hidden sm:inline">
                  @{login}
                </span>
              )}
            </div>
            <button
              onClick={onLogout}
              className="border border-border-dark text-sm px-4 py-1.5 font-mono text-gray-400 hover:text-accent-cyan hover:border-accent-cyan/30 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
