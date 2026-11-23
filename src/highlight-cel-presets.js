/* Material highlights with separately drawn size and angle poses. */
const HighlightCelPresets = (() => {
  const families = {
    brass: {
      palette: ['#be7750', '#e6a663', '#ffcf8b', '#ffe9b0', '#fff8df'],
      art: {
        'pin': ['3'],
        'hook-left': ['.3.', '12.', '...'],
        'hook-front': ['...', '243', '...'],
        'hook-right': ['.2.', '.34', '...'],
        'arc-left': ['.........', '...343...', '..32.....', '.21......', '.1.......'],
        'arc-front': ['...........', '...2343....', '.12....31..', '..........1', '...........'],
        'arc-right': ['.........', '....243..', '......32.', '.......21', '........1'],
        'arc-grazing': ['...........', '..121......', '.....23441.', '...........', '...........']
      }
    },
    enamel: {
      palette: ['#478e89', '#6dc1ae', '#a9e6cd', '#e4f7db', '#fff9e5'],
      art: {
        'pin': ['3'],
        'hook-left': ['.2.', '.43', '..1'],
        'hook-front': ['.2.', '243', '...'],
        'hook-right': ['.3.', '34.', '.1.'],
        'arc-left': ['.......', '..243..', '.234...', '.12....', '.......'],
        'arc-front': ['.........', '...232...', '..24432..', '...11....', '.........'],
        'arc-right': ['.......', '..342..', '...443.', '.....21', '.......'],
        'arc-grazing': ['.........', '.........', '..123431.', '......1..', '.........']
      }
    },
    glass: {
      palette: ['#567db2', '#7fafd5', '#b5dcee', '#e4f9ff', '#fffbef'],
      art: {
        'pin': ['4'],
        'hook-left': ['..2', '.4.', '1..'],
        'hook-front': ['.2.', '343', '.1.'],
        'hook-right': ['2..', '.4.', '..1'],
        'arc-left': ['.......', '.....3.', '....4..', '...3.1.', '..2....', '.1.....', '.......'],
        'arc-front': ['.........', '....2....', '....3....', '.123432..', '....3....', '....1..2.', '.........'],
        'arc-right': ['.......', '.3.....', '..4....', '...31..', '....2..', '.....1.', '.......'],
        'arc-grazing': ['.........', '....2....', '..13.....', '...243...', '.....32..', '......1..', '.........']
      }
    }
  };
  const clips = {};
  for (const [material, { palette, art }] of Object.entries(families)) {
    for (const [pose, rows] of Object.entries(art)) {
      clips['highlight-' + material + '-' + pose] = [
        'Highlight ' + material + ' · ' + pose.replace('-', ' '), 'highlight',
        { width: rows[0].length, height: rows.length, palette, origin: 'top-left',
          frames: [{ rows, duration: 1 }], playback: 'once' }
      ];
    }
  }
  return Object.freeze(clips);
})();
if (typeof module !== 'undefined') module.exports = HighlightCelPresets;
