// 独立于 Monaco 的扩展名映射。这样首屏只判断文件类型时不会连带加载编辑器主包和 worker。
const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
  xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml',
  py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php',
  sql: 'sql', vue: 'vue', svelte: 'svelte', swift: 'swift', kt: 'kotlin',
  dart: 'dart', lua: 'lua', toml: 'ini', ini: 'ini', diff: 'diff'
}

export function languageForFile(name: string): string {
  const base = name.toLowerCase()
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile'
  if (['makefile', 'cmakelists.txt'].includes(base)) return 'makefile'
  if (base === 'gitignore' || base === 'npmrc' || base === 'editorconfig') return 'plaintext'
  const dot = base.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return EXT_LANGUAGE[base.slice(dot + 1)] ?? 'plaintext'
}
