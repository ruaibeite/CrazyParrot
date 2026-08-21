// Monaco 环境配置：worker 加载 + 主题 + 语言映射。
// 不导入 monaco-editor 的聚合入口；它会把全部语言和语言服务 worker 都
// 打进安装包。预览只需要语法高亮，因此按需注册常用语言即可。
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/languages/definitions/javascript/register.js'
import 'monaco-editor/esm/vs/languages/definitions/typescript/register.js'
import 'monaco-editor/esm/vs/languages/definitions/markdown/register.js'
import 'monaco-editor/esm/vs/languages/definitions/css/register.js'
import 'monaco-editor/esm/vs/languages/definitions/html/register.js'
import 'monaco-editor/esm/vs/languages/definitions/xml/register.js'
import 'monaco-editor/esm/vs/languages/definitions/yaml/register.js'
import 'monaco-editor/esm/vs/languages/definitions/python/register.js'
import 'monaco-editor/esm/vs/languages/definitions/shell/register.js'
import 'monaco-editor/esm/vs/languages/definitions/cpp/register.js'
import 'monaco-editor/esm/vs/languages/definitions/rust/register.js'
import 'monaco-editor/esm/vs/languages/definitions/go/register.js'
import 'monaco-editor/esm/vs/languages/definitions/java/register.js'
import 'monaco-editor/esm/vs/languages/definitions/ruby/register.js'
import 'monaco-editor/esm/vs/languages/definitions/php/register.js'
import 'monaco-editor/esm/vs/languages/definitions/sql/register.js'
import 'monaco-editor/esm/vs/languages/definitions/scss/register.js'
import 'monaco-editor/esm/vs/languages/definitions/less/register.js'
import 'monaco-editor/esm/vs/languages/definitions/dockerfile/register.js'
import 'monaco-editor/esm/vs/languages/definitions/ini/register.js'
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js'

export { monaco }

self.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}

monaco.editor.defineTheme('crazyparrot-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0b1016',
    'editor.foreground': '#cbd4df',
    'editorLineNumber.foreground': '#3d4654',
    'editorLineNumber.activeForeground': '#8a95a3',
    'editorCursor.foreground': '#d9ff5b',
    'editor.selectionBackground': '#2b3a24',
    'editor.lineHighlightBackground': '#10161f',
    'editorIndentGuide.background': '#1c232d',
    'editorIndentGuide.activeBackground': '#2e3a48',
    'editorGutter.background': '#0b1016',
    'editorWidget.background': '#121820',
    'editorWidget.border': '#252c36',
    'scrollbarSlider.background': '#2a323d55',
    'scrollbarSlider.hoverBackground': '#3a455455',
    'diffEditor.insertedTextBackground': '#1d302266',
    'diffEditor.removedTextBackground': '#321e2166',
    'diffEditor.insertedLineBackground': '#1d302233',
    'diffEditor.removedLineBackground': '#321e2133',
    'diffEditor.diagonalFill': '#1c232d'
  }
})

monaco.editor.defineTheme('crazyparrot-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#f7f8fa',
    'editor.foreground': '#20252d',
    'editorLineNumber.foreground': '#a0a8b3',
    'editorLineNumber.activeForeground': '#5f6875',
    'editorCursor.foreground': '#3b4654',
    'editor.selectionBackground': '#cfe3f6',
    'editor.lineHighlightBackground': '#eff2f5',
    'editorIndentGuide.background': '#e1e5e9',
    'editorIndentGuide.activeBackground': '#c7cdd5',
    'editorGutter.background': '#f7f8fa',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d7dce3',
    'scrollbarSlider.background': '#97a2b055',
    'scrollbarSlider.hoverBackground': '#77849366',
    'diffEditor.insertedTextBackground': '#b8e0c980',
    'diffEditor.removedTextBackground': '#f3c5c680',
    'diffEditor.insertedLineBackground': '#dff2e633',
    'diffEditor.removedLineBackground': '#fae3e333',
    'diffEditor.diagonalFill': '#e8ebef'
  }
})

export function syncMonacoTheme(theme: 'dark' | 'light'): void {
  monaco.editor.setTheme(theme === 'light' ? 'crazyparrot-light' : 'crazyparrot-dark')
}
