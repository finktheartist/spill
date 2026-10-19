import { roofModules, moduleApproved, roofModuleText, type RoofModule } from './roof-modules';
import roofReviews from './roof-module-reviews.json';
import {surfaceChoices,surfaceOperations,surfaceChoiceText,SURFACE_SOURCE,type SurfaceChoice} from './surface-modules';
import { isMade } from './catalog';
import { heightOf, parsePartId, type Build } from './bricks';
import { add, apply, axisAngle, compileConnections, definition, type ConnectionOperation, type ConnectionProgram, type RequiredContact } from './connections';

export const ANGLE_SOURCE='https://www.newelementary.com/2025/03/lego-building-at-angles-escaping-grid.html';
export interface AngleChoice {
  id:string;family:'rectangle-two-anchor';version:1;length:3|4|6;hand:1|-1;angle:number;
  panel:string;supports:[string,string];height:number;cost:Record<string,number>;hosts:string[];
}
export type ConstructionChoice=AngleChoice|SurfaceChoice|RoofModule;
export const constructionChoices=(stock:Record<string,number>):ConstructionChoice[]=>[...roofModules(stock).filter(m=>moduleApproved(m,roofReviews)),...surfaceChoices(stock),...angleChoices(stock)];
export const constructionChoiceText=(choices:ConstructionChoice[])=>[roofModuleText(choices.filter((c):c is RoofModule=>c.family==='gable-roof')),surfaceChoiceText(choices.filter((c):c is SurfaceChoice=>c.family==='bracket-face'||c.family==='sideways-taper')),angleChoiceText(choices.filter((c):c is AngleChoice=>c.family==='rectangle-two-anchor'))].filter(Boolean).join('\n');
export const architecturalRoofSubject=(name:string)=>/\b(house|gatehouse|gateway|cottage|cabin|kiosk|building|tower|station|shelter|pavilion|gazebo)\b/i.test(name);
export const subjectConstructionChoices=(stock:Record<string,number>,name:string)=>constructionChoices(stock).filter(c=>c.family!=='gable-roof'||architecturalRoofSubject(name));
export interface PartCommand {kind:'part';id:string;partId:string;parent:string;parentPort:string;childPort:string;twist:number}
export interface TechniqueCommand {kind:'technique';id:string;choiceId:string;parent:string;parentPort:string;childPort?:string;twist:number}
export interface TechniqueProgram {name:string;description:string;operations:(PartCommand|TechniqueCommand)[]}
export interface TechniqueReceipt {id:string;choiceId:string;family:string;source:string;host:number;parts:number[];angle:number}
export interface CompiledTechniques {program:ConnectionProgram;receipts:TechniqueReceipt[];lockedOperations:Set<number>;remaining:Record<string,number>}

const count=(ids:string[])=>{const result:Record<string,number>={};for(const id of ids)result[id]=(result[id]??0)+1;return result;};
const supported=(stock:Record<string,number>)=>Object.keys(stock).filter(id=>{
  try{return Number.isSafeInteger(stock[id])&&stock[id]>0&&isMade(id)&&!!definition(parsePartId(id)!);}catch{return false;}
}).sort();
const stud=(id:string,port:string)=>definition(parsePartId(id)!).ports.find(p=>p.id===port&&p.kind==='stud');

/** Bind source-grounded geometry to real stock. These are independent choices, not
 * simultaneous reservations. Compilation below owns the common inventory ledger. */
export function angleChoices(stock:Record<string,number>,limit=18):AngleChoice[]{
  const ids=supported(stock),supportIds=ids.filter(id=>{
    const k=parsePartId(id)!;return k.w===1&&k.d===1&&['plate','roundplate','brick','roundbrick'].includes(k.type);
  });
  const pairs=supportIds.flatMap((a,i)=>supportIds.slice(i).flatMap(b=>{
    const h=heightOf(parsePartId(a)!);
    return h===heightOf(parsePartId(b)!)&&(a!==b||stock[a]>=2)?[{ids:[a,b] as [string,string],h}]:[];
  })).sort((a,b)=>a.h-b.h||Number(a.ids[0]!==a.ids[1])-Number(b.ids[0]!==b.ids[1])||a.ids.join().localeCompare(b.ids.join()));
  const choices:AngleChoice[]=[];
  // Round robin across sizes before alternate palettes/heights. IDs remain stable
  // for a fixed stock snapshot; the agent receives exactly this bounded catalog.
  for(let variant=0;variant<3;variant++)for(const length of [3,4,6] as const){
    const panels=ids.filter(id=>id.startsWith(`plate-2x${length}-`));
    const pair=pairs[Math.min(variant,pairs.length-1)],panel=panels[Math.min(variant,panels.length-1)];
    if(!pair||!panel)continue;
    const cost=count([panel,...pair.ids]);
    if(Object.entries(cost).some(([id,n])=>stock[id]<n))continue;
    const hosts=ids.filter(id=>stock[id]>(cost[id]??0)&&stud(id,`stud:${length-1}:1`)&&stud(id,'stud:0:0'));
    if(!hosts.length)continue;
    for(const hand of [1,-1] as const){
      if(choices.some(c=>c.panel===panel&&c.supports.join()===pair.ids.join()&&c.hand===hand))continue;
      choices.push({id:`angle-${choices.length+1}`,family:'rectangle-two-anchor',version:1,length,hand,angle:hand*2*Math.atan(1/(length-1))*180/Math.PI,panel,supports:pair.ids,height:pair.h,cost,hosts});
      if(choices.length>=limit)return choices;
    }
  }
  return choices;
}

