import { cells, parsePartId, voxels, type Build, type ColorName, type Step } from './bricks';

export interface DisplayModel {
  id: string;
  category: 'Architecture' | 'Space' | 'Objects';
  build: Build;
  details: string[];
}

// Original display designs. Geometry, not decoration added by the renderer, carries every detail.
// These models deliberately bypass inventory matching; their complete BOM is the construction contract.
class Model {
  steps: Step[] = [];
  step(caption: string, add: () => void) { this.steps.push({ caption, parts: [] }); add(); }
  p(shape: string, color: ColorName, x: number, y: number, z: number, rot = 0) {
    this.steps[this.steps.length - 1].parts.push({ partId: `${shape}-${color}`, x, y, z, rot });
  }
  row(color: ColorName, x: number, y: number, z: number, length: number, rot = 0, type = 'brick') {
    const sizes = [8, 6, 4, 3, 2, 1];
    let left = length, offset = 0;
    while (left) { const n = sizes.find(n => n <= left)!; this.p(`${type}-1x${n}`, color, x + (rot ? 0 : offset), y + (rot ? offset : 0), z, rot); left -= n; offset += n; }
  }
  floor(color: ColorName, x: number, y: number, z: number, w: number, d: number) {
    for (let dy = 0; dy < d; dy += 2) {
      let left = w, dx = 0;
      while (left) { const n = [12, 10, 8, 6, 4, 3, 2].find(n => n <= left)!; this.p(`plate-2x${n}`, color, x + dx, y + dy, z); left -= n; dx += n; }
    }
  }
  ground(w: number, d: number, color: ColorName) {
    this.step('Lay out the foundation, then cross the seams with the second layer.', () => {
      this.floor(color, 0, 0, 0, w, d);
      this.row(color, 0, 0, 1, d, 90, 'plate');
      for (let x = 1; x < w - 1; x += 2) this.p(`plate-2x${d}`, color, x, 0, 1, 90);
      this.row(color, w - 1, 0, 1, d, 90, 'plate');
    });
  }
  tileSurface(color: ColorName, z: number, w: number, d: number, include: (x: number, y: number) => boolean) {
    const occupied = new Set(this.steps.flatMap(s => s.parts.flatMap(p => voxels(parsePartId(p.partId)!, p).filter(v => v[2] === z).map(([x, y]) => `${x},${y}`))));
    for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) {
      if (!include(x, y) || occupied.has(`${x},${y}`)) continue;
      for (const [shape, rot] of [['tile-2x2', 0], ['tile-1x2', 0], ['tile-1x2', 90], ['tile-1x1', 0]] as const) {
        const p = { partId: `${shape}-${color}`, x, y, z, rot }, covered = cells(parsePartId(p.partId)!, p);
        if (covered.every(([cx, cy]) => cx < w && cy < d && include(cx, cy) && !occupied.has(`${cx},${cy}`))) {
          this.p(shape, color, x, y, z, rot); covered.forEach(([cx, cy]) => occupied.add(`${cx},${cy}`)); break;
        }
      }
    }
  }
  finish(id: string, name: string, description: string, category: DisplayModel['category'], details: string[]): DisplayModel {
    return { id, category, details, build: { name, description, source: { kind: 'display', recipeId: id }, steps: this.steps } };
  }
}

