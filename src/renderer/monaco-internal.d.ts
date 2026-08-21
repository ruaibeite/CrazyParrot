/**
 * Monaco intentionally hides ESM internals from its package exports. Vite
 * resolves them through the renderer alias, while these declarations let the
 * TypeScript build validate the same deliberate, size-conscious imports.
 */
declare module 'monaco-editor/esm/vs/editor/editor.api.js' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/languages/definitions/*/register.js' {}
declare module 'monaco-editor/esm/vs/language/json/monaco.contribution.js' {}
