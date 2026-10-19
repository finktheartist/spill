import { spatial, validateConnections, frame, connectionPairs } from './connections';
import { cells, heightOf, parsePartId, partCount, studCells, validate, voxels, type Build, type Issue } from './bricks';

/** Assembly geometry is independent of the order a model happened to list its pieces. */
export function orderBuild(build: Build, rebuildSteps = false): Build {
  if(spatial(build))return build;
  const parts = build.steps.flatMap(s => s.parts);
  if (!rebuildSteps && parts.every((p, i) => !i || p.z >= parts[i - 1].z)) return build;
  const sorted = [...parts].sort((a, b) => a.z - b.z);
  const steps: Build['steps'] = [];
  for (const p of sorted) {
    const last = steps[steps.length - 1];
    if (!last || last.parts.length >= 8 || last.parts[0].z !== p.z) {
      steps.push({ caption: p.z === 0 ? 'Lay out the base' : 'Add the next layer', parts: [] });
    }
    steps[steps.length - 1].parts.push(p);
  }
  return { ...build, steps };
}

/** A complete model must contain parts; an empty workbench may still be valid while editing. */
export function constructionIssues(build: Build, have: Record<string, number>, width = Infinity): Issue[] {
  const issues = spatial(build) ? validateConnections(build,have,width) : validate(build, have);
  if (!partCount(build)) issues.push({ kind: 'invalid', message: 'The build is empty. Place a connected model using the available parts.', parts: [] });
  if(spatial(build))return issues;
  for (const p of build.steps.flatMap(s => s.parts)) {
    const k = parsePartId(p.partId);
    if (k && cells(k, p).some(([x, y]) => x < 0 || y < 0 || x >= width || y >= width)) {
      issues.push({ kind: 'invalid', message: `${p.partId} at (${p.x},${p.y},${p.z}) extends outside the ${width}×${width} build area.`, parts: [p] });
    }
  }
  return issues;
}

/** A fresh addition cannot rewrite, recolor, or consume any of the fixed core. */
export function joinConstruction(base: Build, steps: Build['steps']): Build {
  return orderBuild({ ...base, steps: [...base.steps, ...steps.filter(s => s.parts?.length)] });
}

/** Available attachment cells, calculated from the actual geometry rather than estimated by the model. */
export function attachmentMap(build: Build): string {
  if(spatial(build)){
    const frames=build.steps.flatMap(s=>s.parts).map(frame),used=new Set<string>();
    frames.forEach((a,i)=>frames.slice(0,i).forEach((b,j)=>connectionPairs(a,b).forEach(([x,y])=>{used.add(`${i}/${x}`);used.add(`${j}/${y}`);} )));
    return frames.flatMap((f,i)=>f.ports.filter(p=>!used.has(`${i}/${p.id}`)).map(p=>`part ${i}: ${p.id} at LDU ${p.point.join(',')}, normal ${p.normal.join(',')}`)).join('\n');
  }
  const parts = build.steps.flatMap(s => s.parts);
  const occupied = new Set(parts.flatMap(p => {
    const k = parsePartId(p.partId);
    return k ? voxels(k, p).map(v => v.join(',')) : [];
  }));
  const rows = new Map<string, Set<number>>();
  for (const p of parts) {
    const k = parsePartId(p.partId);
    if (!k) continue;
    const z = p.z + heightOf(k);
    for (const [x, y] of studCells(k, p)) {
      if (occupied.has(`${x},${y},${z}`)) continue;
      const key = `z=${z}, y=${y}`;
      const xs = rows.get(key) ?? new Set<number>();
      xs.add(x); rows.set(key, xs);
    }
  }
  return [...rows].map(([key, xs]) => `${key}: x=${[...xs].sort((a, b) => a - b).join(',')}`).join('\n') || 'No exposed studs. A new part must connect underneath, or the existing shape must be revised.';
}

/** Repeated geometric states should not spend the remaining repair budget saying the same thing. */
export const constructionKey = (b: Build) => JSON.stringify(b.steps.flatMap(s => s.parts).map(p => [p.partId, p.x, p.y, p.z, p.rot, ...(p.orientation ? [p.orientation] : [])]));