function cafe(): DisplayModel {
  const m = new Model(); m.ground(16, 12, 'light-gray');
  for (let level = 0; level < 3; level++) m.step(['Frame the storefront and set the first panes of glass.', 'Raise the shop windows and add the brass door handle.', 'Finish the tall storefront glazing.'][level], () => {
    const z = 2 + level * 3;
    for (const x of [2, 6, 10, 13]) m.p('brick-1x1', 'tan', x, 4, z);
    for (const x of [3, 7]) m.p('brick-1x3', 'trans-clear', x, 5, z);
    m.p('brick-1x1', 'trans-clear', 11, 5, z); m.p('brick-1x1', level === 1 ? 'yellow' : 'trans-clear', 12, 5, z);
    for (const x of [2, 13]) m.row('dark-red', x, 5, z, 6, 90);
    m.row('dark-red', 2, 11, z, 12);
  });
  m.step('Bridge the shop walls and project the awning ledge over the sidewalk.', () => {
    for (const y of [3, 5, 7, 9]) m.p('plate-2x12', 'tan', 2, y, 11);
    m.p('plate-1x12', 'tan', 2, 11, 11);
  });
  m.step('Set a striped sloping awning and the upper-floor window sills.', () => {
    for (let x = 2; x < 14; x += 2) m.p('slope-2x2', x % 4 ? 'dark-red' : 'white', x, 2, 12);
    m.row('tan', 2, 4, 12, 12);
    m.row('tan', 3, 5, 12, 10);
    for (const x of [2, 13]) m.row('sand-green', x, 5, 12, 6, 90);
    m.row('sand-green', 2, 11, 12, 12);
  });
  for (const z of [15, 18]) m.step('Build the upstairs sash windows between pale stone piers.', () => {
    for (const x of [2, 6, 10, 13]) m.p('brick-1x1', 'tan', x, 4, z);
    for (const x of [3, 7]) m.p('brick-1x3', 'trans-clear', x, 5, z);
    m.p('brick-1x2', 'trans-clear', 11, 5, z);
    for (const x of [2, 13]) {
      m.p('brick-1x1', 'tan', x, 5, z); m.p('brick-1x3', 'trans-clear', x, 6, z, 90); m.p('brick-1x2', 'tan', x, 9, z, 90);
    }
    m.row('sand-green', 2, 11, z, 12);
  });
  m.step('Close the roof with a projecting stone cornice.', () => {
    m.floor('tan', 1, 3, 21, 14, 10);
    for (const y of [3, 12]) m.row('tan', 1, y, 22, 14, 0, 'tile');
    for (const x of [1, 14]) m.row('tan', x, 4, 22, 8, 90, 'tile');
  });
  m.step('Build the parapet around the recessed tiled roof.', () => {
    for (const y of [4, 11]) m.row('sand-green', 2, y, 22, 12);
    for (const x of [2, 13]) m.row('sand-green', x, 5, 22, 6, 90);
    for (let x = 3; x < 13; x += 2) for (const y of [5, 7, 9]) m.p('tile-2x2', 'dark-gray', x, y, 22);
    for (const y of [4, 11]) m.row('tan', 2, y, 25, 12, 0, 'plate');
    for (const x of [2, 13]) m.row('tan', x, 5, 25, 6, 90, 'plate');
    for (const x of [2, 13]) for (const y of [4, 11]) m.p('roundtile-1x1', 'white', x, y, 26);
    for (const y of [4, 11]) m.row('tan', 3, y, 26, 10, 0, 'tile');
    for (const x of [2, 13]) m.row('tan', x, 5, 26, 6, 90, 'tile');
  });
  m.step('Fill the window boxes with leaves and flowers.', () => {
    for (const x of [3, 7, 11]) {
      m.p('brick-1x2', 'reddish-brown', x, 3, 15);
      for (let dx = 0; dx < 2; dx++) { m.p('roundplate-1x1', 'green', x + dx, 3, 18); m.p('roundtile-1x1', dx ? 'pink' : 'yellow', x + dx, 3, 19); }
    }
  });
  m.step('Lay the pavement and set a café table, chair, and planter.', () => {
    for (let x = 6; x < 14; x += 2) m.p('tile-2x2', x % 4 ? 'dark-gray' : 'light-gray', x, 0, 2);
    m.p('roundbrick-2x2', 'black', 1, 1, 2);
    for (const [x, y, rot] of [[0, 0, 180], [2, 0, 270], [0, 2, 90], [2, 2, 0]]) {
      m.p('cornerplate-2x2', 'reddish-brown', x, y, 5, rot); m.p('cornertile-2x2', 'tan', x, y, 6, rot);
    }
    m.p('brick-1x1', 'reddish-brown', 3, 0, 2); m.p('plate-1x2', 'reddish-brown', 3, 0, 5); m.p('brick-1x1', 'reddish-brown', 4, 0, 6);
    m.p('brick-2x2', 'dark-tan', 14, 1, 2); m.p('roundbrick-1x1', 'green', 14, 1, 5); m.p('roundplate-2x2', 'green', 14, 1, 8); m.p('roundtile-1x1', 'pink', 15, 2, 9);
  });
  m.step('Finish the sidewalk with fitted paving tiles.', () => m.tileSurface('light-gray', 2, 16, 12, (x, y) => y < 4 || x < 2 || x >= 14));
  return m.finish('canal-cafe', 'Canal Street Café', 'A two-story corner of the city, with glazed shopfronts, a striped awning, flower boxes, and a rooftop parapet.', 'Architecture', ['Framed glazing', 'Striped awning', 'Sidewalk furniture']);
}

