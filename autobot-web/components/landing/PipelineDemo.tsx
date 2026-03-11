export function PipelineDemo() {
  return (
    <div className="relative mt-12 mb-24">
      <div className="bg-surface-dark border border-border-dark p-8 md:p-16 relative overflow-hidden glow-box">
        <div className="absolute inset-0 scanlines" />
        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-4 max-w-5xl mx-auto min-h-[400px]">
          {/* Website box card */}
          <div className="relative group">
            <div className="w-32 h-32 md:w-40 md:h-40 bg-black border border-accent-cyan/30 flex flex-col items-center justify-center relative z-20 animate-float transition-all duration-300 group-hover:border-accent-cyan group-hover:shadow-[0_0_20px_-5px_rgba(34,211,238,0.3)]">
              <span className="material-icons text-5xl md:text-6xl text-accent-cyan">
                web
              </span>
              <span className="mt-3 text-sm font-bold text-gray-400 font-mono">
                Your App
              </span>
            </div>
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-accent-green" />
            </span>
          </div>

          {/* Arrow (desktop) */}
          <div className="hidden lg:flex flex-col items-center justify-center flex-1 mx-4 relative h-12">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-px bg-accent-cyan/30" />
            </div>
            <svg className="w-full h-8 absolute text-accent-cyan" preserveAspectRatio="none" viewBox="0 0 100 20">
              <path d="M0 10 L100 10" stroke="currentColor" strokeDasharray="4 2" strokeWidth="2" opacity="0.8" />
              <polygon fill="currentColor" points="95,5 100,10 95,15" />
            </svg>
          </div>
          {/* Arrow (mobile) */}
          <div className="lg:hidden h-16 w-px bg-accent-cyan/30" />

          {/* Auto-Run App card */}
          <div className="glass-card p-6 w-full max-w-[280px] flex flex-col gap-4 relative z-20 transition-transform hover:-translate-y-1 duration-300">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 flex items-center justify-center text-accent-cyan">
                <span className="material-icons text-sm">play_arrow</span>
              </div>
              <span className="text-sm font-bold text-gray-200 font-mono">
                Auto-Run
              </span>
            </div>
            <div className="space-y-2">
              <div className="h-2 bg-accent-cyan/10 w-3/4 animate-pulse" />
              <div className="h-2 bg-accent-cyan/10 w-1/2 animate-pulse delay-75" />
            </div>
            <div className="text-xs text-gray-500 font-mono mt-2 pt-2 border-t border-border-dark flex justify-between">
              <span>status:</span>
              <span className="text-accent-green">running...</span>
            </div>
          </div>

          {/* Report card */}
          <div className="hidden lg:flex flex-col items-center justify-center flex-1 mx-4 relative h-12">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full h-px bg-accent-cyan/30" />
            </div>
            <svg className="w-full h-8 absolute text-accent-cyan" preserveAspectRatio="none" viewBox="0 0 100 20">
              <path d="M0 10 L100 10" stroke="currentColor" strokeDasharray="4 2" strokeWidth="2" opacity="0.8" />
              <polygon fill="currentColor" points="95,5 100,10 95,15" />
            </svg>
          </div>
          <div className="lg:hidden h-16 w-px bg-accent-cyan/30" />

          <div className="glass-card p-6 w-full max-w-[280px] flex flex-col gap-4 relative z-20 transition-transform hover:-translate-y-1 duration-300">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 flex items-center justify-center text-accent-green">
                <span className="material-icons text-sm">assessment</span>
              </div>
              <span className="text-sm font-bold text-gray-200 font-mono">
                QA Report
              </span>
            </div>
            <div className="bg-black/50 p-2 font-mono text-[10px] text-accent-green overflow-hidden leading-relaxed border border-border-dark">
              &gt; 4 pages tested<br />
              &gt; score: 92/100<br />
              &gt; 0 blocking issues<br />
              <span className="text-red-400">&gt; dashboard button error</span>
            </div>
          </div>
        </div>

        {/* Curved arrow (desktop) */}
        <div className="absolute inset-0 pointer-events-none z-0 hidden lg:block">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 400">
            <defs>
              <marker id="arrowhead" markerHeight="7" markerWidth="10" orient="auto" refX="9" refY="3.5">
                <polygon fill="#22d3ee" points="0 0, 10 3.5, 0 7" />
              </marker>
            </defs>
            <path
              className="opacity-40"
              d="M 850 260 C 850 380, 150 380, 150 260"
              fill="none"
              markerEnd="url(#arrowhead)"
              stroke="#22d3ee"
              strokeDasharray="8 8"
              strokeWidth="2"
            />
          </svg>
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-background-dark border border-border-dark px-4 py-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-accent-cyan whitespace-nowrap font-mono">
              <span className="material-icons text-xs">auto_fix_high</span>
              reports to you asap
            </div>
          </div>
        </div>

        {/* Mobile bottom label */}
        <div className="lg:hidden mt-8 flex flex-col items-center">
          <div className="h-12 w-px bg-accent-cyan/20" />
          <div className="bg-background-dark border border-border-dark px-4 py-2 mt-2">
            <div className="flex items-center gap-2 text-xs font-bold text-accent-cyan font-mono">
              <span className="material-icons text-xs">replay</span>
              reports to you asap
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
