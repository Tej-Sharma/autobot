import fs from "node:fs";
import path from "node:path";

export type LegacyPage = {
  headHtml: string;
  bodyHtml: string;
  bodyClassName: string;
};

const legacyCache = new Map<string, LegacyPage>();

const extractTagContent = (source: string, tag: "head" | "body"): string => {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = source.match(pattern);
  return match?.[1] ?? "";
};

const extractBodyClassName = (source: string): string => {
  const bodyOpen = source.match(/<body([^>]*)>/i)?.[1] ?? "";
  const classMatch = bodyOpen.match(/class=["']([^"']*)["']/i);
  return classMatch?.[1] ?? "";
};

export const loadLegacyPage = (
  fileName: "index.html" | "dashboard.html",
): LegacyPage => {
  const cached = legacyCache.get(fileName);
  if (cached) return cached;

  const filePath = path.join(process.cwd(), "legacy", fileName);
  const rawHtml = fs.readFileSync(filePath, "utf8");
  const page = {
    headHtml: extractTagContent(rawHtml, "head"),
    bodyHtml: extractTagContent(rawHtml, "body"),
    bodyClassName: extractBodyClassName(rawHtml),
  };

  legacyCache.set(fileName, page);
  return page;
};
