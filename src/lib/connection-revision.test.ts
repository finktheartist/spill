import {afterEach,expect,it,vi} from 'vitest';
import {connectionGeometryKey,connectionRevisionWins,patchConnectionDraft,type ConnectionDraft,type ConnectionPatch} from './connection-revision';
import {refineConnectionBuild,designBuild,type BuildEvent} from './gemini';
import {constructionIssues} from './construction';
import {compileConnections} from './connections';
import {parsePartId} from './bricks';
import type {Inventory} from './inventory';
import fixture from './fixtures/large-pile-stock.json';
import baseline from './fixtures/gateway-revision-baseline.json';
import named from './fixtures/roof-gateway.json';
const stock=fixture.stock,draft=baseline as ConnectionDraft;
const inv:Inventory={source:'photo',photos:[],others:[],parts:Object.fromEntries(Object.entries(stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:.8,boxes:[]}]))};
const idea={name:'Timber garden gateway',pitch:'A roofed garden entrance',estimatedParts:39,difficulty:3,keyParts:[]};
const patch=(index=28,partId='arch-1x4-light-gray'):ConnectionPatch=>({focus:'Replace the rear white arch with stone gray',updates:[{index,...draft.program.operations[index],partId}],remove:[],add:[]});
const empty={focus:'No further feasible change',updates:[],remove:[],add:[]};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const verdict={looksLike:'garden gateway',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const views=()=>['data:image/jpeg;base64,AA=='];
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers();});
it('replays the original 39-piece live gateway and applies a scoped inventory-bound patch',()=>{
 expect(connectionGeometryKey(compileConnections(draft.program,stock))).toBe(connectionGeometryKey(draft.build));
 const result=patchConnectionDraft(draft,patch(),stock);expect(result.issues).toEqual([]);expect(result.changed).toEqual([28]);
 expect(result.draft!.receipts).toEqual(draft.receipts);expect(constructionIssues(result.draft!.build,stock,24)).toEqual([]);
 expect(draft.program.operations[28].partId).toBe('arch-1x4-white');
});
it('rejects a missing second brown arch without modifying the baseline',()=>{
 const before=JSON.stringify(draft),result=patchConnectionDraft(draft,patch(28,'arch-1x4-reddish-brown'),stock);
 expect(result.draft).toBeUndefined();expect(result.issues.length).toBeGreaterThan(0);expect(JSON.stringify(draft)).toBe(before);
});
it('locks module geometry and colors, and keeps the root fixed',()=>{
 expect(patchConnectionDraft(draft,patch(35,'slope-4x2-red'),stock).issues.join()).toMatch(/locked/);
 expect(patchConnectionDraft(draft,{...empty,remove:[34]},stock).issues.join()).toMatch(/locked/);
 expect(patchConnectionDraft(draft,patch(0),stock).issues.join()).toMatch(/root/);
});
it('remaps surviving module indices after removing an ordinary leaf',()=>{
 const result=patchConnectionDraft(draft,{...empty,remove:[30]},stock);expect(result.issues).toEqual([]);
 expect(result.draft!.receipts[0].parts).toEqual([33,34,35,36,37]);
 expect(result.draft!.program.operations[33].parent).toBe(29);
});
it('rejects deletion of a live parent and a whole-model structural move',()=>{
 expect(patchConnectionDraft(draft,{...empty,remove:[25]},stock).issues.join()).toMatch(/surviving/);
 const p={...empty,updates:[{index:19,...draft.program.operations[19],partId:'brick-1x2-reddish-brown',parentPort:'stud:0:3'},{index:20,...draft.program.operations[20],parentPort:'stud:3:3'}]};
 expect(patchConnectionDraft(draft,p,stock).draft).toBeUndefined();
});
it('ignores renamed/caption-only and globally translated geometry',()=>{
 const copy=structuredClone(draft.build);copy.name='Different story';copy.steps.forEach(s=>{s.caption='New caption';s.parts.forEach(p=>{p.x+=3;p.y+=2;});});
 expect(connectionGeometryKey(copy)).toBe(connectionGeometryKey(draft.build));
 expect(patchConnectionDraft(draft,empty,stock).changed).toEqual([]);
});
it('requires visual preference, subject match and no score regression, even for an integer tie',()=>{
 expect(connectionRevisionWins(draft.verdict,{...draft.verdict},true)).toBe(true);
 expect(connectionRevisionWins(draft.verdict,{...draft.verdict},false)).toBe(false);
 expect(connectionRevisionWins(draft.verdict,{...draft.verdict,subjectMatched:false},true)).toBe(false);
 expect(connectionRevisionWins(draft.verdict,{...draft.verdict,colors:3,impressive:5},true)).toBe(false);
});
it('keeps a validated revision only after anonymous judgment and a separate A/B preference',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(.1);
 const fetch=vi.fn().mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply(verdict)).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({preferred:'A',reason:'The gray rear arch unifies the supports.'}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];const result=await refineConnectionBuild(inv,idea,draft,e=>events.push(e),{views});
 expect(result.improved).toBe(true);expect(fetch).toHaveBeenCalledTimes(4);expect(result.verdict.impressive).toBe(4);
 expect(fetch.mock.calls[1][1].body).not.toContain(idea.name);expect(events.some(e=>e.phase==='compared'&&e.selected==='refinement')).toBe(true);
});
it('retains the original on a comparison tie and does not judge repeated geometry again',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply(verdict)).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({preferred:'tie',reason:'No clear difference.'})).mockImplementation(async () => reply(patch()));vi.stubGlobal('fetch',fetch);
 const result=await refineConnectionBuild(inv,idea,draft,()=>{},{views});
 expect(result.build).toBe(draft.build);expect(result.improved).toBe(false);expect(fetch).toHaveBeenCalledTimes(6);
});
it('does not spend comparison calls on a worse candidate',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply({...verdict,impressive:2})).mockResolvedValueOnce(reply({matchesSubject:true})).mockImplementation(async () => reply(empty));vi.stubGlobal('fetch',fetch);
 const result=await refineConnectionBuild(inv,idea,draft,()=>{},{views});
 expect(result.improved).toBe(false);expect(fetch).toHaveBeenCalledTimes(5);
});
it('allows a construction correction within a visual pass',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(.1);
 const fetch=vi.fn().mockResolvedValueOnce(reply(patch(28,'arch-1x4-reddish-brown'))).mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply(verdict)).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({preferred:'A',reason:'Improved finish.'}));vi.stubGlobal('fetch',fetch);
 const result=await refineConnectionBuild(inv,idea,draft,()=>{},{views});expect(result.improved).toBe(true);expect(fetch).toHaveBeenCalledTimes(5);
});
it('cancellation after a model response does not accept or emit the stale revision',async()=>{
 const signal=new AbortController(),events:BuildEvent[]=[];
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{signal.abort();return reply(patch());}));
 await expect(refineConnectionBuild(inv,idea,draft,e=>events.push(e),{views,signal:signal.signal})).rejects.toThrow();
 expect(events.filter(e=>e.phase==='rebuilt'||e.phase==='compared')).toEqual([]);
});
it('construction failure on attempt one cannot consume the visual passes for valid attempt two',async()=>{
 const plan={choiceId:'gable-roof-white',feature:'Pitched roof',outline:'Open arch',scale:'Four-stud roof',reason:'Shaped canopy'};
 const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply({...named,operations:[]})).mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(named)).mockResolvedValueOnce(reply({...verdict,impressive:3})).mockResolvedValueOnce(reply({matchesSubject:true})).mockImplementation(async () => reply(empty));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];const result=await designBuild(inv,idea,e=>events.push(e),{views});
 expect(result).toBeNull();expect(events.filter(e=>e.phase==='rebuilding')).toHaveLength(3);expect(fetch).toHaveBeenCalledTimes(9);
 expect(events.at(-1)?.phase).toBe('failed');expect(events.some(e=>e.phase==='ready')).toBe(false);
});
it('gives a late valid construction a fresh visual deadline and retains its draft on timeout',async()=>{
 vi.useFakeTimers();
 const plan={choiceId:'gable-roof-white',feature:'Pitched roof',outline:'Open arch',scale:'Four-stud roof',reason:'Shaped canopy'};
 const fetch=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>setTimeout(()=>resolve(reply(plan)),170000))).mockResolvedValueOnce(reply(named)).mockResolvedValueOnce(reply({...verdict,impressive:3})).mockResolvedValueOnce(reply({matchesSubject:true})).mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true})));
 vi.stubGlobal('fetch',fetch);const events:BuildEvent[]=[];
 const pending=designBuild(inv,idea,e=>events.push(e),{views});
 await vi.advanceTimersByTimeAsync(180000);
 expect(events.some(e=>e.phase==='rebuilding')).toBe(true);expect(events.some(e=>e.phase==='failed')).toBe(false);
 await vi.advanceTimersByTimeAsync(230000);expect(await pending).toBeNull();
 expect(events.some(e=>e.phase==='kept'&&e.reason.includes('four-minute'))).toBe(true);
 expect(events.filter(e=>e.phase==='preview').at(-1)).toBeDefined();expect(events.some(e=>e.phase==='ready')).toBe(false);
});
it('recovers once from an empty model response without losing the checked baseline',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(.1);
 const emptyReply=new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{content:{role:'model',parts:[{text:''}]},finishReason:'MAX_TOKENS',continuationToken:'test-empty-revision-state'}]}), { status: 200 });
 const fetch=vi.fn().mockResolvedValueOnce(emptyReply).mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply(verdict)).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({preferred:'A',reason:'Improved finish.'}));vi.stubGlobal('fetch',fetch);
 const result=await refineConnectionBuild(inv,idea,draft,()=>{},{views});expect(result.improved).toBe(true);expect(fetch).toHaveBeenCalledTimes(5);
});
it('retains an already improved draft if a later revision fails',async()=>{
 vi.spyOn(Math,'random').mockReturnValue(.1);
 const fetch=vi.fn().mockResolvedValueOnce(reply(patch())).mockResolvedValueOnce(reply({...verdict,impressive:3})).mockResolvedValueOnce(reply({matchesSubject:true})).mockResolvedValueOnce(reply({preferred:'A',reason:'Improved finish.'})).mockRejectedValueOnce(Error('Disconnected'));vi.stubGlobal('fetch',fetch);
 const result=await refineConnectionBuild(inv,idea,draft,()=>{},{views});expect(result.improved).toBe(true);expect(result.program.operations[28].partId).toBe('arch-1x4-light-gray');expect(result.verdict.impressive).toBe(3);
});
it('preserves and remaps mandatory contacts when an earlier ordinary leaf is removed',()=>{
 const withContact=structuredClone(draft);withContact.program.requiredContacts=[{a:34,b:35,aPort:'stud:0:0',bPort:'grip:0:0'}];withContact.build=compileConnections(withContact.program,stock);
 const result=patchConnectionDraft(withContact,{...empty,remove:[30]},stock);expect(result.issues).toEqual([]);
 expect(result.draft!.program.requiredContacts).toEqual([{a:33,b:34,aPort:'stud:0:0',bPort:'grip:0:0'}]);
 const anchor=structuredClone(draft);anchor.program.requiredContacts=[{a:29,b:30,aPort:'stud:0:0',bPort:'grip:0:0'}];anchor.build=compileConnections(anchor.program,stock);
 expect(patchConnectionDraft(anchor,{...empty,remove:[30]},stock).issues.join()).toMatch(/Required contact/);
});
