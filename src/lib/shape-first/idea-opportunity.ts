import type {ShapeIdea} from './pipeline';
import type {OpportunityContext} from '../build-atlas/opportunity';

export interface FeaturePiece {partId:string;count:number}
export interface IdeaPartOpportunity {
 evidence:'declared-feature-piece-estimate';tier:'candidate'|'scarce'|'blocked'|'unverified';
 allocations:{feature:string;pieces:FeaturePiece[];carriers:FeaturePiece[]}[];
 blockers:string[];remaining:Record<string,number>;bodyReserved:FeaturePiece[];
 confidence:{minimum:number|null;unknownCopies:number;cautionCopies:number};
 geometryUnchecked:string[];
}

/** A proposal must pay for its defining features and supports together. Exact
 * reservations establish piece availability, never that the claimed shape,
 * symmetry, connector arrangement or subject recognition actually works. */
export function assessIdeaParts(idea:ShapeIdea,ctx:OpportunityContext,minParts:number):IdeaPartOpportunity {
 const left={...ctx.stock},byId=new Map(ctx.parts.map(p=>[p.id,p]));
 const result:IdeaPartOpportunity={evidence:'declared-feature-piece-estimate',tier:'unverified',allocations:[],blockers:[],remaining:left,bodyReserved:[],
  confidence:{minimum:null,unknownCopies:0,cautionCopies:0},geometryUnchecked:['Feature shape, paired orientation and clearance','Actual mounting connections and support','Whole-build structure, colors and subject recognition']};
 const evidence=(id:string,count:number)=>{const c=byId.get(id)?.confidence??null;if(c===null)result.confidence.unknownCopies+=count;
  else{result.confidence.minimum=Math.min(result.confidence.minimum??1,c);if(c<=.5)result.confidence.cautionCopies+=count;}};
 const take=(piece:FeaturePiece,feature:string)=>{
  if(!piece||typeof piece.partId!=='string'||!Number.isSafeInteger(piece.count)||piece.count<1||piece.count>80){result.blockers.push(`${feature}: invalid bounded piece reservation.`);return;}
  if(!byId.has(piece.partId)){result.blockers.push(`${feature}: ${piece.partId} has no usable exact part geometry in this stock.`);return;}
  if((left[piece.partId]??0)<piece.count){result.blockers.push(`${feature}: ${piece.partId} needs ${piece.count}, only ${left[piece.partId]??0} remain after earlier features.`);return;}
  left[piece.partId]-=piece.count;evidence(piece.partId,piece.count);
 };
 const features=Array.isArray(idea.features)?idea.features:[];
 if(features.length<2||features.length>4||features.some(f=>!f||!Array.isArray(f.pieces)||!f.pieces.length||!Array.isArray(f.carriers))){
  result.blockers.push('Provide two to four defining features, each with exact pieces and an explicit carrier list.');return result;
 }
 for(const f of features){
  if(f.pieces!.length>8||f.carriers!.length>8){result.blockers.push(`${f.feature}: too many reservations.`);continue;}
  if(!f.pieces!.some(p=>{const k=byId.get(p?.partId)?.kind;return k?.type===f.part&&k?.color===f.color;}))result.blockers.push(`${f.feature}: reserved pieces do not include the declared ${f.color} ${f.part}.`);
  for(const p of [...f.pieces!,...f.carriers!])take(p,f.feature);
  result.allocations.push({feature:f.feature,pieces:f.pieces!.map(p=>({...p})),carriers:f.carriers!.map(p=>({...p}))});
 }
 if(ctx.total<minParts)result.blockers.push(`Only ${ctx.total} usable pieces; this route needs at least ${minParts}.`);
 // A minimum supply of studded body material is a ranking policy, not a body
 // recipe. It is explicitly reserved after every feature/carrier reservation.
 let needed=Math.max(4,Math.ceil(minParts*.25));
 const body=ctx.parts.filter(p=>p.body&&(left[p.id]??0)>0).sort((a,b)=>Number(b.confidence??-.1)-Number(a.confidence??-.1)||b.widthStuds*b.depthStuds-a.widthStuds*a.depthStuds||a.id.localeCompare(b.id));
 for(const p of body){const count=Math.min(needed,left[p.id]);if(!count)continue;left[p.id]-=count;needed-=count;result.bodyReserved.push({partId:p.id,count});evidence(p.id,count);if(!needed)break;}
 if(needed)result.blockers.push(`Feature allocations leave ${needed} too few studded body pieces for the declared reserve.`);
 const scarce=result.allocations.some(a=>a.pieces.some(p=>!left[p.partId]))||result.confidence.cautionCopies>0;
 result.tier=result.blockers.length?'blocked':scarce?'scarce':'candidate';return result;
}
