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

**Estado (2026-11-17):** **todas as etapas (0 a 11) concluídas** (renderizador, núcleo do jogo, modelo de jogo com colisão, determinismo e modo sem navegador, combate e inimigos, HUD, áudio e save, camada para a IA, jogo de demonstração, desempenho). O determinismo vale **entre motores de JavaScript** (Math determinístico; ver [engine-determinism.md](engine-determinism.md)). **O plano terminou.** O que ficou para depois, com custo estimado, está na seção 4 de [engine-performance.md](engine-performance.md) (desempenho em GPUs integradas antigas) e no item 1 das decisões dele (personagens carregados por ossos na GPU). Os resultados medidos de cada etapa estão nas seções abaixo.

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
- `/?game=farol-walk`: um jogo (`engine/examples/<nome>/game.ts`) jogado no navegador; `&input=farol-walk/walk.json&t=6` roda o roteiro até 6 s como a CLI e para o relógio.
- `node cli.js shot farol-walk --input examples/farol-walk/walk.json --t 6 [--out q.png] [--state estado.json] [--colored]`: o mesmo jogo sem navegador; grava o PNG em `engine/out/` e termina com uma linha JSON `{ png, state, hash, t, steps }`.
- `/?game=farol-fight` ou `node cli.js shot farol-fight --input examples/farol-fight/fight.json --t 8.3`: a luta (J golpeia, K dá dash). Na página: M liga e desliga a música, N tira todo o som, P salva agora; o jogo também se salva sozinho a cada 2 s e ao sair, e volta de onde parou ao abrir de novo (`&fresh=1` começa do zero).
- `node cli.js shot farol-fight --t 4 --input ... --save s.json` grava um save; `--load s.json` começa dele (o mesmo formato do save da página).
- `npm test`: typecheck e testes.
- `npm run live`: abre a página ao vivo no navegador headless, mede fps, tempo por quadro e linhas enviadas, e confere se a ordem do Worker é idêntica à calculada na página. Depois testa o núcleo do jogo com o mouse de verdade (arrastar o `farol`, clicar no `idol`; só essa parte: `npm run live -- --only core`). Falha se algo der errado.
- `npm run parity -- --min 99`: compara o renderizador da engine com o do terminal em 60 casos (os dois estilos) e falha se algum cair abaixo de 99%. As imagens ficam em `engine/test/parity/out/` (não vão para o git).
- `npm test` na **raiz** do repositório roda os 171 testes do ink-studio; a engine não altera `src/`, `cli/`, nem `demos/`.

**O que não está no repositório** (é gerado de novo): `node_modules/`, `studio/out/`, `engine/test/parity/out/`, `engine/test/live/out/`, `engine/out/`.

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

### Etapa 6 — Modelo de jogo e modo sem navegador · **[FABLE]** para o desenho, Opus 5.5 para o código · ✅ concluída
Decisões que definem o quanto a engine é AI-friendly; erro aqui custa caro depois.

**Desenho [FABLE]: ✅ concluído** em [engine-stage6-design.md](engine-stage6-design.md), com o contrato em `engine/src/game/types.ts`. Resumo das decisões:
- Um jogo é uma cena do ink-studio **sem alteração** mais uma declaração (`defineGame`). A engine entrega à cena um kit-fachada que intercepta `makeBuilder`, `makeSculpt`, `S.bake` e `B.finish` (testado no `farol`: constrói igual).
- Atores (`K.character`) são declarados com um máximo e sorteados de um pool; um inimigo é um ator cujo "cérebro" devolve o mesmo `StepInput` do jogador.
- Determinismo: passo fixo, ordem por `id`, e a engine troca `Math.random`, `K.rnd` e `K.seed` por geradores do próprio jogo durante o build e cada passo (o `kg-play.js` usa `Math.random` 21 vezes).
- Colisão: o campo do sculpt só conhece o último bake, então é amostrado logo após cada bake num mapa de colunas com trechos sólidos (0,25 de lado). Medido no `farol`: 1969 colunas, 2193 trechos; a ilha sai andável, o farol e a casa viram parede e fora é vazio, o que já impede cair da borda.
- O código (Opus 5.5) segue a seção 7 do documento.

**Código (Opus 5.5): ✅ concluído.** `engine/src/game/` (`rng.ts`, `collision.ts`, `level.ts`, `game.ts`, `script.ts`), `engine/src/headless/run.ts`, `engine/cli.js shot`, `engine/examples/farol-walk/` (jogo e roteiro `walk.json`), `?game=` na página, e um caso de jogo no harness de paridade.

