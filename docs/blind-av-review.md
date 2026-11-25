# Run a blind audiovisual review

Use one delivered take to test what viewers or listeners pick up from picture, sound, or both. Each reviewer gets one condition and answers three questions after playback. Keep the assigned excerpt, response options, and scoring key fixed for the round.

```sh
ink-studio take blind-review brief.json --out review-packet
```

Share one assigned HTML file from `review-packet/reviewers/` with each person, in the order printed by the command. The files work offline and contain one excerpt each. Assign reviewers as they arrive, before collecting answers or revealing the title, conditions, or expected answers. The command shuffles the conditions in groups of three so even a short round gets one seat of each kind per complete block.

Keep `review-key.json` with the facilitator. It holds the title, condition assignments, option orderings, and scoring rubric. Reviewers can tell which media is playing from the excerpt itself. Their pages omit its condition label, the other excerpts, and the scoring key. The page asks for a complete playback before showing the questions and records how many times playback finished. It collects neither names nor network data.

## Author the brief

```json
{
  "format": "ink-studio/blind-av-review",
  "version": 1,
  "id": "ferry-review",
  "title": "Last Ferry",
  "picture": "published/export.json",
  "window": {"from": 24, "to": 84},
  "seats": 9,
  "questions": {
    "action": {
      "prompt": "What changed during the excerpt?",
      "options": [
        {"id": "swing", "label": "A hanging object began to swing"},
        {"id": "gate", "label": "A gate swung shut"},
        {"id": "unsure", "label": "I couldn’t tell"}
      ],
      "correct": "swing"
    },
    "cause": {
      "prompt": "Where did the main event come from?",
      "options": [
        {"id": "bell", "label": "The bell on the dock"},
        {"id": "motor", "label": "A motor starting up"},
        {"id": "unsure", "label": "I couldn’t tell"}
      ],
      "correct": "bell"
    },
    "impact": {
      "prompt": "How strongly did the moment grab your attention?",
      "low": "Barely registered",
      "high": "Immediate and strong"
    }
  }
}
```

- Use a [synchronized audiovisual export](audiovisual-takes.md) with numbered picture frames. You can also use a graph clip report or an inline sequence such as `{"fps":20,"firstFrame":0,"frames":["0000.png","0001.png"]}` with an `audio` object containing a WAV `file` and optional absolute `startSample`. Paths are relative to the file declaring them. The WAV must cover the entire selected excerpt. With an independent WAV, sample zero defaults to the first delivered picture frame.
- `window` is optional and uses absolute frames with an exclusive `to`. The excerpt can run up to 30 seconds and 720 frames. Use a fixed raster up to 1920 × 1080, mono or stereo WAV, and a standard frame rate. The command uses FFmpeg with H.264 and AAC support, and accepts an executable path with `--ffmpeg`. Review pages use the same encoded picture stream and audio stream where each is present.
- Set `seats` to a multiple of three between 3 and 30. The default is 9. Give each action and cause question two to eight choices. Offer an “I couldn’t tell” choice to reduce guessing. Impact always uses a five-point scale with an option to skip the rating.
- Prompts default to the same wording for all conditions. A question can provide optional `prompts` keyed by `picture`, `sound` or `combined`. Keep the measurement and answer options equivalent across groups when comparing the resulting scores.

## Collect and compare

Reviewers download a response JSON file and send it back to the facilitator. Put the files in one directory, with one ballot per seat.

```sh
ink-studio take blind-review-score review-packet/review-key.json ballots --out results
```

Open `results/index.html` for the comparison or use `report.json` to analyze it elsewhere. Action and cause are scored separately, with correct counts over all responses for that condition. Impact shows the median of rated responses along with the rating distribution and the number who couldn't judge. The difference table compares the combined condition with each single medium in percentage points for action and cause and scale points for impact. Empty cohorts and absent impact ratings leave the comparison blank. The report also shows how many people finished the excerpt more than once.

Results describe the responses received. Use similar playback settings across reviewers and keep attention on the individual counts when the groups are small. Save each scoring run in a new directory if additional ballots arrive.

## Try the Last Ferry demo

```sh
node scripts/build.js node
node examples/blind-av-review/demo.cjs ./last-ferry-blind
```

Open `try-a-blind-review.html` for a reviewer page, or `last-ferry-review-demo.html` to audition all three conditions and see the report. The demo report uses nine illustrative ballots.
