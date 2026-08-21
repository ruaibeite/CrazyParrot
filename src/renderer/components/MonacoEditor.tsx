import { useEffect, useRef } from 'react'
import { monaco, syncMonacoTheme } from '../monaco'

interface EditorProps {
  value: string
  language: string
  readOnly?: boolean
  onChange?: (value: string) => void
  className?: string
  ariaLabel?: string
}

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 12.5,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: 20,
  scrollBeyondLastLine: false,
  scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
  padding: { top: 14, bottom: 14 },
  theme: 'crazyparrot-dark',
  tabSize: 2,
  contextmenu: false,
  wordWrap: 'off'
}

/** 受控 Monaco 编辑器。readOnly 变化与 language 变化实时生效。 */
export function MonacoEditor({ value, language, readOnly = false, onChange, className, ariaLabel }: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editor = monaco.editor.create(host, {
      ...EDITOR_OPTIONS,
      value,
      language,
      readOnly,
      ...(ariaLabel ? { ariaLabel } : {})
    })
    editorRef.current = editor
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue())
    })
    return () => {
      subscription.dispose()
      editor.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部 value 变化同步：内容相同时跳过，避免打断编辑光标
  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.getValue() !== value) editor.setValue(value)
  }, [value])

  useEffect(() => {
    const editor = editorRef.current
    if (editor) editor.updateOptions({ readOnly })
  }, [readOnly])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model) monaco.editor.setModelLanguage(model, language)
  }, [language])

  useEffect(() => {
    const sync=()=>syncMonacoTheme(document.documentElement.dataset.theme==='light'?'light':'dark')
    window.addEventListener('crazyparrot-theme-change',sync)
    sync()
    return ()=>window.removeEventListener('crazyparrot-theme-change',sync)
  }, [])

  return <div ref={hostRef} className={className} />
}

interface DiffProps {
  original: string
  modified: string
  language: string
  className?: string
}

/** 只读 Monaco Diff 编辑器，用于快照与当前文件对比。 */
export function MonacoDiff({ original, modified, language, className }: DiffProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const diff = monaco.editor.createDiffEditor(host, {
      ...EDITOR_OPTIONS,
      readOnly: true,
      renderSideBySide: true,
      renderOverviewRuler: false,
      ignoreTrimWhitespace: false,
      diffAlgorithm: 'advanced'
    })
    diffRef.current = diff
    diff.setModel({
      original: monaco.editor.createModel(original, language),
      modified: monaco.editor.createModel(modified, language)
    })
    return () => {
      diff.dispose()
      diffRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const diff = diffRef.current
    if (!diff) return
    const originalModel = diff.getOriginalEditor().getModel()
    const modifiedModel = diff.getModifiedEditor().getModel()
    if (originalModel && originalModel.getValue() !== original) originalModel.setValue(original)
    if (modifiedModel && modifiedModel.getValue() !== modified) modifiedModel.setValue(modified)
  }, [original, modified])

  useEffect(() => {
    const diff = diffRef.current
    if (!diff) return
    const originalModel = diff.getOriginalEditor().getModel()
    const modifiedModel = diff.getModifiedEditor().getModel()
    if (originalModel) monaco.editor.setModelLanguage(originalModel, language)
    if (modifiedModel) monaco.editor.setModelLanguage(modifiedModel, language)
  }, [language])

  useEffect(() => {
    const sync=()=>syncMonacoTheme(document.documentElement.dataset.theme==='light'?'light':'dark')
    window.addEventListener('crazyparrot-theme-change',sync)
    sync()
    return ()=>window.removeEventListener('crazyparrot-theme-change',sync)
  }, [])

  return <div ref={hostRef} className={className} />
}