function chalet(): DisplayModel {
  const m = new Model(); m.ground(16, 12, 'dark-green');
  m.step('Set a stone terrace, front steps, and timber foundation.', () => {
    m.floor('light-gray', 2, 2, 2, 12, 10);
    for (const x of [6, 8]) m.p('plate-2x2', 'light-gray', x, 0, 2);
  });
  for (let level = 0; level < 5; level++) m.step(level < 3 ? 'Stack the log walls around the door and the front windows.' : 'Frame the loft above the entrance.', () => {
    const z = 3 + level * 3, c = level % 2 ? 'dark-brown' : 'reddish-brown';
    for (const x of [3, 6, 9, 12]) m.p('brick-1x1', c, x, 5, z);
    for (const x of [4, 10]) m.p('brick-1x2', level === 0 || level === 3 ? 'tan' : 'trans-clear', x, 5, z);
    if (level === 1) {
      m.p('plate-1x2', 'dark-brown', 7, 5, z); m.p('plate-1x1', 'dark-brown', 7, 5, z + 1); m.p('plate-1x1', 'yellow', 8, 5, z + 1); m.p('plate-1x2', 'dark-brown', 7, 5, z + 2);
    } else m.p('brick-1x2', level < 3 ? 'dark-brown' : 'trans-clear', 7, 5, z);
    for (const x of [3, 12]) m.row(c, x, 6, z, 4, 90);
    m.row(c, 3, 10, z, 10);
  });
  m.step('Tie the walls together beneath the overhanging roof.', () => {
    m.p('plate-1x12', 'black', 2, 5, 18); m.floor('black', 2, 6, 18, 12, 6);
  });
  for (let tier = 0; tier < 3; tier++) m.step('Raise the paired roof slopes toward the ridge.', () => {
    const z = 19 + tier * 3;
    for (const x of [2, 6, 10]) { m.p('slope-4x2', 'dark-blue', x, 4 + tier, z); m.p('slope-4x2', 'dark-blue', x, 10 - tier, z, 180); }
    if (tier < 2) for (const x of [2, 13]) m.row('tan', x, 6 + tier, z, 4 - tier * 2, 90);
  });
  m.step('Cap the ridge and add a snowy highlight along the roof.', () => {
    for (const x of [2, 6, 10]) m.p('plate-2x4', 'dark-blue', x, 7, 28);
    for (const x of [2, 4, 6, 8, 10, 12]) m.p('curve-2x2', 'white', x, 7, 29);
  });
  m.step('Build the porch posts, open railing, and doorway step.', () => {
    for (const x of [2, 13]) for (const z of [3, 6, 9]) m.p('roundbrick-1x1', 'reddish-brown', x, 2, z);
    for (const x of [3, 11]) m.p('brick-1x2', 'reddish-brown', x, 2, 3);
    for (const x of [3, 10]) m.p('plate-1x3', 'tan', x, 2, 6);
    m.p('tile-2x4', 'tan', 6, 3, 3);
    m.p('plate-2x12', 'reddish-brown', 2, 2, 12);
    for (const x of [2, 6, 10]) { m.p('slope-4x2', 'dark-blue', x, 2, 13); m.p('slope-4x2', 'dark-blue', x, 3, 16); }
  });
  m.step('Finish the terrace with planters, flowers, and stone edging.', () => {
    for (const x of [0, 14]) {
      m.p('brick-2x2', 'dark-tan', x, 7, 2); m.p('roundplate-2x2', 'green', x, 7, 5);
      for (const dx of [0, 1]) m.p('roundtile-1x1', dx ? 'yellow' : 'white', x + dx, 7, 6);
    }
    for (const x of [2, 4, 10, 12]) m.p('tile-2x2', 'dark-gray', x, 3, 3);
  });
  return m.finish('alpine-chalet', 'Alpine Chalet', 'A timber lodge with a steep snow-capped roof, glazed loft, stone terrace, and covered front porch.', 'Architecture', ['Three-course roof', 'Timber courses', 'Loft and porch']);
}

