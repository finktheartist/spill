import { afterEach, describe, expect, it, vi } from 'vitest';
import { explorationOrder, inventoryKey, loadIdeaHistory, rememberIdeas, sameConcept, selectDistinctIdeas, type IdeaFamily, type IdeaStorage } from './discovery';
import { proposeIdeas, type RankedIdea } from './pipeline';
import { seedChoices } from './feature-first';
import {atlasShortlist} from '../build-atlas/selection';

const storage=():IdeaStorage=>{const m=new Map<string,string>();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>{m.set(k,v);}};};
const idea=(name:string,family:IdeaFamily,form=name,worst=.5):RankedIdea=>({name,pitch:'',why:'',length:6,width:4,height:5,
  palette:[{role:'body',color:'white',cells:20}],worst,cells:20,shortfall:0,discovery:{family,concept:name,form}});
const stock={'plate-1x2-white':40,'brick-2x2-white':20};
// Minimal legal reservations exercise orchestration, not rendered subject fit.
const response=(ideas:RankedIdea[])=>new Response(JSON.stringify({modelVersion:'gemini-test-model',candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({ideas:ideas.map(i=>({...i,features:[{feature:'Body feature',part:'plate',color:'white',pieces:[{partId:'plate-1x2-white',count:2}],carriers:[]},{feature:'Raised feature',part:'brick',color:'white',pieces:[{partId:'brick-2x2-white',count:2}],carriers:[]}]}))})}]}}]}));
afterEach(()=>vi.unstubAllGlobals());

