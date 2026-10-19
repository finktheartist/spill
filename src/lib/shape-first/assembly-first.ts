/** Choose and review complete module arrangements. The model never invents individual brick coordinates. */
import { partCount, parsePartId, type Build } from '../bricks';
import { constructionIssues } from '../construction';
import { geometryFingerprint } from '../library-discoveries';
import { aircraftModulePlans, aircraftCompositionIssues } from '../assembly-composer/aircraft';
import { searchModuleCompositions } from '../assembly-composer/compose';
import type { AssemblyComposition } from '../assembly-composer/types';
import { frame } from '../connections';
import type { FeatureReceipt } from '../moc-feature-edit';
import { constructionKnowledgeText } from '../build-atlas/guidance';
import { generate, type RankedIdea } from './pipeline';
import { appearanceIsBetter } from './appearance';
import type { ShapeVerdict } from './run';

export const assemblySubject=(name:string)=>/\b(?:seaplane|floatplane)\b|\bfloat plane\b/i.test(name);
export interface AssemblyFirstResult {
  build:Build; features:FeatureReceipt[]; composition:AssemblyComposition; verdict:ShapeVerdict;
  revised:boolean; reviewed:number;
}
interface Options {
  signal?:AbortSignal; minParts:number; views:(build:Build)=>string[];
  judge:(build:Build,idea:RankedIdea,signal?:AbortSignal)=>Promise<ShapeVerdict>;
  onProgress?:(text:string)=>void; debug?:(label:string,data:unknown)=>void;
}
const strong=(v:ShapeVerdict)=>v.named&&v.recognizable>=4&&v.complete>=4&&v.impressive>=4&&v.colors>=3;
const inline=(url:string)=>{
  const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(url);
  if(!match)throw Error('Assembly selection needs actual rendered views.');
  return {inlineData:{mimeType:match[1],data:match[2]}};
};

/** Give the visual selector different proportions and mounting heights rather than the first four loop variants. */
export function assemblyMenu(candidates:AssemblyComposition[],limit=4):AssemblyComposition[] {
  const seen=new Set<string>();
  const distinct=candidates.filter(c=>{const key=geometryFingerprint(c.build);if(seen.has(key))return false;seen.add(key);return true;});
  if(distinct.length<=limit)return distinct;
  const roles=[...new Set(distinct.flatMap(c=>c.receipts.map(r=>r.role)))].sort();
  const vectors=distinct.map(c=>{
    const parts=c.build.steps.flatMap(s=>s.parts),all=parts.map(frame);
    const origin=[0,1,2].map(a=>(Math.min(...all.map(f=>f.bounds.min[a]))+Math.max(...all.map(f=>f.bounds.max[a])))/40);
    return roles.flatMap(role=>{
      const r=c.receipts.find(r=>r.role===role);
      if(!r)return [0,0,0,0,0,0,0];
      const ff=r.indices.map(i=>all[i]);
      return [1,...[0,1,2].flatMap(a=>{const lo=Math.min(...ff.map(f=>f.bounds.min[a]))/20,hi=Math.max(...ff.map(f=>f.bounds.max[a]))/20;return [hi-lo,(hi+lo)/2-origin[a]];})];
    });
  });
  const ranges=vectors[0].map((_,i)=>Math.max(...vectors.map(v=>v[i]))-Math.min(...vectors.map(v=>v[i])));
  const distance=(a:number,b:number)=>vectors[a].reduce((sum,n,i)=>sum+(ranges[i]>1e-6?((n-vectors[b][i])/ranges[i])**2:0),0);
  const selected=[0];
  while(selected.length<limit){let next=-1,best=-1;for(let i=0;i<distinct.length;i++){if(selected.includes(i))continue;const score=Math.min(...selected.map(j=>distance(i,j)));if(score>best){best=score;next=i;}}if(next<0)break;selected.push(next);}
  return selected.sort((a,b)=>a-b).map(i=>distinct[i]);
}

