# Desempenho da engine (Etapa 11)

Medido em 2026-11-17. Este documento diz **quanto custa** um quadro e um passo, **onde** vai o tempo, **o que foi decidido** com esses números e **o que falta** para o pior caso. É o relatório que o critério da Etapa 11 pede.

## 1. Como foi medido

- **Hardware:** AMD Ryzen 5 5500 (6 núcleos, 12 threads) com NVIDIA GeForce RTX 5050 (Direct3D 11 via ANGLE), no Edge 157 headless. **Esta máquina não tem GPU integrada** (o Ryzen 5 5500 não tem vídeo embutido), então o caso "GPU integrada" é **estimado** (seção 4), não medido.
- **O jogo medido:** a arena (`engine/examples/arena`, 50 239 splats) e a mesma arena com as superfícies amostradas 2,8 vezes mais fino (`engine/examples/arena-dense`, **303 205 splats**), ambas jogando o `win.json` ao vivo na página (`&replay`). As medidas começam aos 6 s, já com a primeira onda em cena, e duram 10 s.
- **Ferramentas:**
  - `npm run perf`: o executor das medidas;
  - `&perf=1` na página: o custo de cada parte, quadro a quadro, em `ENGINE.perf`;
  - `&perf=gpu`: espera a placa a cada quadro, lendo um pixel de volta, e mede quanto ela demora;
  - o tempo da placa vem do **cronômetro de GPU do WebGL** (`EXT_disjoint_timer_query_webgl2`, em `SplatRenderer.timeGpu`), que não atrasa nada;
  - `node test/perf/profile.mjs arena`: o perfil de CPU do V8 sobre uma partida inteira sem navegador.
- **Limite pessimista:** os mesmos casos no **SwiftShader**, o rasterizador por software do Chromium, que roda na CPU.

## 2. Resultados

### CPU (por quadro, mediana; entre parênteses o p95)

| | arena (50 mil) | arena densa (303 mil) |
|---|---|---|
| simulação, por passo | 0,4 ms (1,4) | 0,4 ms (1,4) |
| envio de splats à GPU, por passo | 0,3 ms (0,5) | 0,3 ms (1,5) |
| chamada de desenho (lado da CPU) | 0,1 ms | 0,2 ms |
| HUD | < 0,1 ms | < 0,1 ms |
| **quadro inteiro na thread da página** | **0,1 a 0,3 ms (1,3)** | **0,1 a 0,4 ms (1,9)** |
| ordenação (no Worker, fora da página) | 1,2 ms | 7,9 ms |

O orçamento a 60 fps é 16,7 ms. A thread da página usa menos de 2% dele. A simulação é a mesma nos dois casos, porque a densidade do cenário não muda nada nela.

### GPU (tempo da placa por desenho, a pleno clock)

| | estilo padrão | estilo `colored` (dois passes de splats) |
|---|---|---|
| arena, 50 mil splats | 0,21 ms | 0,52 ms |
| arena densa, 303 mil splats | **0,96 ms** | **1,92 ms** |

- **O custo é por splat, não por pixel.** De 50 mil para 303 mil splats, o tempo cresce cerca de 3 ns por splat a mais na RTX 5050. A grade de pixels de arte (183 × 103) é a mesma nos dois casos.
- **O SwiftShader confirma:** 300 ms por quadro com 50 mil splats e 1 888 ms com 303 mil. É proporcional ao número de splats e não ao de pixels.
- **O gargalo de GPU é o vertex shader:** para cada splat, as contas de movimento, ossos e projeção da covariância são refeitas nos 4 cantos do quad.

### Simulação (perfil de uma partida inteira da arena, 3 360 passos)

| Onde | Tempo próprio |
|---|---|
| `K.character` → `animate` (o kit reescreve os splats de cada personagem) | 61,6% |
| `K.character` → `update` (controle) | 10,0% |
| `hypot` do Math determinístico | 7,7% |
| coletor de lixo | 2,6% |
| redução de ângulo e `sin`/`cos` determinísticos | ~4% |
| o resto (combate, efeitos, colisão, cérebros, chão em brasa) | < 15% |

**Cerca de 72% do passo é o `K.character` do kit.** Com 1 a 6 personagens em cena, isso dá uns **0,1 ms por personagem por passo**.

## 3. Decisões, com os números

