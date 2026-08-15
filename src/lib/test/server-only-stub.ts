// Test-only stand-in for the `server-only` package.
//
// `server-only` exists to make a build FAIL when a server module is
// imported into a client bundle. It ships no Node-resolvable entry
// point, so any Vitest suite that imports a module guarded by it dies
// with "Cannot find package 'server-only'".
//
// vitest.config.ts aliases the specifier here so those modules can be
// unit tested. The production guard is untouched: Next.js still
// resolves the real package during the client build, so importing a
// server module from a client component remains a build error.
export {};
