# Como escrever um jogo nesta engine

Guia para quem escreve jogos aqui, pessoa ou IA, partindo do zero. Leia tudo uma vez antes de começar: as armadilhas da seção 8 custam caro quando aparecem tarde.

A engine roda jogos de **ação vista de cima** em pixel-art, feitos de *splats* do [ink-studio](../README.md). Tudo é JavaScript/TypeScript. A mesma partida roda no navegador e no Node (sem navegador), e **é a mesma partida, bit a bit**, nos dois. É isso que permite escrever, rodar e conferir um jogo sem nunca abrir uma janela.

Todos os comandos abaixo rodam da **raiz do repositório**. Na primeira vez, rode `npm install` dentro de `engine/`.

---

## 1. O ciclo de trabalho

```
escreve → check → shot (ou sheet) → olha o PNG → corrige → repete
```

1. **Comece de um modelo:** `node engine/cli.js new meu-jogo` cria `engine/examples/meu-jogo/game.ts` e um roteiro `walk.json`. Há quatro modelos:
   - `--from blank` (padrão): uma cena própria escrita no arquivo, um herói e um inimigo;
   - `--from walk`: o `farol` com um personagem andando;
   - `--from fight`: a arena completa (ondas de inimigos, chefe, cura, robô que vence);
   - `--from serpent`: o ninho, uma serpente com corpo que se arrasta.
2. **Confira:** `node engine/cli.js check meu-jogo`. Ele lista **todos** os problemas de uma vez, cada um com o lugar, o que está errado e o que provavelmente se quis (`->`). Só siga em frente com 0 erros.
3. **Olhe:**
   - `node engine/cli.js shot meu-jogo --input engine/examples/meu-jogo/walk.json --t 3` grava o quadro de 3 s em `engine/out/meu-jogo-3.png`;
   - `sheet ... --times 0,1,2,4` grava vários instantes da **mesma** partida lado a lado;
   - `shot ... --trace 0.5` também anota onde o jogador está (posição, vida, `game.state`) a cada 0,5 s: é o jeito de **ajustar um roteiro** (seção 7);
   - os PNGs trazem o **texto do HUD** no canto (`HP 4/5` e as suas `hud.lines`; `--no-hud` tira). Corações, barra de habilidades e mensagens só aparecem no navegador (`play`);
   - `--px N` fixa o tamanho do pixel de arte (o padrão vem do `detail` da cena), e `--coverage legacy|continuous|soft` troca a cobertura dos splats (o padrão nos jogos é `continuous`, sem buracos entre splats vizinhos);
   - **abra o PNG e olhe de verdade.** O estado impresso não mostra um personagem dentro de uma parede ou uma câmera apontando para o vazio.
4. **Leia a última linha:** todo comando termina com **uma linha de JSON**. Use-a em vez de interpretar o texto acima dela.
   - `shot`: `{ png, hash, t, steps, game: { t, player: { pos, hp, down }, state, entities, enemies }, trace? }`. (Ali, `state` e `save` são os caminhos dos arquivos de `--state` e `--save`, ou `null`.)
   - `sheet`: `{ png, times: [{ t, hash, player, state }] }`.
   - `check`: `{ ok, errors, warnings, stats, parity }`.
5. **Jogue:** `node engine/cli.js play meu-jogo` abre o jogo no navegador. As teclas são WASD/setas para andar, Shift para correr, J golpe, K dash, Espaço pulo, M música, N sem som e P para salvar. Arrastar gira a câmera, a roda dá zoom e C troca o estilo. `[` e `]` diminuem e aumentam o pixel de arte, e `\` volta ao tamanho da cena (`&px=N` na URL fixa um). Pixels menores que o espaço entre os splats não trazem detalhe novo: para isso, a cena precisa de `res` menor (mais splats).
6. **Opcional:** `node engine/cli.js check meu-jogo --parity --input <roteiro> --t 3` também desenha o jogo num navegador headless (Edge ou Chrome) e confere que é a mesma partida do Node.
7. **Para provar que dá para vencer:** escreva um **robô** e grave o que ele fez (seção 7, "Robôs"). No navegador, `play` com `&replay=<pasta>/<roteiro>.json` na URL assiste ao roteiro jogando em tempo real.

Um teste é um roteiro mais asserções. Veja `engine/test/combat.test.mjs`, que roda uma luta inteira sem navegador e confere vida, mortes e estado.

---

## 2. O que é um jogo

Um jogo é **uma cena** (o nível, feito com o kit) mais **uma declaração** do que acontece nela. O arquivo é um ES module em `engine/examples/<nome>/game.ts`:

```ts
import { chaser, defineGame } from '../../src/game/index';
import { walker } from '../farol-walk/game';

