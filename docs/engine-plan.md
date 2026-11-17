# Plano: engine de jogos AI-friendly sobre o ink-studio

## Contexto

O ink-studio constrói mundos 3D em pixel-art feitos de "splats" (modelagem, luz, animação, física, partículas), mas **não desenha em tempo real**: só tem um renderizador lento para terminal ([cli/render.js](../cli/render.js)). O README diz que quem usa precisa fornecer o viewport, o loop e a interface. O objetivo é construir essa "casca" de engine para criar jogos de **ação vista de cima** no estilo do vídeo, de um jeito que uma IA consiga escrever e testar jogos sozinha.

Decisões já tomadas com o usuário:
- A engine fica na pasta `engine/` deste repositório.
- Primeiro alvo: jogo de ação vista de cima (personagem, inimigos, vida).
- Continua em JS/TS, navegador primeiro. Port para desktop/outra linguagem fica para depois.
- Planejamento com Fable 5.2; implementação com Opus 5.5, exceto nas etapas marcadas **[FABLE]**.

Fatos do código que moldam o plano:
- O mundo é `world.data`: `Float32Array` com 16 floats por splat (posição, opacidade, covariância 3D, cor empacotada, `kind` de movimento, fase/velocidade/alcance/extra).
- `world.anim.update(dt, t)` roda os sistemas; `st.rows` marca blocos de **512 splats** alterados (para enviar só eles à GPU).
- `src/pixel-look.js` já exporta `PixelLook.glsl` em **GLSL ES 3.00** (usa `texelFetch`). Isso indica que a página original do autor usa **WebGL2**.
- `K.character` aceita input `{ move, mz, run, jump, dash, attack, cast, crouch }` e pede `world.height(x, z, y)` para o chão.
- `K.play.fx / debris / eco` são os efeitos de gameplay; `st.poke(eye, dir)` faz o clique acertar a cena.
- O ink-studio é licenciado sob **MIT** (arquivo `LICENSE` adicionado pelo autor no `upstream` e trazido para este fork).

## Como retomar em outro computador

**Estado (2026-11-16):** etapas 0 a 5 concluídas (todo o renderizador e o núcleo do jogo). **Próximo passo: o código da Etapa 6** (modelo de jogo e modo sem navegador), com o **Opus 5.5**: o desenho do Fable 5.2 já está pronto em [engine-stage6-design.md](engine-stage6-design.md) (contrato em `engine/src/game/types.ts`), e a seção 7 dele é a lista de trabalho, em ordem. Os resultados medidos de cada etapa estão nas seções abaixo.

**Preparar a máquina** (Node 18 ou mais novo, Git, e o Microsoft Edge ou o Chrome para o teste de paridade):
```bash
git clone https://github.com/scostavinicius/shapeshift-labs-ink-studio.git
cd shapeshift-labs-ink-studio
git checkout engine/stage-0
cd engine
npm install
```
O aviso de `allow-scripts` do esbuild no `npm install` pode ser ignorado: tudo funciona sem ele. Não há download de navegador (o harness usa o Edge/Chrome que já existe; `--browser chrome` troca o navegador).

**Comandos** (na pasta `engine/`):
- `npm run dev`: servidor em http://127.0.0.1:5173. Abra `/?file=showcase/farol.js` ou `/?scene=cabinet` (também `burn`, `idol`, `watcher`). Arrastar gira, a roda dá zoom, clicar toca a cena, WASD/setas (ou o analógico esquerdo) movem o ponto que a câmera segue (Shift corre), a tecla **C** alterna entre o estilo padrão e o `colored` (`&look=colored` já abre nele).
- `npm test`: typecheck e testes.
- `npm run live`: abre a página ao vivo no navegador headless, mede fps, tempo por quadro e linhas enviadas, e confere se a ordem do Worker é idêntica à calculada na página. Depois testa o núcleo do jogo com o mouse de verdade (arrastar o `farol`, clicar no `idol`; só essa parte: `npm run live -- --only core`). Falha se algo der errado.
- `npm run parity -- --min 99`: compara o renderizador da engine com o do terminal em 60 casos (os dois estilos) e falha se algum cair abaixo de 99%. As imagens ficam em `engine/test/parity/out/` (não vão para o git).
- `npm test` na **raiz** do repositório roda os 171 testes do ink-studio; a engine não altera `src/`, `cli/`, nem `demos/`.

