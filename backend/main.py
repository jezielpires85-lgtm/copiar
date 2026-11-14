import asyncio
import contextlib
import json
import os
import re
from html.parser import HTMLParser

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

load_dotenv()
from agents import AGENTS, AGENT_MODEL, PLAN_MODEL

app = FastAPI(title="Agent Swarm Studio")

TOOLS = [
    {"name": "inspect_site", "description": "Inspeciona o HTML atual: seções, títulos, imagens, links, formulários e scripts.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "edit_html", "description": "Edita uma parte exata do HTML. Copie old_text literalmente, sem reescrever a página. Para adicionar CSS, substitua </style> pelas novas regras seguidas de </style>.",
     "input_schema": {"type": "object", "properties": {
         "old_text": {"type": "string", "description": "Trecho exato e único a substituir, não vazio."},
         "new_text": {"type": "string", "description": "Novo trecho HTML, CSS ou JavaScript."},
         "description": {"type": "string", "description": "O que mudou e em qual parte, em português."}},
         "required": ["old_text", "new_text", "description"], "additionalProperties": False}},
    {"name": "validate_site", "description": "Confere estrutura HTML, título, viewport responsivo, alt das imagens e links vazios. Retorna problemas reais.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
]


class SiteInspector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = {}
        self.sections = []
        self.images_without_alt = 0
        self.empty_links = 0
        self.viewport = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags[tag] = self.tags.get(tag, 0) + 1
        if tag in {"header", "main", "section", "footer", "nav", "h1", "h2"}:
            self.sections.append({"tag": tag, "id": attrs.get("id"), "class": attrs.get("class")})
        if tag == "img" and "alt" not in attrs:
            self.images_without_alt += 1
        if tag == "a" and not attrs.get("href", "").strip():
            self.empty_links += 1
        if tag == "meta" and attrs.get("name", "").lower() == "viewport":
            self.viewport = True


def inspect_html(html):
    parser = SiteInspector()
    parser.feed(html)
    warnings = []
    for tag in ("html", "head", "title", "body", "h1"):
        if tag not in parser.tags:
            warnings.append(f"Falta <{tag}>.")
    if not parser.viewport:
        warnings.append("Falta meta viewport para telas menores.")
    if parser.images_without_alt:
        warnings.append(f"{parser.images_without_alt} imagem(ns) sem atributo alt.")
    if parser.empty_links:
        warnings.append(f"{parser.empty_links} link(s) sem destino.")
    return {"characters": len(html), "sections": parser.sections[:60], "tags": parser.tags, "warnings": warnings}


def apply_edit(html, old_text, new_text):
    if not old_text or html.count(old_text) != 1:
        raise ValueError("old_text precisa existir exatamente uma vez. Escolha um trecho maior e copie literalmente do HTML atual.")
    result = html.replace(old_text, new_text, 1)
    if "<body" not in result.lower() or "</html>" not in result.lower():
        raise ValueError("A edição removeria a estrutura da página. Preserve <body> e </html>.")
    return result


def focus_target(html, old_text, agent):
    """Find the real containing element of an edit, instead of inventing cursor coordinates."""
    position = html.find(old_text) if old_text else -1
    stack = []
    if position >= 0:
        # Include the beginning of the edited element so replacements of a full section target it.
        prefix = html[:position] + old_text[:old_text.find('>') + 1]
        for match in re.finditer(r'<(/?)([a-zA-Z][\w:-]*)\b([^>]*)>', prefix):
            closing, tag, attrs = match.groups()
            tag = tag.lower()
            if closing:
                for i in range(len(stack) - 1, -1, -1):
                    if stack[i][0] == tag:
                        stack = stack[:i]
                        break
            elif tag not in {'meta', 'link', 'img', 'input', 'br', 'hr', 'source'} and not attrs.rstrip().endswith('/'):
                ident = re.search(r'\bid\s*=\s*[\"\x27]([^\"\x27]+)', attrs)
                stack.append((tag, ident.group(1) if ident else None))
        for tag, ident in reversed(stack):
            if ident and tag not in {'html', 'head', 'body', 'style', 'script'}:
                return {"id": ident, "tag": tag}
        for tag, _ in reversed(stack):
            if tag in {'header', 'main', 'section', 'footer', 'nav', 'h1', 'h2', 'svg', 'button'}:
                return {"tag": tag}
    return {"tag": {'Layout': 'header', 'Grid': 'main', 'Cor': 'body', 'Tipo': 'h1', 'Dados': 'section',
                    'Copy': 'h1', 'Gráfico': 'svg', 'Pixel': 'button', 'Imagem': 'svg', 'Motion': 'main',
                    'Revisor': 'main', 'Deploy': 'footer'}.get(agent, 'main')}


def clean_html(text):
    text = re.sub(r"^\s*```(?:html)?\s*", "", text, flags=re.I)
    return re.sub(r"\s*```\s*$", "", text).strip()


def error_message(exc):
    if isinstance(exc, anthropic.AuthenticationError):
        return "A chave da API de IA foi recusada. Verifique a configuração do servidor."
    if isinstance(exc, anthropic.RateLimitError):
        return "O limite da API de IA foi atingido. Aguarde e tente novamente."
    if isinstance(exc, anthropic.APIStatusError):
        return f"A API de IA recusou a solicitação (HTTP {exc.status_code}). Verifique saldo, modelo e permissões."
    if isinstance(exc, (anthropic.APIConnectionError, asyncio.TimeoutError)):
        return "A API de IA não respondeu a tempo. Tente novamente."
    if isinstance(exc, ValueError):
        return str(exc)[:300]
    return "A construção foi interrompida por um erro no servidor. Tente novamente."


async def create_plan(prompt, client):
    response = await client.messages.create(
        model=PLAN_MODEL, max_tokens=2200,
        system="Você planeja sites. Responda apenas JSON válido. Não use markdown.",
        messages=[{"role": "user", "content": (
            f"Projeto: {prompt}\nCrie um array com uma tarefa específica e curta para cada agente, nesta ordem: "
            + ", ".join(AGENTS)
            + '. Formato: [{"agent":"Layout","task":"..."}]. Layout cria uma primeira versão compacta e visível. '
            "Cada outro agente melhora somente a sua especialidade. Revisor verifica acessibilidade e links; Deploy verifica integração, sem alegar publicação externa."
        )}],
    )
    raw = "".join(block.text for block in response.content if block.type == "text")
    raw = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw).strip()
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("O planejador não retornou uma lista de tarefas válida.")
    tasks = {item["agent"]: item.get("task") for item in parsed if isinstance(item, dict) and item.get("agent") in AGENTS}
    return [{"step": i + 1, "agent": name, "task": tasks.get(name) or f"Aprimorar {agent['role']}", "badge": name.upper()}
            for i, (name, agent) in enumerate(AGENTS.items())]


