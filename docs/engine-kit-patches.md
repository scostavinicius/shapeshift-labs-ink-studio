# Alterações locais no código do ink-studio

A engine evita mexer no código do kit (`src/`, `cli/`, `index.js`), para que os merges do original continuem limpos. Quando uma alteração é inevitável, ela fica listada aqui: **depois de cada merge do original, confira se cada uma ainda está aplicada** e se o original já resolveu o problema por conta própria (aí a alteração sai).

**Hoje não há nenhuma alteração no código do kit.** `src/`, `cli/` e `index.js` são idênticos aos da `main` do original.

**Também conta como ajuste, mas sem editar o kit:** o `**` do kit é reescrito na hora de carregar ([`engine/scripts/kit-node.cjs`](../engine/scripts/kit-node.cjs); ver [engine-determinism.md](engine-determinism.md), seção 5). É um bom candidato a sugerir ao original.

## Alterações que saíram

| Arquivo | O quê | Por que saiu |
|---|---|---|
| `src/webgl/renderer.mjs`, em `createBackend` | O programa de resolve completo (`sources.POST_FS`) era compilado no primeiro uso, não na criação do renderizador: no Windows (ANGLE sobre Direct3D) ele leva **cerca de 100 s** para ligar (medido em 2026-11-21, RTX 5050, Edge 157), e os jogos da engine usam o resolve especializado (0,3 s). | No merge de 2026-11-23, o original passou a fazer o mesmo (`post ??= program(sources.POST_FS)` em `resolveProgram`). Ficou a versão do original. Para conferir que continua valendo: abrir `/?game=arena` com o servidor de dev; o primeiro quadro sai em poucos segundos. |