function lighthouse(): DisplayModel {
  const m = new Model(); m.ground(16, 12, 'dark-blue');
  m.step('Build a rocky island above the water.', () => {
    m.p('plate-6x8', 'dark-gray', 4, 3, 2);
    for (const [x, y, r] of [[2, 4, 270], [2, 7, 270], [12, 4, 90], [6, 1, 0], [9, 1, 0], [6, 9, 180], [9, 9, 180]]) m.p('slope-2x2', 'light-gray', x, y, 2, r);
    for (const [x, y] of [[0, 3], [3, 0], [12, 0], [1, 9], [13, 10]]) m.p('curve-2x2', 'white', x, y, 2);
  });
  for (let tier = 0; tier < 3; tier++) m.step('Stack the broad octagonal foot of the tower.', () => {
    const z = 3 + tier * 3, c = tier === 1 ? 'dark-red' : 'white';
    if (tier === 2) m.p('arch-1x4', c, 6, 3, z);
    else { m.p('brick-1x1', c, 6, 3, z); m.p('brick-1x2', 'dark-blue', 7, 3, z); m.p('brick-1x1', c, 9, 3, z); }
    m.p('brick-2x6', c, 5, 4, z); m.p('brick-2x6', c, 5, 6, z); m.p('brick-1x4', c, 6, 8, z);
  });
  for (let tier = 0; tier < 6; tier++) m.step('Raise the narrower tower in alternating lighthouse stripes.', () => {
    const z = 12 + tier * 3, c = tier % 2 ? 'white' : 'dark-red';
    if (tier % 2 === 1) {
      m.p('brick-1x1', c, 6, 4, z); m.p('brick-1x2', 'dark-blue', 7, 4, z); m.p('brick-1x1', c, 9, 4, z); m.p('brick-1x4', c, 6, 5, z);
    } else m.p('brick-2x4', c, 6, 4, z);
    m.p('brick-2x4', c, 6, 6, z);
  });
  const lanternStart = m.steps.length;
  m.step('Project the lookout balcony beyond the tower.', () => m.p('plate-6x6', 'light-gray', 5, 3, 24));
  m.step('Set the balcony railing, glazed lantern, and warm beacon.', () => {
    for (const x of [5, 10]) for (const y of [3, 8]) m.p('roundbrick-1x1', 'black', x, y, 25);
    for (const y of [3, 8]) m.p('brick-1x4', 'black', 6, y, 25);
    for (const x of [5, 10]) m.p('brick-1x4', 'black', x, 4, 25, 90);
    for (const z of [25, 28]) {
      for (const y of [4, 7]) m.p('brick-1x4', 'trans-clear', 6, y, z);
      for (const x of [6, 9]) m.p('brick-1x2', 'trans-clear', x, 5, z, 90);
    }
    m.p('roundbrick-2x2', 'yellow', 7, 5, 25); m.p('roundbrick-2x2', 'yellow', 7, 5, 28);
  });
  m.step('Close the lantern with a sloping red cap and finial.', () => {
    m.p('plate-6x6', 'dark-red', 5, 3, 31);
    m.p('slope-4x2', 'dark-red', 6, 3, 32); m.p('slope-4x2', 'dark-red', 6, 7, 32, 180);
    m.p('slope-2x2', 'dark-red', 5, 5, 32, 270); m.p('slope-2x2', 'dark-red', 9, 5, 32, 90);
    m.p('brick-2x2', 'dark-red', 7, 5, 32); m.p('roundplate-2x2', 'black', 7, 5, 35); m.p('roundbrick-2x2', 'black', 7, 5, 36); m.p('roundplate-2x2', 'black', 7, 5, 39);
  });
  m.step('Lay a little timber landing and mark its mooring posts.', () => {
    for (const x of [13, 14]) for (const y of [3, 8]) m.p('brick-1x1', 'reddish-brown', x, y, 2);
    m.p('plate-2x6', 'reddish-brown', 13, 3, 5, 90);
    for (const y of [3, 8]) { m.p('roundbrick-1x1', 'tan', 14, y, 6); m.p('roundtile-1x1', 'white', 14, y, 9); }
    for (const y of [4, 6]) m.p('tile-1x2', 'tan', 13, y, 6, 90);
  });
  for (const step of m.steps.slice(lanternStart)) for (const p of step.parts) if (p.z >= 24) p.z += 6;
  return m.finish('coastal-beacon', 'Coastal Beacon', 'A striped lighthouse on a rocky sea base, with a transparent lantern, guarded balcony, and timber landing.', 'Architecture', ['Tapered tower', 'Glazed beacon', 'Rocky shoreline']);
}

