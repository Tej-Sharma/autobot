"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const email = localStorage.getItem("autobot_email");
    setIsLoggedIn(!!email);
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-border-dark bg-background-dark/90 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link href="/" className="flex items-center gap-2">
            <div className="text-xl font-bold tracking-tight text-accent-cyan flex items-center gap-2">
              <span className="material-icons text-accent-cyan text-xl">
                terminal
              </span>
              AutoBot
            </div>
          </Link>
          <div className="flex items-center space-x-4">
            {isLoggedIn ? (
              <Link
                href="/me"
                className="border border-accent-cyan text-accent-cyan px-4 py-1.5 text-sm font-bold hover:bg-accent-cyan/10 transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/"
                className="border border-accent-cyan text-accent-cyan px-4 py-1.5 text-sm font-bold hover:bg-accent-cyan/10 transition-colors"
              >
                Test Free
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
