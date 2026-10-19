import {afterEach,expect,it,vi} from 'vitest';
import {designBuild,type BuildEvent} from './gemini';
import {constructionIssues} from './construction';
import {surfaceExamples,surfaceExampleStock as stock} from './surface-examples';
import {constructionChoices} from './construction-techniques';
import {parsePartId} from './bricks';
import type {Inventory} from './inventory';
import boat from './fixtures/surface-boat.json';
import robot from './fixtures/surface-robot.json';
import photo from '../../test/fixtures/photo-stock.json';
const inv:Inventory={source:'sample',photos:[],others:[],parts:Object.fromEntries(Object.entries(stock).map(([id,count])=>[id,{kind:parsePartId(id)!,count,confidence:1,boxes:[]}]))};
const reply=(json:unknown)=>(new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}), { status: 200 }));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('whole boat and bust fixtures pass strict validation and never silently fit the photo pile',()=>{
 const examples=surfaceExamples();expect(examples.map(e=>e.build.steps.length)).toEqual([35,27]);
 for(const e of examples){expect(constructionIssues(e.build,stock,24)).toEqual([]);expect(constructionIssues(e.build,photo.stock,24).some(i=>i.kind==='inventory')).toBe(true);expect(e.build.requiredContacts!.length).toBeGreaterThan(4);}
 expect(new Set(constructionChoices(stock).map(c=>c.family))).toEqual(new Set(['bracket-face','sideways-taper']));
});
for(const [subject,raw] of [['Coastal launch boat',boat],['Survey robot bust',robot]] as const)it(`baseline ${subject} requests select surfaces before allocating and retain the blind gate`,async()=>{
 const choice=raw.operations.find(o=>o.kind==='technique')!.choiceId;
 const plan={choiceId:choice,feature:'Thin mounted outer shell',outline:'Paired faces and tapered transitions',scale:'Four studs across',reason:'Make the outer contour with supported panels'};
 const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(raw)).mockResolvedValueOnce(reply({looksLike:subject.toLowerCase(),recognizable:4,complete:4,impressive:4,colors:4,fixes:[]})).mockResolvedValueOnce(reply({matchesSubject:true}));vi.stubGlobal('fetch',fetch);
 const events:BuildEvent[]=[],trace:{label:string;data:any}[]=[];
 const build=await designBuild(inv,{name:subject,pitch:'A developed miniature',estimatedParts:32,difficulty:3,keyParts:[]},e=>events.push(e),{objectLayoutMode:'off',views:()=>['data:image/jpeg;base64,AA=='],debug:(label,data)=>trace.push({label,data})});
 expect(build).not.toBeNull();expect(events.at(-1)?.phase).toBe('ready');expect(fetch).toHaveBeenCalledTimes(4);
 expect(events.find(e=>e.phase==='planned')).toMatchObject({reserved:2});
 const record=trace.find(e=>e.label==='techniqueExpansion')!.data;expect(record.receipts.every((r:any)=>r.family!=='rectangle-two-anchor')).toBe(true);
 expect(constructionIssues(build!,stock,24)).toEqual([]);expect(build!.steps.some(s=>s.caption.includes('BOTH side studs'))).toBe(true);
 const blind=JSON.stringify(JSON.parse(fetch.mock.calls[2][1].body));expect(blind).not.toContain(subject);expect(blind).not.toContain(raw.name);
});