function pagoda(): DisplayModel {
  const m = new Model(); m.ground(16, 12, 'dark-green');
  m.step('Set the raised garden terrace beside a tiled pond.', () => {
    m.p('plate-8x8', 'light-gray', 4, 2, 2);
    for (const x of [0, 2]) for (const y of [2, 4, 6, 8]) m.p('tile-2x2', 'dark-azure', x, y, 2);
    m.p('brick-2x4', 'light-gray', 6, 0, 2);
  });
  for (const z of [3, 6, 9]) m.step('Raise the vermilion columns around the open pavilion.', () => {
    for (const x of [5, 10]) for (const y of [3, 8]) m.p('roundbrick-1x1', 'dark-red', x, y, z);
    if (z === 6) { m.p('brick-1x2', 'yellow', 7, 5, z); m.p('brick-1x2', 'dark-red', 7, 6, z); }
    else m.p('brick-2x2', 'dark-red', 7, 5, z);
  });
  m.step('Tie the columns together beneath the wide lower roof.', () => m.p('plate-8x8', 'black', 4, 2, 12));
  m.step('Curl the lower eaves around the smaller upper room.', () => {
    for (const x of [4, 6, 8, 10]) { m.p('curve-2x2', 'dark-green', x, 2, 13); m.p('curve-2x2', 'dark-green', x, 8, 13, 180); }
    for (const y of [4, 6]) { m.p('curve-2x2', 'dark-green', 4, y, 13, 270); m.p('curve-2x2', 'dark-green', 10, y, 13, 90); }
    for (const z of [13, 16]) for (const y of [4, 6]) m.p('brick-2x4', z === 13 ? 'dark-red' : 'tan', 6, y, z);
  });
  m.step('Build the second roof and its recessed central tower.', () => {
    m.p('plate-6x6', 'black', 5, 3, 19);
    for (const x of [5, 9]) for (const y of [3, 7]) m.p('curve-2x2', 'dark-green', x, y, 20, y === 3 ? 0 : 180);
    m.p('curve-2x2', 'dark-green', 7, 3, 20); m.p('curve-2x2', 'dark-green', 7, 7, 20, 180);
    m.p('curve-2x2', 'dark-green', 5, 5, 20, 270); m.p('curve-2x2', 'dark-green', 9, 5, 20, 90);
    m.p('brick-2x2', 'dark-red', 7, 5, 20);
  });
  m.step('Finish the small peaked roof and tall finial.', () => {
    m.p('plate-4x4', 'black', 6, 4, 23);
    for (const x of [6, 8]) { m.p('slope-2x2', 'dark-green', x, 4, 24); m.p('slope-2x2', 'dark-green', x, 6, 24, 180); }
    m.p('plate-2x2', 'black', 7, 5, 27); m.p('roundbrick-2x2', 'dark-red', 7, 5, 28); m.p('roundplate-2x2', 'yellow', 7, 5, 31);
  });
  m.step('Add stepping stones, flowering shrubs, and a stone lantern.', () => {
    for (const y of [2, 5, 8]) m.p('tile-2x2', 'light-gray', 13, y, 2);
    for (const [x, y] of [[1, 0], [14, 0], [12, 10]]) {
      m.p('roundbrick-1x1', 'reddish-brown', x, y, 2); m.p('roundplate-2x2', 'green', x, y, 5);
      m.p('roundplate-2x2', 'pink', x, y, 6); m.p('roundtile-1x1', 'white', x, y, 7);
    }
    m.p('roundbrick-2x2', 'light-gray', 0, 10, 2); m.p('plate-2x2', 'light-gray', 0, 10, 5); m.p('roundbrick-2x2', 'yellow', 0, 10, 6); m.p('plate-2x2', 'dark-gray', 0, 10, 9); m.p('curve-2x2', 'dark-gray', 0, 10, 10);
  });
  return m.finish('garden-pagoda', 'Garden Pagoda', 'Three receding roofs above an open vermilion pavilion, set beside a pond and flowering garden.', 'Architecture', ['Curved eaves', 'Open colonnade', 'Pond and lantern']);
}

