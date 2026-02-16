import { loadLegacyPage } from "../../lib/legacyPage";

export default function DashboardPage() {
  const page = loadLegacyPage("dashboard.html");
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