export default defineGame({
  id: 'meu-jogo',                         // minúsculas e traços: nomeia saves e arquivos
  scene: 'showcase/farol.js',             // uma cena do repositório (caminho a partir da raiz) ... ou uma função (seção 3)
  actors: {                               // os personagens que podem existir, e quantos de cada ao mesmo tempo
    hero: { spec: walker, hp: 5 },
    grunt: { spec: walker, max: 3, hp: 2 }
  },
  spawns: { start: [3, null, 2], east: [5.5, null, -0.5] },   // [x, y, z]; y null = em cima do chão ali
  init(game) {                            // uma vez, com o mundo pronto: põe o elenco em cena
    game.spawnActor({ actor: 'hero', kind: 'player', at: 'start', brain: 'player', tags: ['player'] });
    game.spawnActor({ actor: 'grunt', at: 'east', brain: chaser(), tags: ['enemy'] });
    return { kills: 0 };                  // vira game.state: SÓ dados simples (números, textos, listas, objetos)
  },
  step(game, dt) {                        // a cada passo de 1/60 s, depois que todos se moveram: as regras
    for (const e of game.events) if (e.name === 'death' && (e.data as any).team === 'enemy') game.state.kills++;
  }
});
```

Os exemplos, do menor ao maior:

| Exemplo | Mostra |
|---|---|
| `engine/examples/farol-walk/` | uma cena pronta, um personagem, colisão (não atravessa o farol nem cai da ilha) |
| `engine/examples/arena/` | **o jogo completo de demonstração**: arena circular, três ondas, dois tipos de inimigo, um chefe que chama reforços, cura entre ondas, vitória e derrota, mira assistida, e um **robô** (`bot.ts`) que vence e gravou o `win.json` |
| `engine/examples/ninho/` | uma serpente: a cabeça é um ator comum e o corpo é uma cadeia física que se arrasta atrás, com dois pares de barbatanas que balançam (`actors.<nome>.body`; as serpentes pequenas usam `tail`), e o cérebro `slither`. **A campanha é toda em dados** (`mission.json` e `story.actions`, sem `step()`), e um robô (`bot.ts`) a vence |

**Copie de um deles** em vez de começar de uma folha em branco.

### Tudo o que uma definição aceita

| Campo | O quê |
|---|---|
| `id`, `name` | nome curto (obrigatório) e título |
| `scene` | caminho de uma cena do repositório ou a função da cena (obrigatório) |
| `seed` | a semente; por padrão, a da cena |
| `actors` | `{ nome: { spec, max?, hp?, radius?, damage?, tail?, body? } }`: personagens (`K.character`), reservados antes de o mundo ficar pronto. `tail`: um corpo que se arrasta atrás (serpente, verme, cauda); `body`: várias cadeias, com galhos (barbatanas, tentáculos). Veja a seção 4 |
| `spawns` | pontos com nome: `[x, y \| null, z]` |
| `init(game)` | põe o elenco em cena; devolve `game.state` (obrigatório) |
| `step(game, dt)` | as regras, a cada passo |
| `camera` | `{ stiffness, minPitch, maxPitch, minDist, maxDist, bounds }`: a câmera segue o jogador com mola |
| `combat` | `{ invuln: 0.6, arc: 70, respawn: 1.5, respawnAt, knock, assist }`, ou `false`; ligado por padrão. `assist` (graus) é a mira assistida do jogador: ao golpear, ele se vira para o inimigo mais próximo dentro desse ângulo (180 = qualquer lado) |
| `effects` | `true` ou `{ fx: 400, debris: 800, eco: true, marks: true, fuel: 0.5, weather: { rain, winter } }`. `marks`: cada golpe que acerta deixa uma mancha escura no chão, e uma queda deixa uma maior; ficam até o fim da partida (`game.effects.mark(x, z, raio)` faz uma à mão) |
| `hud` | `{ lines(game) => string[], message(evento, game) => string \| null \| undefined }` |
| `sounds` | `{ evento: som }`. Sons: `swing`, `hit`, `death`, `respawn`, `blip`, `save`, `crash` e, das receitas do kit, `impact`, `pickup`, `jump`, `charge`, `confirm`, `warning` (cada um com 4 variações tocadas em rodízio). Um nome que não existe faz o `check` avisar. Cada som vem do lugar do evento (de `at`, do `target` ou do `id` dele): sai pelo lado certo e fica mais baixo de longe, ouvido do ponto que a câmera segue |
| `brains` | `{ kind: brain }`: os cérebros dos atores que nascem **durante** a partida (para o save trazê-los de volta) |
| `collision` | `{ cell: 0.25, bakes: 'all' \| [0, 2], block: [caixas], open: [caixas], region }` |
| `breakables` | `[{ tag, hits: 1, mode: 'debris' \| 'rubble', pieces: 0.3, push: 3, by: [times] }]`: coisas que um golpe quebra (seção 5) |
| `coverage` | `'continuous'` (padrão), `'legacy'` ou `'soft'`: como os splats cobrem o pixel de arte |
| `weather` | `{ kind: 'rain' \| 'snow' \| 'leaf', box: [x0, x1, z0, z1] \| rad, n: 400, cols: [índices], top, wind: [vx, vz] }` (ou uma lista): chuva, neve ou folhas caindo. Quem move é a placa de vídeo, então não custa CPU e não entra no jogo |
| `story` | `{ document, actions }`: a campanha em dados, no formato de história do kit (seção 5, "Missões em dados") |
| `build(ctx)` | reserva mais splats antes do `B.finish` (`ctx.reserve(() => K.play.fx(ctx.B, 200))`); o que devolve vira `game.built` |

---

## 3. A cena: o nível feito com o kit

Uma cena é `kit => ({ id, name, seed, build(seed) })`, e `build` devolve o mundo pronto. O jeito mais curto é escrevê-la no próprio `game.ts` (é o que o modelo `blank` faz):

```ts
const PALETTE = [0x0b0d17, 0x1e2230, 0x343a4f, 0x565e78, 0x8790a8, 0x1f3a24, 0x2f5e35, 0x4d8c45, 0x86c05a /* ... */];