function typewriter(): DisplayModel {
  const m = new Model();
  m.step('Set the four rubber feet and bridge them with the case floor.', () => {
    for (const x of [0, 10]) for (const y of [1, 7]) m.p('roundbrick-2x2', 'black', x, y, 0);
    m.p('plate-6x12', 'black', 0, 0, 3); m.p('plate-4x12', 'black', 0, 6, 3);
    for (let x = 0; x < 12; x += 2) m.p('plate-2x10', 'dark-green', x, 0, 4, 90);
  });
  m.step('Build the green case and the stepped keyboard bed.', () => {
    for (const x of [0, 11]) m.row('dark-green', x, 0, 5, 8, 90);
    m.row('dark-green', 1, 0, 5, 10, 0, 'plate');
    for (const x of [0, 6]) m.p('brick-2x6', 'dark-green', x, 8, 5);
    m.p('plate-1x10', 'black', 1, 2, 5);
    m.p('plate-2x10', 'black', 1, 3, 5); m.p('plate-1x10', 'black', 1, 4, 6);
    m.p('brick-1x10', 'black', 1, 6, 5);
    m.p('plate-1x6', 'tan', 3, 1, 5); m.p('tile-1x6', 'tan', 3, 1, 6); m.p('brick-1x10', 'black', 1, 7, 5);
  });
  m.step('Place thirty round keys in three ascending rows.', () => {
    for (let x = 1; x < 11; x++) for (const [y, z] of [[2, 6], [4, 7], [6, 8]]) m.p('roundtile-1x1', x === 1 && y === 6 ? 'dark-red' : 'tan', x, y, z);
  });
  m.step('Curve the case edges and install the carriage knobs and roller.', () => {
    for (const x of [0, 11]) for (const y of [1, 4]) m.p('curve-1x3', 'dark-green', x, y, 8);
    for (const x of [0, 10]) { m.p('roundbrick-2x2', 'black', x, 8, 8); m.p('roundplate-2x2', 'light-gray', x, 8, 11); }
    m.p('brick-1x8', 'black', 2, 8, 8);
  });
  m.step('Feed a brick-built sheet of paper behind the roller.', () => {
    for (const z of [8, 11]) m.p('brick-1x8', 'white', 2, 9, z);
    m.p('plate-1x8', 'white', 2, 9, 14);
    m.p('plate-1x2', 'white', 2, 9, 15); m.p('plate-1x4', 'dark-gray', 4, 9, 15); m.p('plate-1x2', 'white', 8, 9, 15);
    m.p('plate-1x8', 'white', 2, 9, 16); m.p('brick-1x8', 'white', 2, 9, 17); m.p('tile-1x8', 'white', 2, 9, 20);
  });
  m.step('Finish the nameplate, front lip, and return-key surround.', () => {
    m.p('tile-1x4', 'dark-green', 4, 0, 6); m.p('tile-1x3', 'dark-green', 1, 0, 6); m.p('tile-1x3', 'dark-green', 8, 0, 6);
    for (const x of [0, 11]) m.p('tile-1x1', 'dark-green', x, 0, 8);
    m.p('tile-1x1', 'dark-green', 11, 7, 8);
    m.p('plate-1x4', 'light-gray', 0, 7, 8); m.p('roundbrick-1x1', 'black', 3, 7, 9); m.p('tile-1x3', 'light-gray', 1, 7, 12);
  });
  for (const p of m.steps.flatMap(s => s.parts)) {
    if (p.z === 0) p.partId = p.partId.replace('roundbrick-', 'roundplate-');
    else p.z -= 2;
  }
  return m.finish('writers-typewriter', 'Writer’s Typewriter', 'A deep green desktop typewriter with thirty round keys, a stepped keyboard, carriage knobs, and a sheet in the roller.', 'Objects', ['30 individual keys', 'Curved case', 'Brick-built paper']);
}

function arcade(): DisplayModel {
  const m = new Model(); m.ground(8, 8, 'black');
  for (const z of [2, 5, 8, 11, 14, 17]) m.step('Build the cabinet pedestal around a recessed coin slot.', () => {
    m.row('dark-blue', 0, 0, z, 3); m.row('dark-blue', 5, 0, z, 3);
    if (z === 14) {
      m.p('plate-1x2', 'light-gray', 3, 0, z); m.p('plate-1x2', 'black', 3, 0, z + 1); m.p('plate-1x2', 'light-gray', 3, 0, z + 2);
    } else m.p('brick-1x2', 'dark-blue', 3, 0, z);
    for (const x of [0, 7]) m.row('dark-blue', x, 1, z, 6, 90);
    m.row('black', 0, 7, z, 8);
  });
  const pedestalSteps = m.steps.length;
  m.step('Bridge the cabinet and install the joystick and buttons.', () => {
    m.p('plate-8x8', 'black', 0, 0, 8);
    for (const x of [0, 2, 4, 6]) m.p('slope-2x2', 'black', x, 0, 9);
    m.p('brick-1x8', 'black', 0, 2, 9); m.p('tile-1x8', 'black', 0, 2, 12);
    m.p('roundbrick-1x1', 'black', 2, 1, 12); m.p('roundplate-1x1', 'red', 2, 1, 15);
    for (const [x, c] of [[4, 'red'], [5, 'yellow'], [6, 'blue']] as [number, ColorName][]) m.p('roundtile-1x1', c, x, 1, 12);
    m.row('black', 0, 3, 9, 8); m.p('brick-1x6', 'black', 1, 4, 9);
    for (const x of [0, 7]) m.row('dark-blue', x, 4, 9, 3, 90); m.row('black', 0, 7, 9, 8);
  });
  const pixels = ['001100', '011110', '110011', '111111', '010010'];
  for (let row = 0; row < 5; row++) m.step('Build the six-pixel-wide alien into the screen face.', () => {
    const z = 12 + row * 3;
    for (const x of [0, 7]) m.p('brick-1x1', 'black', x, 3, z);
    for (let x = 0; x < 6; x++) m.p('brick-1x1', pixels[4 - row][x] === '1' ? 'bright-green' : 'black', x + 1, 4, z);
    for (const x of [0, 7]) m.row('dark-blue', x, 4, z, 3, 90);
    m.row('black', 0, 7, z, 8);
  });
  m.step('Project the marquee over the screen and add a bright title stripe.', () => {
    m.p('plate-6x8', 'black', 0, 2, 27);
    m.p('brick-1x3', 'dark-blue', 0, 2, 28); m.p('brick-1x2', 'yellow', 3, 2, 28); m.p('brick-1x3', 'dark-blue', 5, 2, 28);
    for (const x of [0, 7]) m.row('dark-blue', x, 3, 28, 4, 90); m.row('black', 0, 7, 28, 8);
    for (const x of [0, 2, 4, 6]) m.p('curve-2x2', 'dark-blue', x, 2, 31);
    for (const x of [0, 4]) for (const y of [4, 6]) m.p('tile-2x4', 'black', x, y, 31);
  });
  for (const step of m.steps.slice(pedestalSteps)) for (const p of step.parts) p.z += 12;
  return m.finish('pixel-arcade', 'Midnight Arcade', 'A freestanding arcade cabinet with a brick-built alien screen, joystick, three buttons, coin slot, and overhanging marquee.', 'Objects', ['Pixel-art screen', 'Raised joystick', 'Sloping control deck']);
}

