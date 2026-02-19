"use client";

export function Hero({ onConnectGitHub }: { onConnectGitHub: () => void }) {
  return (
    <div className="text-center max-w-4xl mx-auto mb-20">
      <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 dark:text-white mb-6 leading-tight">
        Full Testing Your App <br />
        <span className="text-gray-500 dark:text-gray-400 font-medium">
          On Each PR
        </span>
      </h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
        Automatically clicks through your frontend UI and generates &amp; runs
        backend tests to do full QA testing on each PR.
      </p>
      <div className="flex flex-col sm:flex-row justify-center gap-4">
        <button
          onClick={onConnectGitHub}
          className="bg-black dark:bg-white text-white dark:text-black px-8 py-4 rounded-full text-base font-semibold hover:bg-gray-800 dark:hover:bg-gray-200 transition-all transform hover:scale-105 flex items-center justify-center gap-2"
        >
          Connect GitHub now
          <span className="material-icons text-sm">download</span>
        </button>
        <button
          className="bg-gray-200 dark:bg-white/10 text-gray-900 dark:text-white border border-gray-300 dark:border-white/10 px-8 py-4 rounded-full text-base font-semibold hover:bg-gray-300 dark:hover:bg-white/20 transition-all"
          type="button"
        >
          View Demo
        </button>
      </div>
    </div>
  );
}