export async function buildAssemblyFirst(idea:RankedIdea,stock:Record<string,number>,opts:Options):Promise<AssemblyFirstResult|null> {
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  if(!assemblySubject(idea.name))return null;
  opts.onProgress?.('Matching wings, fuselage, tail and floats against one parts budget…');
  const plans=aircraftModulePlans(stock,idea.name);
  const found=searchModuleCompositions(plans,stock,{minParts:opts.minParts,maxParts:80,limit:64,maxAttempts:3000,maxMillis:3000,
    validate:c=>aircraftCompositionIssues(c,idea.name)});
  if(opts.signal?.aborted)throw new DOMException('Stopped','AbortError');
  // When the pile supports both widened wing panels and paired fairings, spend review
  // attempts on those complete functional alternatives before repeating stripped wings.
  const functional=found.candidates.filter(c=>{
    const parts=c.build.steps.flatMap(s=>s.parts);
    return ['wing-left','wing-right'].every(role=>{
      const r=c.receipts.find(r=>r.role===role),kinds=r?.indices.map(i=>parsePartId(parts[i].partId)?.type)??[];
      return kinds.filter(k=>k==='plate').length>=2&&kinds.includes('curve');
    });
  });
  const choices=assemblyMenu(functional.length>=2?functional:found.candidates);
  opts.debug?.('assemblyDiscovery',{plans:plans.length,attempts:found.attempts,rejected:found.rejected,exhausted:found.exhausted,legal:found.candidates.length,functional: functional.length,distinct:choices.length,
    choices:choices.map(c=>({id:c.plan.id,parts:partCount(c.build),roles:c.receipts.map(r=>r.role),size:c.size}))});
  if(!choices.length)return null;
  const ctl=new AbortController(),stop=()=>ctl.abort();opts.signal?.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(stop,480000),active=()=>{if(ctl.signal.aborted||opts.signal?.aborted)throw new DOMException('Stopped','AbortError');};
  const tried=new Set<number>();let best:AssemblyFirstResult|undefined,reviewed=0;
  try {
    for(let round=0;round<Math.min(3,choices.length);round++) {
      active();const available=choices.map((candidate,index)=>({candidate,index})).filter(c=>!tried.has(c.index));
      let chosen=available[0];
      if(available.length>1) {
        opts.onProgress?.(round?'Choosing a different complete arrangement from the visual review…':'Choosing the complete arrangement and proportions…');
        const menu=available.map(({candidate:c,index})=>({id:`layout-${index+1}`,parts:partCount(c.build),size:c.size,modules:c.receipts.map(r=>({role:r.role,cost:r.cost}))}));
        const content:{role:'user'|'model';parts:Record<string,unknown>[]}[]=[{role:'user',parts:[
          {text:`Choose the best complete LEGO ${idea.name}: ${idea.pitch}. ${constructionKnowledgeText(idea)} These alternatives are already assembled from immutable modules and checked for actual stock, mating connectors, collisions and the subject's proportions. Select one offered layout ID; do not invent individual brick placements, add scenery or pad the part count. Favor a clear aircraft outline, thin long wings, separated narrow floats, identifiable tail and cockpit, and coherent color grouping. Each arrangement uses its own copy of the same pile; the layouts are alternatives, not simultaneous builds. ${best?`The retained candidate's blind reviewer saw ${JSON.stringify(best.verdict.looksLike)}. Its fixes: ${JSON.stringify(best.verdict.fixes)}. Pick an UNTRIED arrangement that addresses the large silhouette weaknesses.`:''}\nMENU: ${JSON.stringify(menu)}`},
          ...available.flatMap(({candidate,index})=>[{text:`LAYOUT ${index+1}`},...opts.views(candidate.build).map(inline)]),
        ]}];
        let selected=false;
        for(let attempt=0;attempt<2;attempt++) {
          active();const reply=await generate<{choiceId:string;reason:string}>(content,{type:'OBJECT',required:['choiceId','reason'],properties:{choiceId:{type:'STRING',enum:menu.map(m=>m.id)},reason:{type:'STRING'}}},ctl.signal);active();
          const match=available.find(c=>`layout-${c.index+1}`===reply.json?.choiceId);
          if(match&&typeof reply.json.reason==='string'&&reply.json.reason.trim()){chosen=match;selected=true;opts.debug?.('assemblySelection',{round,id:chosen.candidate.plan.id,reason:reply.json.reason});break;}
          content.push(reply.content,{role:'user',parts:[{text:'Nothing changed. Select one offered layout ID exactly and provide a short reason. No other layout is available.'}]});
        }
        if(!selected)throw Error('No offered complete layout was selected after one repair.');
      }
      active();tried.add(chosen.index);
      const c=chosen.candidate,parts=partCount(c.build),issues=[...constructionIssues(c.build,stock,24).map(i=>i.message),...aircraftCompositionIssues(c,idea.name)];
      if(parts<opts.minParts||parts>80)issues.push(`Complete model needs ${opts.minParts}–80 purposeful parts.`);
      if(issues.length)throw Error(`The composed model changed before review: ${issues.join('; ')}`);
      opts.onProgress?.('Reviewing the complete assembled model without its label…');
      const verdict=await opts.judge(c.build,idea,ctl.signal);active();reviewed++;
      const candidate:AssemblyFirstResult={build:{...c.build,name:idea.name,description:idea.pitch},composition:c,verdict,revised:round>0,reviewed,
        features:c.receipts.map(r=>({id:r.id,studyId:`assembly:${r.role}`,choiceId:r.optionId,cost:r.cost,indices:r.indices}))};
      opts.debug?.('assemblyCandidate',{round,...candidate});
      if(!best||appearanceIsBetter(best.verdict,verdict))best=candidate;
      if(strong(best.verdict))break;
    }
    if(!best)throw Error('No complete assembly was reviewed.');
    return {...best,reviewed};
  }catch(e){
    if(opts.signal?.aborted)throw e;
    if(best){opts.debug?.('assemblyRevisionStopped',{reason:(e as Error).message});opts.onProgress?.('Further arrangements could not be reviewed; keeping the reviewed model.');return {...best,reviewed};}
    if(ctl.signal.aborted)throw Error('Complete assembly review timed out.');throw e;
  }finally{clearTimeout(timer);opts.signal?.removeEventListener('abort',stop);}
}