Medido:
- **Colisão no `farol`:** 49 ms de amostragem no total (bake 0: 1982 colunas, 2205 trechos; bake 1, o facho, é `ghost`: 0). Concorda com o `S.heightAt` do próprio sculpt em 1976 de 2000 pontos sorteados (98,8%; o resto fica em bordas, a até meia célula); de 207 mil consultas, só 2 diferem da varredura da região inteira. Uma consulta `height()` custa ~55 ns.
- **Desvio do desenho, medido:** a poda por blocos da seção 4.2 não funciona, porque o campo do sculpt é limitado a 1,0 longe de tudo (`MARG` em `src/sculpt.js`): ele não sabe dizer que um bloco está vazio. No lugar, a região de cada bake é a **caixa dos splats que aquele bake escreveu** (`B.dabAt`), com 1 de folga: as superfícies dos sólidos estão onde os splats deles estão. O `S.freeze()` (que não desenha) varre a região inteira.
- **`farol-walk` (aceitação):** com o roteiro de 12 s, o personagem chega a 0,92 do eixo do farol (a parede alcança 0,65), nunca fica sem chão sob os pés, nunca cai (y mínimo −0,02) e termina parado na borda leste (x = 6,12).
- **Determinismo:** o mesmo roteiro dá o mesmo `hash` em todos os 180 passos de 3 s; outro roteiro diverge desde o primeiro passo; dois jogos avançando intercalados dão os mesmos `hash` que cada um sozinho; um jogo que usa `K.play.fx` (que chama `Math.random`) dá o mesmo resultado duas vezes, e `Math.random`/`K.rnd`/`K.seed` voltam a ser os originais entre os passos.
- **`shot` duas vezes:** PNG idêntico byte a byte e o mesmo `hash` (`7cb5835f3a13791c` em 6 s).
- **Navegador × Node:** `npm run parity` roda o mesmo roteiro na página: **100%** de paridade nos dois estilos, e o **`hash` do navegador é idêntico ao do Node** (os dois são V8: a simulação é a mesma bit a bit, não só parecida).
- **Ao vivo** (`npm run live`, Edge headless): `?game=farol-walk` com o teclado real, W por 1,5 s anda 3,9 unidades, a 180 fps e 0,5 ms de CPU por quadro.

O que a Etapa 7 precisa saber:
- O `respawn` do `K.character` procura chão só até 6 unidades abaixo de y = 7; o `spawnActor` corrige a altura logo depois, com o chão do ponto de spawn.
- Efeitos do kit que reservam splats (`K.play.fx`, `K.play.debris`) entram por `build(ctx)` com `ctx.reserve(() => K.play.fx(ctx.B, n))`: a engine liga ao mundo e marca as linhas a cada passo; o objeto fica em `game.built`.
- O `farol` + 1 personagem constrói em ~1,1 s (a cena sozinha leva ~0,95 s; a colisão, 0,05 s).
- Os testes de determinismo constroem o `farol` várias vezes: o `npm test` da engine leva ~20 s.
- **[FABLE]** Definir a API de jogo: como se declara um nível (função `build` que devolve mundo + stage + pontos de spawn), entidades (jogador, inimigo, objeto, gatilho), e o contrato de determinismo (mesma seed + mesmo roteiro de input = mesmo resultado, usando `K.seed`/`K.rnd`, nunca `Math.random`).
- **[FABLE]** Colisão: na construção do nível, cozinhar `S.sdf`/`S.heightAt` numa grade (mapa de altura + células bloqueadas) e expor `world.height(x, z, y)` para o `K.character`.
- Modo sem navegador: `engine/src/headless` roda o mesmo loop no Node com input roteirizado e desenha com `cli/render.js`. Comando: `node engine/cli.js shot <jogo> --input roteiro.json --t 5 --out quadro.png`.
- **Pronto quando:** um personagem `K.character` anda sobre a ilha do `farol` sem atravessar o farol nem cair fora da borda; o comando `shot` gera o mesmo quadro duas vezes seguidas (byte a byte) e esse quadro bate ≥ 95% com o navegador.

### Etapa 7 — Combate e inimigos · Opus 5.5 · ✅ concluída