**O que não está no repositório** (é gerado de novo): `node_modules/`, `studio/out/`, `engine/test/parity/out/`, `engine/test/live/out/`.

**Escolha do modelo:** siga a coluna de modelo de cada etapa e o quadro "Resumo de quando usar o Fable" mais abaixo. Uma nova sessão não lembra desta conversa: comece pedindo para ela ler `docs/engine-plan.md` e fazer a etapa seguinte.

**Remotos:** `origin` é o fork `scostavinicius/shapeshift-labs-ink-studio`; o repositório original do autor, `siliconjungle/shapeshift-labs-ink-studio`, é o `upstream` (`git remote add upstream https://github.com/siliconjungle/shapeshift-labs-ink-studio.git` em uma máquina nova).

## Decisões de arquitetura

1. **WebGL2, não WebGPU.** O shader do estilo já existe em GLSL, WebGL2 roda em qualquer navegador e WebView (o que mantém aberto um empacotamento leve para desktop depois), e a cena cabe folgada em WebGL2. Isso muda a recomendação que dei antes na conversa.
2. **Lógica de jogo separada do desenho.** O jogo (simulação) roda igual no Node e no navegador. No Node, o renderizador do terminal desenha o mesmo estado. É isso que deixa a engine AI-friendly: a IA roda o jogo com input roteirizado, gera um PNG e confere, sem abrir navegador.
3. **O renderizador do terminal é o gabarito.** Cada etapa do renderizador WebGL2 só está pronta quando a imagem bate com `cli/render.js` na mesma cena, ângulo e instante.
4. **Não reescrever o kit.** A engine carrega `require('../index.js').bundle()` como está. Tipos entram por um arquivo `.d.ts` escrito à mão para a parte do kit que a engine usa.
5. **Zero dependência em runtime.** Dependências só de desenvolvimento (TypeScript, esbuild, Playwright para os testes de paridade).

## Estrutura

```
engine/
  package.json, tsconfig.json
  types/ink-studio.d.ts      tipos do kit usados pela engine
  src/render/                renderizador WebGL2 (etapas 1 a 4)
  src/core/                  loop, input, câmera, clique, Core (etapa 5)
  src/game/                  mundo, entidades, colisão, combate (etapas 6 e 7)
  src/ui/                    HUD em DOM, áudio (etapa 8)
  src/headless/              o mesmo jogo rodando no Node + CLI (etapa 6)
  test/parity/               comparação WebGL2 x cli/render.js
  examples/arena/            jogo de demonstração (etapa 10)
  AGENTS.md                  guia para a IA escrever jogos (etapa 9)
docs/engine-plan.md          cópia deste plano no repositório
```

## Etapas

Cada etapa tem um critério de "pronto". Faça uma por sessão, na ordem.

### Etapa 0 — Preparação · Opus 5.5 · ✅ concluída