scene: kit => ({
  id: 'meu-nivel', name: 'Meu nível', seed: 1,
  build(seed) {
    const K = kit.KIT;
    const B = kit.makeBuilder(seed, PALETTE);       // o construtor: semente e paleta (0xRRGGBB)
    const S = K.sculpt(kit.makeSculpt(B));          // o escultor (sólidos por campo de distância)
    S.sun = B.norm([-0.4, 0.8, 0.5]);               // de onde vem a luz
    S.box([0, -0.5, 0], [6, 0.5, 6], { r: [5, 6, 7, 8] }, { res: 0.2 });   // chão 12 x 12, topo em y = 0
    S.ball([3, 0.6, -2], 0.8, { r: [1, 2, 3, 4] }, { res: 0.12 });         // uma pedra
    S.bake();                                        // amostra as superfícies e as acende: AGORA elas existem
    return B.finish({ cam: { target: [0, 0.5, 0], dist: 16, pitch: 0.65, yaw: 0.4 }, detail: 8, radius: 8 });
  }
})
```

- **Coordenadas:** `[x, y, z]`, com **y para cima**, em unidades do mundo. Um personagem `walker` tem 1,2 de altura.
- **Sólidos:**
  - `S.box(centro, MEIAS-medidas, material, opções)`: `[6, 0.5, 6]` dá uma caixa de 12 × 1 × 12;
  - `S.ball(centro, raio ou [rx, ry, rz], material, opções)`;
  - `S.tube([[x,y,z], [x,y,z], ...], raio0, raio1, material, opções)`;
  - `S.ground(material, { rad, y })`: um chão sem fim.
- **Opções:**
  - `res`: o espaçamento das amostras de superfície. Menor dá mais detalhe e mais splats; 0,1 a 0,2 é o normal, e um nível grande vai melhor com 0,2;
  - `neg: true`: subtrai, cavando;
  - `ghost: true`: desenha, mas não faz sombra **nem é chão**;
  - `hold: true` serve para operandos de `S.join`. Ver o [README](../README.md#geometry-and-materials).
- **Materiais:**
  - `{ r: [i0, i1, ...] }` são índices da paleta, do escuro ao claro: a rampa de cores daquela superfície;
  - `{ r: [...], em: true }` brilha;
  - o índice 0 é o fundo, o céu.
- **`B.finish({ cam, detail, radius, dither })`:**
  - `cam` é a câmera inicial (ângulos em **radianos**). `yaw` é para que lado ela olha, `pitch` o quanto olha para baixo, `dist` a distância e `target` o ponto visado. Num jogo, a câmera passa a seguir o jogador a partir dali (seção 4);
  - `detail` controla o tamanho do pixel de arte (maior dá pixels menores; 6 a 14 é o normal);
  - `radius` é o tamanho aproximado do nível;
  - `dither` é o quanto os tons vizinhos da paleta se misturam em xadrez nas transições de luz (0 nenhum; 0,2 a 0,3 é o normal).
- **Cenas prontas do repositório:** `showcase/farol.js` (uma ilha flutuante). As demos do kit (`burn`, `idol`, `cabinet`, `watcher`) são cenas para olhar, não níveis.

### Fases geradas pela semente

`makeDungeonScene(opções)` (de `engine/src/game/index`) monta uma masmorra de salas e corredores (`kind: 'rooms'`) ou de cavernas (`kind: 'cave'`) a partir da semente, com chão, paredes e colisão prontos:

```ts
import { defineGame, dungeonOf, makeDungeonScene } from '../../src/game/index';

export default defineGame({
  id: 'minha-masmorra',
  scene: makeDungeonScene({ kind: 'rooms', width: 28, height: 20 }),   // células; cada uma mede 1 unidade
  actors: { hero: { spec: walker, hp: 5 } },
  init(game) {
    const d = dungeonOf(game.world);           // o que foi gerado: salas, pontos livres, início e saída
    game.spawnActor({ actor: 'hero', kind: 'player', at: [d.start[0], null, d.start[1]], brain: 'player', tags: ['player'] });
    return { exit: d.exit };
  }
});
```

- **O que `dungeonOf` dá:** `rooms` (meio e tamanho de cada sala), `spots` (pontos com espaço em volta, todos alcançáveis a pé), `start`, `exit` (o ponto mais longe do início, andando), `depth` (essa distância, em células) e `rows` (a grade: `.` livre e `#` parede).
- **Spawns:** a posição muda com a semente, então use esses pontos no `init` em vez de `spawns` fixos.
- **A semente:** a mesma semente dá a mesma masmorra. O `"seed"` de um roteiro gera outra.
- **Enfeitar:** `dress(S, K, layout, B)` esculpe mais coisas antes do bake, como tochas, caixas e colunas.
- **Opções:** `palette` (a padrão é `DUNGEON_PALETTE`, com as cores do `walker` em 13–17), `floor`, `wall`, `top`, `wallHeight`, `res`, `adaptive` e `finish`.
- **Tochas:** `torches: 8` (padrão; 0 desliga e deixa a masmorra clara) pendura tochas nas paredes, uma por sala. A luz delas, com sombras, é **assada** na cena (`S.lights`): o chão e a pedra perto ficam quentes (rampas `g` da paleta, 25–31), e o resto fica escuro.
  - Não custa nada por quadro e sai igual no navegador e no `shot`. Em `dungeonOf(world).torches` ficam onde estão.
  - **Luz numa cena sua:** `S.lights.push({ p: [x, y, z], r: alcance, s: força, sh: true })` antes do `S.bake()`. Com `g: [rampa quente]` no material, a superfície muda de cor onde essa luz domina.
- **Neblina:** `finish: { fog: { c: índice, start: 0.6, max: 0.4 } }`.

### Modelos 3D (GLB) com textura

1. **Converta uma vez:** `node engine/cli.js asset modelo.glb --size 1 --out engine/examples/<jogo>/assets/modelo.json`. Isso gera uma receita JSON pequena, com a geometria e a textura reduzida a 64 px. Texturas PNG funcionam direto; JPEG precisa de decodificador. Há um modelo de exemplo em `engine/assets/crate.json`.
2. **Na cena:** `placeAsset(K, S, receita, { at, size, turn, palette: PALETA, tag })` antes do `S.bake()`.
   - O modelo vira um sólido como outro qualquer: faz e recebe sombra, é chão e parede na colisão e quebra se a `tag` estiver em `breakables`.
   - As cores vêm da textura, iluminadas pela cena e casadas com a paleta, então a paleta precisa ter tons próximos aos dela.
