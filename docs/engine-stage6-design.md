# Etapa 6 — desenho: modelo de jogo, determinismo e colisão

> **Implementado** (2026-11-16). Um desvio, medido: a poda da seção 4.2 foi trocada pela caixa dos splats de cada bake, porque o campo do sculpt é limitado a 1,0 longe dos sólidos (ver o resultado da Etapa 6 em [engine-plan.md](engine-plan.md)). Acréscimos ao contrato: `CollisionOptions.region`, `BuildContext.reserve` e `Game.built`.

Parte **[FABLE]** da Etapa 6 do [plano](engine-plan.md). Este documento decide; o código é do Opus 5.5 (lista no fim).
O contrato em TypeScript está em [engine/src/game/types.ts](../engine/src/game/types.ts) (só declarações; já passa no typecheck).

## 1. O que foi verificado no código antes de decidir

Medido em 2026-11-16, com scripts de sondagem em Node sobre o `showcase/farol.js`:

| Fato | Consequência |
|---|---|
| `K.character(B, spec, lane)` precisa do **builder antes do `B.finish`** (ele reserva os próprios splats); depois `ch.bind(world, at)`. | Todo ator que vai existir tem de ser declarado antes de o mundo ficar pronto. Inimigos saem de um *pool* fixo. |
| As cenas são monolíticas: `build(seed)` cria o builder, esculpe, chama `B.finish` e devolve o mundo. | Para pôr um personagem numa cena existente sem editá-la, a engine entrega à cena um **kit-fachada** que intercepta `makeBuilder`, `makeSculpt`, `S.bake` e `B.finish`. Testado: o `farol` constrói igual (0 floats de diferença) e a fachada captura `B` e `S`. |
| `spec.world.height(x, z, y)` é chamado ~10 a 40 vezes por passo por personagem. Significado (igual a `S.heightAt`): primeira superfície em `y` ou abaixo; `1e9` se o ponto está dentro de algo; `-1e9` se não há nada embaixo. Com `-1e9` o personagem **não anda** para lá. | A borda da ilha bloqueia de graça: basta o mapa devolver `-1e9` fora dela. |
| O campo de distância do sculpt (`S.sdf`) só conhece os sólidos **do último bake**: cada `S.bake()` refaz a grade interna e esvazia a lista. Depois do build do `farol` (2 bakes), `S.heightAt` devolve `-1e9` em todo lugar. | Não dá para consultar `S.heightAt` em tempo de jogo. A colisão tem de ser **amostrada logo depois de cada bake** e guardada. |
| Amostrando colunas de 0,25 logo após cada bake: bake 0 do `farol` (107 sólidos) dá 1969 colunas e 2193 trechos sólidos; bake 1 (o facho, que é `ghost`) dá zero. O mapa resultante mostra a ilha andável, o farol, a casa e a árvore como parede, e vazio fora. | A ideia funciona. Sólidos `ghost` ficam fora sozinhos. |
| O campo é finito em todo o espaço (não dá para achar os limites procurando `1e9`). A varredura ingênua de ±48 unidades custou ~0,5 s por bake (22 milhões de consultas). | Precisa de poda (seção 4.2). Meta: ≤ 300 ms no total para o `farol`. |
| `Math.random` aparece **21 vezes em `src/kit/kg-play.js`** (`K.play.fx`, `debris`, `eco`) e como plano B em `ks-xpbd.js:552`. O resto do kit usa `K.rnd()` (26 chamadas, em `k7-particles.js` e `k9-matter.js`), que `K.stage` semeia com `0x9e3779b9 ^ W.count`. `K.rnd` é **um estado global** do kit, compartilhado por todos os mundos. | O determinismo não pode depender de quem chama o quê: a engine troca `Math.random`, `K.rnd` e `K.seed` por geradores do próprio jogo durante o build e durante cada passo (seção 3). |
| Nenhum `Date.now` nem `performance.now` em `src/`. | O kit não lê o relógio. |
| Dois builds do `farol` com a mesma seed: 0 floats de diferença. Duas execuções do `idol` até 1,5 s (Etapa 5): 0 splats de diferença. | A base já é determinística quando o passo é fixo. |
| `K.character`, `K.play.fx` e `K.play.debris` escrevem splats **sem marcar** `anim.rows`. | O jogo marca as linhas de cada ator a cada passo (seção 3.4). |
| `cli/render.js` exporta `render`, `upscale`; `cli/png.js` grava PNG. | O modo sem navegador usa os dois como estão. |

