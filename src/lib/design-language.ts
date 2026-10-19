import { strategiesFor, type ConstructionFamily } from './construction-families';

export interface ConstructionPattern {
  id: string; name: string; families: ConstructionFamily[]; rule: string;
}

/** Spatial rules within the renderer's upright-stud contract, not extra stock or unchecked placements. */
export const CONSTRUCTION_PATTERNS: ConstructionPattern[] = [
  { id: 'stepped-massing', name: 'Stepped massing', families: [], rule: 'Establish a dominant volume, a smaller secondary volume and fine details. Offset their edges by one or more studs; vary length, width and height rather than piling identical rectangles. Cross the seams with supported plates.' },
  { id: 'recessed-bay', name: 'Recessed bay', families: ['buildings', 'machines', 'road-vehicles', 'objects'], rule: 'Place two jambs in front of a back wall set at least one stud deeper, or leave the center open. Bridge the jambs with a lintel touching both. Keep the floor and roof separated by visible air; a dark tile on a solid wall is not an opening.' },
  { id: 'projecting-ledges', name: 'Projecting ledges', families: ['buildings', 'watercraft', 'objects'], rule: 'Project a supported roof, balcony or rim one stud beyond the wall, then set the next volume inward. Preserve the underside shadow gap and the opening below. Connect every projecting plate to real exposed studs.' },
  { id: 'framed-face', name: 'Framed face', families: ['animals', 'characters'], rule: 'Separate the head from the shoulders with a narrower supported neck. Sandwich small eye plates between a lower cheek layer and brow; project the muzzle or jaw forward. Use eyes small enough for the face, not full-height blocks that swallow it.' },
  { id: 'separated-limbs', name: 'Separated limbs', families: ['animals', 'characters'], rule: 'Leave visible gaps between feet or legs and join them higher at hips or chest. Step inward for the torso and outward for shoulders or haunches. Add supported toes or paws in front of the legs, preserving a readable stance.' },
  { id: 'layered-hull', name: 'Layered hull', families: ['watercraft'], rule: 'Build a narrow keel, a wider bonded deck and narrower stepped ends. Raise the cabin on only part of the deck. Keep an open working area and separate bow, cabin and stern in both profile and plan view.' },
  { id: 'paired-pods', name: 'Paired pods', families: ['aircraft', 'machines'], rule: 'Join matching side pods or track units to a narrower raised core with crossing beams. Preserve air gaps between the core and the outer assemblies. Keep mirrored shapes even if hidden support colors differ; brick-built tracks are static.' },
  { id: 'vehicle-volumes', name: 'Vehicle volumes', families: ['road-vehicles', 'aircraft'], rule: 'Give the nose, cockpit and rear different lengths and heights. Set the cabin back from the nose, narrow or step the ends and keep wings, wheels or tail surfaces exposed. Choose proportions before decorating the top.' },
  { id: 'offset-branching', name: 'Offset branching', families: ['nature'], rule: 'Continue a supported trunk through offset branch plates. Place foliage pads at different heights and sideways offsets, with air between them. Taper each pad through smaller upper layers; keep branches visible and avoid stacking leaves through the continuing trunk.' },
  { id: 'open-working-frame', name: 'Open working frame', families: ['machines', 'objects'], rule: 'Arrange supports around the space the object uses: a loading bay, press throat, shelf opening or legroom. Connect the frame above or behind that space. Put the defining tool or surface where its function is legible; do not promise moving mechanisms.' },
  { id: 'contour-shaping', name: 'Contour shaping', families: [], rule: 'Use available slopes or curves where the outline changes direction. Without those pieces, use deliberate stepped contours. Integrate shaping parts into the mass; do not sprinkle them on an unchanged rectangular core.' },
  { id: 'selective-finish', name: 'Selective finish', families: [], rule: 'Repeat a small trim rhythm on related edges and cap only surfaces that benefit from being smooth. Put mixed colors in the core and repeat visible accents. Each detail must sharpen identity, contour or function; unused stock is better than padding.' },
];

export interface CompositionPlan {
  dominantForm: string;
  depthLayers: string[];
  focalPoint: string;
  techniques: string[];
}

export function patternsFor(subject: string): ConstructionPattern[] {
  const families = strategiesFor(subject).map(f => f.id);
  return CONSTRUCTION_PATTERNS.filter(p => !p.families.length || p.families.some(f => families.includes(f)));
}
export function designLanguageText(subject: string): string {
  return `CONSTRUCTION LANGUAGE (adaptable spatial rules, not a fixed subject list):\n${patternsFor(subject).map(p => `${p.id} — ${p.name}: ${p.rule}`).join('\n')}\nChoose 2–3 compatible techniques. Describe the dominant form, the near/middle/far or low/middle/high layers and one focal feature in concrete stud/plate offsets. Reserve space and supports for them in the core. These rules allocate no pieces and certify no geometry: every placement must still use the listed stock and pass connection checks. Upright studs only; no imaginary side connections, hinges or angled parts.`;
}

const bounded = (v: unknown, max = 240) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export function cleanComposition(value: unknown): CompositionPlan | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const ids = new Set(CONSTRUCTION_PATTERNS.map(p => p.id));
  const dominantForm = bounded(raw.dominantForm), focalPoint = bounded(raw.focalPoint);
  const depthLayers = (Array.isArray(raw.depthLayers) ? raw.depthLayers : []).slice(0, 4).map(v => bounded(v, 180)).filter(Boolean);
  const techniques = [...new Set((Array.isArray(raw.techniques) ? raw.techniques : []).filter((v): v is string => typeof v === 'string' && ids.has(v)))].slice(0, 3);
  return dominantForm || focalPoint || depthLayers.length || techniques.length ? { dominantForm, focalPoint, depthLayers, techniques } : undefined;
}
export function compositionText(plan?: CompositionPlan): string {
  if (!plan) return '';
  return `SPATIAL COMPOSITION:\nDominant form: ${plan.dominantForm}\nDepth layers: ${plan.depthLayers.join('; ')}\nFocal feature: ${plan.focalPoint}\n${plan.techniques.map(id => CONSTRUCTION_PATTERNS.find(p => p.id === id)).filter((p): p is ConstructionPattern => !!p).map(p => `${p.name}: ${p.rule}`).join('\n')}\nRealize these offsets, openings and proportions in the placements. A written description alone does not satisfy the plan.\n`;
}