3. **Como parte de personagem:** dentro do `sculpt(S, T)` do `spec`, use `placePart(S, receita, { at, size, palette, bone: T('root') })`.
   - A peça é rígida e vai presa ao osso, como um boneco articulado. Não há pele que dobra.
   - `at` é a posição com o personagem parado, pés na origem e virado para +x.

**O chão e as paredes saem da cena sozinhos.** A cada `S.bake()`, a engine amostra os sólidos daquele bake num mapa de colunas: o que é sólido em pé é parede; o que tem topo é chão. Onde não há nada embaixo, o personagem **não anda** (ele não cai da borda de uma ilha). Sólidos `ghost` e o que vem depois do último bake não contam.

---

## 4. Personagens, cérebros e entidades

### Atores

- **Um ator** é um `K.character` do kit, com um **cérebro**. Todos os atores que podem existir são declarados em `actors`, com `max` de cada. A engine os cria antes de o mundo ficar pronto e os esconde até o `spawnActor`.
- **O `spec`** descreve o corpo. **Comece do `walker`** (`engine/examples/farol-walk/game.ts`) e troque só o `sculpt` e as cores:

  ```ts
  const grunt = { ...walker, id: 'grunt', atk: 'pound', sculpt(S, T) {
    S.ball([0, 0.5, 0], [0.34, 0.4, 0.34], { r: [9, 10, 11] }, T('root'));   // corpo, preso ao osso 'root'
    S.ball([0, 1.0, 0], 0.2, { r: [16, 17, 17] }, T('head'));               // cabeça
  } };
  ```

  - **As cores do `walker` são índices fixos: 13, 14 e 15 no corpo, 16 e 17 na cabeça.** Na sua paleta, esses índices precisam ser as cores que você quer (veja o modelo `blank`).
  - `atk` escolhe o golpe: `'slash'`, `'pound'`, `'thrust'`, `'spin'` ou `'peck'`.
- **`game.spawnActor({ actor, at, brain, kind?, tags?, team?, face? })`:**
  - `at` é um ponto com nome ou `[x, y, z]`;
  - `brain: 'player'` lê o teclado e o controle, e a câmera segue o primeiro ator assim;
  - `team` decide quem golpeia quem: por padrão, `'player'` para o jogador e `'enemy'` para os outros.
- **O que um ator tem:** `pos`, `face` (radianos), `hp`, `team`, `damage`, `invuln`, `deadFor` (−1 se vivo), `home`, `input` (o que recebeu neste passo), `data` (dados simples seus) e `ch` (o `K.character`; `ch.st` é o estado inteiro dele).
- Ao nascer, o personagem **se materializa** em cerca de 0,7 s; até lá, aparece como uma nuvem de pontos. É do kit.
- **Medidas do `walker`**, úteis para planejar um nível e um roteiro:
  - altura 1,2 e raio do corpo 0,3;
  - anda a cerca de **2,7 unidades/s** e corre (`run`) a cerca de **5 unidades/s**;
  - alcance do golpe 1,1;
  - sobe sozinho degraus de até cerca de 0,45, e mais alto que isso é parede.

### A câmera

- Num jogo, a câmera segue o **pé do jogador** com uma mola (`camera.stiffness`, padrão 6: assenta em menos de 1 s), mantendo o `yaw`, o `pitch` e a `dist` da `cam` da cena.
- O jogador fica perto do centro do quadro. Quando ele corre, a mola o deixa um pouco para trás.
- Nada esconde o que está na frente: um poste entre a câmera e o jogador o tapa. Leve isso em conta ao pôr coisas altas.
- `camera.bounds: { min: [x, y, z], max: [x, y, z] }` prende o ponto seguido dentro de uma caixa (a câmera não mostra além da borda do nível).
- `minDist` e `maxDist` limitam o zoom; `minPitch` e `maxPitch` limitam a inclinação.
- **Tranco da câmera:** a imagem trepida quando o jogador apanha (vindo de quem bateu), quando acerta, quando derruba um inimigo e quando quebra alguma coisa.
  - `camera.shake` escala a força: 1 é o padrão, 0,5 é mais suave e 0 desliga. Na página, `&shake=0` também desliga.
  - Só a imagem se move: o clique e o jogo não mudam, e o `shot` sem navegador não trepida.

### Cérebros

Um cérebro é uma função que devolve **o mesmo input que o jogador daria**:

```ts
type Brain = (self: Actor, game: Game, dt: number) => Partial<StepInput>;
// StepInput: { move, mz: o desejo de andar no eixo x e z do MUNDO (comprimento até 1),
//              run, jump, jumpHeld, dash, attack, cast, crouch, face? (radianos) }
```

- `chaser({ sight, needsLine, range, speed, cooldown, retreat })` persegue o adversário mais próximo que vê, golpeia ao alcance, recua e volta. Anda em linha reta: atrás de uma parede, fica preso. `dummy` fica parado.
- `hunter({ ...as do chaser, fov, hearing, memory, replan, patrol, stroll })` é o inimigo para níveis com paredes (masmorras):
  - **vê** só à frente (`fov` em graus, padrão 140) e **ouve** de perto através de paredes (`hearing`, padrão 2,5);
  - **anda por rotas** em volta das paredes, recalculadas a cada `replan` segundos (no máximo 3 cálculos por passo no jogo todo);
  - **ao perder o alvo**, vai até onde o viu por último e procura em volta por `memory` segundos;
  - **sem alvo**, patrulha `patrol`: uma lista de pontos `[x, z]`, ou `'spots'` para os pontos livres da masmorra.
  - A rota e a memória ficam em `self.data.brain`, então o save e o `hash` as guardam.
