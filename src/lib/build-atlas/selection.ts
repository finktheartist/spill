import type { ShapeIdea, ShapeMode } from '../shape-first/pipeline';
import { sameConcept, type SeenIdea } from '../shape-first/discovery';
import { assessAtlas, ideaFromAssessment, searchAssessments } from './matching';
import { atlasSeenIds } from './history';
import type { AtlasAssessment } from './types';
import type { OpportunityContextOptions } from './opportunity';

export function atlasShortlist(mode:ShapeMode,stock:Record<string,number>,history:SeenIdea[],limit=36,options:OpportunityContextOptions={}) {
  const seen=atlasSeenIds(mode,stock),all=assessAtlas(stock,undefined,options).filter(a=>!seen.has(a.brief.id)&&!history.some(h=>sameConcept({name:a.brief.name,
    discovery:{family:a.brief.family,concept:a.brief.name,form:a.brief.silhouette}},h)));
  return searchAssessments(all,{limit},history).matches;
}
export const shortlistText=(list:AtlasAssessment[])=>`PERMANENT BUILD CATALOG — these candidates were retrieved from the full catalog for this pile. The estimates describe useful features, not completed constructions. Prefer these distinct subjects; use atlasId="new-idea" only for a genuinely useful gap in the catalog.
${list.map(a=>JSON.stringify({atlasId:a.brief.id,name:a.brief.name,family:a.brief.family,silhouette:a.brief.silhouette,features:a.brief.features,
  approaches:a.brief.approaches.map(p=>({id:p.id,plan:p.plan})),parts:a.brief.parts,assessment:a.status,missing:a.missing.map(m=>m.name),
  opportunity:a.opportunity&&{tier:a.opportunity.tier,evidence:a.opportunity.evidence,score:a.opportunity.score,
    allocations:a.opportunity.receipts.filter(r=>r.required).map(r=>({feature:r.name,requested:r.requested,allocated:r.allocated,parts:r.parts,carriers:r.carriers,evidence:r.evidence,structured:r.structured,singletonIds:r.singletonIds,alternatives:r.alternatives.filter(p=>p.remaining>0).slice(0,4)})),
    blockers:a.opportunity.blockers,bodyReserve:a.opportunity.bodyReserve,slack:a.opportunity.slack,confidence:a.opportunity.confidence,geometryUnchecked:a.opportunity.geometryUnchecked}})).join('\n')}
Exact reservations, compatible pairs and local connector checks are inventory opportunity evidence. Generic authored type counts do not establish feature dimensions, anatomy, a completed construction or craft quality. Missing scan confidence is unknown, not certainty.
For a catalog subject copy its atlasId exactly. Keep its two identifying traits and functional relationships. Choose its natural/credible colors from the actual pile. A subject title alone is not sufficient design knowledge.`;

export function attachCatalogKnowledge(idea:ShapeIdea&{atlasId?:string},list:AtlasAssessment[],stock:Record<string,number>):ShapeIdea {
  const selected=list.find(a=>a.brief.id===idea.atlasId);if(!selected)return idea;
  const authored=ideaFromAssessment(selected,stock);
  return {...idea,name:authored.name,pitch:authored.pitch,discovery:authored.discovery,atlas:authored.atlas,construction:authored.construction,opportunity:selected.opportunity};
}
