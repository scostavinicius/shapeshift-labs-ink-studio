# Phrase contour borrowing

Use a MIDI-recorded take or a gesture take from a
[music edit session](music-edit-session.md#capture-and-comp-phrase-performances)
to shape another melody. The destination can have different pitches,
rhythms, note counts, and local tempo. Ink saves an editable phrase
performance on a separate score take.

```json
[
  {
    "op": "borrow-phrase",
    "lane": "answer",
    "take": "borrowed",
    "phrase": "answer-contour",
    "from": 4,
    "to": 8,
    "source": {"lane": "call", "take": "played", "from": 0, "to": 4}
  }
]
```

Source and destination ranges use absolute beats on the score clock.
Choose one to 64 distinct melodic attacks in each range. The destination
uses one editable clip voice and the range covers its attacks through
key-up. Other instruments can play alongside it.

Ink compares the donor's attacks and velocities with the source lane in
the written `reference` take. The pitches should agree in order.
Choose a different baseline with `source.reference`. An improvised take
can instead use `source.grid` with a subdivision in beats, such as
`0.25` for sixteenth notes. In grid mode the timing deviations are
relative to the closest subdivision and accents are relative to the
take's average velocity.

Timing and accents are sampled at each destination attack's relative
beat position. Timing offsets follow the target tempo. Each shift is
limited to 35 ms or 30% of the original gate, whichever is smaller.
The fitter keeps the original key-up, respects nearby attacks and clip
boundaries, and keeps the existing timing of ties and connected notes.
The destination chooses its own articulations and velocity zones.
Recorded breath curves are stretched onto the destination range as
editable controller knots on the score clock.

Set `timing` or `accent` between 0 and 1 to temper the corresponding
contour. Set `breath: false` to use the destination's breath controls.
Those controls are also used when the donor has no breath data.
`targetTake` chooses a destination score take to copy. It defaults to
`reference`. Set `activate: false` to keep the result as an alternate.

```sh
ink-studio music session edit captured.json borrow.json --out borrowed.json
ink-studio music session audition-phrase borrowed.json listen.json --out compare
```

Use `{"lane":"answer","phrase":"answer-contour","takes":["borrowed"]}` for
`listen.json`. The audition includes the written reference by default.
Use the usual `phrase-point` edit to move the borrowed breath knots.
The same edit works through `editor.edit` and `music.editSession`.

Run `node examples/phrase-contour/demo.cjs paper-wind` and open
`paper-wind/index.html` to hear the performed call and compare two
versions of the destination melody. The example uses a simulated MIDI
pass through the session recorder, with five attacks fitted to seven.