- `slither(cérebro, { swing: 40, rate: 0.9 })` embrulha outro cérebro e faz o ator andar balançando de um lado para o outro (`swing` em graus, `rate` balanços por segundo). Golpes e paradas ficam como estão. Serve para serpentes com `tail`.
- **Corpo que se arrasta (`actors.<nome>.tail`)**: o ator continua um `K.character` comum (anda, luta, tem vida; o `sculpt` dele é a cabeça). Atrás dele vem uma cadeia de juntas no solver XPBD do kit (montada como o `K.proceduralBody` a monta), deitada no chão do nível e desenhada como uma curva grossa:
  ```ts
  serpent: { spec: cabeca, hp: 6, tail: { joints: 12, length: 4.2, width: 0.62, color: '#2f7a5a', pigment: [[0, '#2f7a5a'], [1, '#5fc08a']] } }
  ```
  - `joints` (3 a 24, padrão 9), `length` (padrão 2,4), `width` (um número afina até um quinto na ponta; uma lista dá a largura de cada junta), `lift` (altura de onde a cabeça puxa, padrão 0,3), `color`, `pigment` (cores ao longo, 0 na cabeça e 1 na ponta).
  - **É sólido**: outros atores são empurrados para fora dele, então o jogador precisa contornar a serpente. `solid: false` desliga isso.
  - **Largura mínima**: abaixo de um pixel de arte (cerca de 0,15 unidade) o corpo some na tela. Use `width` de 0,3 ou mais.
  - Some com o ator quando ele morre e volta inteiro, esticado atrás dele, quando o ator nasce de novo.
  - **Vai no save:** a posição e a velocidade de cada junta. Ao carregar, o corpo volta curvado como estava, splat por splat. `game.tailOf(ator)` dá o corpo (`motion()`, `points`, `chainPoints(nome)`).
- **Corpo com galhos (`actors.<nome>.body`)**: várias cadeias por ator, todas no mesmo solver. `tail` é o caso de uma cadeia só (não use os dois):
  ```ts
  serpent: { spec: cabeca, hp: 6, body: { chains: {
    spine: { joints: 12, length: 4.2, width: 0.62 },
    'fin-l': { from: 'spine.3', dir: 115, joints: 4, length: 1.5, width: [0.5, 0.3, 0.2], solid: false, sway: { swing: 28, rate: 1.1 } },
    'fin-r': { from: 'spine.3', dir: -115, joints: 4, length: 1.5, width: [0.5, 0.3, 0.2], solid: false, sway: { swing: 28, rate: 1.1, phase: 0.5 } }
  } } }
  ```
  - Cada cadeia tem as opções de um `tail` e mais: `from` (`'actor'`, o padrão, ou `'cadeia.junta'`: 0 é a raiz, um negativo conta da ponta, e o nome sozinho é a ponta), `dir` (graus, para que lado ela se deita a partir de para onde a raiz olha: 0 à frente, 180 atrás, 90 à esquerda e -90 à direita; o padrão é 180 saindo do ator e 90 saindo de uma junta), `offset` (de onde sai no ator: `[frente, cima, esquerda]`, girando com ele) e `sway: { swing: 30, rate: 1, phase: 0, stiffness: 0.004 }` (a ponta balança: `swing` em graus, `rate` balanços por segundo).
  - Um galho divide a junta de onde sai e fica preso no ângulo dela: puxa o corpo, e o corpo o leva. Para um polvo, ponha várias cadeias saindo do ator com `dir` diferentes.
  - O `check` aponta `from` errado, junta fora da cadeia e cadeias saindo umas das outras em anel.
- `findPath(navGridFor(game.collision, raio, altura), de, para)` dá uma rota para o seu próprio cérebro: cantos `[x, z]` sobre o chão, sem cortar quinas.
- Para escrever o seu, olhe `engine/src/game/brains.ts`. **A memória do cérebro fica em `self.data`** (dados simples), nunca em variáveis de fora: o save e o `hash` dependem disso.
- **Sorte só com `game.rng()`.**

### Outras entidades

- **`game.spawnTrigger({ at, shape: { r } | { half: [x, y, z] }, watch, onEnter(who, game), onLeave(who, game) })`:** avisa uma vez quando alguém com uma das tags de `watch` entra e uma vez quando sai.
  - `watch` é `['player']` por padrão; ele compara com as `tags` de quem passa.
  - A forma fica centrada em `at` (com `y: null`, no chão dali). Conta a **posição do ator**, que é o pé dele. `{ r }` é uma bola; `{ half }` é uma caixa de meias medidas.
  - Um trigger em volta de um poste sólido funciona, desde que o raio passe do poste mais o corpo do ator (0,3).
- **`game.spawnProp({ kind, at, tags?, update(self, game, dt) })`:** qualquer coisa com lugar e passo próprio (gerador de inimigos, porta, item).
- **Ferramentas:**
  - `game.remove(e)` tira da cena;
  - `game.byTag('enemy')` lista quem está vivo com a tag;
  - `game.place('start')` dá a posição de um spawn;
  - `game.player` é o jogador;
  - `game.collision` tem `height(x, z, y)`, `ground(x, z)`, `blocked(p, r, h)` e `clear(a, b)` (linha de visão).

### A ordem de um passo

É fixa:
1. os cérebros;
2. o movimento;
3. os atores se afastam uns dos outros;
4. os golpes acertam e os mortos caem;
5. os triggers;
6. as props;
7. o seu `def.step`;
8. os efeitos;
9. a câmera.

O que nasce durante um passo começa a agir no seguinte.

---

## 5. Combate, eventos e efeitos

- **Um golpe acerta** quem é de outro time, está ao alcance e dentro de `combat.arc` **graus** à frente; acerta cada alvo uma vez por golpe. O alvo perde `damage`, é jogado para trás e fica `invuln` segundos sem poder ser atingido.
- **Com 0 de vida:**
  - um inimigo vira pedaços e sai de cena;
  - o jogador volta ao ponto de partida depois de `respawn` segundos.
