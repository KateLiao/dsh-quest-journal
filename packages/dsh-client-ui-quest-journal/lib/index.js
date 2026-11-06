// Quest Journal — host half of the Web panel bundle.
//
// This package exists for its `dsh.client` manifest: the browser half
// (`lib/client.js`) registers the sidebar entry and the `main` panel. The HTTP
// routes it calls live in the `@deepseek-ai/dsh-quest-journal` package
// (`/quest-journal/*`), because that package already owns the SQLite journal and
// must stay dependency-free.
//
// Keeping an empty `apply` here gives the Loader a real row to mount, which is
// what makes DSH discover this package's client bundle.

export function apply() {}
