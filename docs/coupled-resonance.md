# Coupled resonance

Join two [resonant mode assets](resonant-modes.md) at named excitation
sites. A spring and damper at the contact read the difference between
the sites' displacements and velocities. Their force acts in opposite
directions through the same signed mode gains. A strike on either
body can excite the other one. [Modal contact modeling](https://avanzini.di.unimi.it/downloads/publications/avanzini_lncs06.pdf)

The connection changes the pair's pitches and decay while it is
engaged. As it opens, each object continues from the displacement and
velocity it has already acquired. The solver uses implicit midpoint
integration and substeps when needed for modal bandwidth. A held
lossless contact conserves energy to numerical precision. Damping
removes energy. Changing contact stiffness can do mechanical work.

## Render an opening contact

Use a version 1 `ink-studio/coupled-resonant-mode-run` with the ordinary
resonator CLI. Each asset may also be supplied inline.

```json
{
  "format": "ink-studio/coupled-resonant-mode-run",
  "version": 1,
  "settings": {"sampleRate": 32000},
  "samples": 64000,
  "bodies": {
    "gate": {"asset": "gate.json", "site": "joint"},
    "railing": {"asset": "railing.json", "site": "joint"}
  },
  "contact": {"stiffness": 2350000, "damping": 18, "initial": 1, "slewMs": 5},
  "levels": [{"sample": 18240, "level": 0}],
  "impulses": [{"body": "gate", "excitation": "strike", "sample": 1920, "fraction": 0.3, "value": 0.93}],
  "audio": {"channels": [{"body": "gate", "pickup": "listen"}, {"body": "railing", "pickup": "listen"}],
    "measure": "velocity", "gain": 0.6}
}
```

```sh
ink-studio sim resonator render release.json --out trace.json --wav release.wav
```

| Setting | Meaning |
| --- | --- |
| `stiffness`, `damping` | Spring and damper at full contact. Use compatible mass normalization and site units for both assets. |
| `initial`, `levels` | Contact amount from 0 to 1. Each sample-addressed level holds until the next one. This scales the contact force. |
| `slewMs` | Time for a full-scale contact change. Default 3 ms. Set 0 for a break on a precise sample. |
| `forces` | Optional body and excitation tables. Each force is a constant or one value per sample. |
| `impulses` | Named body and excitation, absolute sample address, optional fractional offset within that sample, and impulse strength. |
| `audio` | One or two pickup channels, a velocity or displacement measure, and a shared listening gain. Velocity is the default measure. |

The trace records the effective contact amount, each body's pickup
displacement and velocity, the endpoint force and energies, and a
resumable checkpoint. A conservative coupled bandwidth estimate must
stay below 49% of the sample rate.

## Drive from a host

`KIT.world.resonantModes.prepareCoupled({bodies, contact}, settings)`
binds the two assets. Call `process(count, {contact, forces, impulses})`
with a scalar contact amount or an array containing one value per sample.
Leaving contact out holds the last target. The call returns pickup
displacement and velocity at the start of each sample. It integrates
fractional impulses inside their sample. Use `view()` to read the next
boundary and `snapshot()` and `restore()` to resume it.

For a [physical audio render](physical-audio.md) or `audio.physicalSignal`
graph input, select
`{"body":"railing","name":"listen","channel":"velocity","metersPerUnit":1}`.
The trace retains the native sample addresses for spatial routing, stems,
or analysis. The generic simulation trace adapter accepts a body in
`track` and a pickup measure in `measure`.

## Demo

```sh
node examples/coupled-resonance/demo.cjs iron-joint
```

Open `iron-joint/index.html`. Strike either body and break the contact
while it rings. The aligned playback comparisons hold the contact,
break it, or keep the bodies apart. The recording always strikes the
gate, with the gate on the left and railing on the right. The demo
uses authored modal banks and one listening gain across the comparisons.
