import { SlackIcon } from "../icons/SlackIcon";

function StepOneIllustration() {
  return (
    <div className="bg-surface-dark border border-border-dark p-8 aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern opacity-10" />
      <div className="relative z-10 w-full max-w-[300px] flex justify-center">
        <div className="flex gap-8 items-start relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-12 bg-accent-cyan/40" />
          <div className="absolute top-12 left-1/2 -translate-x-1/2 w-32 h-px bg-accent-cyan/40" />
          <div className="flex flex-col items-center pt-12">
            <div className="w-px h-8 bg-accent-cyan/40" />
            <div className="w-24 h-32 bg-black border border-accent-cyan/20 p-2 flex flex-col gap-2">
              <div className="w-full h-2 bg-accent-cyan/20" />
              <div className="flex gap-1">
                <div className="w-1/3 h-16 bg-accent-cyan/10" />
                <div className="w-2/3 space-y-1">
                  <div className="w-full h-2 bg-gray-800" />
                  <div className="w-3/4 h-2 bg-gray-800" />
                </div>
              </div>
            </div>
            <span className="mt-3 text-xs font-mono font-bold text-accent-cyan">
              frontend
            </span>
          </div>
          <div className="flex flex-col items-center pt-12">
            <div className="w-px h-8 bg-accent-amber/40" />
            <div className="w-24 h-32 bg-black border border-accent-amber/20 p-3 flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 border-2 border-dashed border-accent-amber/30 flex items-center justify-center">
                <div className="w-2 h-2 bg-accent-amber rounded-full" />
              </div>
              <div className="w-16 h-1.5 bg-accent-amber/20" />
              <div className="w-10 h-1.5 bg-accent-amber/20" />
            </div>
            <span className="mt-3 text-xs font-mono font-bold text-accent-amber">
              backend
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTwoIllustration() {
  return (
    <div className="bg-surface-dark border border-border-dark overflow-hidden aspect-[4/3] flex">
      <div className="w-1/2 border-r border-border-dark bg-black p-4 relative">
        <div className="absolute top-2 left-2 flex gap-1.5">
          <div className="w-2 h-2 bg-red-500" />
          <div className="w-2 h-2 bg-accent-amber" />
          <div className="w-2 h-2 bg-accent-green" />
        </div>
        <div className="mt-6 space-y-3 opacity-80">
          <div className="w-full h-8 bg-surface-dark border border-border-dark" />
          <div className="flex gap-2">
            <div className="w-1/3 h-20 bg-surface-dark border border-border-dark" />
            <div className="flex-1 h-20 bg-surface-dark border border-border-dark relative">
              <span className="material-icons absolute bottom-2 right-4 text-accent-cyan text-lg transform -rotate-12">
                near_me
              </span>
              <div className="absolute bottom-2 right-3 w-3 h-3 bg-accent-cyan/20 animate-ping" />
            </div>
          </div>
        </div>
      </div>
      <div className="w-1/2 bg-black p-4 font-mono text-[10px] text-gray-400 leading-relaxed overflow-hidden">
        <div className="flex justify-between text-gray-600 mb-2 border-b border-border-dark pb-1">
          <span>test_runner.sh</span>
          <span>bash</span>
        </div>
        <div className="space-y-1">
          <p>
            <span className="text-accent-cyan">&#10148;</span>{" "}
            <span className="text-accent-cyan">~</span> run_suite --api
          </p>
          <p className="text-gray-600">compiling...</p>
          <p>
            <span className="text-accent-green">&#10004;</span> auth endpoint
          </p>
          <p>
            <span className="text-accent-green">&#10004;</span> data validation
          </p>
          <p>
            <span className="text-accent-green">&#10004;</span> llm response check
          </p>
          <br />
          <p className="text-gray-500">&gt; all checks passed (142ms)</p>
          <div className="h-3 w-2 bg-accent-cyan animate-blink mt-1" />
        </div>
      </div>
    </div>
  );
}

function StepThreeIllustration() {
  return (
    <div className="bg-surface-dark border border-border-dark p-8 aspect-[4/3] flex flex-col items-center justify-center relative overflow-hidden group">
      <div className="relative mb-8">
        <div className="w-20 h-20 border-2 border-accent-green/30 flex items-center justify-center relative z-10">
          <span className="material-icons text-5xl text-accent-green">
            check_circle
          </span>
        </div>
        <div className="absolute inset-0 bg-accent-green/10 animate-ping" />
      </div>
      <div className="w-full max-w-[200px] h-px bg-border-dark mb-6" />
      <div className="flex gap-8">
        <div className="flex flex-col items-center gap-2 transform transition-transform group-hover:translate-y-[-2px]">
          <div className="w-12 h-12 bg-black border border-border-dark flex items-center justify-center">
            <span className="material-icons text-accent-cyan">web</span>
          </div>
          <span className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wide">
            report
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 transform transition-transform group-hover:translate-y-[-2px] delay-75">
          <div className="w-12 h-12 bg-black border border-border-dark flex items-center justify-center">
            <SlackIcon className="h-6 w-6 text-gray-400" />
          </div>
          <span className="text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wide">
            alert
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
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-4 font-mono">
          how it works
        </h2>
        <p className="text-gray-500 text-lg max-w-2xl mx-auto font-mono">
          from PR to verified code in three automated steps.
        </p>
      </div>

      {/* Step 01 */}
      <div className="flex flex-col items-center gap-12 lg:gap-24 mb-32">
        <div className="w-full max-w-lg lg:max-w-none lg:flex lg:flex-row lg:items-center lg:gap-24">
          <div className="flex-1 w-full mb-8 lg:mb-0 lg:order-2">
            <StepOneIllustration />
          </div>
          <div className="flex-1 space-y-4 lg:order-1">
            <div className="text-accent-cyan font-mono font-bold text-sm tracking-wider">
              Step 01
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight font-mono">
              fully analyzes your features
            </h3>
            <p className="text-gray-500 leading-relaxed text-base font-mono">
              The bot parses your codebase and the PR diff simultaneously. It
              identifies UI changes for frontend review and API modifications
              for backend logic verification.
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
            <div className="text-accent-amber font-mono font-bold text-sm tracking-wider">
              Step 02
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight font-mono">
              actually clicks through and tests your app
            </h3>
            <p className="text-gray-500 leading-relaxed text-base font-mono">
              For frontend, it spins up a headless browser to click through
              flows. For backend, it writes unit tests and verifies logic
              against LLM-predicted outputs.
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
            <div className="text-accent-green font-mono font-bold text-sm tracking-wider">
              Step 03
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight font-mono">
              reports results to your team
            </h3>
            <p className="text-gray-500 leading-relaxed text-base font-mono">
              Once validation is complete, you get a green checkmark on your PR.
              Reports are posted to GitHub and Slack so your team can merge
              with confidence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
