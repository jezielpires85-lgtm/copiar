@echo off
echo ==========================================
echo   AGENT SWARM STUDIO - Iniciando...
echo ==========================================

REM Check .env
if not exist ".env" (
    echo.
    echo [!] Arquivo .env nao encontrado.
    echo     Copiando .env.example...
    copy .env.example .env
    echo.
    echo [!] Edite o arquivo .env e adicione sua ANTHROPIC_API_KEY
    echo     Depois execute este script novamente.
    echo.
    pause
    exit /b 1
)

REM Start backend
echo.
echo [1/2] Iniciando backend (FastAPI)...
cd backend

REM Install deps if venv doesn't exist
if not exist "venv" (
    echo     Criando ambiente virtual Python...
    python -m venv venv
    echo     Instalando dependencias...
    venv\Scripts\pip install -r requirements.txt -q
)

start "Agent Swarm - Backend" cmd /k "venv\Scripts\activate && python main.py"
cd ..

REM Start frontend
echo [2/2] Iniciando frontend (React/Vite)...
cd frontend

REM Install npm deps if needed
if not exist "node_modules" (
    echo     Instalando dependencias npm...
    npm install
)

start "Agent Swarm - Frontend" cmd /k "npm run dev"
cd ..

echo.
echo ==========================================
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo ==========================================
echo.
echo Aguardando servicos iniciarem...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo Pronto! Acesse http://localhost:3000
pause