## 2. Modelo de jogo

### 2.1 Um jogo é uma cena mais uma declaração

```ts
// engine/examples/farol-walk/game.ts
import { defineGame } from '../../src/game';

export default defineGame({
  id: 'farol-walk',
  scene: 'showcase/farol.js',            // a cena do ink-studio, sem alteração
  actors: { hero: { spec: heroSpec } },  // spec do K.character; max: 1 por padrão
  spawns: { start: [3, null, 2] },       // y null = em cima do chão
  init(game) {
    game.spawnActor({ actor: 'hero', at: 'start', brain: 'player', tags: ['player'] });
    return {};                            // game.state: dados simples
  }
});
```

Decisões:

1. **A cena não muda.** `scene` é um caminho a partir da raiz do repositório (o host carrega: `require` no Node, `<script>` na página) ou a própria função `kit => ({ build })`. Qualquer cena existente vira nível.
2. **O kit-fachada.** `runScene(def, kit, seed)` chama o módulo da cena com uma cópia do kit em que:
   - `makeBuilder` devolve o builder de verdade com `finish` embrulhado: antes do `finish` real, a engine cria os atores (`K.character`) e chama `def.build(ctx)`;
   - `makeSculpt` devolve o sculpt de verdade com `bake` e `freeze` embrulhados: depois de cada um, amostra a colisão (seção 4).
   Se a cena não tiver `stage` (`world.anim`), a engine cria um com `K.stage(world)`, porque precisa de `rows`.
3. **Atores são declarados, depois sorteados do pool.** `actors: { grunt: { spec, max: 8 } }` cria 8 `K.character` antes do `finish`, todos escondidos. `game.spawnActor` pega um livre; `game.remove` devolve e esconde (os splats dele vão para `y = -99`, que `K.pick` e o renderizador já ignoram). Pedir mais do que `max` é erro com mensagem clara ("grunt: max é 8, aumente `actors.grunt.max`").
4. **Um inimigo é um jogador com outra mão no controle.** Todo ator tem um `brain`: `'player'` lê o `StepInput` da Etapa 5; uma função `(self, game, dt) => Partial<StepInput>` devolve o mesmo formato. Uma IA escreve um inimigo como "ande na direção do jogador e aperte ataque a menos de 1,2": sem API nova, e testável só olhando o input devolvido.
5. **Três tipos de entidade**, e só três: `actor` (um `K.character` com cérebro), `trigger` (volume que avisa quando algo com certa tag entra ou sai), `prop` (tem lugar e um `update` próprio: porta, item, gerador de inimigos). Todos têm `id`, `kind`, `tags`, `pos`, `alive`, `data` (dados simples).
6. **`game.state` e `entity.data` são dados simples** (JSON). É o que o `snapshot()` devolve e o que os testes conferem. Funções ficam na definição do jogo, nunca no estado.
7. **Módulo de jogo é um ES module** em `engine/examples/<nome>/game.ts` com `export default defineGame(...)`. O esbuild o empacota para os dois lados: o servidor de desenvolvimento serve `/game/<nome>.js`; a CLI empacota em memória.

### 2.2 Ordem de um passo

Dentro do `onStep` do `Core` (que já amostrou o input, girou a câmera e aplicou os cliques):

1. **Cérebros**, em ordem de `id`: cada ator recebe seu `StepInput` (o do jogador vem do `Core`; os outros, da função).
2. **Movimento**, em ordem de `id`: `ch.update(dt, input, t)`; depois `pos`, `face` são copiados de `ch.st`.
3. **Separação entre atores**: pares em ordem de `id`, círculos no plano XZ; cada um é empurrado metade da sobreposição, e só se o lugar novo não for parede (`collision.height`). Um passe por passo basta.
4. **Triggers**: entra/sai, em ordem de `id` do trigger e depois do visitante.
5. **Props**: `update`, em ordem de `id`.
6. **`def.step(game, dt)`**: as regras do jogo.
7. **Linhas marcadas**: para cada ator vivo, `rows[at >> 9 .. (at + total - 1) >> 9] = 1`.
8. **Câmera**: `core.camera.follow(player.pos)`, se houver jogador.

