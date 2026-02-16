import { loadLegacyPage } from "../lib/legacyPage";

export default function LandingPage() {
  const page = loadLegacyPage("index.html");
  return (
    <>
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: page.headHtml }} />
      <div
        className={page.bodyClassName}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: page.bodyHtml }}
      />
    </>
  );
}
