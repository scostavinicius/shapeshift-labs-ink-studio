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
- `package.json` está como `UNLICENSED`.

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
  src/core/                  loop, input, câmera, tempo (etapa 5)
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
- `engine/` criado: `npm run dev` (servidor em http://127.0.0.1:5173, aceita `?scene=<id>` ou `?file=<caminho de um módulo de cena>`), `npm run build`, `npm test` (typecheck + testes em `engine/test/`).
- O kit vai para o navegador sem alteração, por `engine/scripts/kit.mjs` (expõe `window.INK`); os tipos ficam em `engine/types/ink-studio.d.ts`.

- Copiar este plano para `docs/engine-plan.md`.
- **Confirmar a licença** do ink-studio com o autor ou no GitHub (o `package.json` diz `UNLICENSED`). Bloqueia só a publicação, não o desenvolvimento.
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

### Etapa 3 — Passo final do estilo · Opus 5.5 (trocar para Fable se a paridade travar abaixo da meta)

**O modo padrão já foi feito na Etapa 2.** Resta só o modo `colored` (abaixo), mais incluir casos `colored` no harness.

- Porte direto do segundo laço de `render()` (linhas 386 a 480): refração do vidro, sombra de contato (`world.ao`), contorno por degrau de profundidade (`world.outline`), dithering Bayer 4×4, cor de paleta mais próxima com os pesos `0.30/0.55/0.15`, e `anim.grade`.
- Modo `colored`: renderizar em 2× e usar `PixelLook.glsl` (`pixelResolve`) como está.
- **Pronto quando:** paridade ≥ 97% no modo padrão e ≥ 95% no `colored`, nas cenas paradas.

### Etapa 4 — Mundo vivo na GPU · Opus 5.5, com um trecho **[FABLE]**
- Chamar `world.anim.update(dt, t)` por quadro e enviar só as linhas marcadas em `st.rows` (`texSubImage2D` por linha), zerando as marcas depois.
- `anim.kick` (tremor de câmera) e `anim.zoom`.
- **[FABLE]** Ordenação fora da thread principal: radix sort em Web Worker com reaproveitamento da ordem do quadro anterior, e a decisão de quando reordenar (câmera parada × splats se movendo). Também os ossos na GPU (`anim.bones`, 12 números por osso; a referência de comportamento é `K.bones.posed` em [src/kit/k1-stage.js](../src/kit/k1-stage.js)).
- **Pronto quando:** paridade ≥ 95% em `burn`, `stuff` e `farol` nos instantes `t=2` e `t=5`; 60 fps com `farol` num notebook comum (medir com um contador de quadros na página).

### Etapa 5 — Núcleo do jogo · Opus 5.5
- Loop com passo fixo de 1/60 s (a simulação nunca depende do fps).
- Input: teclado, mouse e gamepad mapeados para ações, entregues no formato que `K.character.update` já espera.
- Câmera: segue um alvo com mola, yaw/pitch/distância, limites.
- Clique: converte o pixel em raio e chama `st.poke(eye, dir)`.
- **Pronto quando:** dá para orbitar a cena `farol` com o mouse a 60 fps e clicar em `idol` quebra pedaços.

### Etapa 6 — Modelo de jogo e modo sem navegador · **[FABLE]** para o desenho, Opus 5.5 para o código
Decisões que definem o quanto a engine é AI-friendly; erro aqui custa caro depois.
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

- **Licença** não confirmada (etapa 0).
- **Paridade exata é impossível** (ponto flutuante e empates na ordenação diferem entre CPU e GPU); por isso as metas são porcentagens, com imagem de diferença para julgar o resto a olho.
- **`RGBA16F` com blending** depende da extensão `EXT_color_buffer_float`; se faltar em algum aparelho, o plano B é empacotar profundidade em `RGBA8` (decidir na etapa 2).
- **Determinismo** pode quebrar se algum sistema do kit usar `Math.random` internamente; a etapa 6 precisa auditar isso com `grep`.