Depois o `Core` suaviza a câmera e roda os sistemas do mundo (`poseAt`). Entidades criadas durante um passo só começam a ser passadas no passo seguinte; removidas saem no fim do passo. A ordem nunca depende de `Map`/`Set` iterados por inserção acidental: sempre o vetor ordenado por `id`.

### 2.3 Para quem escreve testes

- `game.snapshot()`: `{ game, seed, t, steps, state, entities[], events[], hash }`. Atores trazem `hp`, `face`, `ground`, `dead`.
- `game.emit(nome, dados)`: eventos do passo (para HUD e som na Etapa 8, e para asserções: "houve um `hit`").
- `game.hash()`: FNV-1a de 64 bits (dois de 32) sobre os bits dos floats de `world.rest || world.data`, o estado das entidades e o estado dos dois geradores. Muda se qualquer coisa da simulação mudar.

## 3. Contrato de determinismo

**A mesma seed e o mesmo roteiro de input dão o mesmo jogo: o mesmo `hash` a cada passo e o mesmo PNG, byte a byte.** Vale para o mesmo motor de JavaScript.

> **Correção medida na Etapa 7:** "o mesmo motor" quer dizer a mesma *versão*. O Node 24 (V8 13.6) e o Edge 157 já arredondam diferente o último bit de `Math.sin`, `atan2`, `exp`, `log` e outras, e numa luta isso aparece no `hash` a partir do passo 6 (as imagens continuam 100% iguais). Detalhes e a decisão pendente no resultado da Etapa 7 em [engine-plan.md](engine-plan.md). Entre motores diferentes (Firefox, Safari) funções como `Math.sin` podem variar no último bit; por isso a comparação com o navegador é uma porcentagem (≥ 95%), não igualdade.

Regras:

1. **Passo fixo.** A simulação só vê passos de 1/60 s (`FixedLoop`). O tempo é `passos / 60`.
2. **Ordem fixa.** Seção 2.2. Nada de simulação fora do passo (nem em `requestAnimationFrame`, nem em eventos de DOM: eventos só alimentam o `InputState`).
3. **Sorte.** Três fontes, todas semeadas pela engine a partir de `seed`:
   - `game.rng()`: o dado do jogo (xorshift32 próprio, semente `seed`). É o único que o código do jogo pode usar.
   - `K.rnd()`: o estado dele é global do kit e não pode ser lido, só semeado. Mas as 26 chamadas no kit são todas `K.rnd()` pela propriedade (nenhuma guarda a função numa variável; conferido com `grep`). Então a engine **troca `K.rnd` e `K.seed`** pelos de um gerador do próprio jogo (mesmo algoritmo xorshift32 do kit, semente inicial `seed ^ 0x51ed270b`) durante o build e durante cada passo, e restaura depois, junto com o `Math.random`. O `K.seed(...)` que o `K.stage` chama passa a semear o gerador do jogo.
   - `Math.random`: **substituído** por um terceiro xorshift (semente `seed ^ 0x2545f491`) durante o build e durante cada passo, e restaurado em seguida (`try/finally`). É o que torna `K.play.*` e o plano B do `ks-xpbd` determinísticos sem tocar em `src/`. O gerador é do jogo, não global: dois jogos na mesma página não se misturam.
