import {afterEach,describe,it,expect,vi} from 'vitest';
import large from '../fixtures/large-pile-stock.json';
import {authoredWholeAnimalTestLayouts,testBlueprint} from '../../../test/whole-animal-fixtures';
import {composeWholeAnimal,wholeAnimalIssues,type WholeAnimalRole} from '../assembly-composer/animal-whole';
import {attachmentTwist,connectionPairs,frame} from '../connections';
import type {WholeAnimalConnection,WholeAnimalConnectionIntent} from './whole-animal-connections';
const mock=vi.hoisted(()=>({generate:vi.fn()}));vi.mock('./pipeline',()=>({generate:mock.generate}));
import {synthesizeWholeAnimals,wholeAnimalBodyKey} from './whole-animal-synthesis';
import {earSeedForBlueprint} from './whole-animal-seed';
const featureRoles=new Set(['head','neck','muzzle','nose','eye-left','eye-right','ear-left','ear-right']);
const response=(json:unknown)=>({json,content:{role:'model',parts:[{text:JSON.stringify(json)}]},seconds:0});
function fixture(withSeed=false,index=0){
 const layout=authoredWholeAnimalTestLayouts()[index];let c=composeWholeAnimal(large.stock,layout),blueprint=testBlueprint(c);const seed=withSeed?earSeedForBlueprint(large.stock,blueprint):undefined;
 if(withSeed&&!seed)throw Error('Test ear motif unavailable.');
 if(seed){const carrier=layout.parts.find(p=>p.role==='head'&&p.partId===seed.operations[0].partId)!,delta=[carrier.x-seed.parts[0].x,carrier.y-seed.parts[0].y,carrier.z-seed.parts[0].z];for(const [i,role]of ['head','ear-left','ear-right'].entries())if(i){const p=layout.parts.find(p=>p.role===role)!,q=seed.parts[i];Object.assign(p,{x:q.x+delta[0],y:q.y+delta[1],z:q.z+delta[2],rot:q.rot});}c=composeWholeAnimal(large.stock,layout);blueprint=testBlueprint(c);}
 const parts=c.build.steps.flatMap(s=>s.parts),roles=new Map(c.receipts.flatMap(r=>r.indices.map(i=>[i,r.role as WholeAnimalRole] as const))),root=seed?c.receipts.filter(r=>r.role==='head').flatMap(r=>r.indices).find(i=>parts[i].partId===seed.operations[0].partId)!:c.receipts.find(r=>r.role==='head')!.indices[0],order=seed?[root,...['ear-left','ear-right'].map(role=>c.receipts.find(r=>r.role===role)!.indices[0])]:[root],seen=new Set(order),parents=new Map<number,number>(),ends:number[]=[];
 if(seed){parents.set(order[1],root);parents.set(order[2],root);}
 for(const stage of ['features','body','legs','tail']){for(let at=0;at<order.length;at++)for(let i=0;i<parts.length;i++)if(!seen.has(i)&&(stage==='features'?featureRoles.has(roles.get(i)!):stage==='body'?roles.get(i)!=='tail'&&!roles.get(i)!.startsWith('leg-'):stage==='legs'?roles.get(i)!=='tail':true)&&connectionPairs(frame(parts[order[at]]),frame(parts[i])).length){parents.set(i,order[at]);seen.add(i);order.push(i);}ends.push(order.length);}
 if(order.length!==parts.length)throw Error('Test-only stage traversal missed a real part.');
 const operations:WholeAnimalConnection[]=order.map((i,n)=>{if(seed&&n<3)return {...seed.operations[n]};if(!n)return {partId:parts[i].partId,role:roles.get(i)!,parent:-1,parentPort:'',childPort:'',twist:0};const p=parents.get(i)!,ports=connectionPairs(frame(parts[p]),frame(parts[i]))[0];return {partId:parts[i].partId,role:roles.get(i)!,parent:order.indexOf(p),parentPort:ports[0],childPort:ports[1],twist:attachmentTwist(parts[p],ports[0],parts[i],ports[1])!};});
 const yaw=((Math.round(Math.atan2(frame(parts[root]).rotation[3],frame(parts[root]).rotation[0])*180/Math.PI)+360)%360) as 0|90|180|270;
 const intents=ends.map(end=>({rootRotation:yaw,operations:structuredClone(operations.slice(0,end))}) satisfies WholeAnimalConnectionIntent),proposals=intents.map((connections,i)=>({id:'staged-test-fox',description:'Test-only fresh stage recipe, not provider quality evidence.',blueprintId:blueprint.id,stance:blueprint.stance,parts:[],connections:{...connections,mode:'append' as const,operations:connections.operations.slice(i?ends[i-1]:(seed?3:0))}}));return {c,blueprint,proposals,seed};
}
afterEach(()=>vi.clearAllMocks());
describe('verified staged animal synthesis',()=>{
 it('constructs features, body/legs and tail through one shared ledger and offers only the final complete animal',async()=>{
  const f=fixture(),trace:{label:string;data:unknown}[]=[];mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));f.proposals.forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));
  const stock={...large.stock},before=JSON.stringify(stock),out=await synthesizeWholeAnimals(stock,'Fox',{motifs:false,minParts:40,maxCandidates:1,debug:(label,data)=>trace.push({label,data})});
  expect(out.candidates).toHaveLength(1);expect(out.attempts).toBe(4);expect(out.rejected).toEqual([]);expect(JSON.stringify(stock)).toBe(before);expect(wholeAnimalIssues(out.candidates[0])).toEqual([]);expect(wholeAnimalBodyKey(out.candidates[0])).toBe(wholeAnimalBodyKey(f.c));
  expect(trace.filter(t=>t.label==='wholeAnimalStageProgress')).toHaveLength(3);expect(trace.filter(t=>t.label==='wholeAnimalAccepted')).toHaveLength(1);
  expect(JSON.stringify(mock.generate.mock.calls[2][0])).toContain('remaining ledger');expect(mock.generate.mock.calls[1][1].properties.layouts.items.required).toContain('connections');
 });
 it('repairs a changed prefix without charging or offering the rejected partial',async()=>{
  const f=fixture(),bad=structuredClone(f.proposals[1]);bad.connections.operations=[...f.proposals[0].connections.operations,...bad.connections.operations];
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValueOnce(response({layouts:[f.proposals[0]]})).mockResolvedValueOnce(response({layouts:[bad]})).mockResolvedValueOnce(response({layouts:[f.proposals[1]]})).mockResolvedValueOnce(response({layouts:[f.proposals[2]]})).mockResolvedValueOnce(response({layouts:[f.proposals[3]]}));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{motifs:false,minParts:40,maxCandidates:1});expect(out.candidates).toHaveLength(1);expect(out.attempts).toBe(5);expect(out.rejected).toHaveLength(1);expect(out.rejected[0].reason).toMatch(/prefix|earlier|unchanged|prior|parent|root/i);expect(mock.generate.mock.calls[2][3]).toBe('low');expect(mock.generate.mock.calls[3][3]).toBe('medium');
 });
 it('returns no partial animal after cancellation between stages',async()=>{
  const f=fixture(),ctl=new AbortController();mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValueOnce(response({layouts:[f.proposals[0]]})).mockImplementationOnce(async()=>{ctl.abort();return response({layouts:[f.proposals[1]]});});
  await expect(synthesizeWholeAnimals({...large.stock},'Fox',{motifs:false,minParts:40,maxCandidates:1,signal:ctl.signal})).rejects.toMatchObject({name:'AbortError'});
 });
 it('restarts a frozen partial at most once after repeated failures and refunds its exact pieces',async()=>{
  const f=fixture(),bad=structuredClone(f.proposals[1]);bad.connections.operations=[...f.proposals[0].connections.operations,...bad.connections.operations];const trace:string[]=[];
  let restartPrompt='';mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));for(const [i,p]of [f.proposals[0],bad,bad,f.proposals[0],f.proposals[1],f.proposals[2],f.proposals[3]].entries())mock.generate.mockImplementationOnce(async(content)=>{if(i===3)restartPrompt=JSON.stringify(content);return response({layouts:[p]});});
  const stock={...large.stock},before=JSON.stringify(stock),out=await synthesizeWholeAnimals(stock,'Fox',{motifs:false,minParts:40,maxCandidates:1,debug:label=>trace.push(label)});expect(out.candidates).toHaveLength(1);expect(out.attempts).toBe(7);expect(trace.filter(x=>x==='wholeAnimalStageRestart')).toHaveLength(1);expect(out.candidates[0].remaining).toEqual(f.c.remaining);expect(JSON.stringify(stock)).toBe(before);expect(restartPrompt.includes('BOUNDED RESTART')).toBe(true);
 });

 it('does not accept a coordinate-only complete response in the required connector-stage mode',async()=>{
  const f=fixture(),layout=authoredWholeAnimalTestLayouts()[0];mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValue(response({layouts:[{...layout,blueprintId:f.blueprint.id}]}));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{motifs:false,minParts:40,maxCandidates:1});expect(out.candidates).toEqual([]);expect(out.attempts).toBe(3);expect(out.rejected.every(r=>r.reason.includes('requires connector intent'))).toBe(true);
 });

 it('prepends only a three-piece compiled motif, then invents the remaining head/body/legs/tail through new joins',async()=>{
  const f=fixture(true);mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));f.proposals.forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1});expect(out.rejected).toEqual([]);expect(out.candidates).toHaveLength(1);expect(out.attempts).toBe(4);expect(wholeAnimalIssues(out.candidates[0])).toEqual([]);
  const motif=out.designs[0].motifs![0],all=out.candidates[0].build.steps.flatMap(s=>s.parts);expect(motif.indices).toHaveLength(3);expect(motif.cost).toEqual(f.seed!.cost);expect(motif.indices.map(i=>all[i].partId)).toEqual(f.seed!.operations.map(o=>o.partId));expect(all).toHaveLength(40);expect(out.designs[0].inputMode).toBe('staged-connections');
  expect(JSON.stringify(mock.generate.mock.calls[1][0])).toContain('first NEW operation index is3');
 });

 it.each([0,1])('executes explicit attachment search for stance fixture %i and records changed bindings with fixed pieces',async(index)=>{
  const f=fixture(true,index),old=structuredClone(f.proposals.at(-1)!),last={...old,connections:{...old.connections,mode:'search' as const}};
  if(!index)last.connections.operations.at(-1)!.parentPort='stud:999:999';
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));f.proposals.slice(0,-1).forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));mock.generate.mockResolvedValueOnce(response({layouts:[last]}));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1});
  expect(out.rejected).toEqual([]);expect(out.candidates).toHaveLength(1);expect(wholeAnimalIssues(out.candidates[0])).toEqual([]);
  if(!index)expect(out.designs[0].attachmentSearches?.[0].changes.length).toBeGreaterThan(0);else expect(out.designs[0].blueprint.stance).toBe('crouching');expect(out.candidates[0].remaining).toEqual(f.c.remaining);
 },20000);

 it('records an explicit sketch revision while keeping the selected stock and actual assembly unchanged',async()=>{
  const f=fixture(true);f.blueprint.parts.min=40;const original=JSON.stringify(f.blueprint),revised=structuredClone(f.blueprint);revised.description='Explicitly revised working sketch after measuring the real carriers.';revised.regions.find(r=>r.role==='head')!.max[0]+=.5;
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValueOnce(response({blueprintRevision:{reason:'The actual carrier needs a little more skull envelope.',blueprint:revised},layouts:[f.proposals[0]]}));f.proposals.slice(1).forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1});expect(out.rejected).toEqual([]);expect(out.candidates).toHaveLength(1);expect(out.designs[0].blueprint).toEqual(revised);expect(out.designs[0].planRevisions).toHaveLength(1);expect(out.designs[0].planRevisions![0].before).toEqual(f.blueprint);expect(JSON.stringify(f.blueprint)).toBe(original);expect(out.candidates[0].remaining).toEqual(f.c.remaining);
 });

 it('rejects a revision incompatible with prepaid feature poses and keeps that prefix for a valid retry',async()=>{
  const f=fixture(true);f.blueprint.parts.min=40;const bad=structuredClone(f.blueprint),eye=bad.regions.find(r=>r.role==='eye-left')!;eye.min[2]+=3.2;eye.max[2]+=3.2;
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValueOnce(response({layouts:[f.proposals[0]]})).mockResolvedValueOnce(response({blueprintRevision:{reason:'Attempt to move one already attached eye in the sketch.',blueprint:bad},layouts:[f.proposals[1]]}));f.proposals.slice(1).forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1});expect(out.candidates).toHaveLength(1);expect(out.rejected).toHaveLength(1);expect(out.rejected[0].reason).toContain('ONE common origin');expect(out.designs[0].planRevisions).toBeUndefined();expect(out.candidates[0].remaining).toEqual(f.c.remaining);
 });

 it('caps explicit plan revisions at two without resetting construction progress or stock',async()=>{
  const f=fixture(true);f.blueprint.parts.min=40;const versions=[1,2,3].map(n=>({...structuredClone(f.blueprint),description:`Explicit working sketch revision ${n}.`}));
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));for(let i=0;i<3;i++)mock.generate.mockResolvedValueOnce(response({blueprintRevision:{reason:`Measured supports, revision ${i+1}.`,blueprint:versions[i]},layouts:[f.proposals[i]]}));mock.generate.mockResolvedValueOnce(response({layouts:[f.proposals[2]]})).mockResolvedValueOnce(response({layouts:[f.proposals[3]]}));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1});expect(out.candidates).toHaveLength(1);expect(out.designs[0].planRevisions).toHaveLength(2);expect(out.designs[0].blueprint.description).toContain('revision 2');expect(out.rejected).toHaveLength(1);expect(out.rejected[0].reason).toContain('TWO explicit');expect(out.attempts).toBe(5);expect(out.candidates[0].remaining).toEqual(f.c.remaining);
 });

 it('rejects an incomplete piece selection before spending time on attachment search',async()=>{
  const f=fixture(true),old=structuredClone(f.proposals[0]),bad={...old,connections:{...old.connections,mode:'search' as const}},trace:string[]=[];bad.connections.operations.find(o=>o.role==='eye-right')!.role='eye-left';
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]})).mockResolvedValue(response({layouts:[bad]}));const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:40,maxCandidates:1,debug:label=>trace.push(label)});
  expect(out.candidates).toEqual([]);expect(out.rejected).toHaveLength(3);expect(out.rejected.every(r=>r.reason.includes('missing eye-right'))).toBe(true);expect(trace).not.toContain('wholeAnimalAttachmentSearch');
 });

 it('shares one real crown carrier across two features while billing the whole animal once',async()=>{
  const f=fixture(true),id='plate-1x4-reddish-brown';f.blueprint.features[0].carriers[0].shared='actual-crown';f.blueprint.features.push({id:'skull-core',description:'Central skull and ear peaks use the same actual crown.',intent:'contoured-body',pairing:'none',pieces:[{partId:'brick-1x2-reddish-brown',count:1,role:'head'}],carriers:[{partId:id,count:1,role:'head',shared:'actual-crown'}]});
  const stock={...large.stock,[id]:3};mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));f.proposals.forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));
  const out=await synthesizeWholeAnimals(stock,'Fox',{minParts:20,maxCandidates:1});expect(out.rejected).toEqual([]);expect(out.candidates).toHaveLength(1);expect(out.candidates[0].remaining[id]).toBe(0);expect(wholeAnimalIssues(out.candidates[0])).toEqual([]);expect(stock[id]).toBe(3);
 });

 it('reconciles an editable sketch mismatch after a complete canonical construction without rebuilding or weakening it',async()=>{
  const f=fixture(true),fixed=structuredClone(f.blueprint);f.blueprint.regions.find(r=>r.role==='leg-front-left')!.intent='taper';
  const old=structuredClone(f.proposals[3]),tail={...old,connections:{...old.connections,mode:'search' as const}};
  mock.generate.mockResolvedValueOnce(response({blueprints:[f.blueprint]}));f.proposals.slice(0,3).forEach(p=>mock.generate.mockResolvedValueOnce(response({layouts:[p]})));mock.generate.mockResolvedValueOnce(response({layouts:[tail]})).mockResolvedValueOnce(response({canRevise:true,reason:'The cylindrical leg is a straight support rather than a taper.',blueprint:fixed}));
  const out=await synthesizeWholeAnimals({...large.stock},'Fox',{minParts:20,maxCandidates:1});expect(out.rejected).toEqual([]);expect(out.candidates).toHaveLength(1);expect(out.attempts).toBe(5);expect(out.designs[0].planRevisions).toHaveLength(1);expect(out.designs[0].attachmentSearches?.at(-1)?.acceptedAfterSketchRevision).toBe(true);expect(wholeAnimalIssues(out.candidates[0])).toEqual([]);expect(out.candidates[0].remaining).toEqual(f.c.remaining);expect(wholeAnimalBodyKey(out.candidates[0])).toBe(wholeAnimalBodyKey(f.c));
 },20000);

});
