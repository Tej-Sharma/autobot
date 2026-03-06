import { XIcon } from "./icons/XIcon";
import { GitHubIcon } from "./icons/GitHubIcon";

export function Footer() {
  return (
    <footer className="border-t border-border-dark bg-background-dark py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-xs text-gray-600 font-mono">
          &copy; 2026 constella app, inc.
        </div>
        <div className="flex gap-6">
          <a
            className="text-gray-600 hover:text-accent-cyan transition-colors"
            href="https://x.com/taayjuss"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="sr-only">X</span>
            <XIcon />
          </a>
          <a
            className="text-gray-600 hover:text-accent-cyan transition-colors"
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
