/** Visual selection clues for exact native molds. These never grant stock,
 * connectors, poses or clearance. Names describe appearance; native geometry
 * and the active builder's pose grammar remain the placement authority. */
import {popularMold} from './popular-molds';
import type {PartKind} from './bricks';

export interface MoldUseGuidance {
 num:string;
 name:string;
 uses:string;
 chooseWhen:string;
 attachmentNotes:string[];
}

export const MOLD_USE_BOUNDARY='Piece-use clues describe possible visible roles, not validated recipes. Use only exact stocked IDs/colors/counts; reserve scarce counterparts and carriers before bulk. Match the listed real ports, their heights and full collision clearance within the active pose grammar. Catalog words such as handle, clip, hinge, pin, axle, ball, socket or hole grant no unlisted joint or moving mechanism. A rendered opening is not a certified mating clearance. Leave a piece unused when its visible form or legal attachment does not fit.';

function visualUse(name:string,sideStuds:boolean):[string,string] {
 const n=name.toLowerCase(),base=n.split(/\bwith\b/)[0];
 if (/\bwindow\b|\bdoor frame\b/.test(base)) return ['visible window/door openings, framed entrances and open architectural bays','the subject needs a framed opening at this piece\'s actual scale; retain the opening instead of filling it with bulk'];
 if (/^panel\b/.test(base)) return ['thin walls, recessed sides, parapets and container-like enclosures','a thin exposed wall or open-backed edge gives a better proportion than a stack of full bricks'];
 if (/\barch\b/.test(base)) return ['arched openings, doorways, bridges and curved spans','the subject needs an opening beneath a curved span; check actual clearance before placing another piece inside it'];
 if (/\bbracket\b/.test(base)||sideStuds) return ['static side-facing detail carriers, offset facades and changes of stud direction','a visible feature needs a listed side-facing stud plane; choose a matching child socket and a pose allowed by the active builder'];
 if (/\bgrille\b|\bgrills\b|\bmasonry\b|\bpalisade\b/.test(n)) return ['exposed vents, ribbed surfaces and textured facade details','the texture belongs on a visible surface and its scale suits the subject'];
 if (/\bladder\b/.test(n)) return ['visible ladder-like or open ribbed detailing','the subject calls for that exposed silhouette; use ordinary listed ports for mounting'];
 if (/\btooth\b|\bteeth\b/.test(n)) return ['pointed tips, small fins, serrated edges and tapered details','a projecting point improves the outline at the model\'s chosen scale'];
 if (/\bdish\b/.test(base)) return ['shallow bowls, flared caps and rounded exposed faces','a shallow concave or domed silhouette is useful; orient it only through legal poses and real ports'];
 if (/\bcone\b/.test(base)) return ['tapered columns, spires, nozzles and narrowing caps','the outline should narrow around a central axis rather than remain a straight cylinder'];
 if (/\bcylinder\b|\bpillar\b/.test(n)||/^support round\b/.test(base)) return ['rounded columns, narrow stems and cylindrical vertical details','a tall narrow rounded mass fits the subject without an oversized square support'];
 if (/\bwedge(?:d)?\b/.test(base)) return ['tapered decks, wings, bow-like outlines and diagonal footprint transitions','the plan-view silhouette needs this exact diagonal or cut corner; reserve the correct handed counterpart if symmetry needs one'];
 if (/\b(?:slope|sloped|curved).*?\binverted\b/.test(n)&&!/\binverted cutout\b/.test(n)) return ['tapered undersides, projecting rims and lower body transitions','the lower silhouette needs to narrow or overhang; match the actual raised/recessed connector planes'];
 if (/\bslope(?:d)?\b/.test(base)&&!/\bcurved\b/.test(n)) return ['inclined roofs, sloping housings, fins and straight profile tapers','a straight inclined face gives the needed roof pitch or body transition; check the actual slope direction in the views'];
 if (/\bcurved\b|\bround\b|\bmacaroni\b/.test(n)) return ['rounded shells, curved corners, circular edges and smoother silhouette transitions','the subject needs this particular rounded outline; match any cutout and actual profile rather than treating all curves as interchangeable'];
 if (/\bcorner\b|\bcutout\b|\bopening\b|\bcross\b/.test(n)) return ['open corners, branching footprints and frames around negative space','an opening or a change of footprint is a defining visible feature; check collision clearance before placing anything through it'];
 if (/^tile\b/.test(base)) return ['smooth covers, decks, exposed finish surfaces and flat control panels','a smooth exposed surface improves the finish; support it through listed sockets instead of assuming studs on top'];
 if (/\bjumper\b/.test(n)) return ['centered or offset detail carriers and small footprint transitions','the actual top port offset solves an alignment problem; use its exact position instead of an ordinary grid assumption'];
 if (/^plate\b/.test(base)) return ['thin decks, foundations, layered edges and footprint transitions','a plate-height layer is useful without making the model bulky; account for sparse or edge-only studs'];
 return ['visible structural masses, piers and upright body sections','the exact height and outline help establish the subject\'s proportions; keep distinctive features exposed'];
}

/** Exact lookup only: unknown numbers, aliases and wrong nominal sizes get no clues. */
export function moldUseGuidance(kind:Pick<PartKind,'type'|'w'|'d'>):MoldUseGuidance|undefined {
 const m=popularMold(kind);if(!m)return undefined;
 const top=m.ports.filter(p=>p.kind==='stud'&&p.normal[2]===1);
 const side=m.ports.filter(p=>p.kind==='stud'&&p.normal[2]===0);
 const grips=m.ports.filter(p=>p.kind==='grip'&&p.normal[2]===-1);
 const [uses,chooseWhen]=visualUse(m.name,side.length>0),attachmentNotes:string[]=[];
 if(!top.length)attachmentNotes.push('No upward stud port in the native pose: do not assume an attachment on that face.');
 if(grips.some(p=>p.point[2]!==0))attachmentNotes.push('Underside socket planes are raised or stepped: use each listed height, never a flattened bottom.');
 if(!grips.length)attachmentNotes.push('No qualified downward socket in the native pose: ground it or use a different listed legal connection; do not invent an underside grip.');
 return {num:m.num,name:m.name,uses,chooseWhen,attachmentNotes};
}

export function moldUseText(kind:Pick<PartKind,'type'|'w'|'d'>):string {
 const g=moldUseGuidance(kind);if(!g)return '';
 return `Exact mold #${g.num}: ${g.name}. Shape uses: ${g.uses}. Choose when ${g.chooseWhen}. ${g.attachmentNotes.join(' ')}`.trim();
}
