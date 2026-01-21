# 📊 Scripts para mantener estadísticas de GitHub activas

Este conjunto de scripts mantiene las imágenes de estadísticas del README siempre activas haciendo peticiones periódicas a ellas. 

## 📁 Archivos

- `ping-stats.py` - Script Python que verifica y "hace ping" a las URLs de estadísticas
- `check-stats.sh` - Script Bash para verificación local rápida
- `requirements.txt` - Dependencias de Python
- `.github/workflows/keep-stats-alive.yml` - GitHub Action que ejecuta automáticamente el script

## 🚀 Uso

### Verificación local (Bash)

```bash
# Dale permisos de ejecución
chmod +x scripts/check-stats.sh

# Ejecuta el script
./scripts/check-stats.sh
```

### Verificación local (Python)

```bash
# Instala dependencias
pip install -r scripts/requirements.txt

# Ejecuta el script
python scripts/ping-stats.py
```

### GitHub Actions (Automático)

El workflow `.github/workflows/keep-stats-alive.yml` se ejecuta automáticamente: 

- ⏰ Cada 6 horas (puedes cambiar la frecuencia en el cron)
- 🖱️ Manualmente desde la pestaña "Actions" en GitHub

#### Para ejecutar manualmente:

1. Ve a tu repositorio en GitHub
2. Haz clic en "Actions"
3. Selecciona "Keep GitHub Stats Images Alive"
4. Haz clic en "Run workflow"

## ⚙️ Configuración

### Cambiar la frecuencia de ejecución

Edita el archivo `.github/workflows/keep-stats-alive.yml` y modifica la línea del cron:

```yaml
schedule:
  # Cada 6 horas
  - cron: '0 */6 * * *'
  
  # Otras opciones: 
  # Cada 3 horas:  - cron: '0 */3 * * *'
  # Cada 12 horas: - cron:  '0 */12 * * *'
  # Cada día a las 9am: - cron: '0 9 * * *'
```

### Añadir más URLs

Edita `scripts/ping-stats.py` y añade URLs al array `STATS_URLS`:

```python
STATS_URLS = [
    "https://tu-nueva-url. com/api",
    # ... más URLs
]
```

## 🔧 Solución de problemas

### Las imágenes siguen cayéndose

Si las imágenes siguen teniendo problemas incluso con el ping automático, considera:

1. **Usar servicios alternativos** - Algunos servicios de estadísticas son más confiables que otros
2. **Aumentar la frecuencia** - Cambia el cron a cada 3 o 1 hora
3. **Cachear las imágenes localmente** - Genera las estadísticas y súbelas al repositorio

### El workflow no se ejecuta

- Asegúrate de que GitHub Actions esté habilitado en tu repositorio
- Ve a Settings > Actions > General y verifica que "Allow all actions" esté seleccionado
- El workflow puede tardar hasta 15 minutos en aparecer después del primer push

## 📝 Notas

- Los servicios como `vercel.app` y `herokuapp.com` suelen entrar en "sleep mode" si no reciben tráfico
- Este script los mantiene "despiertos" haciendo peticiones regulares
- No afecta a tu límite de GitHub Actions (el plan gratuito tiene 2000 minutos/mes y esto usa ~5 min/mes)