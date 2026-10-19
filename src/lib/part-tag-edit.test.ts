import {describe,it,expect} from 'vitest';
import {editPartTag} from './part-tag-edit';
import {PART_TAG_GROUPS,readPartTags,type PartTags,type PartTagGroupId} from './part-tags';
describe('editing observable feature tags',()=>{
 const edits:Record<PartTagGroupId,string[]>={family:['plate'],size:['1x2'],height:['2.5'],shape:['round'],profile:['curved','inverted'],top:['open-studs','center-stud'],studs:['2'],connections:['clip','socket'],decoration:['printed'],color:['white'],category:['plates special'],details:['notch']};
 it.each(PART_TAG_GROUPS.map(g=>g.id))('adds only explicitly passed %s values, with no inferred fields',key=>{
  expect(editPartTag({},key,edits[key])).toEqual({[key]:edits[key]});
  const before:PartTags={family:['brick'],size:['2x2'],height:['3'],shape:['square'],profile:['curved'],top:['studded'],studs:['4'],connections:['stud','anti-stud'],decoration:['printed'],color:['red'],category:['bricks curved'],details:['curved','notch']};
  const next=editPartTag(before,key,edits[key]);
  for(const [group,values]of Object.entries(next))for(const value of values){
   expect(group===key?edits[key]:before[group as PartTagGroupId]).toContain(value);
  }
  expect(readPartTags(next)).toEqual(next);
 });
 it('changes a studded top to smooth without retaining impossible count or stud-layout filters',()=>{
  const before:PartTags={family:['brick'],size:['2x2'],color:['red'],top:['studded','grid-studs','solid-studs'],studs:['4'],connections:['stud','anti-stud','side-stud']};
  const copy=structuredClone(before),next=editPartTag(before,'top',[...before.top!,'smooth']);
  const {studs:removed,...rest}=before;expect(removed).toEqual(['4']);
  expect(next).toEqual({...rest,top:['smooth'],connections:['anti-stud','side-stud']});expect(before).toEqual(copy);
  expect(editPartTag({},'top',['smooth'])).toEqual({top:['smooth']});
 });
 it('treats zero top studs independently from side studs and unrelated physical connections',()=>{
  const next=editPartTag({top:['open-studs','studded'],studs:['2'],connections:['stud','side-stud','clip']},'studs',['0']);
  expect(next.top).toBeUndefined();expect(next.connections).toEqual(['side-stud','clip']);expect(next.studs).toEqual(['0']);
  expect(editPartTag({},'studs',['0'])).toEqual({studs:['0']});
 });
 it('keeps a newly observed positive count while replacing the old smooth claim',()=>{
  const next=editPartTag({top:['smooth'],studs:['0'],color:['white']},'studs',['2']);
  expect(next).toEqual({studs:['2'],color:['white']});
 });
 it('reopens the top-count question when a smooth top is changed to visibly open studs',()=>{
  const next=editPartTag({top:['smooth'],studs:['0']},'top',['smooth','open-studs']);
  expect(next).toEqual({top:['open-studs']});
 });
 it('removes an existing smooth or zero claim when the user explicitly chooses a stud connection, without adding top features',()=>{
  expect(editPartTag({top:['flat','smooth'],studs:['0'],connections:['clip']},'connections',['clip','stud'])).toEqual({top:['flat'],connections:['clip','stud']});
  expect(editPartTag({},'connections',['stud'])).toEqual({connections:['stud']});
 });
 it('replaces an explicitly opposite handedness or stud opening without dropping coexisting features',()=>{
  expect(editPartTag({profile:['curved','left']},'profile',['curved','left','right']).profile).toEqual(['curved','right']);
  expect(editPartTag({profile:['curved','inverted'],details:['inverted']},'profile',['curved','inverted','upright'])).toEqual({profile:['curved','upright']});
  expect(editPartTag({top:['open-studs','center-stud']},'top',['open-studs','center-stud','solid-studs']).top).toEqual(['center-stud','solid-studs']);
  expect(editPartTag({profile:['upright','rounded']},'profile',['upright','rounded','inverted']).profile).toEqual(['rounded','inverted']);
 });
 it('allows clearing any tag and keeps curved plus inverted as coexisting observations',()=>{
  const before:PartTags={profile:['curved','inverted'],color:['red'],family:['slope']};
  expect(editPartTag(before,'color',[])).toEqual({profile:['curved','inverted'],family:['slope']});
  expect(editPartTag(before,'profile',['curved','inverted'])).toEqual(before);
 });
 it('does not keep an old catalog classification blocking a changed family',()=>{
  expect(editPartTag({family:['brick'],category:['bricks curved'],color:['white']},'family',['plate'])).toEqual({family:['plate'],color:['white']});
  expect(editPartTag({family:['brick'],category:['bricks curved']},'family',['brick'])).toEqual({family:['brick'],category:['bricks curved']});
 });
 it('removes duplicated old profile words when the observed profile changes',()=>{
  expect(editPartTag({profile:['curved','inverted'],details:['curved','inverted','notch']},'profile',['curved']).details).toEqual(['curved','notch']);
 });
 it('does not accept malformed custom feature values or numeric units',()=>{
  for(const size of ['1x0','1x2x3','<script>','1xNaN'])expect(()=>editPartTag({},'size',[size])).toThrow();
  expect(()=>editPartTag({},'height',['Infinity'])).toThrow();
  expect(()=>editPartTag({},'family',['brick','plate'])).toThrow(RangeError);
  expect(()=>editPartTag({},'top',['open-studs','open-studs'])).toThrow(RangeError);
  expect(()=>editPartTag({},'profile',['left','right'])).toThrow(RangeError);
  expect(()=>editPartTag({},'profile',['upright','inverted'])).toThrow(RangeError);
  expect(()=>editPartTag({},'top',['open-studs','solid-studs'])).toThrow(RangeError);
  expect(()=>editPartTag({},'top',['smooth','studded'])).toThrow(RangeError);
 });
 it('does not mutate or share editable arrays with the original tags or passed values',()=>{
  const before:PartTags={profile:['curved','left'],color:['white'],details:['curved','left']},values=['curved','left','right'];
  const copy=structuredClone(before),valuesCopy=[...values],next=editPartTag(before,'profile',values);
  expect(before).toEqual(copy);expect(values).toEqual(valuesCopy);
  next.profile!.push('rounded');next.color!.push('red');values.push('bent');
  expect(before).toEqual(copy);expect(next.profile).not.toContain('bent');
 });
 it.each(PART_TAG_GROUPS.map(g=>g.id))('can clear %s without filling any other group',key=>{
  expect(editPartTag({[key]:edits[key]},key,[])).toEqual({});
 });
});