export function angleChoiceText(choices:AngleChoice[]):string {
  return choices.map(c=>`${c.id}: ${c.length}×2 angled panel, ${c.angle.toFixed(3)}°, support height ${c.height} plate(s). Reserves ${JSON.stringify(c.cost)}. Example compatible hosts: ${c.hosts.slice(0,8).join(', ')}. Pattern from host parentPort: second support at origin; first support offset (${c.length-1},${c.hand}) studs before twist. Output ${'ID'}.panel has local studs x0..${c.length-1}, y0..1.`).join('\n');
}

const identifier=(id:unknown)=>typeof id==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(id);
/** Expand a trusted technique into ordinary attachment operations. The language
 * model chooses its purpose/host, not guessed angles or support positions. */
export function expandTechniques(raw:TechniqueProgram,stock:Record<string,number>,choices:ConstructionChoice[],requiredChoice?:string):CompiledTechniques {
  if(!raw||typeof raw.name!=='string'||raw.name.length>80||typeof raw.description!=='string'||raw.description.length>1000||!Array.isArray(raw.operations)||!raw.operations.length||raw.operations.length>60)throw Error('Provide a short name, description and 1–60 named construction commands.');
  const operations:ConnectionOperation[]=[],contacts:RequiredContact[]=[],receipts:TechniqueReceipt[]=[],lockedOperations=new Set<number>(),names=new Map<string,number>(),ids=new Set<string>(),left={...stock};
  const reserved:Record<string,number>={};
  for(const command of raw.operations)if(command?.kind==='technique'){
    const choice=choices.find(c=>c.id===command.choiceId);
    if(!choice)throw Error(`Unknown or unavailable technique ${command.choiceId}.`);
    for(const [id,n]of Object.entries(choice.cost))reserved[id]=(reserved[id]??0)+n;
  }
  for(const [id,n]of Object.entries(reserved))if((stock[id]??0)<n)throw Error(`Not enough actual stock for reserved construction: ${id}.`);
  const reserve=(id:string,technique=false)=>{if(!Number.isSafeInteger(left[id])||left[id]-(technique?0:(reserved[id]??0))<1||!isMade(id))throw Error(`Not enough unreserved actual stock for ${id}.`);left[id]--;if(technique)reserved[id]--;};
  const parent=(name:unknown)=>{if(typeof name!=='string'||!names.has(name))throw Error(`Parent ${String(name)} must name an earlier part or technique output.`);return names.get(name)!;};
  const put=(op:ConnectionOperation,technique=false)=>{if(operations.length>=60)throw Error('Expanded construction exceeds 60 pieces.');reserve(op.partId,technique);operations.push(op);return operations.length-1;};
  for(const command of raw.operations){
    if(!command||!identifier(command.id)||ids.has(command.id))throw Error('Every construction command needs a unique simple id.');
    ids.add(command.id);
    if(command.kind==='part'){
      if(typeof command.partId!=='string'||typeof command.parentPort!=='string'||typeof command.childPort!=='string'||!Number.isFinite(command.twist))throw Error(`Incomplete part command ${command.id}.`);
      const index=operations.length;
      if(!index&&(command.parent!==''||command.parentPort!==''||command.childPort!==''||command.twist!==0))throw Error('Start with an upright part using empty parent/ports and twist 0.');
      const p=index?parent(command.parent):-1;
      names.set(command.id,put({partId:command.partId,parent:p,parentPort:command.parentPort,childPort:command.childPort,twist:command.twist}));
    }else if(command.kind==='technique'){
      const choice=choices.find(c=>c.id===command.choiceId);
      if(!choice)throw Error(`Unknown or unavailable technique ${command.choiceId}.`);
      if(![0,90,180,270,-90,-180].includes(command.twist))throw Error('Technique twist rotates its complete anchor pattern by a quarter turn.');
      const turn=((command.twist+540)%360)-180;
      const host=parent(command.parent),hostId=operations[host].partId,base=stud(hostId,command.parentPort);
      if(!base||!base.normal.every((v,i)=>v===Number(i===2)))throw Error('Choose an existing top stud on the host; its world orientation may be sideways.');
      if(choice.family==='gable-roof'){
        const start=operations.length;
        const grip=command.childPort||'grip:0:0';
        if(!definition(parsePartId(choice.program.operations[0].partId)!).ports.some(p=>p.id===grip&&p.kind==='grip'))throw Error('Choose an actual bottom grip on the roof carrier.');
        const indexes=choice.program.operations.map((op,i)=>put(i?{...op,parent:op.parent+start}:{...op,parent:host,parentPort:command.parentPort,childPort:grip,twist:turn},true));
        for(const index of indexes)lockedOperations.add(index);
        names.set(`${command.id}.carrier`,indexes[0]);names.set(`${command.id}.ridge`,indexes.at(-1)!);
        receipts.push({id:command.id,choiceId:choice.id,family:choice.family,source:'Authored module; visual evidence in docs/shaping-audit.md',host,parts:indexes,angle:0});
        continue;
      }
      if(choice.family!=='rectangle-two-anchor'){
        const start=operations.length,ops=surfaceOperations(choice,host,command.parentPort,turn,start);
        const indexes=ops.map(op=>put(op,true));
        for(const [i,suffix] of ['mount','face'].entries()){names.set(`${command.id}.${suffix}`,indexes[i]);lockedOperations.add(indexes[i]);}
        contacts.push(...choice.contract.contacts.map(c=>({...c,a:c.a+start,b:c.b+start})));
        receipts.push({id:command.id,choiceId:choice.id,family:choice.family,source:SURFACE_SOURCE,host,parts:indexes,angle:choice.faceTwist});
        continue;
      }
      const delta=apply(axisAngle([0,0,1],command.twist),[(choice.length-1)*20,choice.hand*20,0]),point=add(base.point,delta);
      const first=definition(parsePartId(hostId)!).ports.find(p=>p.kind==='stud'&&p.normal.every((v,i)=>v===base.normal[i])&&p.point.every((v,i)=>Math.abs(v-point[i])<1e-5));
      if(!first)throw Error(`${command.id}: the host has no stud at the other end of the ${choice.length-1}×${choice.hand} anchor pattern. Choose another origin, quarter turn or larger host.`);
      const a=put({partId:choice.supports[0],parent:host,parentPort:first.id,childPort:'grip:0:0',twist:turn},true);
      const b=put({partId:choice.supports[1],parent:host,parentPort:base.id,childPort:'grip:0:0',twist:turn},true);
      const panel=put({partId:choice.panel,parent:a,parentPort:'stud:0:0',childPort:`grip:${choice.length-1}:${choice.hand===1?0:1}`,twist:choice.angle},true);
      contacts.push({a,b:panel,aPort:'stud:0:0',bPort:`grip:${choice.length-1}:${choice.hand===1?0:1}`},{a:b,b:panel,aPort:'stud:0:0',bPort:`grip:0:${choice.hand===1?1:0}`});
      for(const [suffix,index]of [['supportA',a],['supportB',b],['panel',panel]] as const){names.set(`${command.id}.${suffix}`,index);lockedOperations.add(index);}
      receipts.push({id:command.id,choiceId:choice.id,family:choice.family,source:ANGLE_SOURCE,host,parts:[a,b,panel],angle:choice.angle});
    }else throw Error('Use part or technique commands only.');
  }
  if(requiredChoice&&!receipts.some(r=>r.choiceId===requiredChoice))throw Error('The chosen defining construction is missing. Replan explicitly instead of replacing it with ordinary blocks.');
  return {program:{name:raw.name,description:raw.description,operations,requiredContacts:contacts},receipts,lockedOperations,remaining:left};
}

