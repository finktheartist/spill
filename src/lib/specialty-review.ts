import { COLORS, parsePartId, type PartKind } from './bricks';
import { isMade } from './catalog';
import { addPart, type Inventory, type OtherEntry } from './inventory';

/** Suggestions are not stock. Exact handedness and profile require human confirmation. */
export function outlineOptions(observation: OtherEntry): PartKind[] {
  if (!(observation.color in COLORS) || observation.unknown) return [];
  const name = observation.description.toLowerCase().replaceAll('×','x');
  let shapes: string[] = [];
  if (/wedge plate/.test(name) && /(?:2\s*x\s*4|4\s*x\s*2)/.test(name)) {
    shapes = /\bleft\b/.test(name) ? ['wedgeleft-2x4'] : /\bright\b/.test(name) ? ['wedgeright-2x4'] : ['wedgeleft-2x4','wedgeright-2x4'];
  } else if (/(?:quarter[ -]circle plate|round(?:ed)? corner plate|plate.*corner round)/.test(name) && /4\s*x\s*4/.test(name)) shapes = ['quarterplate-4x4'];
  else if (/jumper|cent(?:er|re)d stud/.test(name) && !/assembly|stack/.test(name)) {
    shapes = /\b2\s*x\s*2\b/.test(name) ? ['jumper-2x2'] : /\b1\s*x\s*2\b/.test(name) ? ['jumper-1x2'] : [];
  } else if (/brick/.test(name) && /side|snot/.test(name) && !/headlight|recess|assembly|stack|with.*plate/.test(name)) {
    if (/\b1\s*x\s*4\b/.test(name) && /(?:4|four)\s*(?:side[ -]?)?stud/.test(name)) shapes=['sidebrick-1x4'];
    else if (/\b1\s*x\s*2\b/.test(name)) {
      if (/(?:4|four)\s*(?:side[ -]?)?stud/.test(name) && /tall|1[ .-]*(?:2\/3|⅔)|5 plates/.test(name)) shapes=['sidebricktall-1x2'];
      else if (/(?:2|two)\s*(?:side[ -]?)?stud/.test(name) && !/tall|x\s*2\s*x|1[ .-]*(?:2\/3|⅔)/.test(name)) shapes=['sidebrick-1x2'];
    } else if (/\b1\s*x\s*1\b/.test(name)) {
      if (/(?:4|four)\s*(?:side[ -]?)?stud|(?:4|four) sides/.test(name)) shapes=['sidebrickall-1x1'];
      else if (/adjacent/.test(name) && /(?:2|two)/.test(name)) shapes=['sidebrickadjacent-1x1'];
      else if (!/(?:2|two|3|three|4|four|opposite|multiple)\b/.test(name) && /side stud\b|(?:1|one) stud/.test(name)) shapes=['sidebrick-1x1'];
    }
  }
  else if (/^bracket\s+1\s*x\s*2\s*-\s*1\s*x\s*2$/.test(name.trim())) shapes = ['bracket-1x2'];
  return shapes.map(s => parsePartId(`${s}-${observation.color}`)!).filter(k => k && isMade(k.partId));
}

/** Descriptions only nominate a comparison. They never establish exact geometry. */
export function specialtyReviewNote(observation: OtherEntry): string | null {
  const name=observation.description.toLowerCase();
  if (/bracket/.test(name)) return 'Check the bracket direction and both flange sizes. Only the 99781 downward 1x2–1x2 bracket is supported; upward, taller and wider versions need different geometry.';
  if (/snot|studs? (?:on (?:the )?side|on a side)|side[ -]stud/.test(name)) return 'Check the body size and side studs. Match the exact body height and stud arrangement to the preview. One side, two adjacent sides, four sides and the tall two-row brick are different pieces; hidden sides cannot be inferred from one photograph.';
  if (/jumper/.test(name)) return 'Check for exactly one centered top stud and a one-plate-high body: 1x2 (3794b) or 2x2 (87580).';
  return null;
}

/** Consume exactly one still-present observation. A double click or stale selection is a no-op. */
export function confirmOutlineObservation(inv: Inventory, observation: OtherEntry, partId: string): Inventory {
  const index = inv.others.indexOf(observation), kind = outlineOptions(observation).find(k => k.partId === partId);
  if (index < 0 || !kind) return inv;
  const next = addPart({ ...inv, others: inv.others.filter((_, i) => i !== index) }, kind, 1, observation.boxes[0]);
  return next;
}
