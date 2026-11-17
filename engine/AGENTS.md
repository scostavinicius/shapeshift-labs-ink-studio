# Como escrever um jogo nesta engine

Guia para quem escreve jogos aqui, pessoa ou IA, partindo do zero. Leia tudo uma vez antes de começar: as armadilhas da seção 8 custam caro quando aparecem tarde.

A engine roda jogos de **ação vista de cima** em pixel-art, feitos de *splats* do [ink-studio](../README.md). Tudo é JavaScript/TypeScript. A mesma partida roda no navegador e no Node (sem navegador), e **é a mesma partida, bit a bit**, nos dois. É isso que permite escrever, rodar e conferir um jogo sem nunca abrir uma janela.

Todos os comandos abaixo rodam da **raiz do repositório**. Na primeira vez, rode `npm install` dentro de `engine/`.

---

## 1. O ciclo de trabalho

```
escreve → check → shot (ou sheet) → olha o PNG → corrige → repete
```

1. **Comece de um modelo:** `node engine/cli.js new meu-jogo` cria `engine/examples/meu-jogo/game.ts` e um roteiro `walk.json`. Há três modelos:
   - `--from blank` (padrão): uma cena própria escrita no arquivo, um herói e um inimigo;
   - `--from walk`: o `farol` com um personagem andando;
   - `--from fight`: o `farol` com uma luta.
2. **Confira:** `node engine/cli.js check meu-jogo`. Ele lista **todos** os problemas de uma vez, cada um com o lugar, o que está errado e o que provavelmente se quis (`->`). Só siga em frente com 0 erros.
3. **Olhe:**
   - `node engine/cli.js shot meu-jogo --input engine/examples/meu-jogo/walk.json --t 3` grava o quadro de 3 s em `engine/out/meu-jogo-3.png`;
   - `sheet ... --times 0,1,2,4` grava vários instantes da **mesma** partida lado a lado;
   - `shot ... --trace 0.5` também anota onde o jogador está (posição, vida, `game.state`) a cada 0,5 s: é o jeito de **ajustar um roteiro** (seção 7);
   - os PNGs trazem o **texto do HUD** no canto (`HP 4/5` e as suas `hud.lines`; `--no-hud` tira). Corações, barra de habilidades e mensagens só aparecem no navegador (`play`);
   - **abra o PNG e olhe de verdade.** O estado impresso não mostra um personagem dentro de uma parede ou uma câmera apontando para o vazio.
4. **Leia a última linha:** todo comando termina com **uma linha de JSON**. Use-a em vez de interpretar o texto acima dela.
   - `shot`: `{ png, hash, t, steps, game: { t, player: { pos, hp, down }, state, entities, enemies }, trace? }`. (Ali, `state` e `save` são os caminhos dos arquivos de `--state` e `--save`, ou `null`.)
   - `sheet`: `{ png, times: [{ t, hash, player, state }] }`.
   - `check`: `{ ok, errors, warnings, stats, parity }`.
5. **Jogue:** `node engine/cli.js play meu-jogo` abre o jogo no navegador. As teclas são WASD/setas para andar, Shift para correr, J golpe, K dash, Espaço pulo, M música, N sem som e P para salvar. Arrastar gira a câmera, a roda dá zoom e C troca o estilo.
6. **Opcional:** `node engine/cli.js check meu-jogo --parity --input <roteiro> --t 3` também desenha o jogo num navegador headless (Edge ou Chrome) e confere que é a mesma partida do Node.

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

Os três exemplos completos, do menor ao maior:

| Exemplo | Mostra |
|---|---|
| `engine/examples/farol-walk/` | uma cena pronta, um personagem, colisão (não atravessa o farol nem cai da ilha) |
| `engine/examples/farol-fight/` | combate, inimigos que perseguem, efeitos (faíscas, pedaços, chão queimado), linhas de HUD |
| `engine/examples/yard/` | **um nível escrito do zero**, um gerador de inimigos durante a partida, um portão que dá a vitória, chão que congela, `def.brains` para o save |
| `engine/examples/beacons/` | feito por uma IA **sem contexto, lendo só este guia**: acender três faróis com triggers, inimigos que acordam a cada farol aceso, vitória e derrota, e um roteiro (`win.json`) que vence |

**Copie de um deles** em vez de começar de uma folha em branco.

### Tudo o que uma definição aceita

