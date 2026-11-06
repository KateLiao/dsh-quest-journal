// Quest Journal — Host plugin entry (Agent tools).
//
// Dependency-free by necessity: the loader resolves plugin modules with plain
// Node resolution from the profile, where `@deepseek-ai/*` packages are not
// visible. See lib/journal.mjs for the shared store/service.
//
// The web panel ships as the sibling `./web` entry plus the separate
// `dsh-client-ui-quest-journal` bundle, which owns the browser half.

export { apply, inject, name } from "./tools.js";
