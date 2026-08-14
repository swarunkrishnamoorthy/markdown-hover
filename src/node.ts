// Node-facing barrel: bundled to dist/core.node.mjs for scripts and tests.
export { extractGlossary, parseGlossaryBody, buildTermIndex } from "./glossary";
export { deriveTerms, harvestAbbrTags, harvestGlossaryTable } from "./derive-terms";
export { renderDocument } from "./render";
export { partitionDismissed, dismissKey } from "./dismissed";
export {
  dismissedFilePath,
  readDismissed,
  readDismissedTerms,
  addDismissed,
  removeDismissed,
} from "./dismissed-store";
export type { DismissedEntry } from "./dismissed-store";
export type { PayloadTerm, RenderedDoc, RenderOptions, TermSource } from "./render";
export type { GlossaryTerm } from "./term-index";