| Campo | O quê |
|---|---|
| `id`, `name` | nome curto (obrigatório) e título |
| `scene` | caminho de uma cena do repositório ou a função da cena (obrigatório) |
| `seed` | a semente; por padrão, a da cena |
| `actors` | `{ nome: { spec, max?, hp?, radius?, damage? } }`: personagens (`K.character`), reservados antes de o mundo ficar pronto |
| `spawns` | pontos com nome: `[x, y \| null, z]` |
| `init(game)` | põe o elenco em cena; devolve `game.state` (obrigatório) |
| `step(game, dt)` | as regras, a cada passo |
| `camera` | `{ stiffness, minPitch, maxPitch, minDist, maxDist, bounds }`: a câmera segue o jogador com mola |
| `combat` | `{ invuln: 0.6, arc: 70, respawn: 1.5, respawnAt, knock }`, ou `false`; ligado por padrão |
| `effects` | `true` ou `{ fx: 400, debris: 800, eco: true, fuel: 0.5, weather: { rain, winter } }` |
| `hud` | `{ lines(game) => string[], message(evento, game) => string \| null \| undefined }` |
| `sounds` | `{ evento: som }`. Sons: `swing`, `hit`, `death`, `respawn`, `blip`, `save` |
| `brains` | `{ kind: brain }`: os cérebros dos atores que nascem **durante** a partida (para o save trazê-los de volta) |
| `collision` | `{ cell: 0.25, bakes: 'all' \| [0, 2], block: [caixas], open: [caixas], region }` |
| `build(ctx)` | reserva mais splats antes do `B.finish` (`ctx.reserve(() => K.play.fx(ctx.B, 200))`); o que devolve vira `game.built` |

---

## 3. A cena: o nível feito com o kit

Uma cena é `kit => ({ id, name, seed, build(seed) })`, e `build` devolve o mundo pronto. O jeito mais curto é escrevê-la no próprio `game.ts` (é o que o `yard` e o modelo `blank` fazem):

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

  - **As cores do `walker` são índices fixos: 13, 14 e 15 no corpo, 16 e 17 na cabeça.** Na sua paleta, esses índices precisam ser as cores que você quer (veja `yard`).
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

### Cérebros

Um cérebro é uma função que devolve **o mesmo input que o jogador daria**:

```ts
type Brain = (self: Actor, game: Game, dt: number) => Partial<StepInput>;
// StepInput: { move, mz: o desejo de andar no eixo x e z do MUNDO (comprimento até 1),
//              run, jump, jumpHeld, dash, attack, cast, crouch, face? (radianos) }
```

- `chaser({ sight, needsLine, range, speed, cooldown, retreat })` persegue o adversário mais próximo que vê, golpeia ao alcance, recua e volta. `dummy` fica parado.
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
  - `fx.sparks(x, y, z, cor, n, velocidade)` e `fx.ring(x, y, z, cor, r0, r1, vida, n)`, onde a cor é um índice da paleta.
- **HUD e som:** as `hud.lines` aparecem no canto (placar, objetivo), e `hud.message` dá palavras próprias aos eventos.

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

**Saves:**
- `shot --save s.json` grava um save e `--load s.json` começa dele. A página salva sozinha (a cada 2 s, ao sair, e com P) e volta de onde parou; `&fresh=1` começa do zero.
- Um save guarda o estado do jogo e o de cada entidade. **Não guarda o momento do mundo:** partículas, fogo e a animação da cena recomeçam.

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

Quando o `check` não explicar, rode `shot`/`sheet` e **olhe o PNG**.

---

## 9. Onde está cada coisa

| Arquivo | O quê |
|---|---|
| `engine/src/game/types.ts` | o contrato inteiro (toda definição, todo campo, comentado) |
| `engine/src/game/game.ts` | o jogo rodando: entidades, ordem do passo |
| `engine/src/game/combat.ts`, `brains.ts`, `effects.ts` | combate, cérebros, efeitos |
| `engine/src/game/collision.ts` | o mapa de chão e paredes |
| `engine/src/game/validate.ts` | o `check`: cada código de problema e sua dica |
| `engine/src/game/save.ts`, `script.ts` | saves e roteiros |
| `engine/src/ui/` | HUD (fonte própria), som |
| `engine/cli.js` | os comandos |
| `src/kit/kk-character.js` | o `K.character` do kit (o `spec` completo está no topo) |
| `README.md` (raiz) | o kit: formas, materiais, luz, animação |
| `docs/engine-plan.md` | o plano da engine e o que cada etapa mediu |
