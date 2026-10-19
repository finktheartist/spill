import type {Build,Placed,Step} from './bricks';
import {connectionPairs,frame,type Frame,type Solid} from './connections';
import {constructionIssues} from './construction';

export interface InstructionPlan {build:Build;reorderedParts:number;subassemblies:number;notices:string[]}
const EPS=1e-5,MAX_PARTS=80,MAX_SECTION=8,MAX_PORT_WORK=8_000_000,MAX_SOLID_WORK=300_000;
type XY=readonly[number,number];
interface Link {other:number;own:string;otherPort:string}
interface Projection {points:XY[];minZ:number;maxZ:number}

/** Convex projection of an actual nominal solid, including stepped/empty
 * profiles. A world AABB alone would mistake open corners for covers. */
function projection(s:Solid):Projection {
 const points=[...new Map(s.points.map(p=>[`${p[0]},${p[1]}`,[p[0],p[1]] as XY])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const turn=(a:XY,b:XY,c:XY)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=(ps:XY[])=>{const out:XY[]=[];for(const p of ps){while(out.length>1&&turn(out[out.length-2],out[out.length-1],p)<=0)out.pop();out.push(p);}return out;};
 const lower=half(points),upper=half([...points].reverse());
 return {points:[...lower.slice(0,-1),...upper.slice(0,-1)],minZ:s.bounds.min[2],maxZ:s.bounds.max[2]};
}
function overlaps(a:XY[],b:XY[]):boolean {
 if(a.length<3||b.length<3)return false;
 for(const polygon of [a,b])for(let i=0;i<polygon.length;i++){
  const p=polygon[i],q=polygon[(i+1)%polygon.length],length=Math.hypot(q[0]-p[0],q[1]-p[1]);
  if(length<EPS)continue;
  const x=-(q[1]-p[1])/length,y=(q[0]-p[0])/length,aa=a.map(v=>v[0]*x+v[1]*y),bb=b.map(v=>v[0]*x+v[1]*y);
  if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=EPS)return false;
 }
 return true;
}
const earlierOnly=(message:string)=>/^Part \d+ has no mating connector on an earlier piece\.$/.test(message);
const partCounts=(parts:Placed[])=>{const stock:Record<string,number>={};for(const p of parts)stock[p.partId]=(stock[p.partId]??0)+1;return stock;};

/** Bounded instruction planning only. Every literal pose, orientation, color,
 * source and closure contract survives unchanged. Native validation remains the
 * authority. Multiple table-supported roots may be laid out before their later
 * connecting bridge; every nonground part still needs an earlier real mate.
 *
 * Lower nominal solids precede projected covers. Interior parts receive a tie
 * preference, not a claim that a collision-free insertion path was simulated.
 * A small connected section resolves a cover/contact dependency together; its
 * flattened parts remain anchor-first for the unchanged native prefix rules. */
export function planBuildInstructions(build:Build):InstructionPlan {
 const original=structuredClone(build);
 const unchanged=(reason:string):InstructionPlan=>({build:original,reorderedParts:0,subassemblies:0,notices:[reason]});
 if(!original||typeof original!=='object')return unchanged('Malformed build; no instruction ordering was attempted.');
 if(original.engine!=='connections-v2')return unchanged('Instruction ordering supports native connection builds only; this sequence was left unchanged.');
 if(!Array.isArray(original.steps)||original.steps.length>160||original.steps.some(s=>!s||!Array.isArray(s.parts)))return unchanged('Malformed or oversized instruction sequence; no ordering was attempted.');
 const count=original.steps.reduce((n,s)=>n+s.parts.length,0);
 if(!count||count>MAX_PARTS)return unchanged('Instruction planning is bounded to 1–80 parts; this sequence was left unchanged.');
 const parts=original.steps.flatMap(s=>s.parts);
 if(parts.some(p=>!p||typeof p!=='object'||typeof p.partId!=='string'))return unchanged('Malformed literal placement; no instruction ordering was attempted.');
 if(original.requiredContacts!==undefined&&(!Array.isArray(original.requiredContacts)||original.requiredContacts.length>160||original.requiredContacts.some(c=>!c||!Number.isSafeInteger(c.a)||!Number.isSafeInteger(c.b)||c.a<0||c.b<0||c.a>=count||c.b>=count||c.a===c.b||typeof c.aPort!=='string'||typeof c.bPort!=='string')))return unchanged('Invalid required connection contract; no ordering was attempted.');
 const stock=partCounts(parts);
 let frames:Frame[];
 try{frames=parts.map(frame);}catch(e){return unchanged(`Unsupported native geometry; no ordering was attempted: ${(e as Error).message}`);}
 let portWork=0,solidWork=0;
 for(let i=0;i<count;i++)for(let j=0;j<i;j++){
  portWork+=frames[i].ports.length*frames[j].ports.length;
  solidWork+=frames[i].solids.length*frames[j].solids.length;
 }
 if(Array.isArray(original.requiredContacts))for(const c of original.requiredContacts)portWork+=(frames[c?.a]?.ports.length??0)*(frames[c?.b]?.ports.length??0);
 if(portWork>MAX_PORT_WORK||solidWork>MAX_SOLID_WORK)return unchanged('Native contact/solid work exceeds the instruction planner budget; this sequence was left unchanged.');
 const min=[0,1,2].map(a=>Math.min(...frames.map(f=>f.bounds.min[a]))),max=[0,1,2].map(a=>Math.max(...frames.map(f=>f.bounds.max[a])));
 if(max.some((v,a)=>v-min[a]>24*20+EPS))return unchanged('Actual geometry exceeds the 24-stud axis limit; no ordering was attempted.');
 let issues:ReturnType<typeof constructionIssues>;
 try{issues=constructionIssues(original,stock,24);}catch(e){return unchanged(`Native construction validation failed: ${(e as Error).message}`);}
 const invalid=issues.filter(i=>!earlierOnly(i.message));
 if(invalid.length)return unchanged(`Native construction is invalid; no geometry or gate was repaired: ${invalid.slice(0,3).map(i=>i.message).join(' ')}`);

 const links:Link[][]=parts.map(()=>[]),before:Set<number>[]=parts.map(()=>new Set<number>()),projected=frames.map(f=>f.solids.map(projection));
 const ground=frames.map(f=>Math.abs(f.bounds.min[2])<EPS);
 for(let i=0;i<count;i++)for(let j=0;j<i;j++){
  for(const [a,b]of connectionPairs(frames[i],frames[j])){
   links[i].push({other:j,own:a,otherPort:b});links[j].push({other:i,own:b,otherPort:a});
   const pa=frames[i].ports.find(p=>p.id===a)!,pb=frames[j].ports.find(p=>p.id===b)!;
   // Also capture a real underside mate when stepped/oriented bodies have
   // overlapping z envelopes. This changes ordering only, never mating rules.
   if(pa.kind==='grip'&&pa.normal[2]<-.5)before[i].add(j);
   if(pb.kind==='grip'&&pb.normal[2]<-.5)before[j].add(i);
  }
  for(const a of projected[i])for(const b of projected[j]){
   if(a.maxZ<=b.minZ+EPS&&overlaps(a.points,b.points))before[j].add(i);
   if(b.maxZ<=a.minZ+EPS&&overlaps(a.points,b.points))before[i].add(j);
  }
 }
 const inside=frames.map(f=>Math.min((f.bounds.min[0]+f.bounds.max[0])/2-min[0],max[0]-(f.bounds.min[0]+f.bounds.max[0])/2,(f.bounds.min[1]+f.bounds.max[1])/2-min[1],max[1]-(f.bounds.min[1]+f.bounds.max[1])/2));
 const compare=(a:number,b:number)=>frames[a].bounds.min[2]-frames[b].bounds.min[2]||inside[b]-inside[a]||frames[a].bounds.max[2]-frames[b].bounds.max[2]||a-b;
 const placed=new Set<number>(),groups:number[][]=[];
 const available=(i:number)=>ground[i]||links[i].some(e=>placed.has(e.other));
 const clear=(i:number,group:Set<number>)=>[...before[i]].every(p=>placed.has(p)||group.has(p));

 // Connect cover prerequisites through as-yet-unplaced actual mating edges.
 // Expansion is monotonic and hard-capped at eight pieces, never arbitrary
 // grouping of disconnected pieces just to disguise an underside operation.
 function section(seed:number):number[]|undefined {
  const group=new Set([seed]);
  for(let pass=0;pass<MAX_SECTION;pass++){
   const required=[...group].flatMap(i=>[...before[i]].filter(p=>!placed.has(p)&&!group.has(p))).sort(compare);
   if(!required.length){
    const order=[seed],seen=new Set(order);
    while(order.length<group.size){
     const next=[...group].filter(i=>!seen.has(i)&&links[i].some(e=>seen.has(e.other))).sort(compare)[0];
     if(next===undefined)return;
     seen.add(next);order.push(next);
    }
    return order;
   }
   for(const target of required){
    if(group.has(target))continue;
    const queue=[...group],parent=new Map<number,number|null>(queue.map(i=>[i,null]));
    for(let q=0;q<queue.length&&!parent.has(target);q++){
     const at=queue[q];
     for(const next of [...new Set(links[at].map(e=>e.other))].filter(i=>!placed.has(i)).sort(compare))if(!parent.has(next)){parent.set(next,at);queue.push(next);}
    }
    if(!parent.has(target))return;
    let at:number|null=target;
    while(at!==null){group.add(at);if(group.size>MAX_SECTION)return;at=parent.get(at)??null;}
   }
  }
 }
 while(placed.size<count){
  const ready=parts.map((_,i)=>i).filter(i=>!placed.has(i)&&available(i)).sort(compare);
  const one=ready.find(i=>clear(i,new Set()));
  let next=one===undefined?undefined:[one];
  if(!next){
   const choices=ready.flatMap(seed=>{const group=section(seed);return group?[group]:[];});
   choices.sort((a,b)=>a.length-b.length||compare(a[0],b[0]));next=choices[0];
  }
  if(!next)return unchanged('A lower/cover dependency could not be resolved as a connected section of at most eight pieces. The original order needs manual assembly planning; no geometry was changed.');
  groups.push(next);next.forEach(i=>placed.add(i));
 }

 const order=groups.flat(),newIndex=new Map(order.map((old,index)=>[old,index])),steps:Step[]=[];
 const done=new Set<number>();let subassemblies=0;
 function parent(i:number){
  return links[i].filter(e=>done.has(e.other)).sort((a,b)=>{
   const ap=frames[a.other].ports.find(p=>p.id===a.otherPort)!,bp=frames[b.other].ports.find(p=>p.id===b.otherPort)!;
   return bp.normal[2]-ap.normal[2]||newIndex.get(a.other)!-newIndex.get(b.other)!||a.otherPort.localeCompare(b.otherPort)||a.own.localeCompare(b.own);
  })[0];
 }
 for(const group of groups){
  const root=group[0],link=parent(root);let caption:string;
  if(group.length>1){
   subassemblies++;
   // The independent, off-model sequence starts low/inside. It need not share
   // the anchor-first flattening required by the final native validator.
   const local=[...group].sort(compare).slice(0,1),built=new Set(local),directions=[`1) Start with ${parts[local[0]].partId}.`];
   while(local.length<group.length){
    const pending=group.filter(i=>!built.has(i)&&links[i].some(e=>built.has(e.other)));
    const unmet=(i:number)=>[...before[i]].filter(p=>group.includes(p)&&!built.has(p)).length;
    const child=pending.sort((a,b)=>unmet(a)-unmet(b)||compare(a,b))[0];
    const edge=links[child].filter(e=>built.has(e.other)).sort((a,b)=>local.indexOf(a.other)-local.indexOf(b.other)||a.otherPort.localeCompare(b.otherPort)||a.own.localeCompare(b.own))[0];
    directions.push(`${local.length+1}) Attach ${parts[child].partId} using ${edge.own} to section piece ${local.indexOf(edge.other)+1} at ${edge.otherPort}.`);
    local.push(child);built.add(child);
   }
   const attach=ground[root]?`Then place the section on the table in the shown position.`:`Then attach section piece ${local.indexOf(root)+1} (${parts[root].partId}, ${link.own}) to main-model part ${newIndex.get(link.other)!+1} (${parts[link.other].partId}) at ${link.otherPort}.`;
   caption=`Preassemble these ${group.length} connected pieces separately. ${directions.join(' ')} Keep their shown relative poses. ${attach}`;
  }else if(ground[root])caption=`Place ${parts[root].partId} on the table at its shown relative position.`;
  else caption=`Attach ${parts[root].partId} using ${link.own} to earlier part ${newIndex.get(link.other)!+1} at ${link.otherPort}. Keep the shown orientation.`;
  steps.push({caption,parts:group.map(i=>structuredClone(parts[i]))});group.forEach(i=>done.add(i));
 }
 const result:Build={...original,steps,...(original.requiredContacts?{requiredContacts:original.requiredContacts.map(c=>({...c,a:newIndex.get(c.a)!,b:newIndex.get(c.b)!}))}:{})};
 const finalIssues=constructionIssues(result,stock,24);
 if(finalIssues.length)return unchanged(`The proposed order did not pass unchanged native validation; the original sequence was retained: ${finalIssues.slice(0,3).map(i=>i.message).join(' ')}`);
 return {build:result,reorderedParts:order.filter((old,index)=>old!==index).length,subassemblies,
  notices:subassemblies?['Small sections are preassembled before attachment. Nominal solids and actual contacts were checked; moving clearance and real stability were not simulated.']:[]};
}
