#!/bin/bash
set -e

echo "=== Agent Swarm Studio — Setup VPS ==="

# 1. Dependências do sistema
apt-get update -qq
apt-get install -y python3 python3-pip python3-venv nginx unzip

# 2. Diretório da aplicação
mkdir -p /var/www/agent-swarm

# 3. Extrair arquivos (assume que o zip está em /tmp/agent-swarm.zip)
unzip -o /tmp/agent-swarm.zip -d /var/www/agent-swarm

# 4. .env — só cria se não existir
if [ ! -f /var/www/agent-swarm/.env ]; then
    cp /var/www/agent-swarm/.env.example /var/www/agent-swarm/.env
    echo ""
    echo "⚠️  IMPORTANTE: edite o arquivo .env com sua chave Anthropic:"
    echo "    nano /var/www/agent-swarm/.env"
    echo ""
fi

# 5. Virtualenv + dependências Python
cd /var/www/agent-swarm
python3 -m venv venv
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -q -r backend/requirements.txt

# 6. Nginx
cp deploy/nginx.conf /etc/nginx/sites-available/agent-swarm
ln -sf /etc/nginx/sites-available/agent-swarm /etc/nginx/sites-enabled/agent-swarm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 7. Systemd
cp deploy/agent-swarm.service /etc/systemd/system/agent-swarm.service
systemctl daemon-reload
systemctl enable agent-swarm
systemctl restart agent-swarm

echo ""
echo "=== Deploy concluído ==="
echo "Frontend: http://179.198.110.63"
echo "Status:   systemctl status agent-swarm"
echo "Logs:     journalctl -u agent-swarm -f"
