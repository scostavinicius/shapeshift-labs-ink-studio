# Critique a passage by ear

Use the [audio critique workbench](music-critique-audio.md) to inspect any
production passage, ask for a particular monitor view, and audition your
own addressed edits. This page covers the preset and blind workflow. Use
[contextual preference memory](music-listening-preferences.md) to carry
blind choices and their reasons into another cue.

Start with a normal [music production](music-production.md), a named section,
and something you want to hear more clearly. Ink renders the original passage
with its actual instrument, room and filter history. A critique links the
measurements to half-open beat, second, and sample ranges. The same ranges
address the clips and the proposed edits.

```json
{
  "section": "return",
  "goal": "Hear the hook through the keys and make the return feel earned.",
  "lead": "hook",
  "layer": "keys",
  "bass": "bass",
  "leadInBeats": 4,
  "focusBeats": 6,
  "withholdBeats": 1.5,
  "cutDb": -4,
  "sampleRate": 32000,
  "tags": ["arrival", "space"],
  "references": "references.json"
}
```

Choose `kind` as `hook`, `arrival`, `space`, `custom`, or `both` (the default).
Choose `custom` to supply [your own revisions](music-listening-preferences.md#record-a-choice). The focus starts
at the named section, or `offsetBeats` into it. The context includes the
lead-in and is limited to 30 seconds. Track names are optional. For a hook
comparison, Ink looks for an active lead and picks the pitched layer with the
most measured overlap if you omit `layer`.

```sh
ink-studio music critique plan cue.json brief.json --out plan.json
ink-studio music critique listen cue.json plan.json --out review
```

Pass an optional settings file to `listen` with `id`, `seed`, `target` in
LUFS, and `ceiling` in dBTP. Ink creates the following files.

- **`evidence/report.json`** gives raw sample and true peaks, over-range
  frames, stereo correlation, mono fold-down loss, stem band overlap, and
  similar beat patterns with exact sample offsets. The accompanying WAVs
  cover the focus, mono fold-down, lead-in and named solos, plus an overlap
  hotspot or a repeated pair where available. Evidence previews share a
  playback trim. The report measures the original PCM before that trim.
- **`public/index.html`** plays the same passage at matched integrated
  loudness for every neutral label. Switching takes keeps the playhead.
  A seeded shuffle sets the labels and pair order. Share the whole
  `public` folder, including its WAVs. Any comparison can be skipped.
- **`review-key.json`** is the private mapping and editable producer session.
  The key binds the selection to its listening export, score, and source
  audio assets. Keep it with the production.

The band measurements compare simultaneously sounding stem energy. The
repeat detector compares short-time band envelopes on the beat grid, which
can surface a repeated rhythm or texture. Use these as listening cues. The
pairwise questions ask directly about groove, identity, shape, and the
desire to hear the cue again. Listeners can mark ties and skip questions.
The [human preference benchmark](https://arxiv.org/abs/2506.19085) compares
human listening judgments with automatic metrics.

## Hear specific edits

| Take | What changes |
| --- | --- |
| Mute layer | Cuts the competing layer in the focus so the hook can be heard in context. Existing shared room tails from before the cut can still ring. |
| Move register | Shifts the competing layer's new notes by an octave during the focus. Set `octave` to `12` or `-12`. |
| Mix cut | Rides down the competing layer with a short fade at the two edges. |
| Delay bass | Withholds the bass through the lead-in and the first `withholdBeats` of the focus, then lets its existing part resume. |
| Dry drums | Takes playing percussion out of the shared room during the focus. Existing tails can ring out. |
| Empty beat | Clears the last full lead-in beat, including the room, before the focus. |

Each take is an ordinary producer revision over the original cue map. The plan
reports pinned, overlapping, or inapplicable moves. A section-local level ride
is also available directly as a [cue map lane](music-cue-map.md).

## Keep the choice and the reason

The listening player downloads a decision JSON. For tool use, supply the
following shape. Trial IDs and labels come from `public/test.json`. Combine
votes from several listeners by giving each a distinct ID. Choose a take
supported by at least one recorded vote and explain the editorial decision.

```json
{
  "token": "test-token-from-the-manifest",
  "take": "b",
  "reason": "The hook comes through and the keys still answer it.",
  "votes": [
    {"trial": "pair-1", "listener": "editor", "preferences": {"identity": "b", "replay": "tie"}}
  ]
}
```

```sh
ink-studio music critique keep cue.json review/review-key.json listening-decision.json --out chosen
```

The saved `production.json` opens in the regular production renderer and
edit session. `reference.json` retains the votes, decision, rationale,
addressed passage, and exact edit. `producer-reference.json` also works with
`music production revise`. Optional `id`, `title` and `tags` on a decision
make it easier to retrieve in a future session.

## Tag references for the next cue

```json
{
  "id": "wait-for-the-kit",
  "title": "Let the pickup stand alone",
  "source": "Session 3 rehearsal",
  "firstSample": 64000,
  "endSample": 224000,
  "tags": ["arrival", "space"],
  "note": "Listen to how long the drums wait after the first exposed phrase."
}
```

```sh
ink-studio music critique tag rehearsal.wav tag.json --out references/kit-wait
ink-studio music critique find references.json query.json --out found.json
```

The tag command keeps a playable, exact source slice of up to 30 seconds.
Index reference and decision records together in a JSON array. In the CLI,
entries can also be paths relative to the index. Query by words
(`{"text":"drums wait"}`), descriptive `tags`, or `kind` (`clip` or `decision`).
Pass the index to a new brief as `references`. Matching decisions put a
previously preferred move first when it applies and retain the earlier
rationale in the plan.

JavaScript exposes `KIT.music.production.critique` with `plan`, `blind`,
`keep`, `tagReference` and `findReferences`. Graph equivalents are
`music.planCritique`, `music.blindCritique`, `music.keepCritique`,
`music.tagListeningReference` and `music.findListeningReferences`. Keep
the blind node's `key` port private. Use its public `value` and `audio`
ports for listeners, and use its `evidence` port to inspect the original mix.