Resultado:
- Licença verificada em 2026-11-16: o repositório no GitHub é público, mas **não tem arquivo LICENSE** e o `package.json` diz `UNLICENSED`. Sem licença, vale "todos os direitos reservados": dá para estudar e desenvolver, mas publicar ou distribuir um jogo exige permissão do autor.
- **Atualização:** o autor adicionou a licença **MIT** ao repositório original (`upstream`, PR #1, `LICENSE` + `"license": "MIT"` no `package.json`), e ela foi trazida para `main` e `engine/stage-0`. Publicar e distribuir está liberado, desde que o aviso de copyright e o texto da licença acompanhem as cópias.
- `engine/` criado: `npm run dev` (servidor em http://127.0.0.1:5173, aceita `?scene=<id>` ou `?file=<caminho de um módulo de cena>`), `npm run build`, `npm test` (typecheck + testes em `engine/test/`).
- O kit vai para o navegador sem alteração, por `engine/scripts/kit.mjs` (expõe `window.INK`); os tipos ficam em `engine/types/ink-studio.d.ts`.

- Copiar este plano para `docs/engine-plan.md`.
- ~~**Confirmar a licença** do ink-studio com o autor ou no GitHub.~~ Resolvido: MIT.
- Criar `engine/` com TypeScript e esbuild, um servidor de desenvolvimento em Node que serve a página e o bundle do kit, e uma página que carrega uma cena (`burn`) e imprime `world.count`.
- Escrever `types/ink-studio.d.ts` para `World`, `Stage`, `makeBuilder`, `makeSculpt` e o que mais for usado.
- **Pronto quando:** `npm run dev` abre a página e o console mostra a contagem de splats de `burn`; `npm test` do repositório raiz continua passando.

### Etapa 1 — Harness de paridade · Opus 5.5 · ✅ concluída

Resultado:
- `npm run parity` (em `engine/`) roda os 30 casos (5 cenas × 2 instantes × 3 ângulos) no Edge headless via `playwright-core` (sem baixar navegador; `--browser chrome` usa o Chrome). Leva ~25 s. Imagens em `engine/test/parity/out/<caso>.png` (referência | engine | diferença) e `report.json`.
- **Métrica oficial: "foreground parity"**, a porcentagem de pixels iguais entre os que não são fundo em pelo menos uma das duas imagens. Uma imagem vazia dá 0% em qualquer cena. As metas das próximas etapas usam essa métrica. `--min N` faz o comando falhar se o pior caso de alguma cena ficar abaixo de N%.
- Hoje todos os casos dão 0% ("no renderer"), como esperado. A grade de pixels (`px`, `W`, `H`) calculada pela engine em `src/render/view.ts` já bate com a do `cli/render.js` em todos os casos.
- O mundo é posicionado no tempo pelo mesmo código nos dois lados: `src/shared/pose.mjs` (cópia fiel do `pose()` do CLI, incluindo ossos).
- O navegador headless desta máquina tem WebGL2, `EXT_color_buffer_float` e `EXT_float_blend` (GPU AMD via ANGLE/D3D11). O harness imprime isso no início de cada execução, para a Etapa 2 saber com o que conta.
- Observação para a Etapa 6: montar o mesmo mundo duas vezes e avançar até o mesmo instante dá quase os mesmos splats, mas o teste só exige menos de 5% de diferença. O determinismo completo é trabalho da Etapa 6.

- `test/parity/`: o servidor Node gera a imagem de referência com `R.render(world, {...})` (mesmo padrão de [showcase/spin.js](../showcase/spin.js)); a página desenha a mesma cena no canvas e devolve os pixels; um script compara.
- Métrica: porcentagem de pixels com a mesma cor de paleta, mais uma imagem de diferença salva em disco.
- Rodar com Playwright (Chromium headless) para a IA conseguir executar sozinha.
- Conjunto fixo de casos: `watcher`, `burn`, `cabinet`, `idol` e `showcase/farol.js`, em 3 ângulos e 2 instantes cada.
- **Pronto quando:** o harness roda de ponta a ponta e reporta 0% (ainda não há renderizador), com as imagens de diferença geradas.

### Etapa 2 — Passo de splats · **[FABLE]** · ✅ concluída

Resultado (`npm run parity -- --min 99`, 30 casos):
- **Paridade de 99,98% a 100% em todos os casos**, nas 5 cenas, nos instantes 0 e 2 (a meta era 90% só no instante 0).
- `src/render/order.ts`: profundidade e ordenação na CPU (radix sort estável sobre os bits do float32, igual à ordenação estável da referência). `src/render/shaders.ts`: o shader de splats. `src/render/splat-renderer.ts`: os três alvos com mistura pré-multiplicada.
- Os três alvos são todos em float (32 bits quando há `EXT_float_blend`, senão 16). O vidro também: em 8 bits as somas pequenas se perdiam. O limite de 1 do vidro é aplicado na leitura.
- A página (`npm run dev`) já mostra a cena **ao vivo**: arrastar gira, a roda dá zoom. Medido no Edge headless desta máquina: `farol` (126 mil splats) e `cabinet` a 60 fps, mesmo reenviando todos os splats a cada quadro. `stuff` fica em 7 a 29 fps, e o custo ali é a simulação MPM na CPU, não o desenho (assunto da Etapa 11).
- Adiantado da Etapa 3: o passo final do modo padrão inteiro (refração do vidro, sombra de contato, contorno, dithering, paleta e `anim.grade`) já está portado e dentro dos 100%.

A parte mais difícil do projeto. Reproduzir o laço principal de `render()` em [cli/render.js](../cli/render.js) (linhas 51 a 355):
- Dados numa textura `RGBA32F` de 2048 texels de largura (4 texels por splat, 512 splats por linha, casando com `st.rows`).
- Vertex shader: os movimentos por `kind` (1 a 15, mais os bits 512 "born" e 1024 "wet"), a projeção da covariância 3D para elipse 2D (as contas `j00/j02/j12`, `A/Bq/C`, o `+0.15`, o limite `limx/limy`), um quad instanciado por splat.
- Fragment shader: `exp(pw)`, o corte duro para splats sólidos (`0.99 * smoothstep(0.38, 0.62, gg)`), neblina.
- Três alvos em `RGBA16F` com blending pré-multiplicado, para reproduzir de uma vez as três regras de mistura: cor (`over`), profundidade (só sólidos sem a flag 1) e vidro (soma para vidro, apaga para sólido).
- Ordenação de trás para frente na CPU por profundidade (com `world.back` forçado ao fundo), enviada como buffer de índices de instância.
- Resolução baixa: mesmo cálculo de `px`, `W`, `H` do terminal (o tamanho do pixel de arte não muda com o zoom da cena).
- **Pronto quando:** com um passo final provisório (só "cor de paleta mais próxima"), a paridade passa de 90% em todas as cenas paradas (`t=0`).

### Etapa 3 — Passo final do estilo · Opus 5.5 · ✅ concluída

Resultado (`npm run parity -- --min 99`, agora 60 casos: os 30 de antes em cada um dos dois estilos):
- O modo padrão foi feito na Etapa 2. Aqui entrou o **modo `colored`**: a cena é desenhada na grade normal e numa grade 2× mais fina; a normal passa por vidro e sombra de contato, as duas são guardadas em 8 bits, e o `PixelLook.glsl` do próprio kit é usado **como está** para juntar as duas. `src/render/shaders.ts` (`WORKED_FS`, `QUANT_FS`, `coloredFS`) e `src/render/splat-renderer.ts`.
- **Paridade de 99,98% a 100% nos 60 casos.** O que sobra são no máximo 3 pixels por imagem.
- O ajuste que levou de 86–99% para 100%: arredondar a cor para bytes no próprio shader (`floor(c * 255 + 0.5) / 255`, como o `Math.round` da referência) antes de gravar em alvos de 8 bits. A conversão automática da GPU arredondava diferente nos tons misturados dos contornos.
- O harness agora diz **quanto** os pixels diferentes se afastam (até 1, até 2, até 16, mais), o que separa erro de arredondamento de erro de desenho.
- Limite herdado do `PixelLook.glsl`: no máximo 48 cores na paleta no modo `colored` (o renderizador dá um erro claro se passar).
- Desempenho medido no Edge headless: `cabinet` a 56 fps no `colored` (60 no padrão); `farol` cai para 30 fps no `colored` (126 mil splats desenhados duas vezes, a segunda numa grade com 4× mais pixels). Fica para as etapas 4 e 11.

### Etapa 4 — Mundo vivo na GPU · Opus 5.5, com um trecho **[FABLE]** · ✅ concluída

Resultado da parte do Opus:
- `SplatRenderer.upload(world)` envia só o que mudou, seguindo o protocolo do kit (o mesmo que `ink-studio perf` mede): as linhas de 512 splats marcadas em `anim.rows` (e zera as marcas); sem marcas, o trecho `anim.start .. start + count`; em mundos com ossos, tudo, enquanto os ossos forem calculados na CPU.
- O harness de paridade e a página ao vivo usam esse envio incremental. Assim, um sistema que escreva splats sem marcar a linha aparece como diferença na paridade. Resultado: **100% nos 60 casos**, com o modo `marked` confirmado (o harness agora imprime quantas linhas cada caso enviou).
- `anim.kick` e `anim.zoom` já estavam em `src/render/view.ts` desde a Etapa 1.
- Medido ao vivo no Edge headless (linhas enviadas por quadro, mediana / total): `farol` 23 / 247 a 60 fps, **8,1 ms de CPU por quadro (eram 16,7)**; `burn` 2 / 97; `idol` 4 / 153; `watcher` 27 / 220; `cabinet` 149 / 149 (ossos: tudo). `farol` no `colored` continua em ~32 fps com só 9,6 ms de CPU: o limite ali é a GPU (a segunda passada na grade 2×), não o envio.
- Atenção para as etapas 5 e 7: `K.play.fx`/`K.play.debris` (kg-play) e `K.character` escrevem nos splats **sem marcar** `rows` (o jogo original envia o trecho deles por conta própria). Quem usar esses módulos precisa marcar as linhas do trecho deles a cada quadro.

Resultado do trecho **[FABLE]**:
- **Ossos na GPU.** Splats carregados por ossos (kinds 12 e 13) ficam em repouso nos dados; o shader os coloca no lugar a partir de `anim.bones` (textura de 3 texels por osso), com a mesma conta de `K.bones.posed`: posição pelo primeiro osso misturada com o segundo pelo peso, forma (covariância) pelo primeiro, e o kind 13 volta a balançar como grama. A ordenação faz a mesma conta. A página chama `poseAt(..., { bones: 'gpu' })`; a referência em Node continua posando na CPU, então a paridade do `cabinet` (36 mil splats em 23 ossos) valida a conta: **100%**, e ele passou a enviar **1 linha de 149 por quadro**.
- **Ordenação num Web Worker** (`src/render/sort-worker.ts`, `src/render/sorter.ts`). O Worker mantém a própria cópia dos splats, atualizada pelas mesmas linhas que vão para a GPU, e faz a conta de profundidade e a ordenação inteiras fora da thread da página. A página só troca mensagens e usa a ordem mais nova que tiver (um ou dois quadros atrasada). Sem `useSortWorker`, o renderizador ordena em passo, que é exato: é o que o harness de paridade usa.
- **Quando reordenar:** sempre que o Worker estiver livre. Como não custa nada à página, não vale a complexidade de detectar "nada mudou" (quase toda cena tem splats que se movem no shader com o tempo).
- `npm run live` confere isso de verdade: em três instantes por cena, a ordem do Worker é **idêntica, elemento a elemento**, à ordenada na página, e as duas imagens são iguais. (A matriz da câmera vai para o Worker em 64 bits; em 32 bits, centenas de quase-empates trocavam de lugar.)
- Tempo da thread da página por quadro, com Worker / sem (Edge headless, 60 fps em todas): `farol` **1,8 / 8,2 ms**; `cabinet` **1,0 / 5,5 ms**; `idol` 2,1 / 4,8; `burn` 5,1 / 7,8; `watcher` ~6 / ~8,7. A ordenação em si leva de 2 a 8 ms no Worker.
- `farol` no `colored` segue em ~33 fps com 3,3 ms de CPU: o gargalo é a GPU (segunda passada na grade 2×), assunto da Etapa 11.

### Etapa 5 — Núcleo do jogo · Opus 5.5 · ✅ concluída

Resultado (`engine/src/core/`, sem DOM exceto `DomInput`, então roda igual no Node):
- `loop.ts` — `FixedLoop`: passos de exatamente 1/60 s; o relógio é `passos × 1/60` (contado, não somado: não deriva). Um quadro muito atrasado roda no máximo 8 passos e descarta o resto (substitui o remendo de "aba em segundo plano" da página).
- `input.ts` — `InputState` (sem DOM: `press/release/stick/turn/click`, testável e roteirizável) e `DomInput` (teclado por `e.code`, arrastar o canvas gira, clique sem arrastar é toque, roda dá zoom, gamepad no layout padrão lido a cada passo). `sample(yaw)` entrega exatamente o `inp` do `K.character` — `move/mz` já em eixos do mundo relativos à câmera, `jump/dash/attack/cast` verdadeiros só no passo em que foram apertados (um toque mais curto que um passo não se perde), `jumpHeld/run/crouch` enquanto seguros. Teclas: WASD/setas, Shift corre, Espaço pula, J ataca, K dash, L cast, Ctrl agacha. Gamepad: A pula, B dash, X ataca, Y cast, LB agacha, RB/RT corre, analógico direito gira.
- `camera.ts` — `FollowCamera`: órbita (yaw/pitch/distância) em torno de um ponto seguido com mola criticamente amortecida, exata para qualquer `dt` (60 passos de 1/60 e 120 de 1/120 dão o mesmo resultado); girar é imediato, seguir e zoom são suaves; limites de pitch, distância e uma caixa opcional para o alvo.
- `pick.ts` — `rayThrough(view, u, v)`: o inverso exato da projeção do shader; `project()` faz o caminho de ida.
- `core.ts` — `Core`: junta tudo. Ordem de um passo: amostra o input → câmera gira/zoom → cliques viram raios (pela vista que estava na tela) e chamam `st.poke` **antes** do mundo avançar, como o `--poke` do CLI → `onStep` do jogo → câmera suaviza → `poseAt` até o novo instante. `core.run(s)` roda todos os passos sem o limite por quadro (testes e, na Etapa 6, o modo headless).
- A página (`main.ts`) usa o `Core`; o "jogo" do visualizador é um ponto que WASD move e a câmera segue.

Medido:
- `npm test`: 14 testes (6 novos em `test/core.test.mjs`). Entre eles, em Node, um clique na cabeça do `idol` (projetado, convertido em raio, passado pelo `Core`) tira **691 splats** do lugar 1 s depois; duas execuções sem clique diferem em **0**.
- `npm run live` (Edge headless): arrastando o `farol` com o mouse real, **180 fps a 0,6 ms de CPU por quadro**, a câmera gira e 3,67 s simulados em 3,67 s reais (o relógio do jogo não depende do fps); arrastar não conta como toque. Um clique real no `idol` acerta a cabeça e solta pedaços (imagem em `test/live/out/`). A ordem do Worker continua idêntica à da página em todas as cenas.
- O fps headless agora passa de 60 (antes ficava em 60): a página desenha a cada quadro do navegador, e a maioria dos quadros não roda passo nenhum, por isso a mediana de linhas enviadas por quadro virou 0. Nos quadros sem passo a imagem é a mesma; pular o desenho neles é uma otimização possível para a Etapa 11.
- Para a Etapa 6: a câmera e o mundo andam em passos de 1/60 sem interpolação entre eles; em telas de 120/144 Hz pode haver um leve tremor. Interpolar só a câmera (o `advance` já devolve a fração do próximo passo) resolve, se for preciso.

Plano original:
- Loop com passo fixo de 1/60 s (a simulação nunca depende do fps).
- Input: teclado, mouse e gamepad mapeados para ações, entregues no formato que `K.character.update` já espera.
- Câmera: segue um alvo com mola, yaw/pitch/distância, limites.
- Clique: converte o pixel em raio e chama `st.poke(eye, dir)`.
- **Pronto quando:** dá para orbitar a cena `farol` com o mouse a 60 fps e clicar em `idol` quebra pedaços.

### Etapa 6 — Modelo de jogo e modo sem navegador · **[FABLE]** para o desenho, Opus 5.5 para o código
Decisões que definem o quanto a engine é AI-friendly; erro aqui custa caro depois.

**Desenho [FABLE]: ✅ concluído** em [engine-stage6-design.md](engine-stage6-design.md), com o contrato em `engine/src/game/types.ts`. Resumo das decisões:
- Um jogo é uma cena do ink-studio **sem alteração** mais uma declaração (`defineGame`). A engine entrega à cena um kit-fachada que intercepta `makeBuilder`, `makeSculpt`, `S.bake` e `B.finish` (testado no `farol`: constrói igual).
- Atores (`K.character`) são declarados com um máximo e sorteados de um pool; um inimigo é um ator cujo "cérebro" devolve o mesmo `StepInput` do jogador.
- Determinismo: passo fixo, ordem por `id`, e a engine troca `Math.random`, `K.rnd` e `K.seed` por geradores do próprio jogo durante o build e cada passo (o `kg-play.js` usa `Math.random` 21 vezes).
- Colisão: o campo do sculpt só conhece o último bake, então é amostrado logo após cada bake num mapa de colunas com trechos sólidos (0,25 de lado). Medido no `farol`: 1969 colunas, 2193 trechos; a ilha sai andável, o farol e a casa viram parede e fora é vazio, o que já impede cair da borda.
- O código (Opus 5.5) segue a seção 7 do documento.
- **[FABLE]** Definir a API de jogo: como se declara um nível (função `build` que devolve mundo + stage + pontos de spawn), entidades (jogador, inimigo, objeto, gatilho), e o contrato de determinismo (mesma seed + mesmo roteiro de input = mesmo resultado, usando `K.seed`/`K.rnd`, nunca `Math.random`).
- **[FABLE]** Colisão: na construção do nível, cozinhar `S.sdf`/`S.heightAt` numa grade (mapa de altura + células bloqueadas) e expor `world.height(x, z, y)` para o `K.character`.
- Modo sem navegador: `engine/src/headless` roda o mesmo loop no Node com input roteirizado e desenha com `cli/render.js`. Comando: `node engine/cli.js shot <jogo> --input roteiro.json --t 5 --out quadro.png`.
- **Pronto quando:** um personagem `K.character` anda sobre a ilha do `farol` sem atravessar o farol nem cair fora da borda; o comando `shot` gera o mesmo quadro duas vezes seguidas (byte a byte) e esse quadro bate ≥ 95% com o navegador.

### Etapa 7 — Combate e inimigos · Opus 5.5
- Vida, dano, invencibilidade curta, knockback (`ch.hurt`), morte e respawn.
- Acerto de ataque usando `ch.striking()`.
- Inimigos simples (perseguir, atacar, recuar) usando `K.character` ou `K.creature` e `K.anim.steer`.
- Efeitos com `K.play.fx`, `K.play.debris` e `K.play.eco` (chão queimado/congelado que persiste).
- **Pronto quando:** um teste headless roteirizado mostra o jogador matando um inimigo e perdendo vida ao ser atingido, conferido por asserções no estado (não só pela imagem).

### Etapa 8 — HUD, áudio e save · Opus 5.5
- HUD em DOM por cima do canvas: vida, barra de habilidades, mensagens. Fonte e escala em pixel-art.
- Áudio com WebAudio: efeitos e música, com volume por canal.
- Save em JSON (localStorage no navegador, arquivo no Node).
- **Pronto quando:** a vida no HUD acompanha o estado; recarregar a página restaura a posição e a vida salvas.

### Etapa 9 — Camada para a IA · Opus 5.5
- `engine/AGENTS.md`: como criar um nível, um inimigo, um efeito; o ciclo "escreve → `shot` → olha o PNG → corrige"; armadilhas conhecidas (ordem de `bake`, alocar `pool` antes de `B.finish`, sólidos negativos apagam o que está dentro deles, graus × radianos).
- Validador de nível com mensagens que dizem o que provavelmente se quis (mesmo espírito de `K.diorama.check` em [src/kit/kc-data.js](../src/kit/kc-data.js)).
- Comandos: `shot`, `sheet` (vários instantes), `play` (abre no navegador), `check` (paridade).
- Três exemplos pequenos e completos.
- **Pronto quando:** numa sessão nova, sem contexto, o Opus cria um nível jogável novo lendo só o `AGENTS.md`.

### Etapa 10 — Jogo de demonstração · Opus 5.5
- `examples/arena`: uma arena circular como a do vídeo, um jogador, 2 tipos de inimigo, um chefe simples, vitória e derrota.
- **Pronto quando:** dá para jogar do início ao fim no navegador a 60 fps e o roteiro headless de "vitória" passa.

### Etapa 11 — Desempenho · **[FABLE]**
- Medir antes de mexer: perfil de CPU (simulação × ordenação × envio) e de GPU na arena cheia.
- Decidir, com números, o que vale mover para Worker ou WebAssembly (candidatos: ordenação, `K.mpm`, `K.xpbd`, partículas).
- **Pronto quando:** a arena mantém 60 fps com 300 mil splats numa GPU integrada, ou existe um relatório dizendo o que impede e quanto custaria resolver.

## Resumo de quando usar o Fable

| Etapa | Modelo |
|---|---|
| 0, 1 | Opus 5.5 |
| **2 — passo de splats** | **Fable 5.2** |
| 3 | Opus 5.5 (Fable se travar) |
| 4 | Opus 5.5, **Fable na ordenação e nos ossos** |
| 5 | Opus 5.5 |
| **6 — API de jogo, determinismo, colisão** | **Fable 5.2 no desenho**, Opus no código |
| 7, 8, 9, 10 | Opus 5.5 |
| **11 — desempenho** | **Fable 5.2** |

## Verificação de ponta a ponta

- `npm test` na raiz: os testes do ink-studio continuam passando (a engine não altera `src/`).
- `npm run parity` em `engine/`: tabela de paridade por cena, com as metas de cada etapa.
- `node engine/cli.js shot examples/arena --input vitoria.json --t 30`: gera o quadro final e as asserções de estado passam.
- Abrir `npm run dev` e jogar a arena no navegador interno, conferindo 60 fps e o HUD.

## Riscos

- ~~**Licença** não confirmada (etapa 0).~~ Resolvido: o ink-studio é MIT.
- **Paridade exata é impossível** (ponto flutuante e empates na ordenação diferem entre CPU e GPU); por isso as metas são porcentagens, com imagem de diferença para julgar o resto a olho.
- **`RGBA16F` com blending** depende da extensão `EXT_color_buffer_float`; se faltar em algum aparelho, o plano B é empacotar profundidade em `RGBA8` (decidir na etapa 2).
- **Determinismo** pode quebrar se algum sistema do kit usar `Math.random` internamente; a etapa 6 precisa auditar isso com `grep`.