- **Eventos.** `game.emit(nome, dados)` emite; `game.events` são os do passo atual, que é onde as regras leem. Os da engine:
  - `swing` `{ id }`;
  - `hit` `{ by, target, damage, hp }`;
  - `death` `{ id, kind, team, by, at }`;
  - `respawn` `{ id }`.
- **Efeitos** (com `effects` ligado), por `game.effects`:
  - `ignite(x, z, raio)` põe o chão em fogo, que se espalha e deixa marca; `effects.weather.rain` contém o fogo;
  - `freeze(x, z, raio, segundos)` congela o chão;
  - `mark(x, z, raio, força)` escurece o chão em manchas, como as que os golpes deixam (`força` de 0 a 1, padrão 0,6);
  - `fx.sparks(x, y, z, cor, n, velocidade)` e `fx.ring(x, y, z, cor, r0, r1, vida, n)`, onde a cor é um índice da paleta.
- **HUD e som:** as `hud.lines` aparecem no canto (placar, objetivo), e `hud.message` dá palavras próprias aos eventos.
- **Coisas que quebram:** caixas, pilares, paredes.
  - **Na cena:** esculpa com uma `tag`: `S.box([2, 0.5, 0], [0.5, 0.5, 0.5], madeira, { tag: 'caixa-1' })`. Tudo o que tem a mesma tag quebra junto.
  - **No jogo:** `breakables: [{ tag: 'caixa-1', hits: 2 }]`.
  - **O golpe:** como num inimigo, conta quem está ao alcance e à frente, uma vez por golpe.
  - **Eventos:** `hit-object` `{ tag, by, hits }` a cada golpe e `break` `{ tag, by, at }` quando quebra.
  - **Ao quebrar:** os pedaços voam (`mode: 'debris'` some aos poucos; `'rubble'` fica no chão), e o lugar se abre no mapa de colisão. Os inimigos com `hunter()` passam a usar a passagem.
  - **Save:** o save guarda o que quebrou, e ao carregar a coisa continua quebrada.
  - **Por uma regra:** `game.breakables.breakIt(game, 'caixa-1', [dx, dz])` quebra sem golpe, como numa explosão.

---

### Missões em dados (`story`)

A campanha de um jogo pode ser **dados em vez de código**: um documento no formato de história do kit (`ink-studio/story` versão 1, ver [docs/story-documents.md](../docs/story-documents.md)) diz o que há para fazer, e as **ações** dizem o que os eventos dele fazem. O `ninho` não tem `step()`: toda a regra dele está em `mission.json` e nas ações.

```ts
import mission from './mission.json';
// ...
story: {
  document: mission,
  actions: {
    acorda: { on: { kind: 'story-stage-entered', where: { path: '/stage', value: 'serpent' } },
              actions: [{ action: 'game/spawn', args: { actor: 'serpent', at: 'nest' } }, { action: 'game/say', args: { text: 'THE SERPENT WAKES' } }] },
    venceu: { on: { kind: 'story-transition', where: { all: [{ path: '/story', value: 'hunt' }, { path: '/to', value: 'completed' }] } },
              actions: [{ action: 'game/win' }] }
  }
}
```

**O documento:** `{ format, version: 1, id, stories }`. Cada história tem:
- `entry` (o primeiro estágio), `stages`, `outcomes` e, se quiser, `triggers`;
- `lifecycle: { progression: true }`, e em cada estágio `decision: { mode: 'autonomous' }` com `"auto": true` nos ramos. A engine anda sozinha de qualquer jeito, mas o `check` avisa sem isso, porque o kit não rodaria;
- **um estágio** tem `title`, `objectives` (todos os obrigatórios ao mesmo tempo, em qualquer ordem) e `next` (os ramos). Um ramo vai para outro `stage` ou para um `outcome`, e abre quando os objetivos obrigatórios estão feitos (mais os de `requires`). Com vários abertos, vale o primeiro por ordem de ID;
- **um desfecho** encerra a história como `completed`, ou `failed` com `"status": "failed"`.

**Gatilhos** (`triggers`, uma história sem nenhum começa no primeiro passo):
- `{ event: { kind, where }, count?, within? }`: um evento do jogo; com `count`, tantos dentro de `within` segundos;
- `{ state: { field, args?, when } }`: quando a consulta passa de falsa a verdadeira;
- `{ state: ..., hold: s }`: verdadeira por `s` segundos seguidos.

**Objetivos:**
- `evidence: { event: {...} }` ou `evidence: { state: { field, select?, when } }`;
- `type: 'reach'` com `params: { system: 'game', agent: 'player' (ou um kind ou tag), min: [x,y,z], max: [x,y,z] }`;
- `type: 'maintain'` (uma condição por `for` segundos), `'survive'` e `'protect'` (idem, mas falham se a condição quebrar: um ramo com `requiresFailed: ['id']` pega essa falha), `'observe'`;
- `optional: true` não segura o estágio.
- A evidência conta **a partir do passo seguinte** à entrada no estágio: o evento que fechou o estágio anterior não fecha o novo.

**Consultas** (`field` de uma regra `state`):

| `field` | O que dá |
|---|---|
| `game/state` | o `game.state` (use `when.path`, ou `select`, para um campo) |
| `game/enemies` | quantos atores de pé de uma tag (`args: { tag }`), ou de qualquer time que não o do jogador |
| `game/actors` | quantos atores de pé, por `args: { kind, tag, team }` |
| `game/player` | `{ hp, pos, down }` do jogador |
| `game/time` | segundos de jogo |
| `game/story` | `{ [história]: { state, stage, outcome } }` |

**Condições** (`where`, `when`): `{ path: '/campo', op, value }` com `op` `eq` (padrão), `ne`, `lt`, `lte`, `gt`, `gte`, `in` ou `exists`, e `{ all: [...] }`, `{ any: [...] }`, `{ not: ... }`. `path` é um JSON Pointer nos dados do evento ou no valor da consulta.