4. **Sem relógio.** O código de jogo nunca lê `Date.now` nem `performance.now`. O validador da Etapa 9 procura por isso e por `Math.random` no fonte do jogo e avisa.
5. **O input é dado.** Um `Script` (seção 5) é a única entrada. A câmera faz parte da simulação (o yaw decide para onde "frente" aponta), então girar a câmera é um evento do roteiro. Cliques dependem da vista, então o roteiro fixa o tamanho do palco (`view`, padrão 900 × 620).
6. **O que não entra no contrato:** o que é só desenho. A ordem do Worker (um ou dois quadros atrasada), o fps, ossos na GPU ou na CPU (`hash` usa os dados em repouso), o estilo `colored`.
7. **Jogos não se misturam.** Como os três geradores pertencem ao `Game` e só ficam instalados enquanto o passo dele roda, dois jogos na mesma página ou no mesmo processo podem avançar intercalados sem mudar o resultado de nenhum. Há um teste para isso (seção 7). A troca é síncrona e sempre desfeita em `try/finally`; como um passo nunca espera nada assíncrono, não há janela para outro código ver o gerador trocado.

Testes que provam o contrato (seção 7): mesmo roteiro duas vezes → mesmo `hash` em todos os passos e PNG idêntico; roteiro diferente → `hash` diferente; um jogo de teste que chama `K.play.fx` (usa `Math.random`) continua determinístico; dois jogos avançando intercalados dão os mesmos `hash` que cada um sozinho; depois de um passo, `Math.random`, `K.rnd` e `K.seed` são os originais.

## 4. Colisão

### 4.1 O dado

Um mapa de colunas: para cada célula da grade XZ (lado `cell`, padrão 0,25), a lista dos trechos sólidos `[base, topo]` daquela coluna, do mais alto para o mais baixo. Guarda pisos sobrepostos (uma ponte, o interior de uma casa) sem virar voxel 3D. Em `CollisionData`: `start: Uint32Array` (índice do primeiro trecho de cada coluna) e `spans: Float32Array`. São números em vetores tipados: dá para copiar para um Worker ou gravar em disco depois.

Por que não consultar `S.heightAt` direto: o campo só conhece o último bake (seção 1), e marchar o campo 40 vezes por passo por personagem não escala para 20 inimigos. No mapa, uma consulta é uma busca em uma lista de 1 a 3 trechos.

### 4.2 Como amostrar

Depois de cada `S.bake()` / `S.freeze()` que conte (`collision.bakes`, padrão todos):

1. **Poda.** O campo é uma distância (com folga: materiais com `mod`/`bump` deformam a superfície em até alguns décimos). Dividir a região em blocos (por exemplo 4 × 4 unidades em XZ, a coluna inteira em Y dividida em blocos de 4); consultar o centro; se `d > raio do bloco × 1,5 + 0,5`, o bloco é vazio. Região inicial: ±64 em X e Z, −32 a +64 em Y (configurável em `collision`, mas o padrão deve servir a qualquer diorama do kit, que tem `radius` na casa de 10 a 20).
2. **Colunas.** Em cada coluna dos blocos que sobraram, descer do topo: no ar, andar `clamp(0,9 × d, 0,02, 0,45)`; ao cruzar `d < 0,02` (o mesmo limiar de `S.heightAt`), refinar o topo por bisseção até 0,005; dentro do sólido, descer do mesmo jeito até `d > 0,02` e refinar a base. Trechos com menos de 0,04 de espessura são mantidos (um piso fino ainda é piso).
3. **União entre bakes.** Trechos da mesma coluna vindos de bakes diferentes são fundidos se se tocam ou se sobrepõem.
4. **Ajustes do autor.** `collision.block` (caixas sólidas: uma parede invisível) e `collision.open` (caixas vazias: um arbusto que não deve barrar) são aplicados no fim.

O Opus deve conferir a poda contra a varredura bruta no `farol` (mesmas colunas e trechos, tolerância 0,01) antes de confiar nela, e medir: meta ≤ 300 ms no total do build do `farol`.

### 4.3 Como consultar

`height(x, z, y)`, com o significado exato de `S.heightAt(x, z, y)` (profundidade 6):

