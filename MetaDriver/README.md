# Meta Driver 🚗💰

App Android para motoristas de aplicativo (Uber, 99, inDrive...) controlarem metas e despesas.

**APK pronto:** [`../MetaDriver.apk`](../MetaDriver.apk) — copie para o celular e instale
(permita "instalar apps de fontes desconhecidas"). Android 8.0 ou superior.

## Funcionalidades
- **Meta do ciclo**: cadastre suas contas (ex.: financiamento R$ 2.370 vencendo dia 15, seguro, aluguel...).
  O ciclo vai do dia seguinte ao vencimento até o próximo vencimento.
- **Quanto falta e quanto fazer por dia**: líquido necessário por dia de trabalho restante e estimativa
  de quanto faturar (bruto) para sobrar esse valor. Considera seus dias de trabalho e folgas planejadas.
- **Ritmo e projeção**: barra de progresso x tempo decorrido, projeção de fechamento do ciclo.
- **Lançamento diário**: ganhos por plataforma + gorjetas, km, horas online, corridas, observações.
- **Gastos de rua**: alimentação, lavagem, pedágio, estacionamento, manutenção, celular, multa etc.
- **Combustível / recarga elétrica**: gasolina, etanol, diesel, GNV e kWh; consumo médio (km/L, km/kWh)
  pelo método tanque cheio, custo por km, preço médio, gráfico de consumo.
- **Etanol x gasolina**: regra dos 70% e comparação pelo consumo real do seu carro.
- **Relatórios**: 7 dias, ciclo, mês, ciclo anterior, tudo — R$/km, R$/hora, ticket médio, gastos por categoria,
  ganhos por plataforma, gráfico dia a dia, melhores dias da semana, histórico.
- **Vale a pena a corrida?**: avalia R$/km, lucro estimado e R$/hora de uma corrida.
- **Manutenção por km**: troca de óleo, pneus, freios com alertas.
- **Reserva de desgaste** (R$/km) para saber o lucro real.
- **Backup** (exportar/importar) e exportação de planilha CSV. Funciona 100% offline.

## Compilar
```
echo "sdk.dir=/caminho/do/android-sdk" > local.properties
./gradlew assembleRelease
# APK em app/build/outputs/apk/release/app-release.apk
```
A interface fica em `app/src/main/assets` (HTML/CSS/JS) dentro de um WebView nativo.