1. **A simulação não vai para Worker nem para WebAssembly.**
   - 0,4 ms por passo (p95 de 1,4 ms) é 2% a 8% do quadro.
   - O que cresce com o jogo é o número de personagens, a uns 0,1 ms cada. Com 20 inimigos seria ~2 ms por passo, ainda folgado. O limite prático fica perto de 100 personagens.
   - Se um jogo precisar disso, o caminho **não** é WebAssembly. É fazer o `K.character` ser carregado por **ossos na GPU**, como a Etapa 4 fez com os puppets: a CPU passa a mover ~20 ossos em vez de reescrever ~1 000 splats. Isso muda o kit (`src/`), por isso fica registrado aqui e não foi feito. Custo estimado: 2 a 3 dias, com a paridade do terminal como rede de segurança.
   - `K.mpm` e `K.xpbd`, candidatos do plano, não aparecem na arena.
2. **A ordenação fica no Worker, em JavaScript.**
   - 7,9 ms para 303 mil splats, fora da thread da página; a página usa a ordem mais recente, um ou dois quadros atrasada.
   - WebAssembly cortaria isso uma 2 ou 3 vezes, mas hoje não muda nada visível.
   - Só valeria numa CPU fraca em que o Worker passasse de ~16 ms. Aí a ordem atrasaria mais quadros: um efeito visual pequeno em viradas rápidas da câmera, não uma queda de fps.
3. **O envio de splats fica como está:** 0,3 ms, porque só as linhas que mudaram vão para a GPU, desde a Etapa 4.
4. **Feito nesta etapa:**
   - **Desenhar só quando há algo novo.** A página desenhava a cada quadro do monitor, mas a simulação muda 60 vezes por segundo. Numa tela de 120 ou 144 Hz, metade ou mais dos desenhos repetia a mesma imagem a custo cheio. Agora a página só desenha quando um passo rodou, ou quando o tamanho ou o estilo mudaram.
     - **Medido:** 60 desenhos por segundo em vez de 176 na arena densa `colored`. A placa fica ocupada 115 ms por segundo em vez de ~340: **3 vezes menos trabalho de GPU, com a mesma imagem.**
     - Numa GPU integrada, isso é a diferença entre caber e não caber num monitor rápido.
   - **`hypot` determinístico sem criar lista** para 2 e 3 argumentos (4 000 chamadas por passo na arena): mesma aritmética e mesma ordem, os mesmos bits (a impressão digital `852e6b34ae4e5869` continua), e menos lixo para o coletor.
   - **Cronômetro de GPU** no renderizador (`timeGpu`) e o modo `&perf` na página, para medir de novo sempre que algo mudar.

## 4. GPU integrada: estimativa

Não há GPU integrada nesta máquina, e o SwiftShader é lento demais para servir de modelo (cerca de 2 000 vezes a RTX). A estimativa abaixo escala o tempo medido na RTX 5050 pela razão de poder de cálculo FP32. O trabalho é limitado pelo vertex shader, que é conta pura, então essa é a razão que mais pesa. Mas é **só uma orientação**: banda de memória, o driver e o ANGLE mudam o resultado real, para cima ou para baixo.

| GPU (TFLOPS FP32, aprox.) | razão | arena densa, padrão | arena densa, `colored` | arena (50 mil), padrão / `colored` |
|---|---|---|---|---|
| RTX 5050 (13,2), medida | 1× | 0,96 ms | 1,92 ms | 0,21 / 0,52 ms |
| Radeon 680M (3,4) | 3,9× | ~3,7 ms ✓ | ~7,5 ms ✓ | ✓ |
| Apple M1 8 núcleos (2,6) | 5× | ~4,9 ms ✓ | ~9,8 ms ✓ | ✓ |
| Intel Iris Xe 96 EU (2,1) | 6,4× | ~6,1 ms ✓ | ~12,3 ms ✓ (justo) | ✓ |
| Radeon Vega 8 (1,5) | 8,6× | ~8,2 ms ✓ | ~16,5 ms ✗ | ✓ |
| Intel UHD 620 (0,44) | 30× | ~29 ms ✗ | ~58 ms ✗ | ~6,3 ✓ / ~15,6 ms (justo) |

Somando cerca de 1 a 3 ms de CPU por quadro (mais numa CPU de notebook), cabe nos 16,7 ms de um quadro a 60 fps o que fica abaixo de ~13 ms de GPU.

