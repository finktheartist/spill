import { constructionApproaches } from './profiles';
import type { AtlasSourceGroup, BuildBrief } from './types';

const sources=import.meta.glob('./data/*.json',{eager:true,import:'default'}) as Record<string,AtlasSourceGroup[]>;
export const ATLAS_GROUPS=Object.keys(sources).sort().flatMap(k=>sources[k]);
const slug=(text:string)=>text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const aliases=(name:string)=>/espresso|moka|french press/i.test(name)?['coffee','maker','brewer']
  :/submersible/i.test(name)?['submarine']: /corgi|terrier|poodle|hound/i.test(name)?['dog']: /lighthouse/i.test(name)?['beacon']:[];
export const BUILD_ATLAS:BuildBrief[]=ATLAS_GROUPS.flatMap(g=>g.subjects.map(([name,...traits])=>({
  id:`${g.id}:${slug(name)}`,name,family:g.family,category:g.label,categoryId:g.id,
  silhouette:`${g.form}. ${traits.join('; ')}.`,traits,tags:[g.label,g.family,g.profile,...name.toLowerCase().split(/[^a-z0-9]+/),...aliases(name) ],
  parts:[...g.parts] as [number,number],colors:g.colors,features:g.features,
  approaches:constructionApproaches(g.profile),alternatives:g.alternatives,status:'idea',
})));
const BY_ID=new Map(BUILD_ATLAS.map(b=>[b.id,b]));
export const atlasBrief=(id:string)=>BY_ID.get(id);
