import savedReviews from './roof-module-reviews.json';
import { parsePartId, type Build, type Placed } from './bricks';
import { isMade } from './catalog';
import { attachmentTwist, compileConnections, connectionPairs, frame, type ConnectionProgram } from './connections';

export interface RoofModule {
 id:string; family:'gable-roof'; version:1; color:string; cost:Record<string,number>;
 build:Build; program:ConnectionProgram;
 /** Exact installed geometry, including palette. Reviews never transfer to a recolor or repacking. */
 signature:string;
}
export interface ModuleReview {signature:string; profile:number; finish:number; reusable:number; explanation:string}
export const moduleSignature=(build:Build)=>JSON.stringify(build.steps.flatMap(s=>s.parts).map(p=>[p.partId,p.x,p.y,p.z,p.rot,p.orientation??null]));
export function moduleApproved(module:RoofModule,reviews:ModuleReview[]):boolean {
 const actual=moduleSignature(module.build);
 return module.signature===actual&&reviews.some(r=>r.signature===actual&&[r.profile,r.finish,r.reusable].every(n=>Number.isInteger(n)&&n>=4&&n<=5));
}
export const moduleCost=(parts:Placed[])=>{const cost:Record<string,number>={};for(const p of parts)cost[p.partId]=(cost[p.partId]??0)+1;return cost;};
/** Convert authored placements to actual connector operations. Fail if any seam
 * cannot be assembled. The compiled result gets full stock/collision checks. */
export function connectedAssembly(name:string,description:string,parts:Placed[],stock:Record<string,number>):{build:Build;program:ConnectionProgram} {
 if(!parts.length)throw Error('Assembly is empty');
 const frames=parts.map(frame),order=[0],seen=new Set(order);
 const operations:ConnectionProgram['operations']=[{partId:parts[0].partId,parent:-1,parentPort:'',childPort:'',twist:0}];
 while(order.length<parts.length){let found=false;
  for(let i=0;i<parts.length&&!found;i++)if(!seen.has(i))for(let j=0;j<order.length&&!found;j++)for(const [a,b]of connectionPairs(frames[order[j]],frames[i])){
   const twist=attachmentTwist(parts[order[j]],a,parts[i],b);if(twist===null)continue;
   operations.push({partId:parts[i].partId,parent:j,parentPort:a,childPort:b,twist});order.push(i);seen.add(i);found=true;break;
  }
  if(!found)throw Error('Assembly has a disconnected piece');
 }
 const program:ConnectionProgram={name,description,rootRotation:parts[0].rot,operations};
 return {program,build:compileConnections(program,stock)};
}
/** One complete, coherent roof per available palette. Prefer an already reviewed
 * packing whenever its pieces remain available; more stock must not hide it. Opposing slope courses
 * share a ridge; the carrier plate ties every piece together. No guessed stock. */
export function roofModules(stock:Record<string,number>):RoofModule[]{
 const ids=Object.keys(stock).filter(id=>Number.isSafeInteger(stock[id])&&stock[id]>0&&isMade(id)&&parsePartId(id));
 const colors=[...new Set(ids.filter(id=>id.startsWith('slope-')).map(id=>parsePartId(id)!.color))].sort();
 const result:RoofModule[]=[];
 for(const color of colors){
  const left={...stock};const carriers=ids.filter(id=>id.startsWith('plate-4x4-')).sort((a,b)=>Number(!a.endsWith('-'+color))-Number(!b.endsWith('-'+color))||a.localeCompare(b));
  if(!carriers.length)continue;
  const carrier=carriers[0];left[carrier]--;
  const rows:{id:string;width:number}[][]=[];
  const enumerate=(width:number,row:{id:string;width:number}[],available:Record<string,number>)=>{
   if(width===4){rows.push(row);return;}
   for(const w of [4,3,2,1]){const id=`slope-${w}x2-${color}`;if(w+(width)>4||w>(row.at(-1)?.width??4)||!ids.includes(id)||available[id]<1)continue;enumerate(width+w,[...row,{id,width:w}],{...available,[id]:available[id]-1});}
  };
  enumerate(0,[],left);
  let module:RoofModule|undefined;
  outer:for(const front of rows)for(const back of rows){
   const parts:Placed[]=[{partId:carrier,x:0,y:0,z:0,rot:0}];
   for(const [j,row]of [front,back].entries()){let x=0;for(const p of row){parts.push({partId:p.id,x,y:j*2,z:1,rot:j*180});x+=p.width;}}
   const ridges:Placed[][]=[
    [{partId:`tile-2x4-${color}`,x:0,y:1,z:4,rot:0}],
    [1,2].map(y=>({partId:`tile-1x4-${color}`,x:0,y,z:4,rot:0})),
    [1,2].flatMap(y=>[0,2].map(x=>({partId:`tile-1x2-${color}`,x,y,z:4,rot:0}))),
   ];
   for(const ridge of ridges){const all=[...parts,...ridge],cost=moduleCost(all);
    if(Object.entries(cost).some(([id,n])=>!ids.includes(id)||(stock[id]??0)<n))continue;
    try{const compiled=connectedAssembly('Pitched canopy','Opposing sloped courses with a smooth ridge on a connected carrier.',all,stock);const candidate:RoofModule={id:`gable-roof-${color}`,family:'gable-roof',version:1,color,cost,...compiled,signature:moduleSignature(compiled.build)};
     module??=candidate;
     if(moduleApproved(candidate,savedReviews)){module=candidate;break outer;}}catch{/* Try another legal packing. */}
   }
  }
  if(module)result.push(module);
 }
 return result;
}
export function roofModuleText(modules:RoofModule[]):string {
 return modules.map(m=>`${m.id}: 4x4 pitched canopy, ${m.color} sloped faces and smooth ridge, 5 plates tall. Exact stock ${JSON.stringify(m.cost)}. Mount any carrier bottom grip onto a top stud using childPort="grip:x:y" (x,y 0..3). Choose an inset grip to leave an eave overhang. The carrier occupies its actual 4x4 area around the selected grip. Outputs ID.carrier (its studs are occupied by the roof) and ID.ridge (smooth, no top studs). Use as a roof for a gatehouse, cottage, tower or kiosk; choose the subject around this supported profile. The host must hold the roof, with no pieces inside its slopes. A finished object still needs its own appearance review.`).join('\n');
}
