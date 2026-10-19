/** Atomic local replacement with compiled study assemblies. Unedited parts never move or recolor. */
import { partCount, type Build, type Placed } from './bricks';
import { attachPart, connectionPairs, frame, validateConnections, type RequiredContact } from './connections';
import { FEATURE_STUDIES, featureChoices, type FeatureChoice } from './moc-features';

export interface FeatureAddition { id: string; choiceId: string; parent: string; parentPort: string; childPort: string; twist: number }
export interface FeaturePatch { focus: string; remove: number[]; add: FeatureAddition[] }
export interface FeatureReceipt { id: string; studyId: string; choiceId: string; cost: Record<string,number>; indices: number[] }
export interface FeatureEdit { build: Build; receipts: FeatureReceipt[]; removed: number[]; added: number; focus: string }
export const FEATURE_PATCH_SCHEMA = {
  type:'OBJECT', required:['focus','remove','add'], properties:{
    focus:{type:'STRING'}, remove:{type:'ARRAY',items:{type:'INTEGER'}},
    add:{type:'ARRAY',items:{type:'OBJECT',required:['id','choiceId','parent','parentPort','childPort','twist'],properties:{
      id:{type:'STRING'},choiceId:{type:'STRING'},parent:{type:'STRING'},parentPort:{type:'STRING'},childPort:{type:'STRING'},twist:{type:'NUMBER'},
    }}},
  },
};

/** Reorder only the instruction sequence: geometry stays exact, and every added component is assembled on a
 * preceding part. This also permits replacement of a support below an unchanged head. */
function assemblyOrder(parts: Placed[], names:Map<string,number>) {
  const frames = parts.map(frame), links = parts.map(() => [] as number[]);
  for(let i=0;i<parts.length;i++)for(let j=0;j<i;j++)if(connectionPairs(frames[i],frames[j]).length){links[i].push(j);links[j].push(i);}
  const first = frames.findIndex(f => Math.abs(f.bounds.min[2])<1e-5);
  if(first<0)throw Error('No part stands on the ground.');
  const order=[first],seen=new Set(order),from=new Map([[first,-1]]);
  for(let p=0;p<order.length;p++)for(const i of links[order[p]])if(!seen.has(i)){seen.add(i);order.push(i);from.set(i,order[p]);}
  if(order.length!==parts.length){const labels=new Map([...names].map(([name,i])=>[i,name]));throw Error(`The replacement leaves disconnected pieces: ${parts.flatMap((p,i)=>seen.has(i)?[]:[`${labels.get(i)} (${p.partId})`]).join(', ')}. Explicitly remove these affected pieces too, or restore their connection; do not abandon the intended feature merely because its donor region needs repair.`);}
  return {order,from};
}

