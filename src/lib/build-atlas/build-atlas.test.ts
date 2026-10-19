import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLORS } from '../bricks';
import { CATALOG } from '../bricks';
import { BUILD_ATLAS, ATLAS_GROUPS } from './catalog';
import { assessAtlas, assessBrief, ideaFromAssessment, searchAssessments } from './matching';
import { constructionApproaches } from './profiles';
import { atlasSeenIds, rememberAtlasIds } from './history';
import { atlasShortlist, attachCatalogKnowledge } from './selection';
import { constructionKnowledgeText } from './guidance';
import { atlasConstructionKey, saveAtlasDesign } from './cache';
import type { BuildBrief } from './types';
import { rankIdeas } from '../shape-first/pipeline';
import { runShapeTab, type ShapeVerdict } from '../shape-first/run';
import { seedChoices } from '../shape-first/feature-first';
import type { IdeaStorage } from '../shape-first/discovery';
import frozenStock from '../fixtures/atlas-photo-pile-20261013-stock.json';

const brief:BuildBrief={id:'test:appliance',name:'Test appliance',family:'objects',category:'Appliances',categoryId:'test',silhouette:'Open working bay below an overhanging head',
  traits:['Working head above cup','Open bay below the head'],tags:['appliance'],parts:[20,40],status:'idea',
  colors:[{role:'body',colors:['white'],share:1,natural:true}],features:[{name:'Rounded housing',types:['curve'],count:2,required:true,substitution:'Use stepped plates.'}],
  approaches:constructionApproaches('open-bay'),alternatives:['Shorter supported arm']};
const stock={'brick-2x2-white':20,'curve-2x2-white':2,'plate-2x2-white':2};
const reply=(json:unknown)=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(json)}]}}]}));
afterEach(()=>vi.unstubAllGlobals());