function shuttle(): DisplayModel {
  const m = new Model();
  m.step('Lay the fuselage keel and join the nose to the main body.', () => {
    m.p('plate-4x4', 'black', 8, 0, 0); m.floor('black', 8, 4, 0, 4, 14);
    m.p('plate-4x6', 'white', 8, 0, 1, 90);
    m.p('plate-2x8', 'white', 6, 6, 1); m.p('plate-2x12', 'white', 4, 8, 1);
    m.p('plate-6x16', 'white', 2, 10, 1); m.p('plate-2x12', 'white', 4, 16, 1);
  });
  m.step('Shape the nose and set the dark flight-deck glazing.', () => {
    for (const x of [9, 10]) m.p('curve-1x3', 'white', x, 0, 2);
    m.p('slope-2x2', 'black', 9, 3, 2);
    m.p('slope-1x2', 'white', 8, 3, 2); m.p('slope-1x2', 'white', 11, 3, 2);
    for (const x of [8, 10]) for (const y of [5, 11]) m.p('brick-2x6', 'white', x, y, 2, 90);
    for (const x of [8, 10]) m.p('brick-1x2', 'black', x, 17, 2);
  });
  m.step('Tile the stepped wings and trace their leading edges in black.', () => {
    for (const [x, y, n] of [[6, 6, 2], [12, 6, 2], [4, 8, 4], [12, 8, 4], [2, 10, 6], [12, 10, 6]]) m.row('black', x, y, 2, n, 0, 'tile');
    for (const x of [2, 4, 6, 12, 14, 16]) for (const y of [12, 14]) m.p('tile-2x2', (x === 4 || x === 14) && y === 14 ? 'dark-blue' : 'white', x, y, 2);
    for (const x of [4, 6, 12, 14]) m.p('tile-2x2', 'white', x, 16, 2);
    for (const [x, y] of [[4, 9], [6, 9], [12, 9], [14, 9], [6, 7], [12, 7], [2, 11], [4, 11], [6, 11], [12, 11], [14, 11], [16, 11]]) m.p('tile-1x2', 'white', x, y, 2);
  });
  m.step('Smooth the payload bay and close the flight deck.', () => {
    m.p('plate-2x2', 'white', 9, 4, 5); m.p('curve-2x2', 'black', 9, 4, 6);
    for (const x of [8, 10]) for (const y of [7, 9, 11]) m.p('curve-2x2', 'white', x, y, 5, x === 8 ? 270 : 90);
    for (const x of [8, 10]) m.p('plate-2x4', 'white', x, 13, 5, 90);
    for (const x of [8, 10]) m.p('curve-2x2', 'dark-gray', x, 17, 5);
  });
  m.step('Raise the swept tail fin above the rear engine deck.', () => {
    m.p('slope-2x2', 'black', 9, 13, 6); m.p('brick-2x2', 'white', 9, 15, 6); m.p('slope-2x2', 'white', 9, 14, 9); m.p('brick-1x2', 'white', 9, 16, 9); m.p('slope-2x2', 'white', 9, 15, 12); m.p('plate-1x2', 'white', 9, 16, 15); m.p('tile-1x2', 'white', 9, 16, 16);
    m.p('tile-1x4', 'white', 8, 13, 6, 90);
  });
  return m.finish('orbital-shuttle', 'Orbital Shuttle', 'A broad-winged orbiter with a shaped nose, black cockpit glazing, tiled wings, curved payload bay, and swept tail.', 'Space', ['Stepped delta wings', 'Curved payload bay', 'Swept tail fin']);
}

