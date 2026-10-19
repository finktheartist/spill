import {parsePartId,type Placed} from './bricks';
import {isMade} from './catalog';
import {attachPart,connectionPairs,definition,frame,type ConnectionOperation,type Connector,type RequiredContact,type V3,type Box,type Rotation} from './connections';

export const SURFACE_SOURCE='https://www.youtube.com/watch?v=R_dkNhYKaYQ&t=268s';
export interface SurfaceChoice {
 id:string;family:'bracket-face'|'sideways-taper';version:1;
 mount:string;face:string;faceGrip:string;faceTwist:number;cost:Record<string,number>;
 /** Local coordinates belong to the mount. These modules are reconstructed
  * from our exact supported variants, not transcriptions of a hidden video BOM. */
 contract:{input:Connector;outputs:{part:'mount'|'face';port:Connector}[];
  parts:{partId:string;rotation:Rotation;translation:V3}[];
  bounds:Box;solids:V3[][];clearance:V3[][];profile:V3[];contacts:RequiredContact[];
  seam:{plane:number;span:[number,number];axis:'x';note:string}};
}
const count=(ids:string[])=>{const c:Record<string,number>={};for(const id of ids)c[id]=(c[id]??0)+1;return c;};
function recipe(mount:string,face:string,turn:number):Omit<SurfaceChoice,'id'> {
 const faceGrip=turn===90?'grip:0:1':turn===-90?'grip:1:0':'grip:0:0';
 const a:Placed={partId:mount,x:0,y:0,z:0,rot:0},b=attachPart(a,'side:0',face,faceGrip,turn);
 const frames=[frame(a),frame(b)],pairs=connectionPairs(...frames as [ReturnType<typeof frame>,ReturnType<typeof frame>]);
 if(pairs.length!==2)throw Error('Surface must engage both bracket studs');
 const contacts=pairs.map(([aPort,bPort])=>({a:0,b:1,aPort,bPort}));
 const used=new Set(pairs.flatMap(([a,b])=>[`mount/${a}`,`face/${b}`]));
 const solids=frames.flatMap(f=>f.solids.map(s=>s.points));
 const points=solids.flat();
 const bounds:Box={min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as V3};
 return {family:turn===0&&['tile','plate'].includes(parsePartId(face)!.type)?'bracket-face':'sideways-taper',version:1,mount,face,faceGrip,faceTwist:turn,cost:count([mount,face]),contract:{
  input:definition(parsePartId(mount)!).ports.find(p=>p.id==='grip:0:0')!,
  outputs:frames.flatMap((f,i)=>f.ports.filter(p=>!used.has(`${i?'face':'mount'}/${p.id}`)&&!(i===0&&p.id==='grip:0:0')).map(port=>({part:i?'face' as const:'mount' as const,port}))),
  parts:frames.map((f,i)=>({partId:i?face:mount,rotation:f.rotation,translation:f.translation})),
  bounds,solids,clearance:frames.flatMap(f=>f.studs.map(s=>s.solid.points)),profile:frames[1].solids.flatMap(s=>s.points),contacts,
  seam:{plane:0,span:[0,40],axis:'x',note:'Two-stud-wide mounting seam. Join adjacent faces on the same bracket plane; supports and side studs occupy the reserved solids. No sliding fits.'}
 }};
}
/** Feasible alternatives only. Full-program expansion reserves all copies together.
 * Pair handed transitions explicitly; availability of one never promises two. */
export function surfaceChoices(stock:Record<string,number>,limit=12):SurfaceChoice[]{
 const ids=Object.keys(stock).filter(id=>Number.isSafeInteger(stock[id])&&stock[id]>0&&!!parsePartId(id)&&isMade(id)).sort();
 const mounts=ids.filter(id=>id.startsWith('bracket-1x2-')).sort((a,b)=>stock[b]-stock[a]||a.localeCompare(b));
 if(!mounts.length||limit<1)return [];
 const families=['tile','slope','plate'];
 const groups=families.map(type=>ids.filter(id=>id.startsWith(`${type}-2x2-`)));
 const result:SurfaceChoice[]=[];
 // Round robin families before palettes, so one plentiful part never hides all
 // tapered alternatives. A hidden mount color may differ from the visible face.
 for(const mount of mounts)for(let variant=0;variant<Math.max(...groups.map(g=>g.length));variant++)for(const group of groups){
  const face=group[variant];if(!face)continue;
  for(const turn of face.startsWith('slope')?[0,90,-90]:[0]){
   const r=recipe(mount,face,turn);
   result.push({id:`surface-${face}-${turn}-${parsePartId(mount)!.color}`, ...r});if(result.length>=limit)return result;
  }
 }
 return result.slice(0,limit);
}
export function surfaceOperations(choice:SurfaceChoice,host:number,parentPort:string,twist:number,start:number):ConnectionOperation[]{
 return [{partId:choice.mount,parent:host,parentPort,childPort:'grip:0:0',twist},
  {partId:choice.face,parent:start,parentPort:'side:0',childPort:choice.faceGrip,twist:choice.faceTwist}];
}
export function surfaceChoiceText(choices:SurfaceChoice[]):string {
 return choices.map(c=>`${c.id}: ${c.family}, face ${c.face}, face turn ${c.faceTwist}°. Reserves ${JSON.stringify(c.cost)}. Outputs ID.mount and ID.face. Mount input grip:0:0; host must have a top stud on a RAISED EDGE: bracket extends 12 LDU below it and 14 LDU forward of its center, face extends another ${-c.contract.bounds.min[1]} LDU outward. Never mount over filled material in that space. Pattern twist turns the complete module on its host. Local occupied bounds ${JSON.stringify(c.contract.bounds)}. Face contour ${JSON.stringify(c.contract.profile)}. Two side connections are mandatory. Neighboring faces need the same mount plane and matching visible edges. Keep cavity behind face empty except the mount. Exact cost applies to EACH copy.`).join('\n');
}