export function compileTechniques(raw:TechniqueProgram,stock:Record<string,number>,choices=constructionChoices(stock),requiredChoice?:string):CompiledTechniques&{build:Build}{
  const expanded=expandTechniques(raw,stock,choices,requiredChoice);
  const build=compileConnections(expanded.program,stock);captionTechniques(build,expanded.receipts);
  return {...expanded,build};
}

export function captionTechniques(build:Build,receipts:TechniqueReceipt[]):void {
 for(const receipt of receipts){
  if(receipt.family==='gable-roof'){
   build.steps[receipt.parts[0]].caption='Place the roof carrier so it bridges the supports. '+build.steps[receipt.parts[0]].caption;
   for(const i of receipt.parts.slice(1,-1))build.steps[i].caption='Build the opposing sloped roof courses. '+build.steps[i].caption;
   build.steps[receipt.parts.at(-1)!].caption='Cap the two high rows with the smooth ridge tile.';
  }else if(receipt.family!=='rectangle-two-anchor'){
   build.steps[receipt.parts[0]].caption=`Mount for ${receipt.id}. ${build.steps[receipt.parts[0]].caption}`;
   build.steps[receipt.parts[1]].caption=`Fit the shaped face onto BOTH side studs of the bracket from step ${receipt.parts[0]+1}. Keep the space behind this surface clear.`;
  }else{
   build.steps[receipt.parts[0]].caption=`First support for ${receipt.id}. ${build.steps[receipt.parts[0]].caption}`;
   build.steps[receipt.parts[1]].caption=`Second support for ${receipt.id}. ${build.steps[receipt.parts[1]].caption}`;
   build.steps[receipt.parts[2]].caption=`Place the angled panel onto BOTH supports from steps ${receipt.parts[0]+1} and ${receipt.parts[1]+1}. Match the orientation shown; both connections must engage.`;
  }
 }
}