describe('permanent build atlas',()=>{
  it('contains 2000 distinct authored subjects, 100 categories and two construction approaches each',()=>{
    expect(ATLAS_GROUPS).toHaveLength(100);expect(BUILD_ATLAS).toHaveLength(2000);
    expect(new Set(BUILD_ATLAS.map(b=>b.id)).size).toBe(2000);
    expect(new Set(BUILD_ATLAS.map(b=>b.name.toLowerCase().replace(/[^a-z0-9]+/g,''))).size).toBe(2000);
    expect(new Set(BUILD_ATLAS.map(b=>b.family)).size).toBe(10);
    for(const b of BUILD_ATLAS){
      expect(b.traits).toHaveLength(2);expect(b.traits.every(t=>t.trim().split(/\s+/).length>=2&&t.length>=8)).toBe(true);
      expect(b.parts[0]).toBeGreaterThanOrEqual(20);expect(b.parts[1]).toBeGreaterThanOrEqual(b.parts[0]);
      expect(b.approaches).toHaveLength(2);expect(b.approaches[0].plan).not.toBe(b.approaches[1].plan);
      expect(b.features.some(f=>f.required)).toBe(true);
      for(const f of b.features){expect(Number.isSafeInteger(f.count)&&f.count>0).toBe(true);expect(f.substitution.length).toBeGreaterThan(8);for(const t of f.types)expect(Object.hasOwn(CATALOG,t)||t==='wheels').toBe(true);}
      expect(b.colors.reduce((s,c)=>s+c.share,0)).toBeCloseTo(1,2);for(const c of b.colors)for(const color of c.colors)expect(Object.hasOwn(COLORS,color)).toBe(true);
    }
  });
  it('shares the actual stock ledger across competing required features',()=>{
    const b={...brief,features:[...brief.features,{...brief.features[0],name:'Second rounded feature'}]};
    const result=assessBrief(b,stock);
    expect(result.matched.map(f=>f.name)).toEqual(['Rounded housing']);
    expect(result.missing).toContainEqual(expect.objectContaining({name:'Second rounded feature',available:0,count:2}));
    expect(result.status).toBe('needs-parts');
    expect(assessBrief(b,{...stock,'curve-2x2-white':4}).status).toBe('promising');
  });
  it('moves flexible uses off scarce parts so a valid joint feature allocation is not rejected',()=>{
    const b={...brief,features:[{name:'Envelope',types:['brick','slope'],count:8,required:true,substitution:'Use shaped slopes for the envelope.'},
      {name:'Foundation',types:['brick','plate','roundbrick'],count:5,required:true,substitution:'Use connected foundation supports.'}]};
    const result=assessBrief(b,{'brick-2x2-white':5,'slope-2x2-white':25});
    expect(result.missing).toEqual([]);expect(result.matched.map(f=>[f.name,f.available])).toEqual([['Envelope',8],['Foundation',5]]);
  });
  it('retains useful color and part variants while ignoring instruction order in cache identity',()=>{
    const build={name:'Fixture',description:'Cache identity only',steps:[{caption:'Layer',parts:[{partId:'plate-2x2-white',x:0,y:0,z:0,rot:0},{partId:'plate-2x2-white',x:0,y:0,z:1,rot:0}]}]};
    const red={...build,steps:[{...build.steps[0],parts:build.steps[0].parts.map(p=>({...p,partId:'plate-2x2-red'}))}]};
    expect(atlasConstructionKey('fixture',build)).not.toBe(atlasConstructionKey('fixture',red));
    expect(atlasConstructionKey('fixture',build)).not.toBe(atlasConstructionKey('another-brief',build));
    expect(atlasConstructionKey('fixture',build)).toBe(atlasConstructionKey('fixture',{...build,steps:[{...build.steps[0],parts:[...build.steps[0].parts].reverse()}]}));
  });
  it('distinguishes alternate geometry from missing parts and respects natural colors',()=>{
    const stepped={...brief,features:[{...brief.features[0],types:['curve','slope']}]};
    expect(assessBrief(stepped,{'brick-2x2-white':20,'slope-2x2-white':2}).status).toBe('adapt');
    const plant={...brief,colors:[{role:'foliage',colors:['green'],share:1,natural:true}]};
    const result=assessBrief(plant,stock);expect(result.status).toBe('needs-parts');expect(result.palette).toEqual([]);
    const painted={...plant,colors:[{...plant.colors[0],natural:false}]};expect(assessBrief(painted,stock).palette[0].color).toBe('white');
  });
  it('browses and paginates thousands without making generation requests and keeps families diverse',()=>{
    const fetch=vi.spyOn(globalThis,'fetch'),all=assessAtlas(frozenStock),first=searchAssessments(all,{limit:12}),next=searchAssessments(all,{offset:12,limit:12});
    expect(first.total).toBe(2000);expect(first.matches).toHaveLength(12);expect(next.matches).toHaveLength(12);
    expect(first.matches.map(a=>a.brief.id).some(id=>next.matches.some(a=>a.brief.id===id))).toBe(false);
    expect(new Set(first.matches.slice(0,6).map(a=>a.brief.family)).size).toBeGreaterThanOrEqual(3);
    expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
    const espresso=searchAssessments(all,{query:'espresso'});expect(espresso.matches.some(a=>a.brief.name.toLowerCase().includes('espresso'))).toBe(true);
    expect(searchAssessments(all,{query:'coffee maker'}).matches.some(a=>a.brief.name.toLowerCase().includes('espresso'))).toBe(true);
    const only=searchAssessments(all,{family:'architecture',limit:24});expect(only.matches.every(a=>a.brief.family==='architecture')).toBe(true);
    const related=searchAssessments(all,{relatedTo:first.matches[0].brief.id});expect(related.matches.some(a=>a.brief.id===first.matches[0].brief.id)).toBe(false);
  });
  it('retains thousands of explored IDs while isolating modes and inventory changes',()=>{
    const m=new Map<string,string>(),storage:IdeaStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>{m.set(k,v);}};
    rememberAtlasIds('pile',stock,Array.from({length:2000},(_,i)=>'idea:'+i),storage);
    expect(atlasSeenIds('pile',stock,storage).size).toBe(2000);
    expect(atlasSeenIds('shopping',stock,storage).size).toBe(0);
    expect(atlasSeenIds('pile',{...stock,'curve-2x2-white':3},storage).size).toBe(0);
    expect(atlasSeenIds('pile',Object.fromEntries(Object.entries(stock).reverse()),storage).size).toBe(2000);
  });
  it('uses full-catalog retrieval and attaches authored identity instead of a model rename',()=>{
    const shortlist=atlasShortlist('pile',frozenStock,[],36);expect(shortlist).toHaveLength(36);
    const chosen=shortlist[0],generated={...ideaFromAssessment(chosen,frozenStock),name:'Blue decorative sculpture',atlasId:chosen.brief.id};
    const hydrated=attachCatalogKnowledge(generated,shortlist,frozenStock);
    expect(hydrated.name).toBe(chosen.brief.name);expect(hydrated.construction?.traits).toEqual(chosen.brief.traits);
    expect(constructionKnowledgeText(hydrated)).toContain(chosen.brief.approaches[0].checks[0]);
    const shopping=ideaFromAssessment(assessBrief(brief,{}),{},undefined,'shopping');expect(shopping.palette[0].color).toBe('white');expect(shopping.palette[0].cells).toBeGreaterThan(0);
  });
  it('routes a selected subject directly into construction and keeps its defining relationships',async()=>{
    const pile={'plate-2x2-white':1,'curve-2x2-white':1,'plate-1x2-white':18,'brick-2x2-white':20};
    const base={...brief,features:[{...brief.features[0],count:1}]},selected=rankIdeas([ideaFromAssessment(assessBrief(base,pile),pile)],pile,'pile')[0];
    const choice=seedChoices(selected,pile).find(c=>c.studyId==='rounded-muzzle')!;
    const plan={choiceId:choice.id,rotation:0,pose:'Upright',traits:['A generic box','Decoration'],bodySize:[4,4,6],colors:['white']};
    const body={reasoning:'Protocol fixture',parts:Array.from({length:18},(_,i)=>({partId:'plate-1x2-white',x:0,y:i%2,z:-1-Math.floor(i/2),rot:0,role:'Support'}))};
    const fetch=vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply(body));vi.stubGlobal('fetch',fetch);
    const verdict:ShapeVerdict={looksLike:'appliance',recognizable:4,complete:4,colors:4,impressive:4,fixes:[],named:true,pass:true};
    const run=await runShapeTab('pile',pile,()=>{},{ideas:[selected],views:()=>['data:image/jpeg;base64,AA=='],judge:async()=>verdict});
    expect(fetch).toHaveBeenCalledTimes(2);expect(run.slots).toHaveLength(1);expect(run.slots[0].idea.name).toBe(brief.name);
    expect(run.slots[0].featurePlan?.traits).toEqual(brief.traits);expect(run.slots[0].phase).toBe('ready');
    const prompt=JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts.at(-1).text;
    expect(prompt).toContain('Put the tool, dispensing head or other functional feature ABOVE');expect(prompt).toContain('Open bay below the head');
    const open=vi.fn();vi.stubGlobal('indexedDB',{open});
    expect((await saveAtlasDesign({...run.slots[0],idea:{...selected,atlas:{briefId:BUILD_ATLAS[0].id,approachId:BUILD_ATLAS[0].approaches[0].id}},verdict:{...verdict,named:false}},pile)).status).toBe('rejected');
    expect(open).not.toHaveBeenCalled();
  });
});
