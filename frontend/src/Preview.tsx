import { useEffect, useRef } from 'react'

// A stable, isolated document receives incremental HTML without reloading the iframe.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<script>
(() => {
  let last = '', interactive = false, lastHeight = 0, focus = null, marker = null, outline = null;
  const placeAgent = () => {
    document.querySelectorAll('[data-swarm-overlay]').forEach(el => el.remove());
    if (!focus?.agent || !last) return;
    const target = (focus.target?.id && document.getElementById(focus.target.id)) || document.querySelector(focus.target?.tag || 'main') || document.querySelector('header, section, main') || document.body;
    const box = target.getBoundingClientRect();
    const left = Math.max(10, Math.min(innerWidth - 210, box.left + 14));
    const top = Math.max(14, Math.min(innerHeight - 70, box.top + 12));
    outline = document.createElement('div');
    outline.setAttribute('data-swarm-overlay', 'outline');
    outline.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;box-sizing:border-box;border:2px solid ' + focus.color + ';border-radius:5px;left:' + Math.max(0, box.left) + 'px;top:' + Math.max(0, box.top) + 'px;width:' + Math.min(box.width, innerWidth) + 'px;height:' + Math.min(box.height, innerHeight) + 'px;opacity:.7;';
    marker = document.createElement('div');
    marker.setAttribute('data-swarm-overlay', 'agent');
    marker.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;left:' + left + 'px;top:' + top + 'px;font:600 12px/1.4 system-ui,sans-serif;color:#111827;max-width:260px;filter:drop-shadow(0 3px 9px #0007);';
    const cursor = document.createElement('div');
    cursor.style.cssText = 'width:0;height:0;border-top:18px solid ' + focus.color + ';border-right:12px solid transparent;transform:rotate(-12deg);margin-bottom:3px;';
    const label = document.createElement('div');
    label.style.cssText = 'background:' + focus.color + ';border:1px solid #ffffff66;border-radius:4px 8px 8px;padding:7px 11px;margin-left:10px;max-width:250px;';
    const name = document.createElement('strong');
    name.style.cssText = 'display:block;font-size:12px;';
    name.textContent = focus.agent + (focus.paused ? ' · pausado' : ' · trabalhando');
    const detail = document.createElement('span');
    detail.style.cssText = 'display:block;font-size:10px;font-weight:500;max-height:42px;overflow:hidden;margin-top:2px;';
    detail.textContent = focus.task || 'Construindo esta parte da página';
    label.append(name, detail); marker.append(cursor, label);
    document.body.append(outline, marker);
  };
  const report = () => {
    const height = Math.min(20000, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    if (Math.abs(height - lastHeight) > 3) {
      lastHeight = height;
      parent.postMessage({type:'preview-height', height}, '*');
    }
  };
  const observer = new ResizeObserver(report);
  observer.observe(document.documentElement);
  addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'agent-focus') { focus = event.data; placeAgent(); return; }
    if (event.data?.type !== 'render-site') return;
    const {html, color, commit, runScripts} = event.data;
    if (html === last && (!runScripts || interactive)) return;
    const old = new Map([...document.querySelectorAll('body [id]')].map(el => [el.id, el.outerHTML]));
    const x = scrollX, y = scrollY;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('base, meta[http-equiv="refresh"]').forEach(el => el.remove());
    document.documentElement.lang = parsed.documentElement.lang || 'pt-BR';
    document.documentElement.className = parsed.documentElement.className;
    document.documentElement.style.cssText = parsed.documentElement.style.cssText;
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.className = parsed.body.className;
    document.body.style.cssText = parsed.body.style.cssText;
    document.body.innerHTML = parsed.body.innerHTML;
    if (commit && last) {
      const changed = [...document.querySelectorAll('body [id]')].filter(el => old.get(el.id) !== el.outerHTML);
      const targets = changed.length ? changed.filter(el => !changed.some(other => other !== el && el.contains(other))).slice(0, 8) : [document.querySelector('main') || document.body];
      targets.forEach(el => el.animate([{outline:'2px solid ' + color, outlineOffset:'-2px'}, {outline:'2px solid transparent', outlineOffset:'-2px'}], {duration:2400}));
    }
    last = html;
    if (runScripts) {
      document.querySelectorAll('script').forEach(oldScript => {
        const script = document.createElement('script');
        [...oldScript.attributes].forEach(attr => script.setAttribute(attr.name, attr.value));
        script.textContent = oldScript.textContent;
        oldScript.replaceWith(script);
      });
      interactive = true;
    } else interactive = false;
    requestAnimationFrame(() => { scrollTo(x, y); placeAgent(); report(); });
  });
  addEventListener('scroll', placeAgent, {passive:true});
  addEventListener('error', event => parent.postMessage({type:'preview-error', message:String(event.message).slice(0, 200)}, '*'));
  parent.postMessage({type:'preview-ready'}, '*');
})();
<\/script></body></html>`

interface Props {
  html: string
  color: string
  commit: number
  complete: boolean
  agent: string | null
  activity: string
  focus: { id?: string; tag?: string } | null
  paused: boolean
  width: number
  height: number
  onHeight: (height: number) => void
  onError: (message: string) => void
}

export default function Preview(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef(props)
  latest.current = props
  const send = () => {
    const p = latest.current
    if (p.html) frame.current?.contentWindow?.postMessage({
      type: 'render-site', html: p.html, color: p.color, commit: p.commit > 0, runScripts: p.complete,
    }, '*')
    frame.current?.contentWindow?.postMessage({ type: 'agent-focus', agent: p.agent, color: p.color, task: p.activity, target: p.focus, paused: p.paused }, '*')
  }
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'preview-ready') send()
      if (event.data?.type === 'preview-height') latest.current.onHeight(event.data.height)
      if (event.data?.type === 'preview-error') latest.current.onError(event.data.message)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])
  useEffect(send, [props.html, props.commit, props.complete, props.color, props.agent, props.activity, props.focus, props.paused])
  return <iframe ref={frame} srcDoc={SHELL} onLoad={send} title="Palco — site em construção"
    sandbox="allow-scripts" style={{ width: props.width, height: props.height }} />
}
