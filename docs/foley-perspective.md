# Foley and perspective

Start with a material kit and the events committed by a world run.
`audio.spotFoley` turns the matches into an ordinary
[audio editorial session](audio-editorial.md). The editor can move a
contact to a picture frame, choose another performance or microphone
perspective, and change the decay. Render the session on its own or
reference it directly in a scene soundtrack.

```sh
ink-studio music editorial spot-foley contacts.json --out foley.json
ink-studio music editorial edit foley.json changes.json --out revised-foley.json
ink-studio export-scene take.json --audio soundtrack.json --out review
```

Use [dialogue repair](dialogue-repair.md) to clean a dialogue source and key
a frequency-specific cut on music or effects.

## Spot a performance

The CLI input has a `foley` definition and an `assets` table with WAV
paths relative to that file. The graph takes the definition as `source`
and a table of decoded audio as `assets`. The JavaScript entry point is
`KIT.procedural.mediaGraph.foley.plan(source, assets)`. Its `value` is the
editable session and its `report` records matched contacts, selected takes,
alternate IDs, and counts of matching events outside the picture.

```json
{
  "assets": {"close": "wood-close.wav", "room": "wood-room.wav"},
  "foley": {
    "kit": {
      "id": "stage-floor",
      "materials": { "oak": { "step": { "heel": {
        "close": {"asset": "close", "sync": {"sample": 2460}},
        "distant": {"asset": "room", "sync": {"sample": 3210}}
      }}}}
    },
    "picture": {"fps": 30, "shots": [{"id": "approach", "frames": 90}]},
    "world": {
      "simulationRate": 120,
      "events": [{
        "id": "107.0", "tick": 107, "system": "walker",
        "kind": "surface-contact", "material": "oak", "action": "step",
        "strength": 0.8
      }],
      "aliases": {"first-step": "107.0"}
    },
    "bindings": [{"id": "steps", "on": {"kind": "surface-contact", "system": "walker"}}],
    "perspective": "close",
    "sampleRate": 48000,
    "seed": 94
  }
}
```

A kit groups named performances by material and action. Supply close
and distant recordings for each performance. Their sync points can
differ, so the direct arrivals line up even if the microphones have
different lead-ins. Each take accepts editorial ranges, handles, or
named sync markers from `foley.sourceEdits`. In the example the selected
take is `close-heel` and the corresponding room take is `distant-heel`.

Collect committed event rows from `runtime.events` after advancing each
tick. Matching uses `on.kind`, with optional `on.system` and a world-query
`on.where` condition. By default `material` and `action` come from the event.
A binding can supply either one, override the default perspective, and set
a gain. Event `strength` is a linear multiplier in [0, 1] and defaults to
unity. Multiple bindings can layer different actions from a single contact.

The seed and event address select a repeatable performance. A perspective
switch keeps the selected performance. Give recurring contacts stable
aliases when building a new ledger to retain their cue identities across
takes. Use the generated project for editorial work and
`music editorial reconform` to update event times without rerolling takes.

## Change only the decay

Resolve the clip ID through the spotting report. Use `spot` for a revised
sync target and `take` to audition an alternate. Use `stretch-tail` with
`tail: {"fromSample":5200,"factor":1.85,"mode":"tones","joinSamples":480}`
to stretch the selected take after native sample 5200. The sync point and
the earlier portion play at their original rate. The tonal warp preserves
pitch. The edit also accepts `speech` for overlap-add
and `repitch` for a pitched speed change. Tail joins are in native source
samples and default to up to 15 ms. Pass `tail: null` to clear the edit.

## Route a soundtrack by role

Add `post: {}` to a scene soundtrack to enable post routing. Each authored
track can specify `bus` as `dialogue`, `foley`, `effects`, `ambience`, or
`music`. Unassigned authored tracks and spatial loops feed ambience.
Timeline cues and spatial one-shots feed effects. Adaptive and procedural
scores feed music.

```json
{
  "format": "ink-studio/scene-audio",
  "version": 1,
  "assets": {
    "steps": {"editorial": "revised-foley.json"},
    "radio": "dialogue.wav",
    "tunnel": "room-ir.wav"
  },
  "tracks": [
    {"asset": "steps", "bus": "foley"},
    {"asset": "radio", "bus": "dialogue", "time": 0.25}
  ],
  "post": {
    "assets": {"impulse": "tunnel"},
    "strips": {
      "dialogue": {"inserts": ["radio"], "fader": 0.9},
      "foley": {"sends": {"room": {"level": 0.35}}},
      "room": {"inserts": ["reverb"]}
    },
    "processors": {
      "radio": {"type": "highpass", "hz": 220},
      "reverb": {"type": "convolution", "impulse": "impulse", "wet": 1}
    }
  }
}
```

The scene uses Ink's [mixer](audio-mixer.md) for inserts, faders, sends,
returns, sidechains, and automation. The default destination is `master`.
Processor asset names in `post.assets` refer to the soundtrack's asset IDs.
An editorial asset can select one track with `"track":"foley"` or use the
session mix by omitting `track`.

Scene export writes the five post-fader role stems plus the master, aligned
to the picture window. Use scene audio capture with
`{source:{kind:"stem",name:"foley"}}` to retrieve one. Shared returns feed the
master. The role stems are taps on their respective strips. Crops run
processing from timeline zero to carry tails, automation, and sidechains
into the in-point. Soundtracks with no `post` configuration use their
original export stems.

Run [Sluice Foley](../examples/music-production/foley-workshop.cjs) with
`node examples/music-production/foley-workshop.cjs output-directory`.
It constructs an oak, gravel, and steel kit with two variations per
action. The close takes combine original synthesis and the included
recorded percussion. The distant takes use modeled stereo reflections
and a different direct-arrival marker. The demo prints the same run
close and distant, then edits the latch to picture, swaps the take, and
extends its ring. An optional final argument supplies a dialogue WAV.