**Eventos da história** (para ações e para outras histórias): `story-started`, `story-stage-entered` (`{ story, stage, visit }`), `story-objective-resolved`, `story-branch-chosen` e `story-transition` (`{ story, from, to, outcome }`, com `to` `completed`, `failed` ou `expired`).

**Ações** (`on`: `{ kind, where }`; `limit`: quantas vezes no jogo; `delay`: segundos depois; `bindings`: `{ '/args/destino': '/dado/do/evento' }` copia valores do evento):

| Ação | `args` |
|---|---|
| `game/spawn` | `{ actor, at, brain?, kind?, tags? (padrão ['enemy']), team?, face?, count? }`. O cérebro vem de `def.brains` pelo nome (`brain`, ou o `kind`, ou o ator) |
| `game/say` | `{ text }`: mensagem no HUD |
| `game/sound` | `{ name }`: um som da engine |
| `game/emit` | `{ name, data? }` |
| `game/set`, `game/add` | `{ path, value }` no `game.state` |
| `game/heal` | `{ amount }` ao jogador |
| `game/win`, `game/lose` | `game.state.won` / `lost` = true, e o evento `won` / `lost` |
| `game/break` | `{ tag }`: quebra uma coisa de `breakables` |
| `game/remove` | `{ tag }`: tira de cena os atores da tag |
| `game/story-start` | `{ story }`: começa uma história que esperava o gatilho |

- **O HUD:** sem `hud.lines`, ele mostra o estágio de cada história ativa (e os objetivos abertos, quando há mais de um).
- **Save e hash:** o progresso de cada história é dado simples, vai no save e no `hash`. `game.story.of('hunt')` diz onde uma história está, para um robô ou uma regra.
- **O `check`** valida o documento pelo próprio kit (campos, referências, estágios inalcançáveis) e aponta o que a engine não tem: consulta, tipo de objetivo, ação, ator, ponto de spawn, cérebro, ou um evento que nada no jogo emite.
- **Fora do recorte:** escolhas do jogador (`decision` `player` e `intervene`, `choose`), ofertas manuais, papéis, contas e o resto do mundo do kit (`acquire`, `deliver`, `build`, `negotiate`).

---

## 6. Determinismo: as regras que não se quebram

A mesma semente e o mesmo roteiro dão **o mesmo jogo, em qualquer navegador e no Node**. Para isso:
- **sorte só com `game.rng()`**, nunca `Math.random`;
- **nunca leia o relógio** (`Date`, `performance.now`): use `game.t` ou conte passos;
- **escreva `Math.pow(a, b)`, nunca `a ** b`**;
- não guarde funções do `Math` em variáveis no topo do módulo;
- `game.state` e `entity.data` só com **dados simples**;
- nada de timers (`setTimeout`) nem `await` no jogo: o tempo é o passo.

O `check` acusa todas essas. Os detalhes estão em [docs/engine-determinism.md](../docs/engine-determinism.md).

---

## 7. Roteiros de input e saves

Um **roteiro** é o input como dado:

```json
{
  "seed": 5,
  "view": { "w": 900, "h": 620 },
  "events": [
    { "step": 0, "stick": [0.97, 0.23] },
    { "t": 1.0, "tap": "attack", "for": 2 },
    { "t": 5.0, "press": "run" },
    { "t": 9.0, "release": "run" },
    { "t": 9.0, "turn": [0.4, 0] },
    { "t": 10.0, "click": [0.5, 0.4] }
  ]
}
```

- **Ações:** `up`, `down`, `left`, `right`, `run`, `jump`, `dash`, `attack`, `cast` e `crouch`.
- **O manche:** `stick` é `[x, y]` relativo à câmera (y é "para longe dela").
- **Andar numa direção do mundo `(wx, wz)` com a câmera em `yaw`:** use `stick = [wx·cos(yaw) − wz·sin(yaw), −wx·sin(yaw) − wz·cos(yaw)]`. O `yaw` inicial é o da `cam` da cena.
- **Tempo:** um evento em `"step": n` vale no passo n (o primeiro é o 0); `"t"` é arredondado para o passo mais próximo.
- **A semente:** `"seed"` no roteiro **substitui** a semente do jogo (que, por padrão, é a da cena). Sem `"seed"`, vale a do jogo. Ela muda a sorte (`game.rng`, partículas, os golpes dos inimigos), não a cena.
- **Como montar um roteiro que chega a algum lugar:**
  1. calcule as direções com a fórmula acima e os tempos com as velocidades do `walker` (seção 4);
  2. rode `shot ... --t <fim> --trace 0.5` e veja, a cada meio segundo, onde o jogador está e o que o `game.state` diz;
  3. ajuste quando virar e quanto andar, e repita. Postes e paredes no caminho pedem um desvio: o personagem desliza ao longo deles, mas não os atravessa;
  4. quando chegar, confira com `sheet` nos momentos-chave e olhe os quadros.

### Robôs: um jogador de código que grava roteiros

Contra inimigos que reagem, um roteiro escrito à mão quase nunca vence: os tempos mudam a cada ajuste. A saída é um **robô**: uma função chamada antes de cada passo, que olha o jogo e aperta botões, como uma pessoa faria. `record` grava o que ele apertou como um roteiro comum. Depois, **o roteiro sozinho reproduz a mesma partida para sempre**, e é ele que os testes guardam, não o robô.

```ts
// engine/examples/<nome>/bot.ts
import type { BotApi } from '../../src/game/bot';
export default function (api: BotApi) {
  const { game } = api;                         // o jogo como está, entre dois passos: só leia
  const p = game.player;
  if (!p || game.state.won) return api.stop();
  const foe = game.byTag('enemy')[0];
  if (!foe) return api.walkTo([0, 0, 0], 0.5);  // vai até um ponto e para a 0,5 dele
  api.walkTo(foe.pos, 1.0, true);               // corre até o inimigo
  api.tap('attack');                            // aperta e solta o golpe neste passo
}
```