describe('broader subject discovery',()=>{
  it('fills the first three slots from distinct families before a second member, while keeping fit first',()=>{
    const candidates=[idea('Fox','animals'),idea('Dog','animals'),idea('Rabbit','animals'),idea('Desk lamp','objects'),idea('Workshop','architecture'),idea('Crane','machines','crane',2)];
    const {selected}=selectDistinctIdeas(candidates,6,[],'pile');
    expect(new Set(selected.slice(0,3).map(i=>i.discovery!.family)).size).toBe(3);
    expect(selected.at(-1)?.name).toBe('Crane');
  });
  it('keeps the worse inventory tier when a declared feature plan contradicts catalog feasibility',()=>{
    const good={...idea('Lamp','objects'),pieceOpportunity:{tier:'scarce'}};
    const contradicted={...idea('Cabin','architecture'),pieceOpportunity:{tier:'candidate'},opportunity:{tier:'blocked'}};
    expect(selectDistinctIdeas([contradicted,good],1,[],'pile').selected[0].name).toBe('Lamp');
  });
  it('allows shopping proposals whose missing pile features will be bought',async()=>{
    const shopStock={'roundplate-1x1-black':1};
    const entry=atlasShortlist('shopping',shopStock,[]).find(a=>a.opportunity?.tier==='blocked');expect(entry).toBeDefined();
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => response([{...idea('Catalog proposal','objects'),atlasId:entry!.brief.id} as RankedIdea])));
    const result=await proposeIdeas('shopping',shopStock,1);
    expect(result.ranked).toHaveLength(1);expect(result.ranked[0].opportunity?.tier).toBe('blocked');
  });
  it('rejects color/pose renames and shared body plans while leaving genuinely different forms',()=>{
    const old=idea('Kingfisher','animals','perched bird with projecting bill');
    const candidates=[idea('Blue kingfisher','animals'),idea('Woodpecker','animals',old.discovery!.form),idea('Jellyfish','animals','bell and hanging tentacles')];
    expect(selectDistinctIdeas(candidates,6,[old],'pile').selected.map(i=>i.name)).toEqual(['Jellyfish']);
    expect(sameConcept(idea('Compact desk lamp','objects'),idea('Desk lamp','objects'))).toBe(true);
    expect(sameConcept(idea('Lamprey','animals'),idea('Lamp','objects'))).toBe(false);
    expect(sameConcept({name:'Orange'},{name:'Orange'})).toBe(true); // a color can also be the actual subject
  });
  it('keeps cumulative history across reconstructed storage consumers, reordered inventory and modes',()=>{
    const store=storage(),first=idea('Fox','animals'),second=idea('Camera','objects');
    rememberIdeas('pile',stock,[first],store);rememberIdeas('pile',stock,[second],store);
    const reversed=Object.fromEntries(Object.entries(stock).reverse());
    expect(inventoryKey('pile',stock)).toBe(inventoryKey('pile',reversed));
    expect(loadIdeaHistory('pile',reversed,{...store}).map(i=>i.name)).toEqual(['Fox','Camera']);
    expect(loadIdeaHistory('shopping',stock,store)).toEqual([]);
    expect(loadIdeaHistory('pile',{...stock,'plate-1x2-white':39},store)).toEqual([]);
    expect(explorationOrder([first,second]).slice(0,6)).not.toContain('animals');
  });
  it('bounds stored history and tolerates corrupt, incompatible and unavailable storage',()=>{
    const store=storage();rememberIdeas('pile',stock,Array.from({length:150},(_,i)=>idea('Object '+i,'objects')),store);
    expect(loadIdeaHistory('pile',stock,store)).toHaveLength(120);
    for(const raw of ['{','{"version":9,"piles":[]}','{"version":1,"piles":[null,{}, {"key":"x","ideas":[null]}]}'])
      expect(loadIdeaHistory('pile',stock,{getItem:()=>raw,setItem:()=>{}})).toEqual([]);
    expect(()=>rememberIdeas('pile',stock,[idea('Vase','objects')],{getItem:()=>{throw Error();},setItem:()=>{throw Error();}})).not.toThrow();
  });
  it('keeps newer session history if browser storage becomes full after a successful write',()=>{
    const local=storage();vi.stubGlobal('window',{});vi.stubGlobal('localStorage',local);
    rememberIdeas('pile',stock,[idea('Camera','objects')]);
    vi.stubGlobal('localStorage',{...local,setItem:()=>{throw Error('Quota exceeded');}});
    rememberIdeas('pile',stock,[idea('Windmill','architecture')]);
    expect(loadIdeaHistory('pile',stock).map(i=>i.name)).toEqual(['Camera','Windmill']);
    // A successful write recovers persistent history and drops the temporary fallback.
    vi.stubGlobal('localStorage',local);rememberIdeas('pile',stock,[idea('Cactus','nature')]);
    expect(loadIdeaHistory('pile',stock,local)).toHaveLength(3);
  });
  it('records backups and failed construction candidates, rejects a third-run return of first-run ideas',async()=>{
    const store=storage(),batch=(start:number)=>Array.from({length:6},(_,i)=>idea('Object '+(start+i),'objects'));
    const fetch=vi.fn().mockResolvedValueOnce(response(batch(0))).mockResolvedValueOnce(response(batch(6)))
      .mockResolvedValueOnce(response([...batch(0),...batch(6)])).mockResolvedValueOnce(response(batch(12)));
    vi.stubGlobal('fetch',fetch);
    await proposeIdeas('pile',stock,6,[],undefined,true,store);
    await proposeIdeas('pile',stock,6,[],undefined,true,store);
    const result=await proposeIdeas('pile',stock,6,[],undefined,true,store);
    expect(result.ranked.map(i=>i.name)).toEqual(batch(12).map(i=>i.name));
    expect(loadIdeaHistory('pile',stock,store)).toHaveLength(18);
    expect(fetch).toHaveBeenCalledTimes(4);
    const prompt=JSON.parse(fetch.mock.calls[2][1].body).contents[0].parts[0].text;
    expect(prompt).toContain('Propose 18');expect(prompt).toContain('Object 0');expect(prompt).toContain('Object 11');
  });
  it('editable discovery asks for six 20–80-part subjects and retains exact feature-stock checks without authored placements',async()=>{
    const store=storage(),subjects=Array.from({length:6},(_,i)=>idea(`Object ${9400+i}`,'objects'));
    // Use the same valid terminal fixture; change only two proposed reservations
    // so this exercises the real opportunity rejection, not a mocked assessor.
    const terminal=await response(subjects).json();
    const proposal=JSON.parse(terminal.candidates[0].content.parts[0].text);
    proposal.ideas[4].features[0].pieces[0].count=41;
    proposal.ideas[5].features[0].pieces[0].partId='plate-1x2-unknown-color';
    terminal.candidates[0].content.parts[0].text=JSON.stringify(proposal);
    const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(terminal)));vi.stubGlobal('fetch',fetch);
    const result=await proposeIdeas('pile',stock,3,[],undefined,false,store,undefined,true);
    expect(fetch).toHaveBeenCalledOnce();expect(result.ranked).toHaveLength(3);
    const request=JSON.parse(fetch.mock.calls[0][1].body),prompt=request.contents[0].parts[0].text as string;
    expect(prompt).toContain('Propose 6 genuinely different subject candidates');
    expect(prompt).toContain('20–80 purposeful pieces');expect(prompt).toContain('Leave at least 5 studded body pieces');
    expect(prompt).toContain('EXACT USABLE STOCK');expect(prompt).toContain('feature allocations share one ledger');
    expect(prompt).toContain('No predetermined subject or family is required');
    expect(prompt).not.toMatch(/"(?:x|y|z|rot|parentPort)"\s*:/);expect(prompt).not.toContain('LOCKED FEATURE');
    expect(result.exploration.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'Object 9404',reason:expect.stringContaining('only 40 remain')}),
      expect.objectContaining({name:'Object 9405',reason:expect.stringContaining('no usable exact part geometry')}),
    ]));
    for(const selected of result.ranked){
      expect(selected.pieceOpportunity?.tier).toBe('candidate');
      expect(selected.pieceOpportunity?.allocations.map(f=>f.pieces)).toEqual([
        [{partId:'plate-1x2-white',count:2}],[{partId:'brick-2x2-white',count:2}],
      ]);
      expect(selected.pieceOpportunity?.bodyReserved.reduce((sum,p)=>sum+p.count,0)).toBe(5);
    }
    expect(request.generationConfig.maxOutputTokens).toBe(32768);expect(request.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
  });
  it('editable discovery constrains native feature families and both allocation lists to exact usable stock while preserving the legacy schema',async()=>{
    const pile={...stock,'curve-1x3-white':3,'tile-1x8-white':1,'tile-2x5-tan':1};
    const subjects=Array.from({length:6},(_,i)=>idea(`Object ${9600+i}`,'objects'));
    const fetch=vi.fn().mockImplementation(async()=>response(subjects)),progress=vi.fn();vi.stubGlobal('fetch',fetch);
    const result=await proposeIdeas('pile',pile,3,[],undefined,false,storage(),undefined,true,progress);
    expect(result.ranked).toHaveLength(3);expect(fetch).toHaveBeenCalledOnce();
    const request=JSON.parse(fetch.mock.calls[0][1].body),feature=request.generationConfig.responseSchema.properties.ideas.items.properties.features.items.properties;
    expect(feature.part.enum).toEqual(['brick','curve','plate','tile']);expect(feature.color.enum).toEqual(['white']);
    for(const description of ['tile 1x8','white curve-1x3-white','curve-1x3-white and invslope-2x2-white','medium-blue and trans-clear tiles','long reddish-brown plates and tiles','tan 2x3 and 1x4 tiles','bright-pink slope and lime foliage plates','light-gray 2x4 tile and red 2x2 roundplate','dark-gray 1x2 slope, cheese, and tile','black 2x8 and 1x6 plates'])expect(feature.part.enum).not.toContain(description);
    const usableIds=['brick-2x2-white','curve-1x3-white','plate-1x2-white','tile-1x8-white'];
    for(const list of ['pieces','carriers']){
      expect(feature[list].items.properties.partId.enum).toEqual(usableIds);
      expect(feature[list].items.properties.partId.enum).not.toContain('tile-2x5-tan');
    }
    const prompt=request.contents[0].parts[0].text as string;
    expect(prompt).toContain('feature.part is ONE exact native family type');expect(prompt).toContain('never a descriptive phrase');
    expect(prompt).toContain('feature.color is ONE exact usable stock color');expect(prompt).toContain('Dimensions remain studs');
    const table=JSON.parse(/EXACT USABLE STOCK[^\n]*\n(\[[^\n]+\])/.exec(prompt)![1]);
    expect(table.find((p:{id:string})=>p.id==='curve-1x3-white')).toMatchObject({w:1,d:3,heightPlates:3});
    for(const selected of result.ranked)expect(selected.pieceOpportunity?.tier).toBe('candidate');
    expect(progress.mock.calls.map(([p])=>p.phase)).toEqual(['start','complete']);
    await proposeIdeas('pile',pile,3,[],undefined,true,storage());
    const legacy=JSON.parse(fetch.mock.calls[1][1].body).generationConfig.responseSchema.properties.ideas.items.properties.features.items.properties;
    expect(legacy.part).toEqual({type:'STRING'});
    for(const list of ['pieces','carriers'])expect(legacy[list].items.properties.partId).toEqual({type:'STRING'});
  });
  it('does not record cancelled responses or silently recycle excluded subjects after a bounded refill',async()=>{
    const store=storage(),old=idea('Vase','objects');rememberIdeas('pile',stock,[old],store);
    const fetch=vi.fn().mockImplementation(async()=>response([old]));vi.stubGlobal('fetch',fetch);
    expect((await proposeIdeas('pile',stock,6,[],undefined,true,store)).ranked).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const ctl=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{ctl.abort();return response([idea('Kettle','objects')]);}));
    await expect(proposeIdeas('pile',stock,6,[],ctl.signal,true,store)).rejects.toMatchObject({name:'AbortError'});
    expect(loadIdeaHistory('pile',stock,store).map(i=>i.name)).toEqual(['Vase']);
  });
  it('offers actual reusable shells and columns to non-animal subjects without substring anatomy matches',()=>{
    const pile={'plate-2x2-white':2,'curve-2x2-white':1,'roundbrick-1x1-white':2,'plate-1x2-white':2,'plate-1x4-white':2,'cheese-1x1-white':2};
    const appliance={...idea('Toaster','objects'),features:[{feature:'Curved housing',part:'curve',color:'white'}]};
    const shell=seedChoices(appliance,pile).find(c=>c.studyId==='rounded-muzzle');
    expect(shell?.name).toBe('Rounded shell or housing');expect(shell?.cost['curve-2x2-white']).toBe(1);
    expect(seedChoices({...idea('Desk lamp','objects'),features:[{feature:'Narrow column',part:'roundbrick',color:'white'}]},pile).some(c=>c.studyId==='round-neck')).toBe(true);
    expect(seedChoices(idea('Cathedral','architecture'),pile).some(c=>c.studyId==='separated-ears')).toBe(false);
  });
});
