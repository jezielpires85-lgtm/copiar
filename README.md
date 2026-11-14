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

## Executar com Docker

Com o Docker Desktop aberto e o arquivo `.env` configurado, execute na pasta do projeto:

```bash
docker compose up -d --build
```

Acesse http://localhost. Para verificar o backend, acesse http://localhost/health.
Para encerrar, execute `docker compose down`.

Na execução manual com `start.bat`, o frontend usa http://localhost:3000 e o backend usa a porta 8001.

## Stack

- **Backend**: Python / FastAPI / WebSocket / Anthropic Claude
- **Frontend**: React 18 / Vite / TypeScript

## VPS Hostinger

Produção: https://jezielpires.cloud (também atende `www.jezielpires.cloud`).
Servidor: `179.198.110.63`, projeto em `/opt/copiar`.

```bash
cd /opt/copiar
docker compose -p copiar -f deploy/compose.vps.yml up -d --build
docker compose -p copiar -f deploy/compose.vps.yml ps
docker compose -p copiar -f deploy/compose.vps.yml logs --tail 100
```

O frontend fica acessível somente na VPS em `127.0.0.1:8091`. O Caddy existente
(`prospect-caddy-1`) encaminha o domínio para essa porta e gerencia o HTTPS.
O trecho em `deploy/copiar.Caddyfile` está acrescentado ao arquivo
`/opt/prospect/infra/vps/Caddyfile`; preserve os demais domínios ao editar esse arquivo.
O backend fica na rede interna do Docker. As credenciais ficam em `/opt/copiar/.env`
com permissão `600`, fora do Git.