- A `api` tem `walkTo(ponto, perto?, correr?)`, `walkAway(ponto, correr?)`, `stand()`, `tap(ação)`, `stop()`, o `game` e o `input`. A conversão de direção do mundo para o manche já é feita.
- Grave com `node engine/cli.js record meu-jogo --bot engine/examples/meu-jogo/bot.ts --until won --t 120 --out engine/examples/meu-jogo/win.json`.
  - O jogo para quando `game.state.won` fica verdadeiro, ou em `--t` segundos.
  - Ele roda o roteiro de novo **sem o robô** e confere que dá o mesmo `hash` (`"ok": true` no JSON).
- O robô da arena (`engine/examples/arena/bot.ts`) mostra uma tática: contra o chefe, ficar fora do alcance dele, entrar logo depois de ele golpear, bater e recuar.

**Saves:**
- `shot --save s.json` grava um save e `--load s.json` começa dele. A página salva sozinha (a cada 2 s, ao sair, e com P) e volta de onde parou; `&fresh=1` começa do zero.
- Um save guarda o estado do jogo e o de cada entidade (com o mesmo `id`, mesmo a que nasceu durante a partida, e a pose do corpo de quem tem `tail`). **Não guarda o momento do mundo:** partículas, fogo e a animação da cena recomeçam, e o relógio do jogo volta a 0. Por isso uma partida carregada não dá o mesmo `hash` da que não parou; duas cargas do mesmo save dão o mesmo `hash`, passo a passo.

---

## 8. Armadilhas conhecidas

| Armadilha | Sintoma | O que fazer |
|---|---|---|
| **Sólido adicionado depois do último `S.bake()`** | não aparece e ninguém pisa nele | `S.bake()` depois de adicionar (o `check` avisa) |
| **Ordem dos bakes** | o cenário tem buracos ou sombras de algo que se move | faça o bake do cenário fixo **antes** das partes que se movem |
| **`K.pool`, `K.character` ou `K.play.fx` depois de `B.finish`** | os splats nunca entram no mundo | personagens vão em `actors`; pools de efeito, em `build(ctx)` com `ctx.reserve` (o `check` acusa) |
| **Sólido negativo (`neg: true`)** | apaga **tudo** o que estiver dentro dele, inclusive o chão de baixo | deixe o negativo pequeno e só onde quer cavar; se o nível ficou sem chão, o `check` diz "nothing to stand on" |
| **Graus × radianos** | câmera virada, ângulo absurdo | **radianos** em `cam`, `camera`, `face` e `yaw`; **graus** só em `combat.arc` (o `check` desconfia de valores estranhos) |
| **`S.box` com medidas inteiras** | caixa com o dobro do tamanho | `S.box` recebe **meias** medidas |
| **Spawn na borda ou fora do chão** | o personagem não nasce, ou nasce dentro de algo | use `[x, null, z]`; o `check` diz onde fica o chão livre mais perto |
| **Paleta curta para o `walker`** | personagem com cores erradas | os índices 13 a 17 da paleta precisam existir e ser as cores certas |
| **Índice de cor fora da paleta num material** | cor errada ou erro no bake | toda rampa `r: [...]` usa índices que a paleta tem |
| **Ghost como chão** | o personagem não sobe em algo que se vê | `ghost: true` não é chão: só decoração |
| **Ator nascendo durante a partida, sem `brains`** | o save não carrega | `brains: { kind: cérebro }` na definição |
| **Estado com funções ou objetos do kit** | o save quebra; o `check` acusa | `game.state` só com dados simples; objetos do kit vão em `build()` → `game.built` |
| **Mais atores que `max`** | erro "max is N, all in use" | aumente `actors.<nome>.max` |
| **Superfícies finas demais para o pixel de arte** | o jogo pesa numa GPU fraca sem ficar mais bonito | o custo de GPU e da ordenação é por splat. Ponha `S.adaptiveSampling = true` antes do `S.bake()`: faces largas ficam com menos splats e bordas com mais (−41% numa arena com 2,8 vezes mais detalhe, sem diferença visível). Use `res` de acordo com o `detail` da cena: a arena tem ~2,7 splats por pixel de arte, e uma arena com 16 por pixel custa 4,5 vezes mais na GPU. O estilo `colored` dobra o custo. Meça com `cd engine && npm run perf` (ver `docs/engine-performance.md`) |

Quando o `check` não explicar, rode `shot`/`sheet` e **olhe o PNG**.

---

## 9. Onde está cada coisa

| Arquivo | O quê |
|---|---|
| `engine/src/game/types.ts` | o contrato inteiro (toda definição, todo campo, comentado) |
| `engine/src/game/game.ts` | o jogo rodando: entidades, ordem do passo |
| `engine/src/game/combat.ts`, `brains.ts`, `effects.ts`, `tails.ts` | combate, cérebros, efeitos, corpos que se arrastam |
| `engine/src/game/story.ts` | o executor das missões em dados: consultas, tipos de objetivo e ações que a engine conhece |
| `engine/src/game/collision.ts` | o mapa de chão e paredes |
| `engine/src/game/validate.ts` | o `check`: cada código de problema e sua dica |
| `engine/src/game/save.ts`, `script.ts` | saves e roteiros |
| `engine/src/ui/` | HUD (fonte própria), som |
| `engine/cli.js` | os comandos |
| `engine/src/game/bot.ts` | a `BotApi` dos robôs |
| `src/kit/kk-character.js` | o `K.character` do kit (o `spec` completo está no topo) |
| `README.md` (raiz) | o kit: formas, materiais, luz, animação |
| `docs/engine-plan.md` | o plano da engine e o que cada etapa mediu |