export function applyFeaturePatch(original: Build, patch: FeaturePatch, stock: Record<string,number>, choices: FeatureChoice[], minParts=20): FeatureEdit {
  const old=original.steps.flatMap(s=>s.parts);
  if(!patch || typeof patch.focus!=='string' || !patch.focus.trim() || patch.focus.length>1000 || !Array.isArray(patch.remove) || !Array.isArray(patch.add))throw Error('Describe one local repair and provide remove/add arrays.');
  const removed=new Set(patch.remove);
  if(removed.size!==patch.remove.length || patch.remove.some(i=>!Number.isSafeInteger(i)||i<0||i>=old.length))throw Error('Removal indices must be unique current part indices.');
  if(removed.size>Math.min(12,Math.ceil(old.length*.35)))throw Error('Change at most 35% of the current parts, up to twelve. Keep the successful structure.');
  if(patch.add.length>4 || (!removed.size&&!patch.add.length))throw Error('Use at most four feature assemblies, or remove distracting detail. An empty patch changes nothing.');
  if(original.requiredContacts?.some(c=>removed.has(c.a)||removed.has(c.b)))throw Error('Do not remove a part locked by an existing required-contact contract.');
  const parts:Placed[]=[],captions:string[]=[],names=new Map<string,number>(),contacts:RequiredContact[]=[],receipts:FeatureReceipt[]=[];
  old.forEach((p,i)=>{if(!removed.has(i)){names.set(`p${i}`,parts.length);parts.push(structuredClone(p));captions.push('');}});
  for(const c of original.requiredContacts??[])contacts.push({...c,a:names.get(`p${c.a}`)!,b:names.get(`p${c.b}`)!});
  let added=0;
  const usedIds=new Set<string>();
  for(const a of patch.add){
    if(!a || !/^[a-z][a-z0-9_]{0,24}$/.test(a.id) || usedIds.has(a.id))throw Error('Every added assembly needs a unique simple lowercase id.');
    usedIds.add(a.id);
    const choice=choices.find(c=>c.id===a.choiceId);
    if(!choice)throw Error('Choose an offered, stock-bound feature ID.');
    if(![-180,-90,0,90,180].includes(a.twist))throw Error('Turn the complete assembly by a quarter turn; its internal recipe preserves any exact non-grid angle.');
    const host=names.get(a.parent);
    if(host===undefined)throw Error(`Parent ${a.parent} is removed, unavailable, or not yet assembled.`);
    const start=parts.length;
    added+=choice.program.operations.length;
    if(added>16)throw Error('Add at most sixteen physical parts.');
    choice.program.operations.forEach((op,i)=>{
      const p=i ? attachPart(parts[start+op.parent],op.parentPort,op.partId,op.childPort,op.twist) : attachPart(parts[host],a.parentPort,op.partId,a.childPort,a.twist);
      names.set(`${a.id}:${i}`,parts.length);parts.push(p);
      captions.push(choice.name);
    });
    for(const c of choice.program.requiredContacts??[])contacts.push({...c,a:c.a+start,b:c.b+start});
    receipts.push({id:a.id,studyId:choice.studyId,choiceId:choice.id,cost:{...choice.cost},indices:choice.program.operations.map((_,i)=>i+start)});
  }
  if(parts.length<minParts || parts.length>160)throw Error(`Keep ${minParts}–160 purposeful parts in the complete model.`);
  const labels=new Map([...names].map(([name,i])=>[i,name]));
  const explain=(issue:{message:string;parts:Placed[]})=>`${issue.message} [${issue.parts.map(p=>labels.get(parts.indexOf(p))).filter(Boolean).join(', ')}]`;
  let assembly:ReturnType<typeof assemblyOrder>;
  try{assembly=assemblyOrder(parts,names);}catch(e){
    const raw:Build={...original,engine:'connections-v2',steps:parts.map(p=>({caption:'Pending',parts:[p]})),requiredContacts:contacts};
    const other=validateConnections(raw,stock,24).filter(i=>i.kind!=='floating'&&i.kind!=='loose').slice(0,5).map(explain);
    throw Error([(e as Error).message,...other].join(' '));
  }
  const {order,from}=assembly,index=new Map(order.map((i,j)=>[i,j]));
  const build:Build={name:original.name,description:original.description,engine:'connections-v2',steps:order.map((i,j)=>({caption:j===0?'Place the first piece flat on the table.':`${captions[i]?captions[i]+': ':''}Attach to the piece from step ${index.get(from.get(i)!)!+1}. Match the orientation shown.`,parts:[parts[i]]})),requiredContacts:contacts.map(c=>({...c,a:index.get(c.a)!,b:index.get(c.b)!}))};
  const issues=validateConnections(build,stock,24);
  if(issues.length)throw Error(issues.slice(0,8).map(explain).join(' '));
  const geometry=(ps:Placed[])=>JSON.stringify(ps.map(p=>{const f=frame(p);return [p.partId,...f.translation,...f.rotation].map(v=>typeof v==='number'?Math.round(v*1e6)/1e6:v);}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if(geometry(old)===geometry(parts))throw Error('The patch repeats the same geometry. Change the visible construction or keep the original.');
  for(const r of receipts)r.indices=r.indices.map(i=>index.get(i)!);
  return {build,receipts,removed:[...removed],added,focus:patch.focus};
}

export function featureEditContext(build:Build,stock:Record<string,number>,subject:string,colors?:string[]) {
  const parts=build.steps.flatMap(s=>s.parts),fs=parts.map(frame),used=new Map<number,Set<string>>(),neighbors=parts.map(()=>new Set<number>());
  for(let i=0;i<parts.length;i++)for(let j=0;j<i;j++)for(const [a,b] of connectionPairs(fs[i],fs[j])){
    neighbors[i].add(j);neighbors[j].add(i);
    if(!used.has(i))used.set(i,new Set());if(!used.has(j))used.set(j,new Set());used.get(i)!.add(a);used.get(j)!.add(b);
  }
  const choices=featureChoices(stock,subject,colors);
  const listing=parts.map((p,i)=>`p${i}: ${p.partId}, body min [${p.x},${p.y},${p.z}] (stud,stud,plate); local +x=[${[0,3,6].map(j=>+fs[i].rotation[j].toFixed(3))}], +y=[${[1,4,7].map(j=>+fs[i].rotation[j].toFixed(3))}]; connected to [${[...neighbors[i]].map(n=>`p${n}`).join(',')}]; ports ${fs[i].ports.filter(p=>p.kind==='stud'||!used.get(i)?.has(p.id)).map(c=>`${c.id}${used.get(i)?.has(c.id)?' (occupied; remove occupant first)':''}@[${c.point.map(x=>+(x/20).toFixed(2))}]`).join(' ')}`).join('\n');
  const have={...stock};for(const p of parts)have[p.partId]=(have[p.partId]??0)-1;
  return {choices,listing,remaining:Object.fromEntries(Object.entries(have).filter(([,n])=>n>0)),parts:partCount(build),lessons:[...new Set(choices.map(c=>FEATURE_STUDIES.find(s=>s.id===c.studyId)!.lesson))]};
}
