import asyncio
import json
import os

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(title="Agent Swarm Studio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENTS: dict[str, dict] = {
    "Layout":  {"color": "#a855f7", "role": "estrutura e esqueleto da página HTML"},
    "Grid":    {"color": "#f97316", "role": "CSS grid, flexbox e sistemas de layout"},
    "Cor":     {"color": "#ec4899", "role": "paleta de cores e estilos visuais"},
    "Tipo":    {"color": "#8b5cf6", "role": "tipografia, fontes e hierarquia de texto"},
    "Dados":   {"color": "#22c55e", "role": "dados, conteúdo e informações da página"},
    "Copy":    {"color": "#eab308", "role": "textos, títulos e copywriting"},
    "Gráfico": {"color": "#3b82f6", "role": "gráficos e visualizações de dados com CSS/SVG"},
    "Pixel":   {"color": "#06b6d4", "role": "detalhes visuais, ícones SVG e micro-elementos"},
    "Imagem":  {"color": "#14b8a6", "role": "imagens placeholder e elementos visuais decorativos"},
    "Motion":  {"color": "#6366f1", "role": "animações CSS e transições suaves"},
    "Revisor": {"color": "#ef4444", "role": "revisão de qualidade, consistência e polimento"},
    "Deploy":  {"color": "#84cc16", "role": "integração final e otimização de todos os elementos"},
}

PLAN_MODEL = os.getenv("PLAN_MODEL", "claude-opus-4-5")
AGENT_MODEL = os.getenv("AGENT_MODEL", "claude-sonnet-4-5")


async def create_plan(prompt: str, client: anthropic.AsyncAnthropic) -> list[dict]:
    response = await client.messages.create(
        model=PLAN_MODEL,
        max_tokens=1500,
        system=(
            "Você é um arquiteto de websites. "
            "Responda APENAS com um array JSON válido, sem markdown, sem explicações."
        ),
        messages=[{
            "role": "user",
            "content": (
                f'Crie um plano de construção para: "{prompt}"\n\n'
                "Retorne APENAS um array JSON com exatamente 10 objetos:\n"
                '[{"step":1,"agent":"Layout","task":"descrição curta","badge":"ESTRUTURA"}, ...]\n\n'
                "Agentes disponíveis: Layout, Grid, Cor, Tipo, Dados, Copy, Gráfico, Pixel, Imagem, Motion, Revisor, Deploy\n"
                "Escolha os agentes mais relevantes. Seja específico para o projeto."
            ),
        }],
    )

    raw = response.content[0].text.strip()

    # Strip markdown fences if the model added them
    if "```" in raw:
        for part in raw.split("```"):
            part = part.strip().lstrip("json").strip()
            if part.startswith("["):
                raw = part
                break

    start = raw.find("[")
    if start != -1:
        raw = raw[start:]

    return json.loads(raw)


