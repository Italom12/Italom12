# Eletrovia

App Android de mapa de carregadores para carros elétricos, no estilo PlugShare.

**APK pronto:** [`../apk/Eletrovia-1.0.0.apk`](../apk/Eletrovia-1.0.0.apk). Baixe no celular, permita
"instalar apps desconhecidos" e abra o arquivo.

## O que tem
- Mapa escuro com todos os carregadores agrupados; cor do ponto = potência
  (azul AC · verde DC · amarelo 100 kW+ · violeta sem dados · rosa = adicionado por você).
- Busca por cidade, posto, operadora ou endereço.
- Filtros: potência, conector (CCS2, Tipo 2, CHAdeMO, GB/T, Tesla…), potência mínima,
  operadora, gratuitos, 24 h, ocultar privados.
- Detalhes do posto: conectores, potência, horário, preço, rota no Google Maps / Waze,
  salvar, compartilhar, check-ins ("carreguei aqui" / "com problema").
- **Perto**: lista dos mais próximos (GPS ou centro do mapa).
- **Painel**: números da rede e gráfico de conectores de norte a sul.
- **+**: cadastre um carregador que ainda não aparece (fica salvo no aparelho).
- "Atualizar esta área": busca pontos novos na região visível.

## De onde vêm os dados
- **OpenStreetMap** (ODbL): snapshot do Brasil empacotado no app (`data/stations.json`)
  e atualização por área via Overpass. Ainda é pouco no Brasil (~400 pontos).
- **Open Charge Map** (CC BY 4.0): é o que enche o mapa. Crie uma chave grátis em
  openchargemap.org → *My Profile → My Apps → Register an application*, e cole em
  **Salvos → Sobre o app** (ou no chip "+ Mais carregadores"). O app baixa o Brasil inteiro
  e guarda no aparelho, atualizando uma vez por semana.

Os dados internos dos apps Tupi, VAPT e PlugShare são proprietários e não são usados.

## Como gerar o APK
Requisitos: JDK 17+ e Android SDK (platform 35).

```bash
cd eletrovia
echo "sdk.dir=/caminho/do/android-sdk" > local.properties
./gradlew :app:assembleRelease
# saída: app/build/outputs/apk/release/app-release.apk
```

Coloque `eletrovia.jks` em `keystore/` para assinar com a chave do app (assim versões novas
instalam por cima). Sem ela, o build usa a chave de debug.

Atualizar o snapshot do OpenStreetMap:
```bash
pip install osmium
curl -O https://download.openstreetmap.fr/extracts/south-america/brazil-latest.osm.pbf
python3 tools/build_data.py brazil-latest.osm.pbf app/src/main/assets/www/data/stations.json
```

## Estrutura
- `app/src/main/java/.../MainActivity.kt`: casca nativa (WebView em tela cheia, GPS,
  botão voltar, abrir Maps/Waze, compartilhar).
- `app/src/main/assets/www/`: interface (Leaflet + MarkerCluster, `app.js`, `app.css`).
- Mapa base: Esri Dark Gray Canvas. Visual inspirado no estilo "unslop" (CC BY 4.0).
