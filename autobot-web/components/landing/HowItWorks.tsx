import { GitHubIcon } from "../icons/GitHubIcon";
import { SlackIcon } from "../icons/SlackIcon";

function StepOneIllustration() {
  return (
    <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-2xl p-8 aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden shadow-lg">
      <div className="absolute inset-0 bg-grid-pattern opacity-10" />
      <div className="relative z-10 w-full max-w-[300px] flex justify-center">
        <div className="flex gap-8 items-start relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-12 bg-gradient-to-b from-gray-300 to-purple-500 dark:from-gray-700 dark:to-accent-purple" />
          <div className="absolute top-12 left-1/2 -translate-x-1/2 w-32 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 dark:from-accent-blue dark:to-accent-purple" />
          <div className="flex flex-col items-center pt-12">
            <div className="w-0.5 h-8 bg-blue-500 dark:bg-accent-blue" />
            <div className="w-24 h-32 bg-gray-50 dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-900/30 p-2 shadow-sm flex flex-col gap-2">
              <div className="w-full h-2 bg-blue-100 dark:bg-blue-900/40 rounded-sm" />
              <div className="flex gap-1">
                <div className="w-1/3 h-16 bg-blue-50 dark:bg-blue-900/20 rounded-sm" />
                <div className="w-2/3 space-y-1">
                  <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-sm" />
                  <div className="w-3/4 h-2 bg-gray-200 dark:bg-gray-700 rounded-sm" />
                </div>
              </div>
            </div>
            <span className="mt-3 text-xs font-mono font-medium text-blue-600 dark:text-blue-400">
              Frontend UI
            </span>
          </div>
          <div className="flex flex-col items-center pt-12">
            <div className="w-0.5 h-8 bg-purple-500 dark:bg-accent-purple" />
            <div className="w-24 h-32 bg-gray-50 dark:bg-gray-800 rounded-lg border border-purple-200 dark:border-purple-900/30 p-3 shadow-sm flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-purple-300 dark:border-purple-700 flex items-center justify-center">
                <div className="w-2 h-2 bg-purple-500 rounded-full" />
              </div>
              <div className="w-16 h-1.5 bg-purple-100 dark:bg-purple-900/40 rounded-full" />
              <div className="w-10 h-1.5 bg-purple-100 dark:bg-purple-900/40 rounded-full" />
            </div>
            <span className="mt-3 text-xs font-mono font-medium text-purple-600 dark:text-purple-400">
              Backend API
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTwoIllustration() {
  return (
    <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-2xl overflow-hidden shadow-lg aspect-[4/3] flex">
      <div className="w-1/2 border-r border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-gray-900/50 p-4 relative">
        <div className="absolute top-2 left-2 flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <div className="w-2 h-2 rounded-full bg-yellow-400" />
          <div className="w-2 h-2 rounded-full bg-green-400" />
        </div>
        <div className="mt-6 space-y-3 opacity-80">
          <div className="w-full h-8 bg-white dark:bg-gray-800 rounded-sm shadow-sm border border-gray-100 dark:border-gray-700" />
          <div className="flex gap-2">
            <div className="w-1/3 h-20 bg-white dark:bg-gray-800 rounded-sm shadow-sm border border-gray-100 dark:border-gray-700" />
            <div className="flex-1 h-20 bg-white dark:bg-gray-800 rounded-sm shadow-sm border border-gray-100 dark:border-gray-700 relative">
              <span className="material-icons absolute bottom-2 right-4 text-black dark:text-white text-lg drop-shadow-md transform -rotate-12">
                near_me
              </span>
              <div className="absolute bottom-2 right-3 w-3 h-3 bg-black/10 dark:bg-white/10 rounded-full animate-ping" />
            </div>
          </div>
        </div>
      </div>
      <div className="w-1/2 bg-[#1e1e1e] p-4 font-mono text-[10px] text-gray-300 leading-relaxed overflow-hidden">
        <div className="flex justify-between text-gray-500 mb-2 border-b border-gray-700 pb-1">
          <span>test_runner.sh</span>
          <span>bash</span>
        </div>
        <div className="space-y-1">
          <p>
            <span className="text-purple-400">&#10148;</span>{" "}
            <span className="text-blue-400">~</span> run_suite --api
          </p>
          <p className="text-gray-500">Compiling...</p>
          <p>
            <span className="text-green-400">&#10004;</span> Auth Endpoint
          </p>
          <p>
            <span className="text-green-400">&#10004;</span> Data Validation
          </p>
          <p>
            <span className="text-green-400">&#10004;</span> LLM Response Check
          </p>
          <br />
          <p className="text-gray-400">&gt; All checks passed (142ms)</p>
          <div className="h-3 w-2 bg-gray-500 animate-pulse mt-1" />
        </div>
      </div>
    </div>
  );
}

function StepThreeIllustration() {
  return (
    <div className="bg-white dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-2xl p-8 aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden shadow-lg group">
      <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-50" />
      <div className="relative mb-8">
        <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center relative z-10">
          <span className="material-icons text-5xl text-green-500">
            check_circle
          </span>
        </div>
        <div className="absolute inset-0 bg-green-400/20 rounded-full animate-ping" />
      </div>
      <div className="w-full max-w-[200px] h-px bg-gradient-to-r from-transparent via-gray-300 dark:via-gray-700 to-transparent mb-6" />
      <div className="flex gap-8">
        <div className="flex flex-col items-center gap-2 transform transition-transform group-hover:translate-y-[-2px]">
          <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center border border-gray-200 dark:border-gray-700 shadow-sm">
            <GitHubIcon className="h-6 w-6 text-gray-800 dark:text-white" />
          </div>
          <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wide">
            Report
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 transform transition-transform group-hover:translate-y-[-2px] delay-75">
          <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center border border-gray-200 dark:border-gray-700 shadow-sm">
            <SlackIcon className="h-6 w-6 text-gray-800 dark:text-white" />
          </div>
          <span className="text-[10px] font-mono font-medium text-gray-500 uppercase tracking-wide">
            Alert
          </span>
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-32 mb-24">
      <div className="text-center mb-20">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-gray-900 dark:text-white mb-4">
          How it works
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto">
          From PR to verified code in three automated steps.
        </p>
      </div>

      {/* Step 01 */}
      <div className="flex flex-col items-center gap-12 lg:gap-24 mb-32">
        <div className="w-full max-w-lg lg:max-w-none lg:flex lg:flex-row lg:items-center lg:gap-24">
          <div className="flex-1 w-full mb-8 lg:mb-0 lg:order-2">
            <StepOneIllustration />
          </div>
          <div className="flex-1 space-y-4 lg:order-1">
            <div className="text-accent-blue font-mono font-semibold text-sm tracking-wider uppercase">
              Step 01
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              Fully analyzes your features automatically
            </h3>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg">
              The bot parses your codebase and the PR diff simultaneously. It
              identifies UI changes for frontend review and API modifications
              for backend logic verification, creating a comprehensive testing
              strategy.
            </p>
          </div>
        </div>
      </div>

      {/* Step 02 */}
      <div className="flex flex-col items-center gap-12 lg:gap-24 mb-32">
        <div className="w-full max-w-lg lg:max-w-none lg:flex lg:flex-row lg:items-center lg:gap-24">
          <div className="flex-1 w-full mb-8 lg:mb-0">
            <StepTwoIllustration />
          </div>
          <div className="flex-1 space-y-4">
            <div className="text-accent-purple font-mono font-semibold text-sm tracking-wider uppercase">
              Step 02
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              Generates visual tests that click through or execute code
            </h3>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg">
              For frontend, it spins up a headless browser to click through
              flows. For backend, it writes unit tests and verifies logic
              against LLM-predicted outputs to ensure robust functionality.
            </p>
          </div>
        </div>
      </div>

      {/* Step 03 */}
      <div className="flex flex-col items-center gap-12 lg:gap-24">
        <div className="w-full max-w-lg lg:max-w-none lg:flex lg:flex-row lg:items-center lg:gap-24">
          <div className="flex-1 w-full mb-8 lg:mb-0 lg:order-2">
            <StepThreeIllustration />
          </div>
          <div className="flex-1 space-y-4 lg:order-1">
            <div className="text-green-500 font-mono font-semibold text-sm tracking-wider uppercase">
              Step 03
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white leading-tight">
              Quality tests visual outputs and reports to your team
            </h3>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-lg">
              Once validation is complete, you get a green checkmark on your PR.
              Detailed reports are automatically posted to GitHub and sent to
              Slack so your team can merge with confidence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
