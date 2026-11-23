# Reusable simulation modules

An Ink [simulation model](simulation-models.md) can be used as a module.
It keeps its version, clock, initial state, named inputs and outputs, and
probes. A model can assemble native operators and other modules, so the
same valve controller can be tested alone and reused inside several rigs.

## Expose parameters on a model

Put defaults in `parameters` and declare the names instance authors can set
in `parameterSchema`. A definition can use a parameter anywhere it already
accepts a `$model` binding, including another module's instance parameters.

```json
{
  "parameters": { "gain": 0.6 },
  "parameterSchema": {
    "gain": { "type": "number", "min": 0, "max": 1, "description": "Valve opening at full command." }
  }
}
```

Types use Ink's graph validators for finite JSON values. For numeric
parameters, `min` and `max` are inclusive. An optional `choices` array lists
accepted values. Each declared parameter needs a valid default. Ink
rejects unknown overrides and values outside their declared constraints.

## Instantiate and wire a module

In a world or model, use `modules` to name definitions and `instances` to
place them. A definition can be a pinned relative JSON reference or an
inline simulation model. Instance names must be distinct from native
system or operator names.

```json
{
  "modules": { "reservoir": { "file": "reservoir.json", "revision": 1 } },
  "instances": {
    "slow": { "module": "reservoir", "parameters": { "valveGain": 0.25 } },
    "fast": {
      "module": "reservoir",
      "parameters": { "valveGain": 0.85 },
      "drive": ["opening"]
    }
  },
  "connections": [{ "from": "slow/receiver", "to": "meter/value" }]
}
```

The example assumes a native `meter` system with a `value` input. Address
module ports as `instance/port` and named probes as `instance/probe`. Ink
checks the connection against the existing type and
[physical quantity](physical-ports.md) contracts. A connection drives its
target automatically. Use `drive` for an exposed input you plan to set
with a host `world/input` command.

Instance parameters are applied before initialization. For changes during a
run, use named input ports. Each instance owns its own state and checkpoint.
It starts with the module's seed unless it declares its own integer `seed`.
It can also declare a native `schedule` and `contract` for its host system.

Use `sim model inspect` to see declared modules and exposed parameters.
Use `sim plan` to see each resolved instance, its effective parameter
values, and its named ports. Checkpoints embed the resolved definition and
overrides. Portable takes carry the source module files through nested
references. File references require a revision, resolve from the file that
declares them, and reject cycles.

From JavaScript, `W.models.system(model, {parameters, seed, drive})`
builds a system record from an already loaded model. Use
`W.models.instantiate(model, {parameters, seed})` to get a configured model
for a standalone or graph run. Both leave the shared definition intact.

## Reservoir bench demo

The [reservoir module](../examples/simulation-modules/reservoir.json)
connects a [valve controller](../examples/simulation-modules/valve.json)
to a pipe network. The [bench world](../examples/simulation-modules/bench.world.json)
uses the reservoir twice. Both start with the same amount of water. One
uses a 25% valve gain and the other 85%. At tick 16 a host command closes
only the faster valve. Its receiver plateaus while the other keeps filling.

```sh
ink-studio sim plan examples/simulation-modules/bench.world.json
ink-studio sim run examples/simulation-modules/bench.world.json --ticks 36 --record bench.run.json
ink-studio sim verify bench.run.json
node examples/simulation-modules/demo.cjs demo-output
```

The demo writes an animated PNG, a still, and a JSON report with the
measured volumes, valve outputs, and mass balance for both instances.