**Conclusão para o critério da Etapa 11:**
- **Integradas atuais** (Iris Xe, Radeon 680M e Vega, Apple M1): a arena com 300 mil splats deve manter 60 fps no estilo padrão; no `colored`, com folga só nas mais fortes.
- **Integradas antigas** (Intel UHD 6xx, notebooks de 2017 a 2019): **não deve**. A estimativa é de ~29 ms no padrão. A arena na densidade dela (50 mil splats) cabe.

**O que impede no pior caso:** o vertex shader refaz, para cada splat, as contas de movimento, ossos e projeção nos 4 cantos do quad.

**Quanto custaria resolver**, do mais barato ao mais caro:
1. **Densidade de acordo com o pixel de arte (autoria, horas).**
   - A arena densa tem 303 mil splats numa grade de 18 849 pixels de arte, cerca de 16 por pixel. A arena normal tem 2,7 por pixel.
   - O `detail` da cena e o `res` dos sólidos já controlam isso. Um aviso no `check` quando houver splats demais por pixel de arte levaria umas 2 horas.
2. **Estilo padrão em GPUs fracas (horas).** O `colored` dobra o custo de GPU. A página poderia escolher o estilo pelo tempo de GPU medido nos primeiros segundos, com o cronômetro que já existe.
3. **Pré-passe de projeção (1 a 2 dias).**
   - Calcular a projeção de cada splat **uma vez**, com *transform feedback* do WebGL2 (um vértice por splat, sem rasterizar), e fazer o desenho dos quads só ler o resultado.
   - Isso corta o trabalho de vértice pesado de 4 para 1 por splat; estimativa de 2 a 3 vezes menos tempo de GPU. Leva a UHD 620 para ~10 a 15 ms no estilo padrão.
   - A paridade com o renderizador do terminal (100% hoje) confere que a imagem não muda.
4. **Medir de verdade numa GPU integrada (1 hora, com o aparelho).** Rode `npm run perf` em `engine/` num notebook com Iris Xe ou UHD 620 e compare com a tabela acima.

## 5. Como medir de novo

```
cd engine
npm run perf                      # todos os casos, na placa (hw) e no SwiftShader (sw)
npm run perf -- --only hw         # só na placa
node test/perf/profile.mjs arena  # o perfil de CPU de uma partida inteira (engine/test/perf/out/arena.cpuprofile abre no DevTools)
```

Na página: `?game=arena&replay=arena/win.json&perf=1`. Depois, `ENGINE.perf` e `ENGINE.gpuTimes` no console.

## 6. Etapa 14: o renderizador do ink-studio (2026-11-21)

A engine passou a desenhar com o renderizador WebGL2 do próprio ink-studio (`webgl.mjs`), por meio de [`engine/src/render/upstream.ts`](../engine/src/render/upstream.ts). O renderizador antigo continua disponível com `&renderer=old` para comparar. Mesma máquina e mesmo método da seção 1.

| | antigo | ink-studio, ordem do Worker | ink-studio, ordena na página (padrão) |
|---|---|---|---|
| arena: GPU por desenho | 0,18 ms | 0,42 ms | 0,42 ms |
| arena: desenho + ordenação na thread da página | 0,2 ms | 1,0 ms | 0,8 ms |
| arena densa: GPU por desenho | 1,73 ms | 3,58 ms | 3,67 ms |
| arena densa: desenho + ordenação na thread da página | 0,3 ms | 4,2 ms | 3,1 ms |
| arena densa, `colored`: GPU por desenho | 3,74 ms | 3,81 ms | 3,81 ms |
| fps (placa) | 175–180 | 158–180 | 166–180 |
| SwiftShader, arena: por desenho | 303 ms | 300 ms | — |

- **A GPU custa cerca de 2 vezes mais no estilo padrão.** O shader do ink-studio faz mais trabalho por splat. No estilo `colored` os dois empatam.
- **A ordenação fica na página.** O renderizador do ink-studio ordena com um counting sort de 16 bits e reaproveita a ordem quando nada se moveu. Entregar a ordem pronta do Worker sai mais caro, porque ele confere e reenvia o `Int32Array` inteiro a cada quadro. O Worker continua para o renderizador antigo e com `&sort=worker`.
- **Primeiro quadro:** sem a alteração listada em [engine-kit-patches.md](engine-kit-patches.md), o primeiro quadro levava **cerca de 110 s** no Edge do Windows (Direct3D), só para ligar um shader que os jogos nem usam. Com ela, menos de 3 s.
- Todos os casos ficam bem dentro dos 16,7 ms de um quadro a 60 fps. A etapa 16 procura cortar esse custo de volta.
