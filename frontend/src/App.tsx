import { useCallback, useEffect, useRef, useState } from 'react'
import Preview from './Preview'

type BuildState = 'idle' | 'connecting' | 'building' | 'paused' | 'stopped' | 'complete' | 'error'
type StepState = 'pending' | 'active' | 'done' | 'error'
interface PlanItem { step: number; agent: string; task: string; status: StepState }
interface Log { id: number; agent: string; message: string; color: string }
interface ToolUse { name: string; agent: string; status: string; message: string }
interface SavedSite { id: string; prompt: string; html: string; date: string }

const AGENTS: Record<string, { color: string; role: string; icon: string }> = {
  Layout: { color: '#a78bfa', role: 'Estrutura', icon: '▤' },
  Grid: { color: '#fb923c', role: 'Layout responsivo', icon: '▦' },
  Cor: { color: '#f472b6', role: 'Cores', icon: '◐' },
  Tipo: { color: '#c4b5fd', role: 'Tipografia', icon: 'Aa' },
  Dados: { color: '#4ade80', role: 'Conteúdo', icon: '▥' },
  Copy: { color: '#facc15', role: 'Textos', icon: '≡' },
  Gráfico: { color: '#60a5fa', role: 'Gráficos', icon: '▥' },
  Pixel: { color: '#22d3ee', role: 'Detalhes', icon: '✦' },
  Imagem: { color: '#2dd4bf', role: 'Ilustrações SVG', icon: '▧' },
  Motion: { color: '#818cf8', role: 'Movimento', icon: '↗' },
  Revisor: { color: '#f87171', role: 'Qualidade', icon: '✓' },
  Deploy: { color: '#a3e635', role: 'Integração final', icon: '◇' },
}
const TOOL_LABEL: Record<string, string> = { inspect_site: 'Inspecionar página', edit_html: 'Editar trecho', validate_site: 'Validar HTML' }
const EXAMPLES = [
  { icon: '☕', title: 'Café do Bairro', prompt: 'Crie um site para a cafeteria Café do Bairro, com visual acolhedor em creme e marrom, apresentação, cardápio de três cafés com preços e contato. Use ilustrações SVG.' },
  { icon: '◈', title: 'Estúdio criativo', prompt: 'Crie um portfólio para um estúdio criativo chamado Forma, com tipografia marcante, projetos em cards coloridos, serviços e contato.' },
  { icon: '▥', title: 'Dashboard financeiro', prompt: 'Crie um dashboard financeiro com saldo, receitas, despesas, gráfico SVG mensal e tabela de transações com dados de exemplo identificados.' },
]
let logId = 0

