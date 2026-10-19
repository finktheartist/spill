import {afterEach,expect,it,vi} from 'vitest';
import {designBuild,type BuildEvent} from './gemini';
import * as allocator from './robot-body-plan';
import {createRobotTarget,silhouetteFit} from './robot-silhouette';
import {DEFAULT_ROBOT_MODULES} from './robot-module-shapes';
import {parsePartId} from './bricks';
import type {Inventory} from './inventory';
import photo from '../../test/fixtures/photo-stock.json';
const idea={name:'Survey robot',pitch:'A proportioned robot.',estimatedParts:32,difficulty:3,keyParts:[]};
const inv:Inventory={source:'sample',photos:[],others:[],parts:Object.fromEntries(Object.entries(photo.stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const good={looksLike:'robot',recognizable:4,complete:4,impressive:4,colors:4,fixes:[]};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
const plan=(legHeight=7)=>reply({...DEFAULT_ROBOT_MODULES,legHeight,reason:'Distinct legs and a compact torso'});
const approved=()=>reply({accepted:true,reason:'Coherent proportions'});
const match=()=>reply({matchesSubject:true});
const options={views:vi.fn(()=>['data:image/jpeg;base64,AA==']),targetViews:vi.fn(()=>['data:image/png;base64,AA==','data:image/png;base64,BB=='])};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();options.views.mockClear();options.targetViews.mockClear();});
it('designs and visually approves a part-free target before invoking the allocator',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget'),events:BuildEvent[]=[],debug:{label:string;data:any}[]=[];
 const fetch=vi.fn()
  .mockImplementationOnce(async()=>{expect(solve).not.toHaveBeenCalled();expect(options.views).not.toHaveBeenCalled();return plan();})
  .mockImplementationOnce(async()=>{expect(solve).not.toHaveBeenCalled();expect(options.targetViews).toHaveBeenCalledTimes(1);expect(options.views).not.toHaveBeenCalled();expect(events.at(-1)?.phase).toBe('silhouettePlanned');return approved();})
  .mockResolvedValueOnce(reply(good)).mockResolvedValueOnce(match());vi.stubGlobal('fetch',fetch);
 const build=await designBuild(inv,idea,e=>{if(e.phase==='silhouetteLocked')expect(solve).not.toHaveBeenCalled();events.push(e);},{...options,debug:(label,data)=>debug.push({label,data})});
 expect(build).not.toBeNull();expect(solve).toHaveBeenCalledTimes(1);expect(events.at(-1)?.phase).toBe('ready');
 const solution=debug.find(d=>d.label==='robotSolution')!.data;
 expect(silhouetteFit(build!,createRobotTarget(DEFAULT_ROBOT_MODULES),solution.candidate.contract.roles).issues).toEqual([]);
 const labels=debug.map(d=>d.label);expect(labels.indexOf('robotTargetLocked')).toBeLessThan(labels.indexOf('robotAllocation'));
 const selection=JSON.parse(fetch.mock.calls[0][1].body),judge=JSON.parse(fetch.mock.calls[2][1].body);
 expect(selection.generationConfig.responseSchema.properties.legHeight).toBeDefined();expect(selection.generationConfig.responseSchema.properties.handStyle).toBeDefined();expect(selection.generationConfig.responseSchema.properties.candidateId).toBeUndefined();expect(JSON.stringify(judge)).not.toContain('Survey robot');
 expect(selection.contents[0].parts[0].text).toContain('Stock capacity bounds');
});
it('rejected silhouettes never reach part allocation or assembled-build rendering',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget');const fetch=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(reply({accepted:false,reason:'Change the torso'})).mockResolvedValueOnce(plan(10)).mockResolvedValueOnce(reply({accepted:false,reason:'Change the shoulders'}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();expect(solve).not.toHaveBeenCalled();expect(options.views).not.toHaveBeenCalled();expect(events.some(e=>e.phase==='preview'||e.phase==='ready')).toBe(false);
});
it('rejects box-dominated targets before paid visual review or stock allocation',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget'),fetch=vi.fn().mockImplementation(async () => reply({...DEFAULT_ROBOT_MODULES,torsoProfile:'tapered',shoulderProfile:'stepped',headStyle:'visor'}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();
 expect(fetch).toHaveBeenCalledTimes(2);expect(solve).not.toHaveBeenCalled();expect(options.views).not.toHaveBeenCalled();
 expect(events.some(e=>e.phase==='issues'&&e.summary.includes('exposed shaped edge'))).toBe(true);
});
it('invalid targets cannot be converted to arbitrary candidate selections',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget');vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => reply({candidateId:'robot-1'})));
 expect(await designBuild(inv,idea,()=>{},options)).toBeNull();expect(solve).not.toHaveBeenCalled();expect(options.targetViews).not.toHaveBeenCalled();
});
it('repeated rejected targets do not reach review or allocation again',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget'),fetch=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(reply({accepted:false,reason:'Revise proportions'})).mockResolvedValueOnce(plan());vi.stubGlobal('fetch',fetch);
 expect(await designBuild(inv,idea,()=>{},options)).toBeNull();expect(fetch).toHaveBeenCalledTimes(3);expect(options.targetViews).toHaveBeenCalledTimes(1);expect(solve).not.toHaveBeenCalled();
});
it('explicitly replans an infeasible target without silently shrinking it to available stock',async()=>{
 const sparse={...inv,parts:{'brick-1x2-red':{kind:parsePartId('brick-1x2-red')!,count:30,confidence:1,boxes:[]}}};
 const fetch=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(approved()).mockResolvedValueOnce(plan(10)).mockResolvedValueOnce(approved());vi.stubGlobal('fetch',fetch);
 const solve=vi.spyOn(allocator,'solveRobotTarget'),events:BuildEvent[]=[];
 expect(await designBuild(sparse,idea,e=>events.push(e),options)).toBeNull();expect(solve).toHaveBeenCalledTimes(2);
 expect(solve.mock.calls.map(c=>c[1].shape.legHeight)).toEqual([7,10]);expect(events.some(e=>e.phase==='preview')).toBe(false);
 expect(JSON.parse(fetch.mock.calls[2][1].body).contents[0].parts[0].text).toContain('could not be filled');
});
it('outline fidelity cannot bypass craft scoring, and a weaker second target does not replace the stronger draft',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(approved()).mockResolvedValueOnce(reply({...good,impressive:3})).mockResolvedValueOnce(match()).mockResolvedValueOnce(plan(10)).mockResolvedValueOnce(approved()).mockResolvedValueOnce(reply({...good,impressive:2})).mockResolvedValueOnce(match());vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[];expect(await designBuild(inv,idea,e=>events.push(e),options)).toBeNull();
 expect(events.some(e=>e.phase==='ready')).toBe(false);expect(events.filter(e=>e.phase==='silhouetteLocked').at(-1)).toMatchObject({restored:true,target:{id:createRobotTarget(DEFAULT_ROBOT_MODULES).id}});
 const previews=events.filter(e=>e.phase==='preview');expect(previews.at(-1)).toEqual(previews[0]);
 expect(events.filter(e=>e.phase==='silhouetteFitted').every(e=>e.fit.front>=.95&&e.fit.side>=.95)).toBe(true);
});
it('requires both target views and a valid target-review decision before allocation',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget');vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(plan()));
 expect(await designBuild(inv,idea,()=>{},{...options,targetViews:()=>[]})).toBeNull();expect(solve).not.toHaveBeenCalled();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(reply({accepted:'yes',reason:'Bad schema'})));
 expect(await designBuild(inv,idea,()=>{},options)).toBeNull();expect(solve).not.toHaveBeenCalled();
});
it('cancellation after target approval cannot begin allocation',async()=>{
 const solve=vi.spyOn(allocator,'solveRobotTarget'),controller=new AbortController();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(plan()).mockResolvedValueOnce(approved()));
 expect(await designBuild(inv,idea,e=>{if(e.phase==='silhouetteLocked')controller.abort();},{...options,signal:controller.signal})).toBeNull();expect(solve).not.toHaveBeenCalled();
});
it('requires finished-build rendered review even when target rendering is available',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect(await designBuild(inv,idea,()=>{},{targetViews:options.targetViews})).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
