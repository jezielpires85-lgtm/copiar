import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanItem {
  step: number
  agent: string
  task: string
  badge: string
  status: 'pending' | 'active' | 'done'
}

interface LogEntry {
  id: number
  agent: string
  message: string
  color: string
}

type WsMsg =
  | { type: 'status'; message: string }
  | { type: 'plan'; items: Omit<PlanItem, 'status'>[] }
  | { type: 'agent_start'; agent: string; step: number; total: number; task: string; color: string }
  | { type: 'agent_done'; agent: string; step: number; total: number }
  | { type: 'html_update'; agent: string; html: string; step: number; total: number }
  | { type: 'html_chunk'; agent: string; chunk: string }
  | { type: 'log'; agent: string; message: string; color: string }
  | { type: 'complete'; html: string; steps: number }
  | { type: 'error'; message: string }

// ─── Agent colours ────────────────────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  Layout:  '#a855f7',
  Grid:    '#f97316',
  Cor:     '#ec4899',
  Tipo:    '#8b5cf6',
  Dados:   '#22c55e',
  Copy:    '#eab308',
  Gráfico: '#3b82f6',
  Pixel:   '#06b6d4',
  Imagem:  '#14b8a6',
  Motion:  '#6366f1',
  Revisor: '#ef4444',
  Deploy:  '#84cc16',
}