function download(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'site-gerado.html'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [prompt, setPrompt] = useState('')
  const [state, setState] = useState<BuildState>('idle')
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [html, setHtml] = useState('')
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [message, setMessage] = useState('Descreva uma ideia. Acompanhe cada agente dando forma ao seu site.')
  const [activity, setActivity] = useState('')
  const [lastChange, setLastChange] = useState('')
  const [toolUses, setToolUses] = useState<ToolUse[]>([])
  const [toolsOpen, setToolsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(true)
  const [device, setDevice] = useState(1280)
  const [zoom, setZoom] = useState('fit')
  const [fullPage, setFullPage] = useState(false)
  const [pageHeight, setPageHeight] = useState(900)
  const [size, setSize] = useState({ width: 1000, height: 700 })
  const [commit, setCommit] = useState(0)
  const [chars, setChars] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [pendingControl, setPendingControl] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [agentFocus, setAgentFocus] = useState<{ id?: string; tag?: string } | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [savedSites, setSavedSites] = useState<SavedSite[]>(() => {
    try { return JSON.parse(localStorage.getItem('copiar_sites') || '[]') } catch { return [] }
  })
  const uploadRef = useRef<HTMLInputElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const stateRef = useRef<BuildState>('idle')
  const chunkBuffer = useRef('')
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const logEnd = useRef<HTMLDivElement>(null)
  const terminal = useRef(false)
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  stateRef.current = state
  const busy = state === 'building' || state === 'connecting' || state === 'paused'
  const color = activeAgent ? AGENTS[activeAgent]?.color || '#a78bfa' : '#a78bfa'
  const done = plan.filter(item => item.status === 'done').length

  const addLog = useCallback((agent: string, message: string, color = '#a7b3cb') => {
    setLogs(prev => [...prev.slice(-199), { id: logId++, agent, message, color }])
  }, [])

  const flushPreview = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = null
    const content = chunkBuffer.current.replace(/^\s*```(?:html)?\s*/i, '').replace(/```\s*$/, '')
    setChars(content.length)
    if (content.length > 0) setHtml(content)
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (state !== 'building' && state !== 'connecting') return
    const timer = setInterval(() => setElapsed(n => n + 1), 1000)
    return () => clearInterval(timer)
  }, [state])
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }) }, [logs])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      socket.current?.close()
      if (previewTimer.current) clearTimeout(previewTimer.current)
      if (connectTimer.current) clearTimeout(connectTimer.current)
    }
  }, [])

  const startBuild = (customPrompt?: string) => {
    const value = (customPrompt || prompt).trim()
    if (!value || busy) return
    setPrompt(value)
    const old = socket.current
    if (old) { old.onclose = null; old.close() }
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = null
    chunkBuffer.current = ''
    terminal.current = false
    setState('connecting')
    setMessage('Conectando ao estúdio…')
    setPlan([]); setLogs([]); setHtml(''); setToolUses([]); setWarnings([])
    setChars(0); setElapsed(0); setCommit(0); setLastChange(''); setActiveAgent(null); setActivity(''); setPendingControl(''); setPageHeight(900)
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`)
    socket.current = ws
    connectTimer.current = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close() }, 15000)
    ws.onopen = () => {
      if (connectTimer.current) clearTimeout(connectTimer.current)
      ws.send(JSON.stringify({ type: 'build', prompt: value }))
    }
    ws.onmessage = event => {
      if (socket.current !== ws) return
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      switch (msg.type) {
        case 'state':
          setState(msg.state); setMessage(msg.message); setPendingControl('')
          if (msg.state === 'paused' || msg.state === 'stopped') flushPreview()
          if (msg.state === 'stopped') { terminal.current = true; setActiveAgent(null); ws.close() }
          break
        case 'notice': setMessage(msg.message); setPendingControl(''); break
        case 'plan': setPlan(msg.items.map((item: PlanItem) => ({ ...item, status: 'pending' }))); break
        case 'agent_start':
          setAgentFocus(msg.focus || null)
          setActiveAgent(msg.agent); setMessage(msg.task); setActivity('Preparando a próxima alteração…')
          if (msg.step === 1) chunkBuffer.current = ''
          setPlan(prev => prev.map(item => item.step === msg.step ? { ...item, status: 'active' } : item))
          break
        case 'agent_done':
          setPlan(prev => prev.map(item => item.step === msg.step ? { ...item, status: 'done' } : item))
          break
        case 'activity': setActivity(msg.message); break
        case 'html_chunk':
          chunkBuffer.current += msg.chunk
          if (!previewTimer.current) previewTimer.current = setTimeout(flushPreview, 220)
          setActivity('Escrevendo HTML ao vivo…')
          break
        case 'html_update':
          if (msg.focus) setAgentFocus(msg.focus)
          if (previewTimer.current) clearTimeout(previewTimer.current)
          previewTimer.current = null
          chunkBuffer.current = msg.html
          setHtml(msg.html); setChars(msg.html.length); setCommit(n => n + 1)
          setLastChange(msg.change || 'Página atualizada'); setActivity(msg.change || 'Alteração aplicada ao palco')
          break
        case 'tool':
          setToolUses(prev => [...prev.slice(-29), { name: msg.name, agent: msg.agent, status: msg.status, message: msg.message }])
          setActivity(`${TOOL_LABEL[msg.name] || msg.name}: ${msg.message}`)
          break
        case 'log': addLog(msg.agent, msg.message, msg.color); break
        case 'complete':
          flushPreview(); setHtml(msg.html); setState('complete'); setActiveAgent(null)
          setMessage('Seu site está pronto. Explore a página ou baixe o HTML.'); setActivity(''); setPendingControl('')
          setWarnings(msg.validation?.warnings || [])
          addLog('Sistema', 'Os 12 agentes concluíram a construção.', '#4ade80')
          terminal.current = true; ws.close()
          setSavedSites(prev => {
            const site: SavedSite = { id: Date.now().toString(), prompt: value, html: msg.html, date: new Date().toISOString() }
            const updated = [site, ...prev].slice(0, 20)
            try { localStorage.setItem('copiar_sites', JSON.stringify(updated)) } catch {}
            return updated
          })
          break
        case 'error':
          flushPreview(); setState('error'); setMessage(msg.message); setActivity(''); setPendingControl('')
          setPlan(prev => prev.map(item => item.status === 'active' ? { ...item, status: 'error' } : item))
          setActiveAgent(null); addLog('Erro', msg.message, '#f87171'); setLogsOpen(true)
          terminal.current = true; ws.close()
          break
      }
    }
    ws.onerror = () => { if (!terminal.current) addLog('Conexão', 'Falha na conexão com o servidor.', '#f87171') }
    ws.onclose = () => {
      if (socket.current !== ws || terminal.current) return
      flushPreview(); setState('error'); setActiveAgent(null); setPendingControl('')
      setMessage('A conexão foi encerrada. A prévia foi preservada; inicie uma nova construção para tentar novamente.')
      addLog('Conexão', 'Conexão encerrada antes da conclusão.', '#f87171')
    }
  }

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      const content = ev.target?.result as string
      if (!content) return
      setSavedSites(prev => {
        const site: SavedSite = { id: Date.now().toString(), prompt: file.name.replace(/\.html?$/i, ''), html: content, date: new Date().toISOString() }
        const updated = [site, ...prev].slice(0, 20)
        try { localStorage.setItem('copiar_sites', JSON.stringify(updated)) } catch {}
        return updated
      })
    }
    reader.readAsText(file)
  }

  const control = (type: 'pause' | 'resume' | 'stop') => {
    if (state === 'connecting' && type === 'stop') {
      terminal.current = true; socket.current?.close(); setState('stopped'); setMessage('Conexão cancelada.'); return
    }
    if (socket.current?.readyState !== WebSocket.OPEN || pendingControl) return
    setPendingControl(type)
    socket.current.send(JSON.stringify({ type }))
  }

  const fullScreen = async () => {
    setExpanded(true)
    try {
      if (!document.fullscreenElement) await root.current?.requestFullscreen()
      else await document.exitFullscreen()
    } catch { /* Expanded stage remains usable when native fullscreen is unavailable. */ }
  }
  const onPreviewError = useCallback((message: string) => addLog('Prévia', message, '#fbbf24'), [addLog])
  const availableWidth = Math.max(100, size.width - 40)
  const availableHeight = Math.max(100, size.height - 40)
  const logicalHeight = fullPage ? Math.max(700, pageHeight) : 900
  const scale = zoom === 'fit' ? Math.max(.1, Math.min(availableWidth / device, fullPage ? availableHeight / logicalHeight : 1)) : Number(zoom) / 100
  const statusLabel = { idle: 'Pronto para criar', connecting: 'Conectando', building: 'Construindo ao vivo', paused: 'Pausado', stopped: 'Parado', complete: 'Concluído', error: 'Atenção' }[state]

  return <div ref={root} className={`studio ${expanded ? 'studio-expanded' : ''}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-symbol">⬡</span><div>SWARM<span>STUDIO</span></div><small>SEU ESTÚDIO DE AGENTES</small></div>
      <div className={`status status-${state}`}><i />{statusLabel}</div>
      <div className="top-actions">
        <button className={toolsOpen ? 'selected' : ''} onClick={() => setToolsOpen(v => !v)}>⌘ Ferramentas</button>
        <button className={galleryOpen ? 'selected' : ''} onClick={() => setGalleryOpen(v => !v)}>⊞ Projetos{savedSites.length > 0 && ` (${savedSites.length})`}</button>
        <button disabled={!html} onClick={() => download(html)}>↓ Baixar HTML</button>
      </div>
    </header>

    <section className="composer">
      <label htmlFor="project-prompt">O QUE VAMOS CONSTRUIR?<span>12 especialistas, uma página tomando forma.</span></label>
      <div className="prompt-row">
        <textarea id="project-prompt" value={prompt} maxLength={12000} disabled={busy} rows={2}
          placeholder="Descreva seu site: para quem é, o que deve mostrar e qual estilo você imagina…"
          onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) startBuild() }} />
        <div className="build-controls">
          {!busy && <button className="primary" disabled={!prompt.trim()} onClick={() => startBuild()}>✦ Construir site</button>}
          {state === 'building' && <button disabled={!!pendingControl} onClick={() => control('pause')}>{pendingControl === 'pause' ? 'Pausando…' : 'Ⅱ Pausar'}</button>}
          {state === 'paused' && <button className="primary" disabled={!!pendingControl} onClick={() => control('resume')}>{pendingControl === 'resume' ? 'Retomando…' : '▶ Continuar'}</button>}
          {busy && <button className="danger" disabled={!!pendingControl} onClick={() => control('stop')}>{pendingControl === 'stop' ? 'Parando…' : '■ Parar'}</button>}
        </div>
      </div>
    </section>

    {toolsOpen && <section className="tools-panel">
      <div><strong>Ferramentas dos agentes</strong><span>Chamadas reais, registradas na atividade.</span></div>
      <span className="tool-chip">✓ Inspecionar página</span><span className="tool-chip">✓ Editar trechos HTML/CSS/JS</span><span className="tool-chip">✓ Validar estrutura</span>
      <p>Ilustrações em SVG e CSS. Pesquisa web, geração de fotos, banco de dados e publicação dos sites gerados ainda não estão conectados.</p>
      <button onClick={() => setToolsOpen(false)} aria-label="Fechar ferramentas">×</button>
    </section>}

    <div className="workspace">
      <aside className={`agents-panel${agentsPanelOpen ? '' : ' agents-collapsed'}`}>
        <div className="panel-heading"><div><span className="eyebrow">EQUIPE DE CONSTRUÇÃO</span><h2>Os agentes</h2></div><span className="counter">{done}<span> / {plan.length || 12}</span></span><button className="panel-toggle" onClick={() => setAgentsPanelOpen(v => !v)} title={agentsPanelOpen ? 'Recolher' : 'Expandir'}>{agentsPanelOpen ? '◀' : '▶'}</button></div>
        <div className="progress-track"><span style={{ width: `${done / (plan.length || 12) * 100}%` }} /></div>
        <div className="agent-list">
          {Object.entries(AGENTS).map(([name, agent], index) => {
            const item = plan.find(item => item.agent === name)
            const status = item?.status || 'pending'
            return <article key={name} className={`agent-card agent-${status}`} style={{ '--agent': agent.color } as React.CSSProperties}>
              <div className="agent-icon">{status === 'done' ? '✓' : agent.icon}</div>
              <div className="agent-info"><div><strong>{name}</strong><span>{status === 'done' ? 'Concluído' : status === 'error' ? 'Erro' : status === 'active' ? (state === 'paused' ? 'Pausado' : 'Trabalhando') : String(index + 1).padStart(2, '0')}</span></div>
                <p>{item?.task || agent.role}</p>
                {status === 'active' && <small>{activity || 'Preparando…'}</small>}
              </div>
            </article>
          })}
        </div>
        <div className="team-note"><i /> Um agente por vez. Cada etapa preserva e melhora a anterior.</div>
      </aside>

      <main className="main-area">
        <div className="stage-toolbar">
          <div className="stage-label"><span className={state === 'building' ? 'live-dot' : 'stage-dot'} /><strong>Palco</strong><span className="stage-subtitle">{activeAgent || 'Prévia do site'}</span></div>
          <div className="viewport-controls" role="group" aria-label="Tamanho da prévia">
            {[{ w: 1280, label: 'Desktop' }, { w: 820, label: 'Tablet' }, { w: 390, label: 'Celular' }].map(item => <button key={item.w} className={device === item.w ? 'selected' : ''} onClick={() => { setDevice(item.w); setZoom('fit'); setFullPage(false) }}>{item.label}</button>)}
          </div>
          {busy && <div className="stage-build-controls">
            {state === 'building' && <button disabled={!!pendingControl} onClick={() => control('pause')}>{pendingControl === 'pause' ? 'Pausando…' : 'Ⅱ Pausar'}</button>}
            {state === 'paused' && <button className="primary" disabled={!!pendingControl} onClick={() => control('resume')}>{pendingControl === 'resume' ? 'Retomando…' : '▶ Continuar'}</button>}
            {busy && <button className="danger" disabled={!!pendingControl} onClick={() => control('stop')}>{pendingControl === 'stop' ? 'Parando…' : '■ Parar'}</button>}
          </div>}
          <div className="stage-actions">
            <select aria-label="Zoom do palco" value={zoom} onChange={e => setZoom(e.target.value)}><option value="fit">Ajustar</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option><option value="125">125%</option></select>
            <button className={fullPage ? 'selected' : ''} onClick={() => { setFullPage(v => !v); setZoom('fit') }}>Página inteira</button>
            <button onClick={() => setExpanded(v => !v)}>{expanded ? '↙ Voltar ao estúdio' : '↗ Ampliar palco'}</button>
            <button onClick={fullScreen} aria-label="Tela cheia" title="Tela cheia">⛶</button>
          </div>
        </div>

        {expanded && <div className="focus-status"><span style={{ color }}>{activeAgent ? `${activeAgent} · ` : ''}{message}</span><div>
          {state === 'building' && <button disabled={!!pendingControl} onClick={() => control('pause')}>Ⅱ Pausar</button>}
          {state === 'paused' && <button disabled={!!pendingControl} onClick={() => control('resume')}>▶ Continuar</button>}
          {busy && <button className="danger" disabled={!!pendingControl} onClick={() => control('stop')}>■ Parar</button>}
        </div></div>}

        <div className="stage" ref={stage}>
          <div className="preview-position" style={{ display: html ? 'block' : 'none', width: device * scale, height: logicalHeight * scale }}>
            <div className="preview-frame" style={{ width: device, height: logicalHeight, transform: `scale(${scale})` }}>
              <Preview html={html} color={color} commit={commit} complete={state === 'complete'} agent={activeAgent} activity={activity || message} focus={agentFocus} paused={state === 'paused'} width={device} height={logicalHeight} onHeight={setPageHeight} onError={onPreviewError} />
            </div>
          </div>
          {!html && <div className="empty-stage">
            <div className={`empty-mark ${busy ? 'is-working' : ''}`}>⬡<span>✦</span></div>
            <div className="eyebrow">DA IDEIA À PRIMEIRA PÁGINA</div>
            <h1>{state === 'building' ? (activeAgent ? 'Seu site está tomando forma.' : 'Montando sua equipe.') : state === 'paused' ? 'Construção pausada.' : state === 'error' ? 'Vamos tentar de novo?' : 'Um palco para sua próxima ideia.'}</h1>
            <p>{busy || state === 'error' ? message : 'Descreva o que você imagina e veja cada especialista construir uma parte, ao vivo.'}</p>
            {busy && <div className="generation-meter"><span className="live-dot" />{chars > 0 ? `${chars.toLocaleString('pt-BR')} caracteres recebidos · preparando a primeira seção` : 'Aguardando a resposta da IA…'}<strong>{elapsed}s</strong></div>}
            {!busy && <div className="example-grid">{EXAMPLES.map(example => <button key={example.title} onClick={() => startBuild(example.prompt)}><span>{example.icon}</span><strong>{example.title}</strong><small>Construir exemplo ↗</small></button>)}</div>}
          </div>}
          {html && lastChange && <div className="change-badge" style={{ borderColor: color + '66' }}><span style={{ background: color }} /><strong>{activeAgent || 'Última alteração'}</strong><span>{lastChange}</span></div>}
          {state === 'paused' && html && <div className="paused-badge">Ⅱ Pausado · prévia preservada</div>}
        </div>

        <div className={`activity-panel ${logsOpen ? 'activity-open' : ''}`}>
          <button className="activity-toggle" onClick={() => setLogsOpen(v => !v)}><span><i className={state === 'building' ? 'live-dot' : 'stage-dot'} /><strong>Atividade dos agentes</strong><small>{logs.length} registros</small></span><span>{logsOpen ? 'Recolher ↓' : 'Expandir ↑'}</span></button>
          {logsOpen && <div className="activity-content">
            <div className="log-list">{logs.length === 0 && <p>A primeira tarefa aparecerá aqui quando a construção começar.</p>}{logs.map(log => <div className="log-row" key={log.id}><strong style={{ color: log.color }}>{log.agent}</strong><span>{log.message}</span></div>)}<div ref={logEnd} /></div>
            <div className="tool-history"><span className="eyebrow">FERRAMENTAS UTILIZADAS</span>{toolUses.filter(tool => tool.status !== 'running').slice(-5).reverse().map((tool, i) => <div key={i}><span className={tool.status === 'error' ? 'error-text' : 'ok-text'}>{tool.status === 'error' ? '!' : '✓'}</span><strong>{TOOL_LABEL[tool.name] || tool.name}</strong><small>{tool.agent} · {tool.message}</small></div>)}{!toolUses.length && <p>As chamadas de inspeção, edição e validação aparecem aqui.</p>}</div>
          </div>}
        </div>
      </main>
    </div>
    {galleryOpen && <aside className="gallery-drawer">
      <input ref={uploadRef} type="file" accept=".html,.htm" style={{ display: 'none' }} onChange={handleUpload} />
      <div className="gallery-head">
        <div><span className="eyebrow">MEUS PROJETOS</span><h2>Sites salvos</h2></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <button onClick={() => uploadRef.current?.click()} title="Importar HTML">↑ Importar</button>
          <button onClick={() => setGalleryOpen(false)} title="Fechar">×</button>
        </div>
      </div>
      {savedSites.length === 0
        ? <p className="gallery-empty">Nenhum site concluído ainda. Quando uma construção terminar, ela aparece aqui automaticamente.</p>
        : <div className="gallery-list">
            {savedSites.map(site => (
              <div key={site.id} className="gallery-card">
                <p className="gallery-prompt">{site.prompt.length > 130 ? site.prompt.slice(0, 130) + '…' : site.prompt}</p>
                <span className="gallery-date">{new Date(site.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <div className="gallery-actions">
                  <button className="primary" onClick={() => { setHtml(site.html); setChars(site.html.length); setState('complete'); setPrompt(site.prompt); setCommit(n => n + 1); setLastChange('Carregado do histórico'); setActiveAgent(null); setMessage('Site carregado.'); setGalleryOpen(false) }}>Carregar</button>
                  <button onClick={() => { setPrompt(site.prompt); setGalleryOpen(false) }}>Editar</button>
                  <button onClick={() => download(site.html)}>↓ HTML</button>
                  <button className="danger" onClick={() => setSavedSites(prev => { const u = prev.filter(s => s.id !== site.id); try { localStorage.setItem('copiar_sites', JSON.stringify(u)) } catch {} return u })}>×</button>
                </div>
              </div>
            ))}
          </div>
      }
    </aside>}
    <footer className="statusbar"><span className={`status status-${state}`}><i />{statusLabel}</span><p role={state === 'error' ? 'alert' : 'status'}>{message}</p><span>{chars.toLocaleString('pt-BR')} caracteres</span><span>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>{warnings.length > 0 && <span className="warning" title={warnings.join('\n')}>{warnings.length} aviso(s)</span>}</footer>
  </div>
}