Resultado (`engine/src/game/combat.ts`, `brains.ts`, `effects.ts`; exemplo `engine/examples/farol-fight/` com o roteiro `fight.json`):
- **O que o kit faz e o que ficou com a engine.** O `K.character` sabe golpear (`ch.striking()`) e apanhar (`ch.hurt(kx, kz)`: arremesso, piscar, −1 de vida), mas não decide quem acerta quem. Ele **não** marca `st.connected` (então um golpe acertaria a cada passo da janela de golpe) e o `hurt` **não** checa invencibilidade. Os dois ficaram com o `Combat`.
- **Regras (`def.combat`, ligado por padrão):** um golpe acerta atores de outro time (`team`: `'player'` para o cérebro do jogador, `'enemy'` para os outros, ou o que o `spawnActor` disser), dentro do alcance (`spec.reach` do atacante + o raio do alvo) e de um arco de 70° à frente; cada golpe acerta cada alvo uma vez. Dano por ator (`ActorDef.damage`), invencibilidade de 0,6 s, knockback do próprio kit. Com 0 de vida o ator morre mesmo sem `spec.mortal`: um inimigo vira pedaços (`debris`) e sai de cena (o lugar dele no pool fica livre); o jogador se levanta no ponto de spawn 1,5 s depois. Eventos: `hit`, `death` (com a posição `at`), `respawn`; `game.events` lista os do passo.
- **Inimigos (`chaser()`):** um cérebro que persegue o adversário mais próximo que **vê** (`collision.clear`: uma parede esconde o jogador), golpeia quando está ao alcance e esfriou, recua um pouco e volta. Tudo o que ele lembra fica em `self.data.brain` (dados simples: entram no snapshot e no hash); o ritmo varia com `game.rng()`. O `K.anim.steer` do plano não foi preciso: o cérebro devolve o mesmo `StepInput` do jogador, e o `K.character` já cuida de andar e virar.
- **Efeitos (`def.effects`):** `fx` (faíscas no golpe, anel na morte), `debris` (o corpo do inimigo em pedaços) e `eco` (o chão que queima ou congela e **guarda a marca**). O `eco` guarda a memória numa textura feita para o shader do jogo original, que o nosso renderizador não lê: a engine **repinta os splats do chão** com um *painter* do stage, só nas células que mudaram. O fogo do kit se espalha até ~14 células; `effects.weather.rain` (usado no exemplo: 0,6) contém o incêndio, e `effects.fuel` diz o quanto o chão queima.

Medido:
- **Pronto quando (cumprido):** `test/combat.test.mjs` roda a luta roteirizada do `farol-fight` sem navegador e confere **no estado e nos eventos**: os inimigos acertam o jogador (vida 5 → 4 → 3 → 2 → 1 → 0), ele morre aos 5,58 s e volta aos 7,08 s com vida 5, mata os dois inimigos (7,93 s e 10,10 s), `state.kills = 2`, `won = true`, só o jogador fica em cena, e o chão continua queimado onde cada inimigo caiu.
- Mais 4 testes de regras numa cena plana: alcance e arco (só quem está à frente leva), um acerto por golpe, invencibilidade, times, morte e volta do jogador, o inimigo que não vê através do pilar, e a marca do fogo nos splats do chão (mais de 80% repintados, nada mudou longe dali, e a marca fica).
- A mesma luta duas vezes: os mesmos eventos, golpe a golpe, e o mesmo `hash`.
- `npm run parity`: a luta aos 8,3 s (pedaços no ar, chão em brasa) dá **100%** de paridade no navegador, nos dois estilos.
- `npm run live`: no `?game=farol-fight`, ao vivo, os inimigos vêm, acertam o jogador, o jogador mata um deles com J; 180 fps, 0,6 ms de CPU por quadro.

