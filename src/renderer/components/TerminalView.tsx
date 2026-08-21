import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import type { AgentEvent } from '../../shared/types'
import { nextTerminalWrite } from '../../shared/events'

/** 固定可视行数：xterm 自带滚动（scrollback），高度恒定避免 fit 反馈循环 */
const ROWS = 10
const terminalTheme=()=>document.documentElement.dataset.theme==='light'
  ? { background: '#f8f9fb', foreground: '#2c333c', cursor: '#3f4a58', selectionBackground: '#dbe6f1' }
  : { background: '#080b0f', foreground: '#9ea9b5', cursor: '#d9ff5b', selectionBackground: '#2b333e' }

/**
 * 渲染单个 terminal 事件（pty 原始输出，含 ANSI 转义）。
 * 事件 message 是累积文本（shared/events.ts 按类型合并）：挂载时全量重放，
 * 之后 message 变长时只写增量；若内容不匹配（新会话块）则清屏重写。
 */
export function TerminalView({ event, className }: { event: AgentEvent; className?: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const writtenRef = useRef('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.4,
      rows: ROWS,
      scrollback: 5000,
      theme: terminalTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    const syncTheme=()=>term.options.theme=terminalTheme()
    window.addEventListener('crazyparrot-theme-change',syncTheme)
    term.write(event.message)
    writtenRef.current = event.message
    const observer = new ResizeObserver(() => { try { fit.fit() } catch { /* 隐藏时无尺寸，忽略 */ } })
    observer.observe(host)
    try { fit.fit() } catch { /* 同上 */ }
    return () => { window.removeEventListener('crazyparrot-theme-change',syncTheme); observer.disconnect(); term.dispose(); termRef.current = null; writtenRef.current = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时创建一次实例
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const { kind, text } = nextTerminalWrite(writtenRef.current, event.message)
    if (kind === 'rewrite') term.reset()
    term.write(text)
    writtenRef.current = event.message
  }, [event.message])

  return <div className={className ?? 'terminal-view'}><div ref={hostRef} className="terminal-host" /></div>
}