export const TECHNIQUE_PROGRAM_SCHEMA={type:'OBJECT',required:['name','description','operations'],properties:{name:{type:'STRING'},description:{type:'STRING'},operations:{type:'ARRAY',items:{type:'OBJECT',required:['kind','id','parent','parentPort','twist','partId','childPort','choiceId'],properties:{kind:{type:'STRING',enum:['part','technique']},id:{type:'STRING'},parent:{type:'STRING'},parentPort:{type:'STRING'},twist:{type:'NUMBER'},partId:{type:'STRING'},childPort:{type:'STRING'},choiceId:{type:'STRING'}}}}}};

export const TECHNIQUE_PROGRAM_BRIEF=`Use named construction commands. First command: kind="part", id="body", partId from stock, parent="", parentPort="", childPort="", twist=0. Later part commands use an EARLIER parent id, its compatible ports, and twist. Never numeric parent indices. Each id is unique: letters, digits, underscores or hyphens.
A part command needs partId and childPort, with choiceId="". A technique command needs a listed choiceId, parent, parentPort and quarter-turn twist, with partId="" and childPort="". Example shape: {kind:"technique",id:"chest",choiceId:"COPY AN AVAILABLE ID EXACTLY",parent:"body",parentPort:"stud:0:0",twist:0}. The compiler places every reserved piece; do not duplicate them.
PITCHED ROOF (gable-roof): a connected 4x4 module with opposing slope courses and a smooth ridge. Outputs ID.carrier and ID.ridge. Choose childPort="grip:x:y" on the carrier (x,y 0..3) and attach it to a supported top stud; its other bottom grips can engage further supports at the same height. Roof carrier top studs are occupied, and the ridge is smooth. All internal placements and colors are locked to the visually reviewed module. It is not a complete model or a general purpose replacement for animal/vehicle shaping.
MOUNTED SURFACES (bracket-face, sideways-taper): TWO pieces, outputs ID.mount and ID.face. Mount a bracket along the edge of a RAISED supporting brick. It hangs 12 LDU below the selected stud and needs clear space outside that edge. Both side studs must engage the face; the compiler locks these connections. The bracket also occupies the body's top studs: a later roof, head or core layer must attach ABOVE ID.mount, not to the now-covered body studs. Two adjacent brackets placed along the same edge can carry neighboring faces; brackets mounted on perpendicular faces can collide at the corner, so plan their backing separately. The slope's high side has exposed studs; a stocked tile-1x2 can finish that edge using ID.face parentPort="stud:0:1", childPort="grip:0:0", twist=0. It costs an additional real tile. Pair mirrored taper variants to form a bow or chest and check which ends project outward. Keep the cavity behind a face empty except for its support. There is no ID.panel output for this family.
TWO-ANCHOR ANGLES (rectangle-two-anchor): THREE pieces, outputs ID.supportA, ID.supportB and ID.panel. Origin parentPort and quarter-turn twist orient the entire anchor pattern on the host's LOCAL top face. Choose a host with BOTH required studs. The compiler supplies the non-quarter-turn panel angle. Descendants use ID.panel's unchanged local port ids and inherit its rotation. Keep both supports engaged and the panel clearance empty. There is no ID.face output for this family.
All copies compete for the same stock. Reserve repeated surfaces together before internal filler. The host is charged separately and should be part of the subject. There is no output named just ID: use a listed suffix. Only these registered constructions execute; hinges, clips and flexible tubes are not supported.`;
