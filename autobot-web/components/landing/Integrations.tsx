import { GitHubIcon } from "../icons/GitHubIcon";

export function Integrations() {
  return (
    <div className="text-center">
      <p className="text-sm font-mono text-gray-500 dark:text-gray-500 mb-8 uppercase tracking-widest">
        Integrating seamlessly with
      </p>
      <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
        <div className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white">
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          GitLab
        </div>
        <div className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white">
          <GitHubIcon className="h-6 w-6" />
          GitHub
        </div>
        <div className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white">
          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.36 2.003a20.005 20.005 0 00-7.36 0C7.23 2.563 2 7.093 2 12c0 4.907 5.23 9.437 10 9.997 1.623.19 3.277.19 4.9 0 4.77-.56 10-5.09 10-9.997 0-4.907-5.23-9.437-10-9.997zM12 18a6 6 0 110-12 6 6 0 010 12z" />
          </svg>
          BitBucket
        </div>
      </div>
    </div>
  );
}