function agentColor(name: string) {
  return AGENT_COLOR[name] ?? '#888'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanHtml(raw: string): string {
  // Remove markdown fences the LLM sometimes adds around HTML
  let s = raw.replace(/^```(?:html)?\r?\n?/i, '')
  s = s.replace(/```\s*$/, '')
  return s
}

let _logId = 0

function PlanCard({ item }: { item: PlanItem }) {
  const color = agentColor(item.agent)
  const isActive = item.status === 'active'
  const isDone = item.status === 'done'

  return (
    <div
      style={{
        marginBottom: 6,
        padding: '10px 12px',
        borderRadius: 8,
        background: isActive ? '#161616' : '#0f0f0f',
        border: `1px solid ${isActive ? color + '66' : isDone ? color + '22' : '#1c1c1c'}`,
        boxShadow: isActive ? `0 0 14px 2px ${color}28` : 'none',
        transition: 'border-color 0.2s, background 0.2s, box-shadow 0.2s',
        animation: isActive ? 'agent-click 0.4s ease' : 'slide-in 0.2s ease',
        // CSS custom property for glow-in keyframe
        ['--glow-color' as string]: color + '44',
      }}
    >
      {/* Row 1: dot + badge + status icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            background: isDone ? '#22c55e' : isActive ? color : '#2a2a2a',
            animation: isActive ? 'pulse-dot 1.2s ease infinite' : undefined,
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '2px 7px',
            borderRadius: 4,
            background: color + '18',
            color,
            border: `1px solid ${color}30`,
          }}
        >
          {item.agent.toUpperCase()}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 11,
            color: isDone ? '#22c55e' : isActive ? color : '#2a2a2a',
          }}
        >
          {isDone ? '✓' : isActive ? '●' : '○'}
        </span>
      </div>
      {/* Row 2: task description */}
      <div
        style={{
          fontSize: 11.5,
          color: isDone ? '#555' : isActive ? '#aaa' : '#3a3a3a',
          lineHeight: 1.45,
          paddingLeft: 14,
          transition: 'color 0.25s',
        }}
      >
        {item.task}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [isBuilding, setIsBuilding] = useState(false)
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [html, setHtml] = useState('')
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const chunkBufRef = useRef('')
  const rafRef = useRef<number>(0)

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const addLog = useCallback((agent: string, message: string, color: string) => {
    setLogs(prev => [...prev.slice(-150), { id: _logId++, agent, message, color }])
  }, [])

  const startBuild = useCallback(() => {
    if (!prompt.trim() || isBuilding) return

    // Close any existing connection
    wsRef.current?.close()

    const ws = new WebSocket(`ws://${window.location.host}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'build', prompt: prompt.trim(), speed }))
      setIsBuilding(true)
      setIsStreaming(false)
      setPlan([])
      setLogs([])
      setHtml('')
      setProgress({ done: 0, total: 0 })
      setActiveAgent(null)
      setStatusMsg('')
    }

    ws.onmessage = (event: MessageEvent) => {
      const msg: WsMsg = JSON.parse(event.data as string)

      switch (msg.type) {
        case 'status':
          setStatusMsg(msg.message)
          break

        case 'plan':
          setPlan(msg.items.map(item => ({ ...item, status: 'pending' as const })))
          setProgress({ done: 0, total: msg.items.length })
          setStatusMsg('')
          break

        case 'agent_start':
          chunkBufRef.current = ''
          cancelAnimationFrame(rafRef.current)
          setActiveAgent(msg.agent)
          setIsStreaming(true)
          setPlan(prev =>
            prev.map(item => item.step === msg.step ? { ...item, status: 'active' } : item)
          )
          break

        case 'agent_done':
          setIsStreaming(false)
          setPlan(prev =>
            prev.map(item => item.step === msg.step ? { ...item, status: 'done' } : item)
          )
          setProgress({ done: msg.step, total: msg.total })
          break

        case 'html_chunk':
          chunkBufRef.current += msg.chunk
          cancelAnimationFrame(rafRef.current)
          rafRef.current = requestAnimationFrame(() => {
            const cleaned = cleanHtml(chunkBufRef.current)
            // Only update iframe once we have HTML past the <head> section
            // This prevents blank/black frames during the first few hundred chars
            if (cleaned.includes('<body') && cleaned.length > 400) {
              setHtml(cleaned)
            }
          })
          break

        case 'html_update':
          cancelAnimationFrame(rafRef.current)
          chunkBufRef.current = ''
          setHtml(cleanHtml(msg.html))
          break

        case 'log':
          addLog(msg.agent, msg.message, msg.color)
          break

        case 'complete':
          setIsBuilding(false)
          setIsStreaming(false)
          setActiveAgent(null)
          setStatusMsg('Concluído!')
          addLog('Sistema', 'Construção concluída ✓', '#22c55e')
          break

        case 'error':
          setIsBuilding(false)
          setIsStreaming(false)
          setActiveAgent(null)
          addLog('Erro', msg.message, '#ef4444')
          setStatusMsg(msg.message)
          break

        default:
          break
      }
    }

    ws.onerror = () => {
      setIsBuilding(false)
      setIsStreaming(false)
      addLog('Erro', 'Não foi possível conectar ao backend (localhost:8000). Certifique-se que está rodando.', '#ef4444')
    }

    ws.onclose = () => {
      setIsBuilding(false)
      setIsStreaming(false)
    }
  }, [prompt, speed, isBuilding, addLog])

  const handleDownload = () => {
    if (!html) return
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'site-gerado.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  const aColor = activeAgent ? agentColor(activeAgent) : '#7c3aed'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a', color: '#fff' }}>

      {/* ── Header ── */}
      <header style={{
        height: 56,
        borderBottom: '1px solid #161616',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 16,
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <polygon points="10,2 18,6 18,14 10,18 2,14 2,6" fill="none" stroke="#7c3aed" strokeWidth="1.5"/>
            <circle cx="10" cy="10" r="2.5" fill="#7c3aed"/>
          </svg>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.05em' }}>AGENT SWARM</span>
          <span style={{ fontSize: 14, fontWeight: 300, color: '#444', letterSpacing: '0.08em' }}>STUDIO</span>
        </div>

        {/* Input */}
        <input
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && startBuild()}
          placeholder="Descreva o site que quer construir… (ex: dashboard financeiro, landing page de startup)"
          disabled={isBuilding}
          style={{
            flex: 1,
            background: '#0f0f0f',
            border: '1px solid #1e1e1e',
            borderRadius: 8,
            padding: '9px 14px',
            color: '#e0e0e0',
            fontSize: 13,
            fontFamily: 'inherit',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed44' }}
          onBlur={e => { e.currentTarget.style.borderColor = '#1e1e1e' }}
        />

        {/* Build button */}
        <button
          onClick={startBuild}
          disabled={isBuilding || !prompt.trim()}
          style={{
            flexShrink: 0,
            background: isBuilding ? '#1a1a1a' : '#7c3aed',
            border: '1px solid ' + (isBuilding ? '#222' : '#7c3aed'),
            borderRadius: 8,
            padding: '9px 18px',
            color: isBuilding ? '#444' : '#fff',
            fontSize: 13,
            fontWeight: 600,
            transition: 'background 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          {isBuilding ? (
            <>
              <span style={{ animation: 'pulse-dot 1s ease infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#555' }} />
              Construindo…
            </>
          ) : (
            <>▶ Construir</>
          )}
        </button>

        {/* Download */}
        {html && !isBuilding && (
          <button
            onClick={handleDownload}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: '1px solid #222',
              borderRadius: 8,
              padding: '9px 14px',
              color: '#555',
              fontSize: 12,
              transition: 'color 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#444' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = '#222' }}
          >
            ↓ Baixar HTML
          </button>
        )}
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left sidebar — Plan */}
        <aside style={{
          width: 268,
          borderRight: '1px solid #161616',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '12px 14px 8px',
            fontSize: 10,
            letterSpacing: '0.15em',
            color: '#333',
            fontWeight: 600,
            borderBottom: '1px solid #111',
          }}>
            PLANO DE CONSTRUÇÃO
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
            {plan.length === 0 ? (
              <div style={{ textAlign: 'center', marginTop: 48, color: '#252525', fontSize: 12 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>⬡</div>
                {statusMsg || 'O plano aparecerá aqui'}
              </div>
            ) : (
              plan.map(item => <PlanCard key={item.step} item={item} />)
            )}
          </div>

          {/* Agent legend */}
          <div style={{ borderTop: '1px solid #111', padding: '10px 12px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: '#252525', marginBottom: 8 }}>AGENTES</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {Object.entries(AGENT_COLOR).map(([name, color]) => (
                <span
                  key={name}
                  style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: color + '15',
                    color: color + 'aa',
                    border: `1px solid ${color}20`,
                    letterSpacing: '0.05em',
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </aside>

        {/* Center — Canvas + Log */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Canvas */}
          <div style={{ flex: 1, position: 'relative', background: '#141414', overflow: 'hidden' }}>
            {html ? (
              <iframe
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin"
                title="Palco"
                style={{
                  position: 'absolute',
                  top: 10, left: 10, right: 10, bottom: 10,
                  width: 'calc(100% - 20px)',
                  height: 'calc(100% - 20px)',
                  border: '1px solid #2a2a2a',
                  borderRadius: 6,
                  display: 'block',
                  boxShadow: '0 0 0 1px #1f1f1f, 0 8px 32px rgba(0,0,0,0.6)',
                }}
              />
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 14,
              }}>
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.07 }}>
                  <polygon points="24,4 44,14 44,34 24,44 4,34 4,14" fill="none" stroke="#fff" strokeWidth="2"/>
                  <polygon points="24,12 36,18 36,30 24,36 12,30 12,18" fill="none" stroke="#fff" strokeWidth="1.5"/>
                  <circle cx="24" cy="24" r="4" fill="#fff"/>
                </svg>
                <span style={{ color: '#1e1e1e', fontSize: 13 }}>
                  {statusMsg || 'O palco está vazio — faça um prompt para começar'}
                </span>
              </div>
            )}

            {/* Streaming: active agent badge */}
            {isStreaming && activeAgent && (
              <div style={{
                position: 'absolute',
                top: 14,
                right: 14,
                background: '#0a0a0aee',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${aColor}50`,
                borderRadius: 8,
                padding: '7px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: aColor,
                  animation: 'pulse-dot 1s ease infinite',
                }} />
                <span style={{ fontSize: 12, color: aColor, fontWeight: 700 }}>{activeAgent}</span>
                <span style={{ fontSize: 11, color: '#444' }}>gerando…</span>
              </div>
            )}

            {/* Streaming: bottom scanner line */}
            {isStreaming && (
              <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${aColor}, transparent)`,
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s linear infinite',
              }} />
            )}
          </div>

          {/* Agent Log */}
          <div style={{
            height: logCollapsed ? 32 : 150,
            borderTop: '1px solid #161616',
            background: '#070707',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            transition: 'height 0.25s ease',
          }}>
            <div style={{
              padding: '7px 14px',
              borderBottom: logCollapsed ? 'none' : '1px solid #111',
              fontSize: 9,
              letterSpacing: '0.15em',
              color: '#252525',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
              cursor: 'pointer',
              userSelect: 'none',
            }}
              onClick={() => setLogCollapsed(v => !v)}
            >
              LOG DOS AGENTES
              {isBuilding && (
                <span style={{
                  display: 'inline-block',
                  width: 5, height: 5, borderRadius: '50%',
                  background: '#22c55e',
                  animation: 'blink 1s ease infinite',
                }} />
              )}
              <span style={{ marginLeft: 'auto', color: '#333', fontSize: 10 }}>
                {logCollapsed ? '▲' : '▼'}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px' }}>
              {logs.length === 0 && (
                <div style={{ color: '#1e1e1e', fontSize: 11, marginTop: 10 }}>Aguardando…</div>
              )}
              {logs.map(log => (
                <div
                  key={log.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 11,
                    lineHeight: '1.9',
                    fontFamily: "'JetBrains Mono', monospace",
                    animation: 'slide-in 0.15s ease',
                  }}
                >
                  <span style={{ color: log.color, fontWeight: 700, minWidth: 58, flexShrink: 0 }}>
                    {log.agent}
                  </span>
                  <span style={{ color: '#2a2a2a' }}>›</span>
                  <span style={{ color: '#4a4a4a' }}>{log.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

        </main>
      </div>

      {/* ── Bottom bar ── */}
      <div style={{
        height: 46,
        borderTop: '1px solid #111',
        background: '#070707',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 12,
        flexShrink: 0,
      }}>
        {/* Speed */}
        <span style={{ fontSize: 9, letterSpacing: '0.15em', color: '#282828', fontWeight: 600 }}>
          VELOCIDADE
        </span>
        {([1, 2, 3] as const).map(s => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              background: speed === s ? '#1a1a1a' : 'transparent',
              border: `1px solid ${speed === s ? '#333' : '#161616'}`,
              borderRadius: 5,
              padding: '4px 10px',
              color: speed === s ? '#ccc' : '#2a2a2a',
              fontSize: 11,
              fontWeight: speed === s ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >
            {s}×
          </button>
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* CONSTRUÍDO */}
        {progress.total > 0 && (
          <>
            <span style={{ fontSize: 9, letterSpacing: '0.15em', color: '#282828', fontWeight: 600 }}>
              CONSTRUÍDO
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.03em' }}>
              <span style={{ color: '#7c3aed' }}>{progress.done}</span>
              <span style={{ color: '#252525' }}>/{progress.total}</span>
            </span>

            {/* Bar */}
            <div style={{ width: 100, height: 3, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  background: '#7c3aed',
                  borderRadius: 2,
                  width: `${(progress.done / progress.total) * 100}%`,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </>
        )}

        {/* Status pill */}
        {statusMsg && !progress.total && (
          <span style={{ fontSize: 11, color: '#333', fontStyle: 'italic' }}>{statusMsg}</span>
        )}
      </div>

    </div>
  )
}
