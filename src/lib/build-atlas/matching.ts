import { CATALOG, parsePartId, type PartKind } from '../bricks';
import { isMade } from '../catalog';
import { pileColors, type ShapeIdea, type ShapeMode } from '../shape-first/pipeline';
import { explorationOrder, sameConcept, type IdeaFamily, type SeenIdea } from '../shape-first/discovery';
import { FEATURE_PARTS } from '../shape-first/program';
import { subjectWords } from '../construction-families';
import { BUILD_ATLAS } from './catalog';
import { profileSize } from './profiles';
import type { AtlasAssessment, BuildBrief } from './types';
import { assessSubjectOpportunity, createOpportunityContext, type OpportunityContext, type OpportunityContextOptions } from './opportunity';

interface AvailablePart {id:string;kind:PartKind;count:number}
const usable=(stock:Record<string,number>):AvailablePart[]=>Object.entries(stock).flatMap(([id,count])=>{
  const kind=parsePartId(id);return kind&&kind.type!=='wheel'&&kind.type!=='wheels'&&CATALOG[kind.type]?.includes(`${kind.w}x${kind.d}`)&&Number.isSafeInteger(count)&&count>0&&isMade(id)?[{id,kind,count}]:[];
});
/** Exact inventory opportunity; neither a complete construction nor a craft verdict. */
export function assessBrief(brief:BuildBrief,stock:Record<string,number>,context=createOpportunityContext(stock)):AtlasAssessment {
  const opportunity=assessSubjectOpportunity(brief,context),matched:AtlasAssessment['matched']=[];
  for(const r of opportunity.receipts)if(r.allocated>=r.requested)matched.push({name:r.name,count:r.requested,available:r.allocated,
    types:[...new Set(r.parts.map(p=>parsePartId(p.id)!.type))]});
  const missing=opportunity.blockers.map(b=>({name:b.name,count:b.required,available:b.available,substitution:b.detail}));
  return {brief,score:opportunity.score,coverage:opportunity.coverage,status:opportunity.status,matched,missing,
    palette:opportunity.palette,reasons:opportunity.reasons,opportunity};
}
export function assessAtlas(stock:Record<string,number>,briefs=BUILD_ATLAS,options:OpportunityContextOptions={}) {
  const context:OpportunityContext=createOpportunityContext(stock,options);
  return briefs.map(b=>assessBrief(b,stock,context));
}

