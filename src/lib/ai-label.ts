/** User-facing source label for AI output. Provider and model names stay internal. */
export function aiSourceLabel(provider: string, reason?: string) {
  if (provider !== "fallback") return "Suggested by AI";
  if (reason?.toLowerCase().includes("quota")) return "Daily AI limit reached — showing a basic suggestion";
  return "Basic suggestion (AI is unavailable right now)";
}
