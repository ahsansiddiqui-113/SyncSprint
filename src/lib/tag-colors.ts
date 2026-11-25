/**
 * Label colors for tags. Tags always render with their name, so color is a
 * secondary cue (never the only one) — chips use a tinted fill + dot + dark text.
 */
export const TAG_COLORS = ["#7b68ee", "#3f7cb8", "#0f9d74", "#dd6b00", "#e44a8a", "#0891b2", "#a16207", "#64748b"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