function lander(): DisplayModel {
  const m = new Model(); m.ground(16, 12, 'dark-gray');
  m.step('Place four landing pads on the lunar surface.', () => {
    for (const x of [2, 12]) for (const y of [1, 9]) m.p('roundplate-2x2', 'light-gray', x, y, 2);
    for (const [x, y] of [[0, 3], [7, 0], [14, 5], [7, 10]]) m.p('slope-2x2', 'light-gray', x, y, 2);
  });
  for (const z of [3, 6, 9]) m.step('Raise the four landing struts and their flared braces.', () => {
    for (const x of [3, 13]) for (const y of [2, 9]) {
      if (z === 6) m.p('invslope-2x2', 'yellow', x === 3 ? 3 : 12, y - 1, z);
      else m.p('roundbrick-1x1', 'light-gray', z === 9 ? (x === 3 ? 4 : 12) : x, y, z);
    }
  });
  m.step('Support the descent engine on a clear display column.', () => {
    for (const z of [2, 5]) m.p('roundbrick-2x2', 'trans-clear', 7, 5, z);
    m.p('roundbrick-2x2', 'black', 7, 5, 8); m.p('roundplate-2x2', 'light-gray', 7, 5, 11); m.p('plate-2x2', 'black', 7, 5, 12);
  });
  m.step('Bridge the struts and install the suspended equipment platform.', () => {
    for (const y of [2, 9]) m.p('plate-1x12', 'light-gray', 2, y, 12);
    m.p('plate-8x8', 'black', 4, 2, 13);
  });
  for (const z of [14, 17]) m.step('Build the gold cabin and its panoramic front window.', () => {
    for (const [x, y, rot] of [[5, 3, 180], [9, 3, 270], [5, 7, 90], [9, 7, 0]]) {
      if (z === 17 && y === 3) {
        m.p('brick-1x1', 'trans-clear', x === 5 ? 6 : 9, 3, z);
        m.p('brick-1x2', 'yellow', x, 4, z);
      } else m.p('cornerbrick-2x2', 'yellow', x, y, z, rot);
    }
    m.p('brick-1x2', z === 14 ? 'yellow' : 'trans-clear', 7, 3, z);
    for (const x of [5, 10]) m.p('brick-1x2', z === 14 ? 'yellow' : 'trans-clear', x, 5, z, 90);
    m.p('brick-1x2', 'yellow', 7, 8, z);
  });
  m.step('Close the cabin roof and extend the solar-panel support beam.', () => {
    m.p('plate-6x6', 'light-gray', 5, 3, 20); m.p('plate-1x12', 'light-gray', 2, 7, 21);
    m.p('brick-2x2', 'black', 7, 5, 21);
    for (const x of [5, 7, 9]) m.p('slope-2x2', 'yellow', x, 3, 21);
  });
  m.step('Tile the two dark-blue solar wings.', () => {
    for (const x of [0, 12]) {
      m.p('plate-4x4', 'light-gray', x, 4, 22);
      for (const dx of [0, 2]) for (const y of [4, 6]) m.p('tile-2x2', 'dark-blue', x + dx, y, 23);
    }
  });
  m.step('Raise the communication mast and add the beacon.', () => {
    m.p('roundbrick-1x1', 'light-gray', 7, 5, 24); m.p('roundplate-2x2', 'light-gray', 7, 5, 27); m.p('cone-1x1', 'white', 7, 5, 28);
    m.p('roundbrick-1x1', 'white', 9, 7, 22); m.p('roundplate-1x1', 'trans-red', 9, 7, 25);
  });
  return m.finish('lunar-surveyor', 'Lunar Surveyor', 'A gold observation lander raised on four struts, with solar wings, a glazed cabin, and a communication mast.', 'Space', ['Four landing struts', 'Solar wings', 'Glazed observation cabin']);
}

export const DISPLAY_MODELS: DisplayModel[] = [cafe(), chalet(), lighthouse(), pagoda(), typewriter(), arcade(), shuttle(), lander()];
