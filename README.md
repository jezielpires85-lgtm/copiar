# Agent Swarm Studio

Multi-agent AI platform that builds websites using 12 specialized agents working in real-time.

## Agentes

| Agente  | Especialidade |
|---------|--------------|
| Layout  | Estrutura e esqueleto HTML |
| Grid    | CSS grid e flexbox |
| Cor     | Paleta de cores |
| Tipo    | Tipografia e fontes |
| Dados   | Conteúdo e informações |
| Copy    | Textos e copywriting |
| Gráfico | Charts e visualizações |
| Pixel   | Ícones SVG e micro-detalhes |
| Imagem  | Elementos visuais |
| Motion  | Animações CSS |
| Revisor | Qualidade e polimento |
| Deploy  | Integração final |

## Setup rápido

### 1. Configure sua API key

```bash
cp .env.example .env
# Edite .env e adicione: ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Inicie (Windows)

```
start.bat
```

Ou manualmente:

**Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
python main.py
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Acesse: http://localhost:3000

## Stack

- **Backend**: Python / FastAPI / WebSocket / Anthropic Claude
- **Frontend**: React 18 / Vite / TypeScript
