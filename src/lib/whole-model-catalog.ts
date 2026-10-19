import {heightOf,parsePartId,type PartKind} from './bricks';
import {connectorShapeText,definition} from './connections';
import {createBench,MAX_WHOLE_MODEL_PARTS,WHOLE_MODEL_WIDTH_STUDS} from './whole-model-workbench';

/** Exact stock/geometry contract with visual piece-selection clues. Unsupported IDs throw, never alias.
 * Any filtering must be explicit upstream and disclosed with the omitted IDs.
 * No QA-only catalog, complete model, subject recipe or world pose is imported.
 */
export function catalogContract(stock:Record<string,number>):string {
 const exact=createBench(stock).stock,shapes=new Map<string,PartKind>();
 for(const id of Object.keys(exact)){
  const kind=parsePartId(id)!;
  shapes.set(`${kind.type}-${kind.w}x${kind.d}`,kind);
 }
 const profiles=[...shapes].map(([id,kind])=>{
  const native=definition(kind);
  return `${id}: height ${heightOf(kind)} plates; local nominal envelope boxes ${JSON.stringify(native.boxes)}; ${native.convex?`convex body sections ${JSON.stringify(native.convex.map(section=>section.points))}`:'collision uses the listed native nominal boxes; rendered family rounding does not imply extra clearance'}`;
 }).join('\n');
 return `Coordinates: x right, y back, z up. x/y are studs in multiples of 0.05; z is PLATE units in multiples of 0.125. One stud = 20 LDU; one plate = 8 LDU. This is a literal 1-LDU pose grid: use the exact stocked part's port offsets, including bracket y offsets of 0.2 stud offsets and fractional-plate planes, only when real connectors and full clearance validate. A pose is the nominal rotation-envelope minimum corner, not its center; actual convex bodies may retain clipped corners inside that envelope. Use upright quarter-turn yaw rot 0/90/180/270 only; no orientation matrix. All proposed poses are literal: no snapping, fitting, settling or substitute parts. The model may use at most ${MAX_WHOLE_MODEL_PARTS} pieces from the exact inventory and must remain within the native ${WHOLE_MODEL_WIDTH_STUDS}×${WHOLE_MODEL_WIDTH_STUDS} stud build area. Inventory quantity does not increase that model limit.
LOCAL SHAPE/PORT TABLES use LDU coordinates for the unrotated native part. Actual port kind, point and opposing normal must mate. Half-stud coordinates permit actual centered joins, not invented grips. A part has ONLY the studs/grips listed for its shape; a smooth or sloping surface supplies no unlisted attachment. Raised underside grips and local clearances must follow the native tables. Side-facing ports do not permit an orientation outside the upright pose grammar. Nominal solids/contacts establish digital geometry, not clutch strength or physical assembly proof.
${connectorShapeText(exact)}
LOCAL SOLID PROFILES (shared across the stocked colors):
${profiles}`;
}

export const wholeModelCatalog=catalogContract;
