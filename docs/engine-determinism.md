# Determinismo da engine

Este documento diz **o que a engine garante** sobre repetir uma partida, **como** ela garante, **como conferir**, e o que um **port para outra linguagem** (C++, Rust, Zig, C#…) precisa reproduzir para continuar valendo. Ele complementa a seção 3 de [engine-stage6-design.md](engine-stage6-design.md), que definiu o contrato, e o resultado da Etapa 7 em [engine-plan.md](engine-plan.md), onde o problema foi achado.

## 1. A garantia

> **A mesma seed e o mesmo roteiro de input dão o mesmo jogo, bit a bit, em qualquer motor de JavaScript.**

"O mesmo jogo" quer dizer: os mesmos splats (`world.data`, cada float), as mesmas entidades (posição, vida, estado de cada `K.character`, memória dos cérebros), os mesmos dados (os três geradores) e, portanto, o mesmo `game.hash()` **a cada passo**. Vale entre o Node e qualquer navegador, e entre versões diferentes deles.

Isso é o que permite:
- gravar uma partida no navegador (`InputRecorder`) e reproduzi-la no Node (`cli.js shot`, testes) com o mesmo desfecho: se um golpe acertou lá, acerta aqui;
- uma IA escrever um jogo, rodá-lo sem navegador, e confiar que o jogador vai ver exatamente aquilo;
- no futuro: replays, multiplayer por *lockstep* (cada máquina simula, só o input viaja), testes de regressão com `hash` fixado.

O que **não** está na garantia: o que é só desenho. A imagem na GPU (o shader arredonda como a placa quiser; a paridade com o renderizador do terminal é medida em %, e dá 100% hoje), a ordem do Worker de ordenação, o fps, o estilo `colored`. Nada disso volta para a simulação.

## 2. Por que precisou de trabalho: o que o JavaScript não fixa

O padrão ECMAScript fixa o resultado, bit a bit, de `+ - * /`, `Math.sqrt`, `floor`, `ceil`, `round`, `trunc`, `abs`, `min`, `max`, `sign`, `fround`, `imul`, `clz32`, das conversões e dos `Float32Array` (arredondamento para o par mais próximo). São operações do IEEE 754, e todo motor dá o mesmo resultado.

Ele **não** fixa as funções transcendentes: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow` (e o operador `**`), `cbrt`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `hypot`. Cada motor usa a sua biblioteca, e elas mudam de uma versão para outra.

**Medido na Etapa 7** (20 mil entradas por função, mesmos bits de entrada nos dois lados):

| Função | Node 24 (V8 13.6) × Edge 157 — entradas com resultado diferente |
|---|---|
| `sin`, `cos`, `tan`, `log` | 3% a 4% |
| `atan`, `asin`, `acos`, `exp`, `cbrt`, `sinh`, `expm1`, `log1p` | 6% a 10% |
| `atan2`, `tanh` | 16% a 18% |
| `log2` | 0,2% |
| `pow`, `hypot`, `sqrt` | 0% (nesta dupla de versões; nada garante na próxima) |

As diferenças são de 1 ulp (o último bit), mas um jogo é um sistema caótico. Na luta do `farol-fight`, o ângulo de um inimigo (`atan2`) divergiu no passo 6, e o `hash` da partida no Edge deixou de ser o do Node. Por sorte, as imagens ainda batiam 100% aos 8,3 s. Sem correção, uma partida gravada no navegador podia terminar diferente no Node.

## 3. Como a engine garante

Tudo o que a simulação faz acontece **dentro** de `Dice.during(K, fn)` ([engine/src/game/rng.ts](../engine/src/game/rng.ts)): o build do nível e cada passo. Durante essa chamada, e só durante ela, a engine troca peças globais pelas suas e as devolve no fim (`try/finally`, mesmo com exceção). A troca é síncrona, então nenhum outro código vê o estado trocado.

| Fonte de diferença | Como é neutralizada | Onde |
|---|---|---|
| Tempo | Passo fixo de 1/60 s; o relógio é `passos / 60`, contado, não somado. Nenhum `Date.now`/`performance.now` na simulação. | `core/loop.ts` |
| Ordem | Entidades sempre em ordem de `id`; a ordem do passo é fixa (`game.ts`, seção 2.2 do desenho). `Map`/`Set` iteram em ordem de inserção e `Array.prototype.sort` é estável (ES2019): o kit depende disso (18 `sort`, 40 `Set`/`Map`). | `game/game.ts` |
| Sorte do jogo | `game.rng()`: xorshift32 com semente `seed`. | `game/rng.ts` |
| Sorte do kit | `K.rnd`/`K.seed` trocados por um xorshift32 do jogo (semente `seed ^ 0x51ed270b`; o mesmo algoritmo do kit). | `game/rng.ts` |
| `Math.random` | Trocado por um terceiro xorshift32 (semente `seed ^ 0x2545f491`). O `K.play.*` usa `Math.random` 21 vezes. | `game/rng.ts` |
| Funções transcendentes | **Trocadas pelas da engine** ([engine/src/game/dmath.ts](../engine/src/game/dmath.ts)): todas as 22 da lista da seção 2. | `game/dmath.ts` |
| Input | Só pelo `InputState`, como dado (`Script`); a câmera faz parte da simulação; cliques são resolvidos pela vista fixada no roteiro (`view`). | `core/input.ts`, `game/script.ts` |

### 3.1 O `dmath`

São ports da **fdlibm 5.3** (Sun Microsystems, 1993), a biblioteca de referência das funções matemáticas em C. É também a base do `StrictMath` do Java, e o V8 a usava. Os ports estão em TypeScript e só usam as operações que o padrão fixa, mais a leitura e escrita das duas metades de 32 bits de um `double`.

- **Precisão:** até 1 ulp das funções nativas em todas as que o kit usa. `log1p`, `asinh`, `acosh` e `atanh` ficam a até 2 ulp; o kit não as usa. Nos 20 mil testes por função, a maioria dá exatamente o bit do Node 24, que também deriva da fdlibm. Em todos os valores especiais (NaN, ±0, ±∞, limites de overflow e underflow), o resultado é o que o padrão manda.
- **O que difere da fdlibm original:**
  - ângulos acima de 2^19 · π/2 (≈ 823 mil radianos) em `sin`, `cos` e `tan` são reduzidos com `BigInt`, em vez do `__kernel_rem_pio2` da fdlibm. O 2/π com 1280 bits é calculado uma vez, pela fórmula de Machin. O `BigInt` é exato em qualquer motor. `sin(1e22)` e `cos(1e22)` dão os valores corretos;
  - `hypot` é a soma escalada simples (divide pelo maior valor, soma os quadrados na ordem dos argumentos e tira a raiz), não a da fdlibm;
  - `log2`, `log10`, `log1p`, `asinh`, `acosh` e `atanh` são derivadas do `log` e do `exp` da fdlibm. O `log2` dá exato em potências de 2.
- **O que fica nativo:** `sqrt` e as demais funções da seção 2 que o padrão fixa. O `dmath` guarda o `Math.sqrt` original para nunca chamar a si mesmo.
- **Custo medido:** o build do `farol` fica 11% mais lento (941 → 1047 ms) e um passo da luta 15% mais lento (0,78 → 0,90 ms). Um passo da luta faz cerca de 10 500 `sin`, 2 400 `cos`, 4 100 `hypot`, 14 `exp` e 10 `atan2`.
- **Fora da simulação**, o `Math` é o nativo: o desenho (`makeView`, câmera na hora de desenhar) e a página. Isso é proposital, porque não volta para o estado do jogo.

### 3.2 A impressão digital

`fingerprint()` em `dmath.ts` passa cada função por um conjunto fixo de entradas: uma sequência congruente linear a partir de 12345, mais valores especiais e argumentos enormes. Depois calcula um FNV-1a de 64 bits sobre os bits dos resultados.

> **Impressão digital atual: `852e6b34ae4e5869`**

Ela está fixada em `engine/test/dmath.test.mjs`, e o harness de paridade (`npm run parity`) a calcula no Node e no navegador e falha se diferirem. **Mudar qualquer função do `dmath` muda a impressão digital, e partidas gravadas antes podem terminar diferente.** Isso só se faz de propósito, atualizando o valor fixado e registrando aqui.

## 4. Como conferir

- `npm test` (engine):
  - `dmath.test.mjs`: impressão digital, precisão, valores especiais, e a troca só durante o jogo;
  - `game.test.mjs`: mesmo roteiro, mesmo `hash` em todos os passos; outro roteiro diverge; dois jogos intercalados não se misturam; `K.play.fx` continua determinístico;
  - `combat.test.mjs`: a mesma luta duas vezes, golpe a golpe.
- `npm run parity`: o mesmo roteiro no navegador e no Node. **Falha se o `hash` diferir** ou se a impressão digital diferir. Medido em 2026-11-16, com o Edge 157 e o Node 24:

| Jogo, roteiro, instante | `hash` (navegador = Node) |
|---|---|
| `farol-walk`, `walk.json`, 6 s | `ea152a96cb4fe1a9` |
| `farol-fight`, `fight.json`, 8,3 s | `a9cdaa735cf7eda8` |
| `arena`, `win.json`, 40 s | `368cabf9a6aee950` |

  A luta inteira (720 passos, 12 s) também foi comparada passo a passo: nenhuma diferença.

## 5. Regras para quem escreve um jogo

- Sorte só com `game.rng()`. O `Math.random` está trocado durante o passo, mas é do kit; o jogo não deve contar com ele.
- Nunca ler o relógio (`Date.now`, `performance.now`) na simulação.
- Usar `Math.pow`, não o operador `**`. O operador é calculado pelo motor e **não passa pela troca**. O validador da Etapa 9 recusa `**`, `Date`, `performance` e `Math.random` no código de jogo.
  - **O kit:** até 2026-11-17 o kit não usava `**`. Depois do merge do original (2026-11-21) ele passou a usar em cerca de 165 arquivos, inclusive no núcleo (`K.wobble`, deformadores, matéria). A engine não edita esses arquivos: ela carrega o kit por [`engine/scripts/kit-node.cjs`](../engine/scripts/kit-node.cjs), que pede ao esbuild para reescrever cada `a ** b` como `__pow(a, b)` e troca o ajudante do esbuild (`var __pow = Math.pow`, que guardaria a função nativa) por um que **eleva ao quadrado com `a * a`** (exato em qualquer motor), **mantém `**` só para `BigInt`** (inteiro, exato) e, no resto, **procura `Math.pow` na hora da chamada** (a determinística durante o passo). Isso vale para a página (`kit.js`) e para o Node (CLI e testes).
  - O teste [`engine/test/kit-determinism.test.mjs`](../engine/test/kit-determinism.test.mjs) confere que o kit carregado não tem nenhum `**` fora do ajudante e que o ajudante se comporta assim.
- Nunca guardar uma função do `Math` numa variável fora do passo (`const sin = Math.sin` no topo do módulo): ela ficaria com a nativa. Dentro da função, a cada chamada, tudo bem: é o que o `ki-deform.js` faz.
- Estado do jogo (`game.state`, `entity.data`) só com dados simples. Nada de `Map`/`Set` com chaves de objeto, que dependem da ordem de criação.
- O que mostra o jogo (HUD, som, a página) lê o jogo **entre** os passos, por `game.takeEvents()`, e nunca reage de dentro do passo: lá dentro o `Math.random` e o `Math` são os do jogo, e um som que sorteasse algo gastaria o dado da partida.
- Um save é aplicado dentro do dado do jogo (`game.withDice`), então carregar um save também é determinístico: o mesmo save e o mesmo roteiro dão o mesmo jogo.

## 6. Para um port a outra linguagem

O plano prevê, mais adiante, levar a engine (ou só a simulação) para uma linguagem mais rápida. O determinismo **vai junto** se o port seguir as regras abaixo. A forma de provar é a mesma de hoje: o port roda os roteiros de exemplo e dá os mesmos `hash` da tabela da seção 4. Para isso, o hash precisa ser redefinido (item 8).

1. **Aritmética:** IEEE 754 binary64 (`double`) em toda a simulação, arredondamento para o mais próximo.
   - Sem contração em FMA (*fused multiply-add*): em C/C++, `-ffp-contract=off` e nada de `-ffast-math`/`/fp:fast`. Rust não contrai por padrão; não usar `mul_add` onde o JS faz `a * b + c`.
   - Sem precisão estendida: x87 de 80 bits nunca, só SSE2/NEON.
   - Subnormais preservados: FTZ/DAZ desligados.
   - Sem reassociação: `a + b + c` é `(a + b) + c`, da esquerda para a direita, como no JS.
2. **`float` só onde o JS usa `Float32Array`:** o buffer de splats e afins guarda em 32 bits, com arredondamento para o par mais próximo, mas **as contas são em `double`**. Um port que fizer as contas em `float` muda os resultados.
3. **Inteiros como no JS:**
   - `x | 0` e `x >>> 0` são o ToInt32/ToUint32 do JS: truncam em direção a zero e depois dão a volta módulo 2^32. Isso não é o cast do C, que é comportamento indefinido fora do intervalo;
   - `Math.imul` é a multiplicação de 32 bits com estouro;
   - os deslocamentos usam só os 5 bits de baixo da contagem.
4. **Arredondamentos do JS:** `Math.round(x)` é `floor(x + 0.5)` com sinal preservado (`Math.round(-0.5) === -0`, `Math.round(2.5) === 3`); não é o `round` do C, que arredonda metade para longe do zero. `floor`, `ceil` e `trunc` são os do IEEE.
5. **Funções transcendentes:** portar **o `dmath.ts`**, não usar a `libm` do sistema. A `libm` da glibc, da musl, da MSVC e da Apple são todas diferentes entre si e da fdlibm. Opções:
   - traduzir `dmath.ts` linha a linha (ele já usa só operações básicas e as metades de 32 bits);
   - ou usar a fdlibm 5.3 original em C com as mesmas correções (redução com precisão arbitrária acima de 2^19 · π/2, o `hypot` simples, as derivadas).

   O teste é a **impressão digital `852e6b34ae4e5869`**: o port precisa dá-la.
6. **Geradores:** xorshift32 exatamente como em `rng.ts` (`s ^= s << 13; s ^= s >>> 17; s ^= s << 5`, em 32 bits sem sinal; resultado `s / 2^32`), com as mesmas sementes derivadas.
7. **Ordem e coleções:** iterar entidades por `id`; onde o kit usa `Set`/`Map` (40 lugares), iterar em ordem de inserção; onde ordena (18 `sort`), usar ordenação **estável**.
8. **O `hash`:** hoje é FNV-1a de 64 bits sobre os bytes dos floats dos splats, mais um `JSON.stringify` do estado. A parte em JSON depende de como o JS escreve números, o que é chato de reproduzir. Um port deve trocar essa parte por bytes (os `double` de cada campo, em ordem fixa) e recalcular a tabela da seção 4 nas duas implementações, para comparar uma com a outra.
9. **O kit vem junto:** a simulação inclui o ink-studio (`src/`). Ele é JavaScript e segue as mesmas regras. Portar a engine sem portar o kit (por exemplo, rodando o kit num motor de JS embutido) mantém a garantia **se** esse motor também receber a troca do `Math`.

## 7. Limites conhecidos

- O operador `**` escapa da troca (seção 5).
- Uma função do `Math` guardada numa variável no carregamento de um módulo também escapa. Hoje nenhum módulo faz isso.
- `Math.random` e `K.rnd` só são determinísticos durante o passo; fora dele (na página, no desenho) voltam a ser os originais.
- A troca do `Math` é global durante o passo. Se outro código de JavaScript rodasse **no meio** de um passo, veria o `dmath`. Isso não acontece hoje, porque um passo é síncrono do começo ao fim. Se um dia a simulação ficar assíncrona (esperar um Worker no meio do passo, por exemplo), esse desenho precisa ser revisto.
