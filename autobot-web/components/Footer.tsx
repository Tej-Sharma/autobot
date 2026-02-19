import { XIcon } from "./icons/XIcon";
import { GitHubIcon } from "./icons/GitHubIcon";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-white/10 bg-background-light dark:bg-background-dark py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          &copy; 2026 Constella App, Inc.
        </div>
        <div className="flex gap-6">
          <a
            className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            href="https://x.com/taayjuss"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="sr-only">X</span>
            <XIcon />
          </a>
          <a
            className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            href="https://github.com/Tej-Sharma/autobot"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="sr-only">Open Source on GitHub</span>
            <GitHubIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