- Coluna mais próxima: `i = round(x / cell)`, `k = round(z / cell)`.
- Se `y` está dentro de um trecho (`base < y < topo`): `1e9`.
- Senão, o maior `topo ≤ y` com `topo ≥ y − 6`; se não houver: `-1e9`.
- **Suavização em rampas:** se as quatro colunas em volta de `(x, z)` têm resposta finita e todas a menos de 0,5 da resposta da mais próxima, devolver a interpolação bilinear delas. Qualquer `±1e9` ou degrau maior que 0,5 entre vizinhas: devolver a da coluna mais próxima, sem interpolar. Assim rampa é lisa e parede é seca. (O `K.character` sobe sozinho degraus de até 0,45: o limite de 0,5 fica logo acima disso.)

`ground(x, z)` é `height(x, z, +∞)` sem o limite de profundidade. `blocked(p, r, h)` testa o centro e 8 pontos no raio, em `p.y + 0,3` e `p.y + h`. `clear(a, b)` anda a reta em passos de `cell / 2` e falha se algum ponto está dentro de um trecho.

### 4.4 Ligação com o `K.character`

O ator é criado no gancho do `B.finish`, quando todos os bakes já aconteceram, então o mapa está completo. A engine preenche `spec.world = { height: (x, z, y) => collision.height(x, z, y) }`. Não fornece `slick` (gelo) nesta etapa.

### 4.5 O que fica de fora agora

- Colisão que muda em jogo (porta que abre, caixa empurrável): `block`/`open` em tempo de execução. Entra na Etapa 7 se o combate pedir.
- Excluir por material (a copa de uma árvore): o kit tem um modo `S.collide` para isso, mas ele exige construir a cena uma segunda vez. Por ora, `collision.open`.
- Mapa de navegação para inimigos: `clear()` e "andar na direção do alvo" bastam para a arena. A Etapa 7 decide se precisa de mais.

## 5. Roteiro de input e modo sem navegador

Formato (`Script` em `types.ts`):

```json
{
  "seed": 11,
  "view": { "w": 900, "h": 620 },
  "events": [
    { "step": 0,   "press": "up" },
    { "step": 90,  "release": "up" },
    { "t": 2.0,    "tap": "jump" },
    { "step": 150, "turn": [0.4, 0] },
    { "step": 200, "click": [0.5, 0.4] }
  ]
}
```

Um evento no passo `n` já está em vigor quando o passo `n` roda (o primeiro passo é o 0). `t` em segundos é arredondado para o passo mais próximo. O `ScriptPlayer` só chama `InputState.press/release/stick/turn/click`: é o mesmo caminho do teclado. O `DomInput` ganha um gravador (`record()` devolve um `Script` com o que o jogador fez), para transformar uma partida real em teste.

**CLI** (`engine/cli.js`, um jogo por processo):

```
node engine/cli.js shot <jogo> [--input roteiro.json] [--t 5] [--out quadro.png] [--state estado.json]
                               [--w 900 --h 620] [--colored] [--seed n]
```

- `<jogo>` é o nome de uma pasta em `engine/examples/` ou o caminho de um módulo de jogo.
- Roda `core.run(t)` com ossos na CPU (o renderizador do terminal não carrega ossos), desenha com `R.render(world, { t, ...camera.view(), w, h })`, amplia com `R.upscale` e grava com `cli/png.js`.
- `--state` grava o `snapshot()`. Sem `--out`, o nome é `<jogo>-<t>.png` em `engine/out/` (fora do git).
- A última linha do stdout é sempre um JSON de uma linha `{ "png": ..., "hash": ..., "t": ..., "steps": ... }`, para uma IA ler sem adivinhar.

**Página:** `/?game=<nome>` roda o jogo ao vivo. `/?game=<nome>&input=<arquivo>&t=5` aplica o roteiro com `core.run(t)` antes do primeiro quadro e para o relógio: é o que o harness de paridade usa para comparar com o `shot`.

## 6. Arquivos