export interface AtlasFilters {query?:string;family?:IdeaFamily;category?:string;fit?:'all'|'promising'|'adapt'|'needs-parts';relatedTo?:string;offset?:number;limit?:number}
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const identity=(b:BuildBrief)=>({name:b.name,discovery:{family:b.family,concept:b.name,form:b.silhouette}});
export function searchAssessments(assessments:AtlasAssessment[],filters:AtlasFilters={},history:SeenIdea[]=[]) {
  const tokens=subjectWords(norm(filters.query??'')),related=assessments.find(a=>a.brief.id===filters.relatedTo)?.brief;
  const matches=assessments.filter(a=>(!filters.family||a.brief.family===filters.family)&&(!filters.category||a.brief.categoryId===filters.category)&&
    (!filters.relatedTo||a.brief.id!==filters.relatedTo)&&(!filters.fit||filters.fit==='all'||a.status===filters.fit)&&
    tokens.every(t=>subjectWords(norm([a.brief.name,a.brief.category,...a.brief.tags,...a.brief.traits].join(' '))).includes(t)));
  const order=explorationOrder(history),categoryCounts=new Map<string,number>(),familyCounts=new Map<IdeaFamily,number>();
  const seen=new Set(history.length?matches.filter(a=>history.some(h=>sameConcept(identity(a.brief),h))).map(a=>a.brief.id):[]);
  const selected:AtlasAssessment[]=[];
  const similarity=(b:BuildBrief)=>related?Number(b.categoryId===related.categoryId)*30+Number(b.approaches[0].profile===related.approaches[0].profile)*20+Number(b.family===related.family)*12:0;
  const buckets=new Map<string,{priority:number[];groups:Map<string,AtlasAssessment[]>}>();
  for(const a of matches) {
    const tier=a.opportunity?(a.opportunity.tier==='blocked'?2:a.opportunity.tier==='scarce'?1:0):(a.status==='needs-parts'?2:a.status==='adapt'?1:0);
    const priority=[tier,-Math.floor(a.score/5),-similarity(a.brief),Number(seen.has(a.brief.id))],key=priority.join(':');
    if(!buckets.has(key))buckets.set(key,{priority,groups:new Map()});
    const groups=buckets.get(key)!.groups;if(!groups.has(a.brief.categoryId))groups.set(a.brief.categoryId,[]);groups.get(a.brief.categoryId)!.push(a);
  }
  const compare=(a:AtlasAssessment,b:AtlasAssessment)=>(!filters.family?(familyCounts.get(a.brief.family)??0)-(familyCounts.get(b.brief.family)??0)||order.indexOf(a.brief.family)-order.indexOf(b.brief.family):0)||
    (categoryCounts.get(a.brief.categoryId)??0)-(categoryCounts.get(b.brief.categoryId)??0)||b.score-a.score||a.brief.name.localeCompare(b.brief.name);
  const limit=Math.min(matches.length,Math.max(0,filters.offset??0)+Math.max(0,filters.limit??24));
  for(const bucket of [...buckets.values()].sort((a,b)=>a.priority[0]-b.priority[0]||a.priority[1]-b.priority[1]||a.priority[2]-b.priority[2]||a.priority[3]-b.priority[3])) {
    const heads=[...bucket.groups.values()].map(list=>({list:list.sort((a,b)=>b.score-a.score||a.brief.name.localeCompare(b.brief.name)),at:0}));
    while(heads.length&&selected.length<limit) {
      let best=0;for(let i=1;i<heads.length;i++)if(compare(heads[i].list[heads[i].at],heads[best].list[heads[best].at])<0)best=i;
      const group=heads[best],next=group.list[group.at++];selected.push(next);if(group.at===group.list.length)heads.splice(best,1);
      familyCounts.set(next.brief.family,(familyCounts.get(next.brief.family)??0)+1);categoryCounts.set(next.brief.categoryId,(categoryCounts.get(next.brief.categoryId)??0)+1);
    }
    if(selected.length>=limit)break;
  }
  return {total:matches.length,matches:selected.slice(filters.offset??0),catalogTotal:assessments.length};
}

export function ideaFromAssessment(a:AtlasAssessment,stock:Record<string,number>,approachId=a.brief.approaches[0].id,mode:ShapeMode='pile'):ShapeIdea {
  const supportedStock=Object.fromEntries(usable(stock).map(p=>[p.id,p.count]));
  const b=a.brief,[length,width,height]=profileSize(b.approaches[0].profile),covers=Object.fromEntries(pileColors(supportedStock).map(c=>[c.color,c.roundedCells]));
  const palette=mode==='shopping'?b.colors.map(p=>({role:p.role,color:p.colors[0],share:p.share})):a.palette;
  const parts=usable(stock),features=b.features.flatMap(f=>{
    const reserved=a.opportunity?.receipts.find(r=>r.featureIndex===b.features.indexOf(f))?.parts;
    const p=reserved?reserved.map(r=>parts.find(p=>p.id===r.id)).find(p=>p&&FEATURE_PARTS.includes(p.kind.type)):parts.find(p=>FEATURE_PARTS.includes(p.kind.type)&&f.types.includes(p.kind.type)&&a.palette.some(c=>c.color===p.kind.color));
    return p?[{feature:f.name,part:p.kind.type,color:p.kind.color}]:[];
  });
  return {name:b.name,pitch:b.traits.join('; '),why:a.reasons.join(' '),length,width,height,
    palette:palette.map(p=>({role:p.role,color:p.color,cells:mode==='shopping'?Math.max(1,Math.round(b.parts[0]*3*p.share)):Math.max(1,Math.min(Math.round(b.parts[0]*3*p.share),Math.floor((covers[p.color]??0)*.65)))})),features,
    discovery:{family:b.family,concept:b.name,form:b.silhouette},atlas:{briefId:b.id,approachId},opportunity:a.opportunity,
    construction:{silhouette:b.silhouette,traits:[...b.traits],approach:b.approaches.find(p=>p.id===approachId)??b.approaches[0],alternatives:b.alternatives}};
}