class BuildSession:
    """One build per connection. Controls remain readable during model requests."""

    def __init__(self, websocket):
        self.websocket = websocket
        self.lock = asyncio.Lock()
        self.task = None
        self.status = "idle"
        self.prompt = ""
        self.plan = []
        self.index = 0
        self.html = ""
        self.preview = ""

    async def send(self, type, **fields):
        async with self.lock:
            await self.websocket.send_json({"type": type, **fields})

    async def log(self, agent, message):
        await self.send("log", agent=agent, message=message, color=AGENTS.get(agent, {}).get("color", "#a7b3cb"))

    async def cancel(self):
        if self.task and not self.task.done():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
        self.task = None

    async def control(self, data):
        command = data.get("type")
        if command == "build":
            if self.status in {"building", "paused"}:
                await self.send("notice", message="Pare a construção atual antes de iniciar outra.")
                return
            prompt = data.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 12000:
                await self.send("error", message="Descreva o site em até 12.000 caracteres.")
                return
            if not os.getenv("ANTHROPIC_API_KEY"):
                await self.send("error", message="A chave da API de IA não está configurada no servidor.")
                return
            self.prompt = prompt.strip()
            self.plan, self.index, self.html, self.preview = [], 0, "", ""
            self.status = "building"
            await self.send("state", state="building", message="Criando o plano dos 12 agentes…")
            self.task = asyncio.create_task(self.run())
        elif command == "pause" and self.status == "building":
            await self.cancel()
            self.status = "paused"
            await self.send("state", state="paused", message="Pausado. A chamada de IA foi cancelada; continuar reinicia a etapa interrompida.")
            await self.log("Sistema", "Pausa confirmada. Etapas concluídas e prévia preservadas.")
        elif command == "resume" and self.status == "paused":
            self.status = "building"
            await self.send("state", state="building", message="Retomando a etapa interrompida…")
            self.task = asyncio.create_task(self.run())
        elif command == "stop" and self.status in {"building", "paused"}:
            await self.cancel()
            self.status = "stopped"
            await self.send("state", state="stopped", message="Construção parada. A prévia foi preservada e pode ser baixada.")
            await self.log("Sistema", "Parada confirmada. Nenhuma chamada de IA continua em execução.")

    async def initial_site(self, client):
        await self.log("Layout", "Escrevendo a primeira versão HTML ao vivo no palco.")
        chunks = []
        async with client.messages.stream(
            model=AGENT_MODEL, max_tokens=8192,
            system=(
                "Crie sites profissionais. Retorne SOMENTE HTML completo, sem markdown. "
                "IMPORTANTE para prévia ao vivo: use head MUITO curto (no máximo 1200 caracteres), "
                "abra body logo no início e escreva as seções visíveis antes de CSS adicional no fim. "
                "Crie uma versão inicial compacta com até 180 linhas. Use ids únicos nas seções. "
                "Inclua title, meta viewport, um style no head e body com header, main, section e footer. "
                "Escolha estilo e cores adequados ao pedido. Sem frameworks ou bibliotecas obrigatórias. "
                "Use HTML/CSS/JS vanilla. Não esconda body até carregar nem use animações que ocultem conteúdo. "
                "Não alegue ter pesquisado, gerado fotos ou conectado serviços externos. SVG e gráficos CSS permitidos."
            ),
            messages=[{"role": "user", "content": self.prompt}],
        ) as stream:
            async for text in stream.text_stream:
                chunks.append(text)
                self.preview = clean_html("".join(chunks))
                await self.send("html_chunk", agent="Layout", chunk=text)
            final = await stream.get_final_message()
        html = clean_html("".join(chunks))
        if "<body" not in html.lower():
            raise ValueError("O agente não retornou uma página HTML completa. Tente novamente.")
        if final.stop_reason == "max_tokens":
            if "</body>" not in html.lower():
                html += "\n</body></html>"
            elif "</html>" not in html.lower():
                html += "\n</html>"
        return html

    async def refine_site(self, client, step):
        name = step["agent"]
        messages = [{"role": "user", "content": (
            f"Pedido original: {self.prompt}\nSua tarefa: {step['task']}\n\nHTML atual:\n{self.html}\n\n"
            "Faça uma melhoria concreta com edit_html. Preserve o trabalho anterior. "
            "Use descrições curtas em português indicando a seção alterada. Ao terminar, dê um resumo curto."
        )}]
        edits = 0
        for turn in range(5):
            await self.send("activity", agent=name, message="Analisando a página e preparando alterações…")
            response = await client.messages.create(
                model=AGENT_MODEL, max_tokens=4500,
                system=(f"Você é o agente {name}. Especialidade: {AGENTS[name]['role']}. "
                        "Você tem ferramentas reais de inspeção, edição de HTML e validação. "
                        "Faça de 1 a 3 edições pequenas e relevantes por etapa. "
                        "Mantenha a página completa, responsiva e legível; não oculte o body para animar entrada. "
                        "Prefira SVG/CSS para ilustrações; não invente URLs de imagens. "
                        "Sem backend, pesquisa web, geração de fotos ou deploy externo disponíveis. "
                        "Não diga que usou uma ferramenta sem chamá-la. "
                        "Revisor e Deploy devem usar validate_site e corrigir problemas encontrados."),
                tools=TOOLS, messages=messages,
            )
            if response.stop_reason == "max_tokens":
                raise ValueError(f"{name}: a edição excedeu o limite de saída. Tente novamente.")
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in response.content:
                if block.type == "text" and block.text.strip():
                    await self.log(name, block.text.strip()[:400])
                if block.type != "tool_use":
                    continue
                await self.send("tool", agent=name, name=block.name, status="running", message="Executando ferramenta…")
                try:
                    if block.name in {"inspect_site", "validate_site"}:
                        output = inspect_html(self.html)
                        description = f"{len(output['sections'])} elementos estruturais; {len(output['warnings'])} aviso(s) de validação."
                    elif block.name == "edit_html":
                        focus = focus_target(self.html, block.input["old_text"], name)
                        self.html = apply_edit(self.html, block.input["old_text"], block.input["new_text"])
                        edits += 1
                        description = str(block.input["description"])[:250]
                        self.preview = self.html
                        output = {"ok": True, "characters": len(self.html)}
                        await self.send("html_update", agent=name, html=self.html, step=self.index + 1,
                                        total=len(self.plan), change=description, focus=focus)
                    else:
                        raise ValueError("Ferramenta desconhecida.")
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(output, ensure_ascii=False)})
                    await self.send("tool", agent=name, name=block.name, status="done", message=description)
                    await self.log(name, description)
                except (ValueError, KeyError, TypeError) as exc:
                    description = str(exc)[:250]
                    results.append({"type": "tool_result", "tool_use_id": block.id, "is_error": True, "content": description})
                    await self.send("tool", agent=name, name=block.name, status="error", message=description)
            if not results:
                if edits:
                    return
                messages.append({"role": "user", "content": "Ainda não houve edição. Use edit_html para implementar sua melhoria agora."})
            else:
                messages.append({"role": "user", "content": results})
                if edits >= 3:
                    return
        if not edits:
            raise ValueError(f"{name} não conseguiu aplicar uma alteração. A etapa não foi marcada como concluída.")

    async def run(self):
        try:
            async with anthropic.AsyncAnthropic(timeout=120.0, max_retries=1) as client:
                if not self.plan:
                    self.plan = await create_plan(self.prompt, client)
                    await self.send("plan", items=self.plan)
                while self.index < len(self.plan):
                    step = self.plan[self.index]
                    name = step["agent"]
                    await self.send("agent_start", agent=name, step=self.index + 1, total=len(self.plan),
                                    task=step["task"], color=AGENTS[name]["color"], focus=focus_target(self.html, '', name))
                    await self.log(name, step["task"])
                    if self.index == 0:
                        self.html = await self.initial_site(client)
                        self.preview = self.html
                        await self.send("html_update", agent=name, html=self.html, step=1, total=len(self.plan), change="Estrutura inicial criada")
                    else:
                        await self.refine_site(client, step)
                    self.index += 1
                    await self.send("agent_done", agent=name, step=self.index, total=len(self.plan))
                self.status = "complete"
                await self.send("complete", html=self.html, steps=self.index, validation=inspect_html(self.html))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self.status = "error"
            await self.send("error", message=error_message(exc), step=self.index + 1)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session = BuildSession(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if isinstance(data, dict):
                await session.control(data)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await session.cancel()


@app.get("/health")
async def health():
    return {"status": "ok", "agents": list(AGENTS), "api_configured": bool(os.getenv("ANTHROPIC_API_KEY")),
            "tools": [tool["name"] for tool in TOOLS], "controls": ["pause", "resume", "stop"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
