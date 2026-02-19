import { GitHubIcon } from "../icons/GitHubIcon";

export function PipelineDemo() {
  return (
    <div className="relative mt-12 mb-24">
      <div className="bg-white/50 dark:bg-surface-dark/60 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-3xl p-8 md:p-16 relative overflow-hidden glow-box shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent opacity-50" />
        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-4 max-w-5xl mx-auto min-h-[400px]">
          {/* New PR card */}
          <div className="relative group">
            <div className="w-32 h-32 md:w-40 md:h-40 bg-white dark:bg-black border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl flex flex-col items-center justify-center relative z-20 animate-float transition-all duration-300 group-hover:border-purple-500/50 group-hover:shadow-[0_0_30px_-5px_rgba(139,92,246,0.3)]">
              <GitHubIcon className="w-12 h-12 md:w-16 md:h-16 text-gray-900 dark:text-white" />
              <span className="mt-3 text-sm font-semibold text-gray-600 dark:text-gray-400 font-mono">
                New PR
              </span>
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500" />
            </span>
          </div>

          {/* Arrow (desktop) */}
          <div className="hidden lg:flex flex-col items-center justify-center flex-1 mx-4 relative h-12">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-[2px] bg-gradient-to-r from-gray-300 via-purple-500 to-gray-300 dark:from-gray-700 dark:via-purple-500 dark:to-gray-700 opacity-50" />
            </div>
            <svg className="w-full h-8 absolute text-purple-500 animate-pulse" preserveAspectRatio="none" viewBox="0 0 100 20">
              <path className="arrow-path opacity-80" d="M0 10 L100 10" stroke="currentColor" strokeDasharray="4 2" strokeWidth="2" />
              <polygon fill="currentColor" points="95,5 100,10 95,15" />
            </svg>
          </div>
          {/* Arrow (mobile) */}
          <div className="lg:hidden h-16 w-[2px] bg-gradient-to-b from-gray-300 via-purple-500 to-gray-300 dark:from-gray-700 dark:via-purple-500 dark:to-gray-700" />

          {/* Auto-Run App card */}
          <div className="glass-card rounded-xl p-6 w-full max-w-[280px] flex flex-col gap-4 relative z-20 transition-transform hover:-translate-y-1 duration-300">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-500">
                <span className="material-icons text-sm">play_arrow</span>
              </div>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                Auto-Run App
              </span>
            </div>
            <div className="space-y-2">
              <div className="h-2 bg-gray-200 dark:bg-white/10 rounded-sm w-3/4 animate-pulse" />
              <div className="h-2 bg-gray-200 dark:bg-white/10 rounded-sm w-1/2 animate-pulse delay-75" />
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-2 pt-2 border-t border-gray-200 dark:border-white/5 flex justify-between">
              <span>Status:</span>
              <span className="text-green-500">Running...</span>
            </div>
          </div>

          {/* Arrow (desktop) */}
          <div className="hidden lg:flex flex-col items-center justify-center flex-1 mx-4 relative h-12">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-[2px] bg-gradient-to-r from-gray-300 via-blue-500 to-gray-300 dark:from-gray-700 dark:via-blue-500 dark:to-gray-700 opacity-50" />
            </div>
            <svg className="w-full h-8 absolute text-blue-500 animate-pulse" preserveAspectRatio="none" viewBox="0 0 100 20">
              <path className="arrow-path opacity-80" d="M0 10 L100 10" stroke="currentColor" strokeDasharray="4 2" strokeWidth="2" />
              <polygon fill="currentColor" points="95,5 100,10 95,15" />
            </svg>
          </div>
          {/* Arrow (mobile) */}
          <div className="lg:hidden h-16 w-[2px] bg-gradient-to-b from-gray-300 via-blue-500 to-gray-300 dark:from-gray-700 dark:via-blue-500 dark:to-gray-700" />

          {/* Generate & Run Tests card */}
          <div className="glass-card rounded-xl p-6 w-full max-w-[280px] flex flex-col gap-4 relative z-20 transition-transform hover:-translate-y-1 duration-300">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-500">
                <span className="material-icons text-sm">science</span>
              </div>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                Generate &amp; Run Tests
              </span>
            </div>
            <div className="bg-gray-900/50 rounded-sm p-2 font-mono text-[10px] text-green-400 overflow-hidden leading-relaxed border border-white/5">
              &gt; analyzing diff...<br />
              &gt; generating spec...<br />
              &gt; 3 edge cases found
            </div>
          </div>
        </div>

        {/* Curved arrow (desktop) */}
        <div className="absolute inset-0 pointer-events-none z-0 hidden lg:block">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 400">
            <defs>
              <linearGradient id="grad1" x1="0%" x2="100%" y1="0%" y2="0%">
                <stop offset="0%" style={{ stopColor: "#3b82f6", stopOpacity: 0 }} />
                <stop offset="50%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
                <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 0 }} />
              </linearGradient>
              <marker id="arrowhead" markerHeight="7" markerWidth="10" orient="auto" refX="9" refY="3.5">
                <polygon fill="#8B5CF6" points="0 0, 10 3.5, 0 7" />
              </marker>
            </defs>
            <path
              className="opacity-60 arrow-path"
              d="M 850 260 C 850 380, 150 380, 150 260"
              fill="none"
              markerEnd="url(#arrowhead)"
              stroke="url(#grad1)"
              strokeDasharray="8 8"
              strokeWidth="2"
            />
          </svg>
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-background-light dark:bg-background-dark border border-gray-200 dark:border-white/10 px-4 py-1.5 rounded-full shadow-lg">
            <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 whitespace-nowrap">
              <span className="material-icons text-xs">auto_fix_high</span>
              commits fixes + report
            </div>
          </div>
        </div>

        {/* Mobile bottom label */}
        <div className="lg:hidden mt-8 flex flex-col items-center">
          <div className="h-12 w-[2px] bg-gradient-to-b from-gray-300 to-transparent dark:from-gray-700" />
          <div className="bg-background-light dark:bg-background-dark border border-gray-200 dark:border-white/10 px-4 py-2 rounded-full shadow-lg mt-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
              <span className="material-icons text-xs">replay</span>
              Repeats on every commit
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
