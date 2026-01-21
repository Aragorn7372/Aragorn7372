import requests
import os
import sys
from datetime import datetime

# URLs de las imágenes de estadísticas
USERNAME = os.getenv('GITHUB_USERNAME', 'Aragorn7372')

STATS_URLS = [
    f"https://github-readme-stats.vercel.app/api? username={USERNAME}&show_icons=true&theme=tokyonight&hide_border=true&bg_color=0D1117&title_color=58A6FF&icon_color=58A6FF&text_color=C9D1D9",
    f"https://github-readme-stats.vercel.app/api/top-langs/?username={USERNAME}&layout=compact&theme=tokyonight&hide_border=true&bg_color=0D1117&title_color=58A6FF&text_color=C9D1D9",
    f"https://github-readme-streak-stats.herokuapp.com/? user={USERNAME}&theme=tokyonight&hide_border=true&background=0D1117&stroke=58A6FF&ring=58A6FF&fire=FF6B6B&currStreakLabel=58A6FF",
    f"https://github-readme-activity-graph.vercel.app/graph?username={USERNAME}&theme=tokyo-night&hide_border=true&bg_color=0D1117&color=58A6FF&line=58A6FF&point=FFFFFF",
    f"https://komarev.com/ghpvc/? username={USERNAME}&color=58A6FF&style=for-the-badge&label=VISITAS+AL+PERFIL",
    f"https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=22&duration=3000&pause=1000&color=58A6FF&center=true&vCenter=true&width=435&lines=Desarrollador+en+formación;Apasionado+por+la+tecnología;Siempre+aprendiendo+algo+nuevo"
]

def ping_url(url):
    """
    Hace una petición GET a la URL y retorna si fue exitosa
    """
    try:
        response = requests.get(url, timeout=15)
        if response.status_code == 200:
            print(f" OK: {url[: 80]}...")
            return True
        else:
            print(f"  ERROR {response.status_code}: {url[:80]}...")
            return False
    except requests.exceptions. Timeout:
        print(f"  TIMEOUT: {url[: 80]}...")
        return False
    except requests.exceptions.RequestException as e:
        print(f" FAILED: {url[:80]}...")
        print(f"   Error: {str(e)}")
        return False

def main():
    print(f" Iniciando verificación de URLs de estadísticas")
    print(f" Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f" Usuario: {USERNAME}")
    print("-" * 80)
    
    results = []
    for url in STATS_URLS:
        result = ping_url(url)
        results.append(result)
    
    print("-" * 80)
    successful = sum(results)
    total = len(results)
    
    print(f"\n Resultados:  {successful}/{total} URLs funcionando correctamente")
    
    if successful == total:
        print(" Todas las URLs están activas")
        sys.exit(0)
    elif successful > 0:
        print("  Algunas URLs tienen problemas")
        sys.exit(0)
    else:
        print(" Todas las URLs están caídas")
        sys.exit(1)

if __name__ == "__main__":
    main()