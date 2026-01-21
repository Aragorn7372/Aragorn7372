#!/bin/bash

# Script para verificar localmente el estado de las URLs
# Uso: ./scripts/check-stats.sh

USERNAME="Aragorn7372"

echo "🔍 Verificando URLs de estadísticas de GitHub..."
echo "👤 Usuario: $USERNAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Lista de URLs a verificar
urls=(
  "https://github-readme-stats.vercel.app/api? username=$USERNAME&show_icons=true&theme=tokyonight"
  "https://github-readme-streak-stats.herokuapp.com/?user=$USERNAME&theme=tokyonight"
  "https://komarev.com/ghpvc/?username=$USERNAME&color=58A6FF&style=for-the-badge"
  "https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=22"
)

success=0
total=${#urls[@]}

for url in "${urls[@]}"; do
  if curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" | grep -q "200"; then
    echo "✅ OK: ${url: 0:60}..."
    ((success++))
  else
    echo "❌ FAIL: ${url:0:60}..."
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Resultado: $success/$total URLs funcionando"

if [ $success -eq $total ]; then
  echo "✨ Todas las URLs están activas"
  exit 0
else
  echo "⚠️  Algunas URLs tienen problemas"
  exit 1
fi