async def run_agent(
    agent_name: str,
    task: str,
    current_html: str,
    prompt: str,
    websocket: WebSocket,
    client: anthropic.AsyncAnthropic,
    speed: float,
) -> str:
    agent = AGENTS.get(agent_name, {"role": "construção geral"})

    system = (
        f"Você é o agente {agent_name} do Agent Swarm Studio.\n"
        f"Especialidade: {agent['role']}.\n\n"
        "REGRAS:\n"
        "- Retorne APENAS código HTML completo (<!DOCTYPE html> … </html>)\n"
        "- Design moderno, profissional, fundo escuro (#0a0a0a / #111)\n"
        "- SEM gradientes lineares ou radiais\n"
        "- SEM React/Vue/Angular — JavaScript vanilla permitido\n"
        "- Cores sólidas e contrastantes\n"
        "- Sem comentários, sem markdown, apenas código HTML"
    )

    if current_html:
        user_msg = (
            f"Projeto: {prompt}\n\n"
            f"HTML atual:\n{current_html}\n\n"
            f"Sua tarefa ({agent_name}): {task}\n\n"
            "Retorne o HTML completo melhorado. "
            f"Preserve todo o trabalho anterior e refine com sua especialidade em {agent['role']}."
        )
    else:
        user_msg = (
            f"Projeto: {prompt}\n\n"
            f"Você é o primeiro agente. Crie a estrutura inicial.\n"
            f"Tarefa: {task}\n\n"
            "Crie uma página HTML completa, impressionante e profissional."
        )

    chunks: list[str] = []

    async with client.messages.stream(
        model=AGENT_MODEL,
        max_tokens=8000,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        async for text in stream.text_stream:
            chunks.append(text)
            await websocket.send_json({"type": "html_chunk", "agent": agent_name, "chunk": text})
            if speed < 3:
                await asyncio.sleep(0.003 / speed)

    result = "".join(chunks).strip()

    # Strip markdown fences
    if "```" in result:
        for part in result.split("```"):
            part = part.strip().lstrip("html").strip()
            if part.startswith("<!") or "<html" in part:
                result = part
                break

    return result


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        await websocket.send_json({
            "type": "error",
            "message": "ANTHROPIC_API_KEY não configurada. Crie o arquivo .env com sua chave.",
        })
        return

    client = anthropic.AsyncAnthropic(api_key=api_key)

    try:
        while True:
            data = await websocket.receive_json()

            if data.get("type") != "build":
                continue

            prompt: str = data.get("prompt", "").strip()
            speed: float = float(data.get("speed", 1.0))

            if not prompt:
                continue

            await websocket.send_json({"type": "status", "message": "Criando plano de construção…"})

            # --- Create plan ---
            try:
                plan = await create_plan(prompt, client)
            except Exception as exc:
                fallback_agents = list(AGENTS.keys())
                plan = [
                    {
                        "step": i + 1,
                        "agent": fallback_agents[i % len(fallback_agents)],
                        "task": f"Construir seção {i + 1}",
                        "badge": fallback_agents[i % len(fallback_agents)].upper(),
                    }
                    for i in range(10)
                ]
                await websocket.send_json({
                    "type": "log",
                    "agent": "Sistema",
                    "message": f"Plano padrão (erro: {str(exc)[:60]})",
                    "color": "#666666",
                })

            await websocket.send_json({"type": "plan", "items": plan})

            current_html = ""
            total_steps = len(plan)

            for i, step in enumerate(plan):
                agent_name: str = step.get("agent", "Layout")
                task: str = step.get("task", f"Passo {i + 1}")
                color: str = AGENTS.get(agent_name, {}).get("color", "#888888")

                await websocket.send_json({
                    "type": "agent_start",
                    "agent": agent_name,
                    "step": i + 1,
                    "total": total_steps,
                    "task": task,
                    "color": color,
                })
                await websocket.send_json({
                    "type": "log",
                    "agent": agent_name,
                    "message": task,
                    "color": color,
                })

                try:
                    new_html = await run_agent(
                        agent_name, task, current_html, prompt, websocket, client, speed
                    )
                    if new_html:
                        current_html = new_html

                    await websocket.send_json({
                        "type": "html_update",
                        "agent": agent_name,
                        "html": current_html,
                        "step": i + 1,
                        "total": total_steps,
                    })
                    await websocket.send_json({
                        "type": "agent_done",
                        "agent": agent_name,
                        "step": i + 1,
                        "total": total_steps,
                    })
                    await websocket.send_json({
                        "type": "log",
                        "agent": agent_name,
                        "message": "Concluído ✓",
                        "color": color,
                    })

                except Exception as exc:
                    await websocket.send_json({
                        "type": "log",
                        "agent": agent_name,
                        "message": f"Erro: {str(exc)[:100]}",
                        "color": "#ef4444",
                    })

            await websocket.send_json({
                "type": "complete",
                "html": current_html,
                "steps": total_steps,
            })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "agents": list(AGENTS.keys())}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