```
engine/src/game/
  types.ts        o contrato (pronto)
  rng.ts          xorshift32; Dice (os três geradores de um jogo) e dice.during(K, fn), que troca e restaura Math.random, K.rnd e K.seed
  level.ts        kit-fachada: runScene(def, kit, seed) -> { world, B, S, collision, actors }
  collision.ts    bakeCollision(S, options, into), makeCollision(data): Collision
  game.ts         defineGame, createGame(def, kit, o): Game  (entidades, passo, snapshot, hash)
  script.ts       ScriptPlayer, gravador
  index.ts
engine/src/headless/
  run.ts          runHeadless(def, script, t) -> { game, frame }  (usa cli/render.js)
engine/cli.js     shot (empacota o jogo com esbuild em memória e roda)
engine/examples/farol-walk/game.ts, walk.json
engine/test/game.test.mjs, collision.test.mjs
```

`Core` ganha o que faltar para o `Game` (por exemplo, `beforeStep` já existe para o gamepad; o `ScriptPlayer` usa o mesmo gancho). `main.ts` ganha `?game=`.

## 7. Trabalho do Opus 5.5, em ordem

Cada item termina com teste passando. Parar e avisar se alguma medição contrariar este desenho.

1. **`rng.ts`** e teste: sequência fixa para uma seed; `dice.during` restaura `Math.random`, `K.rnd` e `K.seed` mesmo com exceção; o gerador que substitui `K.rnd` dá a mesma sequência que o do kit para a mesma seed.
2. **`collision.ts`**: amostragem com poda, união, `block`/`open`, as quatro consultas. Testes: no `farol`, poda = varredura bruta; `height` contra `S.heightAt` consultado logo após o bake 0 em 2000 pontos semeados (≥ 95% a menos de 0,1; nenhum ponto de chão virando `±1e9` a mais de uma célula de uma borda); tempo ≤ 300 ms.
3. **`level.ts`**: a fachada. Testes: `farol` pela fachada tem os mesmos splats que sem ela (mais os dos atores); cena sem `stage` ganha um.
4. **`game.ts`**: entidades, ordem do passo, pool de atores, separação, triggers, `snapshot`, `hash`. Testes: ordem por `id`; pool cheio dá erro claro; trigger avisa entrada e saída uma vez cada.
5. **`script.ts`** e gravador. Teste: gravar no `InputState`, reproduzir, mesmos `StepInput` passo a passo.
6. **`examples/farol-walk`**: um personagem simples (pode partir do spec `blob` do `cli/selftest.js`, linha 2644) e um roteiro que anda até a parede do farol e depois até a borda.
7. **`headless/run.ts` e `cli.js shot`**.
8. **`main.ts` com `?game=`** e um caso de jogo no harness de paridade.
9. Atualizar `docs/engine-plan.md` (Etapa 6 concluída, com as medições) e a seção "Como retomar".

**Pronto quando** (do plano, tornado mensurável):
- no `farol-walk`, com o roteiro andando 10 s contra o farol: o personagem nunca fica a menos de (raio do farol − 0,1) do eixo dele, e `collision.height` sob os pés é sempre finito (nunca saiu da ilha);
- `shot` duas vezes com o mesmo roteiro: PNG idêntico byte a byte e mesmo `hash`;
- esse quadro bate ≥ 95% (foreground parity) com a página em `?game=farol-walk&input=...&t=...`;
- `npm test` da engine e os 171 testes da raiz continuam passando; `src/`, `cli/` e `demos/` intactos.

## 8. Riscos

- **A poda pode cortar sólidos com `mod` forte.** Por isso a conferência contra a varredura bruta é teste, não suposição. Se falhar, aumentar a folga ou cair para a varredura bruta com região declarada pelo nível.
- **Colunas de 0,25 em paredes finas ou diagonais** podem deixar frestas de uma célula. O `K.character` sonda com raio 0,26, o que cobre uma célula; se aparecer fresta no `farol`, baixar `cell` para 0,2.
- **`K.character` parado no pool**: confirmar que splats em `y = -99` não custam envio por quadro (só marcar linhas de atores vivos).
- **Um módulo novo do kit pode guardar `K.rnd` numa variável** (`const rnd = K.rnd`), e aí a troca não o alcança. Hoje nenhum faz isso; o teste de determinismo com dois jogos intercalados acusa se passar a acontecer.
- **Paridade com o navegador** depende de o jogo na página ter rodado exatamente os mesmos passos: por isso `&input=&t=` usa `core.run`, não o relógio da página.
