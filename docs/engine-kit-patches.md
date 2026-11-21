# Alterações locais no código do ink-studio

A engine evita mexer no código do kit (`src/`, `cli/`, `index.js`), para que os merges do original continuem limpos. Quando uma alteração é inevitável, ela fica listada aqui: **depois de cada merge do original, confira se cada uma ainda está aplicada** e se o original já resolveu o problema por conta própria (aí a alteração sai).

| Arquivo | O quê | Por quê | Como conferir |
|---|---|---|---|
| `src/webgl/renderer.mjs`, em `createBackend` | O programa de resolve completo (`sources.POST_FS`) passa a ser compilado no primeiro uso (`fullPost()`), não na criação do renderizador. | No Windows, o Edge e o Chrome traduzem o GLSL para Direct3D (ANGLE), e esse programa leva **cerca de 100 s** para ligar (medido em 2026-11-21, RTX 5050, Edge 157). Os jogos da engine não usam padrões por pixel, vidro, AO, tom nem gradação, então usam o resolve especializado (0,3 s) e nunca precisam do completo. Sem a alteração, a página fica travada por quase 2 minutos antes do primeiro quadro. | Abrir `/?game=arena` com o servidor de dev: o primeiro quadro sai em poucos segundos. O comentário `ink-engine patch` marca o trecho. |

**Também conta como ajuste, mas sem editar o kit:** o `**` do kit é reescrito na hora de carregar ([`engine/scripts/kit-node.cjs`](../engine/scripts/kit-node.cjs); ver [engine-determinism.md](engine-determinism.md), seção 5).

As duas são boas candidatas a sugerir ao original.