**Achado que muda o contrato de determinismo da Etapa 6.** O `hash` da luta no Edge **difere** do Node, embora as imagens batam 100%. A causa: **o Node 24 (V8 13.6) e o Edge 157 arredondam diferente o último bit** de `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `log`, `cbrt`, `sinh`, `tanh` e outras (de 3% a 18% das entradas, medido em 20 mil por função); só `pow`, `hypot` e `sqrt` batem. No `farol-walk` o `hash` bateu por sorte (os splats são `Float32` e engolem diferenças de 1 ulp); na luta, o ângulo dos inimigos (`atan2`) diverge no passo 6. O que continua valendo: no **mesmo** motor e versão (todos os testes em Node, ou a mesma versão do navegador), mesma seed + mesmo roteiro = mesmo jogo, bit a bit. O que não vale: gravar uma partida num navegador e garantir o mesmo resultado no Node de outra versão do V8. **Decidido e feito: Math determinístico.** Durante o build e cada passo, a engine troca as 22 funções transcendentes do `Math` por ports da fdlibm em JavaScript puro (`engine/src/game/dmath.ts`), como já fazia com o `Math.random`. Resultado: a luta inteira (720 passos) dá o **mesmo `hash` no Edge e no Node, passo a passo**, e o harness de paridade voltou a falhar se o `hash` diferir. Custo medido: build do `farol` 11% mais lento, passo da luta 15% (0,78 → 0,90 ms). Tudo — a garantia, como funciona, como conferir, a impressão digital `852e6b34ae4e5869` e o que um port para outra linguagem precisa reproduzir — está em [engine-determinism.md](engine-determinism.md).

Plano original:
- Vida, dano, invencibilidade curta, knockback (`ch.hurt`), morte e respawn.
- Acerto de ataque usando `ch.striking()`.
- Inimigos simples (perseguir, atacar, recuar) usando `K.character` ou `K.creature` e `K.anim.steer`.
- Efeitos com `K.play.fx`, `K.play.debris` e `K.play.eco` (chão queimado/congelado que persiste).
- **Pronto quando:** um teste headless roteirizado mostra o jogador matando um inimigo e perdendo vida ao ser atingido, conferido por asserções no estado (não só pela imagem).

### Etapa 8 — HUD, áudio e save · Opus 5.5 · ✅ concluída

Resultado (`engine/src/ui/`: `font.ts`, `hud.ts`, `audio.ts`; `engine/src/game/save.ts`):
- **Fora da simulação, sempre.** HUD e som leem o jogo **entre** os passos: `game.takeEvents()` entrega tudo o que foi emitido desde a última vez, com o instante. Reagir de dentro do passo gastaria o dado do jogo e quebraria o determinismo (o som usa `Math.random` à vontade, porque está fora dele). A engine passou a emitir `swing` quando um ator começa a golpear.
- **HUD** em DOM por cima do canvas: corações de vida (cheios e vazios), a barra de habilidades (J golpe, K dash, L cast se houver; cada caixa enche conforme fica pronta), as linhas do próprio jogo (`def.hud.lines`: no `farol-fight`, `KILLS 1/2` e `ALL CLEAR`) e mensagens que somem sozinhas (`YOU FELL`, `BACK ON YOUR FEET`, `GRUNT DOWN`, `SAVED`, `WELCOME BACK`; o jogo pode dar as suas com `def.hud.message`). **Fonte de pixel própria** (5 × 7, maiúsculas, dígitos e pontuação; nada a baixar), na escala do pixel de arte, e **cores tiradas da paleta da cena** (a mais clara, a mais escura, a mais vermelha e um cinza discreto). Cada pedaço só é redesenhado quando o que mostra muda.
- **Som** com WebAudio: canais geral, efeitos e música, cada um com seu volume, guardados no navegador; M liga e desliga a música, N tira tudo. **Nenhum arquivo de som:** golpe, acerto, morte, volta e save são sintetizados na hora (osciladores e ruído), e a música é um laço curto numa escala pentatônica menor, agendado um pouco à frente. O contexto de áudio só nasce no primeiro gesto do jogador (exigência dos navegadores). Eventos viram sons por `DEFAULT_SOUNDS`, e o jogo acrescenta os seus com `def.sounds`.
- **Save** em JSON (formato `ink-engine-save`, versão 1): o `game.state` e, de cada entidade, lugar, ângulo, vida, se ainda está em cena e os dados (a memória dos cérebros). **Não** guarda o momento do mundo (partículas, fogo no chão, a animação da cena): carregar reconstrói o nível do zero, roda o `init` e põe cada entidade onde o save diz. Um jogador salvo caído volta de pé em casa, com a vida cheia. Entidades que o `init` não cria (nascidas durante o jogo) precisam de `def.brains[kind]` para voltar. No navegador vai para o `localStorage` (a cada 2 s, ao sair da página e com P); no Node, para arquivo (`--save`/`--load`). Um save de outro jogo, de outra versão ou que não é save é recusado dizendo por quê. Carregar roda dentro do dado do jogo, então **o mesmo save + o mesmo roteiro dão o mesmo jogo**.

Medido:
- **Pronto quando (cumprido):** no `npm run live` (Edge headless, teclado de verdade), os corações mostram a vida do jogador em todas as amostras enquanto os inimigos batem (5 → 4 → 3); a página é deixada com o jogador em (2,16; 0,25; 0,64) e vida 3, e ao abrir de novo ele está **no mesmo lugar, com vida 3**, o HUD mostra 3 e diz `WELCOME BACK`. O som roda (contexto `running`; golpes e acertos tocados).
- `test/ui.test.mjs`, sem navegador: a fonte escreve e lê de volta todos os caracteres; numa luta roteirizada de 12 s o HUD mostra a vida certa **em todos os 720 passos** e as mensagens certas na ordem certa; os eventos da luta dão os sons certos (11 acertos, 3 mortes, 1 volta, mais de 20 golpes); um save carregado num jogo novo reproduz posições, vida e estado, e o mesmo save + roteiro dá o mesmo `hash` duas vezes; saves errados são recusados com a razão.

Plano original:
- HUD em DOM por cima do canvas: vida, barra de habilidades, mensagens. Fonte e escala em pixel-art.
- Áudio com WebAudio: efeitos e música, com volume por canal.
- Save em JSON (localStorage no navegador, arquivo no Node).
- **Pronto quando:** a vida no HUD acompanha o estado; recarregar a página restaura a posição e a vida salvas.

### Etapa 9 — Camada para a IA · Opus 5.5 · ✅ concluída

Resultado:
- **[engine/AGENTS.md](../engine/AGENTS.md):** o guia. O ciclo "escreve → `check` → `shot`/`sheet` → olha o PNG → corrige"; o que é um jogo e tudo o que uma definição aceita; como escrever uma cena com o kit (coordenadas, `S.box` com meias medidas, `res`, materiais em rampa de paleta, `B.finish`); atores, cérebros, triggers, props, a ordem do passo; combate, eventos e efeitos; as regras do determinismo; roteiros e saves; uma tabela de armadilhas (ordem de bake, pools depois do `B.finish`, sólidos negativos que apagam o que está dentro, graus × radianos, meias medidas, as cores fixas do `walker`, ghost não é chão...).
- **Validador** (`engine/src/game/validate.ts`): todos os problemas de uma vez, cada um com onde, o quê e o que provavelmente se quis (`->`), mais um código estável. Três passadas: o **código-fonte** do jogo (`Math.random`, relógio, `**`, `Math` guardado no topo do módulo, timers; ignora comentários e textos), a **definição** (forma das coisas, graus onde vão radianos e vice-versa, números fora de propósito) e uma **execução** curta (spawn sem chão, com a sugestão do chão livre mais próximo; spawn dentro de parede; splats feitos depois do `B.finish`; sólidos depois do último bake; nível sem chão; `init` que devolve algo que não é dado; ninguém com cérebro de jogador; ator que cai do mundo ou vira NaN; a mesma partida duas vezes dando resultados diferentes; build ou passo lento). Se o `init` falha, o nível ainda é conferido.
- **Comandos** (`node engine/cli.js ...`, todos terminando numa linha de JSON): `new` (um jogo a partir de um modelo: `blank` com cena própria, `walk`, `fight`), `check` (o validador; `--parity` também desenha no navegador e compara com o Node), `shot`, `sheet` (vários instantes da mesma partida lado a lado), `play` (abre no navegador). O jogo e a engine são empacotados juntos (uma cópia só da engine), e a cena pode ser escrita no próprio módulo do jogo.
- **Três exemplos completos:** `farol-walk` (andar), `farol-fight` (lutar) e o novo **`yard`**: um nível escrito do zero, com um gerador de inimigos durante a partida (uma *prop*), um portão que dá a vitória (um *trigger*), chão que congela onde um inimigo cai, e `def.brains` para o save; o roteiro `win.json` ganha o jogo aos 25 s.
- Correções no caminho: um ator agora aparece no instante em que nasce (antes, só no passo seguinte); o `sheet` mostrava o estado final em todas as linhas; o modelo em branco trazia o jogador e o inimigo com as mesmas cores; o typecheck agora cobre `engine/examples/`.

Medido: `test/ai.test.mjs` (8 testes): o validador acha cada erro típico com a linha e a dica certas; os três exemplos passam **sem erros e sem avisos**; `new` gera um jogo que passa no `check`, e um jogo quebrado de propósito (spawn fora do chão + `Math.random` numa regra) faz o `check` sair com erro e um JSON que diz os três problemas.

**Pronto quando (cumprido):** um agente Opus novo, **sem o contexto desta conversa**, recebeu só "leia engine/AGENTS.md e crie um nível jogável novo, diferente dos exemplos" e fez o **`beacons`** em menos de 3 minutos: uma cena própria (platô de grama, santuário em ruínas, três postes de farol), um jogador, inimigos que acordam a cada farol aceso, vitória (acender os três) e derrota (cair três vezes), HUD, e um roteiro que vence aos 7,2 s. Conferido à parte: `check` sem erros nem avisos, o roteiro chega a `won: true`, o PNG mostra o nível certo, e `check --parity` dá 100% e o mesmo `hash` no navegador. Ficou como quarto exemplo.

O relato dele apontou 10 lacunas, e as que pesavam foram corrigidas:
- **na ferramenta:** o `shot` agora escreve o texto do HUD no PNG (vida e `hud.lines`; `--no-hud` tira), traz o estado do jogo na linha JSON (`game: { player, state, ... }`) e ganhou `--trace 0.5`, que anota o jogador a cada meio segundo, para ajustar roteiros;
- **no guia:** o formato do JSON de cada comando; as medidas do `walker` (anda ≈ 2,7 u/s, corre ≈ 5 u/s, alcance 1,1, degrau até 0,45); como a câmera segue o jogador; a assinatura e o padrão dos triggers (`onEnter(who, game)`, `watch` = `['player']`, raio medido até o pé do ator); a semente do roteiro (substitui a do jogo); o `dither`; e um passo a passo para montar um roteiro que chega a algum lugar.

Plano original:
- `engine/AGENTS.md`: como criar um nível, um inimigo, um efeito; o ciclo "escreve → `shot` → olha o PNG → corrige"; armadilhas conhecidas (ordem de `bake`, alocar `pool` antes de `B.finish`, sólidos negativos apagam o que está dentro deles, graus × radianos).
- Validador de nível com mensagens que dizem o que provavelmente se quis (mesmo espírito de `K.diorama.check` em [src/kit/kc-data.js](../src/kit/kc-data.js)).
- Comandos: `shot`, `sheet` (vários instantes), `play` (abre no navegador), `check` (paridade).
- Três exemplos pequenos e completos.
- **Pronto quando:** numa sessão nova, sem contexto, o Opus cria um nível jogável novo lendo só o `AGENTS.md`.

### Etapa 10 — Jogo de demonstração · Opus 5.5 · ✅ concluída

Resultado (`engine/examples/arena/`: `game.ts`, `bot.ts`, `win.json`):
- **A arena:** um disco de areia de 20 de diâmetro sobre pedra, um muro em anel com quatro portões, pilares com tochas. **Três ondas** que entram pelos portões: três *grunts* (lentos, golpe pesado); dois grunts e três *darters* (rápidos, frágeis, entram e saem); e o **Warden**, o chefe (2,2 de altura, golpe giratório de alcance 1,9 que tira 2, 8 de vida), que **na metade da vida chama dois darters** e fica mais agressivo. Entre ondas, 2,5 s de respiro e +3 de vida. **Vitória** quando o Warden cai; **derrota** na terceira queda do jogador (e a arena se esvazia). HUD com onda, vidas e a barra de vida do Warden; mensagens e sons próprios; fogo no chão onde cada inimigo cai.
- **Mira assistida** (`combat.assist`, graus): ao golpear, o jogador se vira para o inimigo mais próximo dentro do ângulo. Sem ela, nem uma pessoa nem um roteiro acertam inimigos que chegam de todos os lados.
- **Robôs e o comando `record`** (`engine/src/game/bot.ts`): contra inimigos que reagem, um roteiro escrito à mão não vence (tentei: parado no meio golpeando, o jogador perde aos ~50 s). Um robô é uma função que olha o jogo **entre** os passos e aperta botões; `record` grava o que ele apertou como um roteiro comum e confere que **o roteiro sozinho dá o mesmo `hash`**. O robô da arena fica fora do alcance do Warden, entra logo depois de um golpe dele, bate e recua. O `win.json` gravado (1185 eventos, 43 KB) vence aos 56,2 s.
- **Replay ao vivo** (`&replay=arena/win.json`): a página joga em tempo real com o input do roteiro, aplicado pelo número do passo.
- **Dois bugs achados pelo replay ao vivo**, que a jogada com teclado escondia: o `DomInput` zerava o manche a cada passo quando não havia controle conectado (agora só solta o que o próprio controle segurava); e o gancho "antes do passo" da página recebia o índice do passo com um a mais (o `FixedLoop` já tinha contado o passo), então o roteiro entrava um passo atrasado e a partida divergia. Agora `Core.advance` entrega o índice certo, o mesmo dos roteiros.
- Outras correções: a vida não fica mais negativa com dano maior que 1; as mensagens do HUD descem para um terço da tela (não cobrem as linhas do canto) e o HUD usa 60% do pixel de arte.

Medido:
- **Pronto quando (cumprido):** `npm run live` abre `?game=arena&replay=arena/win.json` no Edge e a partida vai **do início ao fim em tempo real: vitória aos 56,4 s, 11 inimigos derrubados, 1 queda, a 180 fps no mínimo** durante toda a luta (o mesmo desfecho do Node). E `test/arena.test.mjs`, sem navegador: o `win.json` vence (onda 1 aos 1,5 s, onda 2 aos 10,5 s, onda 3 aos 19,4 s, o chamado aos 36,0 s, a vitória aos 56,2 s), a mesma partida duas vezes é idêntica passo a passo, sem input o jogador perde, e a mira assistida acerta quem está do lado (sem ela, erra).
- A arena passa no `check` sem erros nem avisos: 50 mil splats, construída em ~0,3 s, ~1,5 ms por passo.

Plano original:
- `examples/arena`: uma arena circular como a do vídeo, um jogador, 2 tipos de inimigo, um chefe simples, vitória e derrota.
- **Pronto quando:** dá para jogar do início ao fim no navegador a 60 fps e o roteiro headless de "vitória" passa.

### Etapa 11 — Desempenho · **[FABLE]** → feita com o Opus 5.5 (o acesso ao Fable acabou) · ✅ concluída

Resultado: o relatório completo está em **[engine-performance.md](engine-performance.md)**. Em resumo:
- **Medido** (Ryzen 5 5500 + RTX 5050; esta máquina não tem GPU integrada): a thread da página gasta 0,1 a 0,4 ms por quadro (p95 < 2 ms) e a simulação 0,4 ms por passo, a mesma com 50 mil ou 303 mil splats. A GPU gasta 0,96 ms por desenho com 303 mil splats no estilo padrão e 1,92 ms no `colored`. **O gargalo de GPU é por splat (vertex shader)**, não por pixel: o SwiftShader escala em proporção direta aos splats.
- **Perfil da simulação:** ~72% é o `K.character` do kit reescrevendo os splats de cada personagem (~0,1 ms por personagem por passo).
- **Decidido:**
  - simulação e ordenação **não** vão para WebAssembly (os números não pedem);
  - se um jogo tiver dezenas de inimigos, o caminho é carregar o `K.character` por ossos na GPU, o que muda o kit (2 a 3 dias).
- **Feito:**
  - a página só desenha quando há algo novo (60 desenhos por segundo em vez de 176: **3 vezes menos GPU** num monitor rápido, a mesma imagem);
  - `hypot` determinístico mais leve, com os mesmos bits;
  - cronômetro de GPU no renderizador;
  - `npm run perf` e `test/perf/profile.mjs`;
  - a arena densa (`engine/examples/arena-dense`, 303 mil splats).
- **Pronto quando (pela segunda opção do critério):** o relatório diz o que impede e quanto custa.
  - Pela estimativa, as integradas atuais (Iris Xe, Radeon 680M e Vega, M1) seguram 60 fps com 300 mil splats no estilo padrão; as antigas (Intel UHD 6xx) não, com ~29 ms estimados.
  - O que impede é o trabalho de vértice por splat. Resolver vai de horas (densidade de acordo com o pixel de arte; estilo padrão em GPU fraca) a 1 ou 2 dias (pré-passe de projeção com *transform feedback*, estimado em 2 a 3 vezes menos GPU).
  - Medir num aparelho com GPU integrada fecha a estimativa.

Plano original:
- Medir antes de mexer: perfil de CPU (simulação × ordenação × envio) e de GPU na arena cheia.
- Decidir, com números, o que vale mover para Worker ou WebAssembly (candidatos: ordenação, `K.mpm`, `K.xpbd`, partículas).
- **Pronto quando:** a arena mantém 60 fps com 300 mil splats numa GPU integrada, ou existe um relatório dizendo o que impede e quanto custaria resolver.

## Etapas 12+ — trazer o ink-studio novo para a engine

Em 2026-11-21 o `main` do original (828 commits: geração procedural, simulação de mundo, IA de agentes, luzes, clima, áudio espacial, renderizador WebGL próprio) entrou nesta branch. O plano abaixo traz para a engine só o que melhora os jogos, escolhido com o usuário. O que ficou de fora, e por quê, está no fim desta seção.

| Etapa | O quê | Estado |
|---|---|---|
| 12 | Saúde depois do merge, `**` do kit, linha de base | ✅ |
| 13 | Peso de carregamento: kit minificado e comprimido (cenas pré-montadas adiadas) | ✅ |
| 14 | Trocar o renderizador próprio pelo do original (`webgl.mjs`), mantendo o Worker de ordenação | |
| 15 | Tamanho do pixel controlável (`&px=`, `[` `]`) e cobertura contínua (sem buracos) | |
| 16 | Custo de render: recorte por visibilidade, ordem estática + móvel, menos splats no bake | |
| 17 | Fases procedurais (salas e cavernas pela semente) | |
| 18 | IA dos inimigos: rotas, percepção, `hunter()` | |
| 19 | Objetos destrutíveis, que continuam quebrados depois do save | |
| 20 | Câmera com impacto (só na vista desenhada) | |
| 21–22 | Luzes locais com sombra; chuva, neblina e raios | |
| 23–24 | Som posicional; modelos GLB (cenário e personagens rígidos) | |
| 25 | Jogo novo (`masmorra`) e o que melhora cada jogo atual | |

### Etapa 12 — Saúde depois do merge · ✅ concluída

- **Linha de base:** com o kit novo, `npm test` (55), `npm run parity -- --min 99` (100% em todos os casos), `npm run live` e `npm run perf` passaram sem mudança. Números do perf na mesma máquina da etapa 11: arena 0,18 ms de GPU por desenho, arena densa 1,73 ms; ordenação no Worker 1,4 ms e 8 ms.
- **O `**` voltou ao kit:** o original passou a usar o operador em cerca de 165 arquivos, inclusive no núcleo (`K.wobble`, deformadores). Ele não passa pela troca do `Math` determinístico. Em vez de editar esses arquivos, a engine carrega o kit por [`engine/scripts/kit-node.cjs`](../engine/scripts/kit-node.cjs), que reescreve cada `a ** b` com o esbuild e põe um ajudante que eleva ao quadrado com `a * a` e, no resto, chama o `Math.pow` do momento. Vale para a página e para o Node (CLI e testes); o kit reescrito fica em cache em `engine/out/kit/`. O teste [`kit-determinism.test.mjs`](../engine/test/kit-determinism.test.mjs) confere. Detalhes em [engine-determinism.md](engine-determinism.md), seção 5.
- Depois da troca: 58 testes e a paridade continuam em 100%.

### Etapa 13 — Peso de carregamento · ✅ concluída (em parte)

Medido no Edge, servidor local, 2026-11-21:

| | antes | depois |
|---|---|---|
| `kit.js` no servidor de dev | 7,6 MB sem compressão | 2,0 MB com gzip (o servidor comprime arquivos grandes) |
| `kit.js` no build (`npm run build`) | 7,6 MB | 4,45 MB minificado; 1,69 MB gzip, 1,35 MB brotli (`.gz` e `.br` ao lado) |

- **Montagem do mundo no navegador:** 0,45 s na arena, 0,35 s no pátio e nos faróis, 1,4 a 1,5 s no farol e 1,8 s na arena densa.
- **Cenas pré-montadas: adiadas.** O ganho máximo é esse tempo de montagem. O mundo pronto carrega sistemas vivos do kit (palco, personagens, pools de efeito, ossos) que são funções com estado e não viram arquivo. O `splatCodec` do kit só guarda os splats. Pré-montar exigiria refazer esses sistemas por cima dos splats carregados, com risco de quebrar o determinismo, para ganhar 0,4 s na maioria dos jogos. Volta a valer a pena se uma fase passar de uns 3 s para montar.

### O que fica de fora (e por quê)

- **Grafos de nós e tradução do Pixel Composer:** são ferramentas de autoria offline.
- **Efeitos glitch e retrô:** não servem ao estilo dos jogos.
- **Revisão de paleta:** é direção de arte, não runtime.
- **Redes elétricas, hidráulica, logística, população, economia:** fora do gênero.
- **Simulação em pedaços com workers:** para mundos enormes; as fases daqui são pequenas.
- **Música procedural, fractais, geometria 4D, mosaicos matemáticos:** não melhoram os jogos.
- **Estado de jogo declarativo (`pu24`) e controladores de personagem (`pu88`):** duplicam ou conflitam com `def.step` e `K.character`.
- **Multidões (`pu36-crowd`):** querem ser donas do movimento, como o `K.character`.
- **Código do repositório do cobanov:** o ink-studio já cobre aquele pipeline.

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
| **11 — desempenho** | **Fable 5.2** no plano; feita com o Opus 5.5 |

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
