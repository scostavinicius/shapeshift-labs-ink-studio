# Physical quantities on ports

A scalar or vector port can declare a `quantity`. The planner checks the
physical dimension in addition to the existing value type. It reports both
endpoints and the reason when a wire is incompatible.

```text
Incompatible physical ports pump/pressure.supply -> meter/value: Pa (mass length^-1 time^-2) cannot supply m^3/s (length^3 time^-1)
```

## Declare quantities

Use a `quantity` inside a graph input or operation socket descriptor, or in
the descriptor returned by a JavaScript world system. In an authored world
or [simulation model](simulation-models.md), add `portQuantities` to a system
or operator to annotate its existing named ports.

```json
{
  "portQuantities": {
    "inputs": {
      "value": {
        "unit": "m^3/s",
        "kind": "volume-flow",
        "frame": "pump-branch",
        "positive": "supply-to-return"
      }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `unit` | Required physical unit. Use SI symbols and prefixes, products, divisions, and integer powers such as `Pa`, `N/m^2`, `kPa`, `m^3/s`, or `L/s`. `1` is dimensionless, and `world` is an independent scene length unit. |
| `kind` | Optional semantic label, such as `gauge-pressure` or `absolute-pressure`. Equal dimensions can still describe different quantities. |
| `frame` | Optional coordinate or reference frame ID. Use the same name at both ends, or insert an explicit transform. |
| `positive` | Optional label for what a positive value means, such as `supply-to-return`. Opposing conventions need an explicit sign adapter. |
| `sampleRate` | Optional nominal rate in hertz, as a number or an exact `{ "numerator": 30000, "denominator": 1001 }` ratio. World plans infer this from the solver schedule. A declared world rate must match that schedule. |

A linked quantity input requires a quantity declaration at its source.
The target can require a kind, frame, direction, or rate by declaring it.
Literals and keyframe values use the receiving socket's units. Legacy
inputs still accept their existing types. The graph catalog's display-only
`unit` label can coexist with the checked `quantity` record.

Compatible spelling such as `Pa` and `N/m^2` can be wired directly. Scaled
or offset units require an explicit conversion. In graphs, use
`quantity.convert` with literal `from` and `to` quantity records. It preserves
the quantity kind, frame, direction, and cadence. The default `shape` is
`number`. Use `vec2` or `vec3` for vector scale conversions. In the library,
`KIT.quantities.unit('Pa')` reports dimensions, and
`KIT.quantities.converter({unit:'kPa'}, {unit:'Pa'})(12.5)` returns `12500`.

## Inspect timing and reuse models

`sim plan` shows physical metadata for each world port. When two numeric
world ports have different schedules, choose an explicit sampling policy
such as `"sample":"hold"` or `"sample":"average"` on the connection. The
existing policy determines which values the receiver sees. World plans
list possible active rates for systems with variable simulation detail,
which also require an explicit policy on physical links. See
[explicit rate crossings](simulation-rate-crossings.md) for the signal
semantics and available filters and delays.

To change unit scale or offset within a world, insert a
`quantity-convert` system. Set `config.from` and `config.to` to the quantity
records and connect its `value` input and output. Set `config.type` to
`vec3` for a vector scale conversion.

Model interfaces inherit units, kinds, frames, and direction from their
internal ports. When a model is embedded as a world system, its exposed
ports report the enclosing system's cadence. The model still solves at
its own rate. Graph plans and group outputs retain physical socket contracts.
A graph that changes a declared cadence needs a node that performs that
sampling and publishes the resulting rate.

## Run the pump demo

The [pump world](../examples/physical-ports/pump.world.json) authors one
world unit as one metre for the purpose of its model. It connects a pressure
gauge and a slower, averaging flow meter to Ink's pipe network. The
[pressure graph](../examples/physical-ports/pressure.graph.json) converts
12.5 kPa to 12,500 Pa.

```sh
ink-studio sim plan examples/physical-ports/pump.world.json
ink-studio graph run examples/physical-ports/pressure.graph.json
node examples/physical-ports/demo.cjs demo-output
ink-studio sim plan demo-output/rejected.world.json
```

The demo writes a PNG, a report from tick 8, and a miswired version of the
same world. The last command exits with the dimensional diagnostic.
