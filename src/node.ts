// Node-facing barrel: bundled to dist/core.node.mjs for scripts and tests.
export { extractGlossary, parseGlossaryBody, buildTermIndex } from "./glossary";
export { deriveTerms, harvestAbbrTags, harvestGlossaryTable } from "./derive-terms";
export { renderDocument } from "./render";
export type { PayloadTerm, RenderedDoc, TermSource } from "./render";
export type { GlossaryTerm } from "./term-index";
