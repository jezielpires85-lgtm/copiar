import os

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

