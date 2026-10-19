/** Independently authored feature studies. Sources supply design lessons, not these instructions.
 * Every offered option is a concrete, stock-bound connection program. A study is not a whole model. */
import { COLORS, footprint, parsePartId, type Build } from './bricks';
import { compileConnections, definition, frame, type ConnectionOperation, type ConnectionProgram, type RequiredContact } from './connections';
import { isMade } from './catalog';

export const MOC_SOURCES = {
  process: 'https://bricknerd.com/home/how-to-start-building-lego-mocs-6-5-25',
  focus: 'https://www.newelementary.com/2025/04/tom-loftus-fractal-45-spaceship-moc.html',
  seams: 'https://bricknerd.com/home/seamless-snot-lego-techniques-for-smooth-surfaces-5-20-24',
  detail: 'https://bricknerd.com/home/how-to-balance-detail-in-a-lego-moc-7-3-25',
  pose: 'https://bricknerd.com/home/how-to-build-convincing-lego-characters-11-4-25',
  angles: 'https://www.newelementary.com/2025/03/lego-building-at-angles-escaping-grid.html',
};
type Source = keyof typeof MOC_SOURCES;
type Spec = Omit<ConnectionOperation, 'partId'> & { shape: string; color: 'main' | 'accent' | 'support' | 'connector' };
export interface FeatureStudy {
  id: string; name: string; group: 'head' | 'transition' | 'wing' | 'pose' | 'object';
  tags: string[]; sources: Source[]; lesson: string; comparison: string; limitation: string;
  alternatives: string[]; before: Spec[]; after: Spec[]; contacts?: RequiredContact[];
}
const root = (shape: string): Spec => ({ shape, color: 'main', parent: -1, parentPort: '', childPort: '', twist: 0 });
const on = (shape: string, parent = 0, parentPort = 'stud:0:0', childPort = 'grip:0:0', twist = 0, color: Spec['color'] = 'main'): Spec => ({ shape, parent, parentPort, childPort, twist, color });
const block = (base = 'plate-2x2', body = 'brick-2x2') => [root(base), on(body)];
const s = (id: string, name: string, group: FeatureStudy['group'], tags: string[], sources: Source[], lesson: string, comparison: string, limitation: string, alternatives: string[], before: Spec[], after: Spec[], contacts?: RequiredContact[]): FeatureStudy => ({ id, name, group, tags, sources, lesson, comparison, limitation, alternatives, before, after, contacts });

export const FEATURE_STUDIES: FeatureStudy[] = [
  s('pointed-muzzle', 'Pointed muzzle', 'head', ['animal','fox','dog','wolf','nose','bow'], ['process'],
    'Let the nose projection set the head depth; preserve a narrowing side profile.', 'The box front becomes a slope with a low leading edge.',
    'Faces local -y. A 2-stud-wide snout is too broad for a 2-stud-wide whole head.', ['rounded-muzzle','long-beak'], block(), [root('plate-2x2'), on('slope-2x2')]),
  s('rounded-muzzle', 'Rounded muzzle or forehead', 'head', ['animal','dog','bear','otter','head','hood'], ['process','detail'],
    'Use one continuous curve to make a soft facial mass; keep nearby detail quiet.', 'A curved cap replaces a square upper corner.',
    'The cap has no studs. Attach the rest through the carrier, never through the curve.', ['pointed-muzzle'], block(), [root('plate-2x2'), on('curve-2x2')]),
  s('short-beak', 'Small pointed beak', 'head', ['bird','beak','nose','kingfisher','finch','penguin'], ['process'],
    'Protect a one-stud identifying feature instead of shrinking it into a colored patch.', 'A pointed tip breaks the flat rectangular profile.',
    'One stud wide; the rear stud on its carrier must remain accessible to the head.', ['long-beak'], [root('plate-1x2'), on('plate-1x1')], [root('plate-1x2'), on('cheese-1x1',0,'stud:0:0')]),
  s('long-beak', 'Long tapering beak', 'head', ['bird','beak','kingfisher','heron','woodpecker','nose'], ['process','focus'],
    'Allocate length to the beak before enlarging the body.', 'A brick-width bar becomes a pointed two-stud run.',
    'Long axis local y; mount with a quarter turn to point along the body. Do not fill the air above its low edge.', ['short-beak','pointed-muzzle'], [root('plate-1x2'), on('brick-1x2')], [root('plate-1x2'), on('slope-1x2',0,'stud:1:0','grip:0:0',90)]),
  s('separated-ears', 'Separated ear tips', 'head', ['animal','fox','cat','wolf','ears','rabbit'], ['detail','process'],
    'The gap between ears is part of the identity. Keep two tips distinct.', 'A solid ridge becomes two pointed peaks with a two-stud gap.',
    'Four studs across; both matching tips are reserved together. Not suitable for a narrow head.', ['pointed-muzzle'], [root('plate-1x4'), on('brick-1x4')], [root('plate-1x4'), on('cheese-1x1'), on('cheese-1x1',0,'stud:3:0')]),
  s('round-neck', 'Narrow round neck', 'transition', ['animal','bird','neck','robot','post'], ['process','detail'],
    'Separate head and body with a narrow connection instead of a full-width column.', 'A broad neck block becomes a one-stud round stem and head carrier.',
    'A narrow stem is not a physical strength claim; avoid a heavy cantilevered head.', ['offset-neck','stepped-neck'], block('plate-2x2','brick-2x2'), [root('plate-2x2'), on('roundbrick-1x1'), on('plate-1x2',1)]),
  s('stepped-neck', 'Forward-reaching neck', 'transition', ['animal','bird','neck','dinosaur','giraffe'], ['pose'],
    'A small forward offset can give a head direction without enlarging the entire torso.', 'The upper carrier projects one stud beyond the lower carrier.',
    'This is a fixed plate offset, not a joint. Two consecutive offsets would need new validation.', ['round-neck','offset-neck'], [root('plate-1x2'), on('plate-1x2'), on('plate-1x2',1)], [root('plate-1x2'), on('plate-1x2',0,'stud:1:0'), on('plate-1x2',1)]),
  s('chin-transition', 'Tapered underside', 'transition', ['animal','chin','neck','jaw','boat','bow','vehicle'], ['seams'],
    'Shape the underside as well as the top so a head or bow does not read as a box.', 'A vertical lower wall becomes an undercut beneath the projecting cap.',
    'The inverted slope grips only along its high row. Leave the undercut empty.', ['pointed-muzzle'], block(), [root('plate-2x2'), on('invslope-2x2',0,'stud:0:1','grip:0:1'), on('plate-2x2',1)]),
  s('side-face', 'Thin sideways face', 'transition', ['robot','face','animal','cheek','vehicle','wall','panel'], ['seams'],
    'Use a thin sideways surface around a support rather than thickening the whole body.', 'A thick side brick is replaced by a flat face mounted on a real side stud.',
    'Requires a confirmed side-stud brick. The face projects outside the carrier and needs clearance.', ['rounded-muzzle'], [root('plate-2x2'), on('brick-2x2')], [root('plate-2x2'), on('sidebrick-1x2'), on('tile-1x2',1,'side:0')]),
  s('offset-neck', 'Half-stud head alignment', 'transition', ['animal','bird','neck','robot','head','offset'], ['seams'],
    'An exact half-stud offset can center a small head without widening the body.', 'An off-center upright stem becomes a centered stem on a jumper.',
    'Requires the actual 1x2 jumper variant and its centered connector. No substitute ordinary plate.', ['round-neck','stepped-neck'], [root('plate-1x2'), on('roundbrick-1x1')], [root('jumper-1x2'), on('roundbrick-1x1',0,'stud:center')]),
  s('layered-wing', 'Stepped feather edge', 'wing', ['bird','wing','feather','airplane','fin'], ['detail'],
    'Use a few larger steps to suggest feathers while preserving a readable outer edge.', 'A rectangular slab becomes three increasingly short overlapping strips.',
    'Thin layered geometry; the step pattern should remain large enough to read at the final scale.', ['folded-wing','swept-wing'], [root('plate-1x4'), on('plate-1x4'), on('plate-1x4',1)], [root('plate-1x4'), on('plate-1x3',0,'stud:1:0'), on('plate-1x2',1,'stud:1:0')]),
  s('folded-wing', 'Folded tapered wing', 'wing', ['bird','wing','penguin','kingfisher','fin'], ['focus','detail'],
    'Make the wing a distinct tapered surface against a quieter body.', 'A flat rectangular cap becomes a pair of aligned sloping surfaces.',
    'Two equal slopes are needed. This is a top-mounted wing; use a side-facing host for a vertical wing.', ['layered-wing','swept-wing'], block(), [root('plate-2x2'), on('slope-1x2'), on('slope-1x2',0,'stud:1:0')]),
  s('swept-wing', 'Two-anchor swept panel', 'wing', ['wing','airplane','spaceship','bird','panel'], ['angles','focus'],
    'Solve both attachment points so a deliberate diagonal survives assembly.', 'An axis-aligned panel becomes a panel fixed at 53.13 degrees by two supports.',
    'Planar angle only. Both anchors and the overhanging panel clearance are mandatory.', ['layered-wing'],
    [root('plate-4x6'), on('plate-1x1'), on('plate-1x1',0,'stud:2:1'), on('plate-2x3',1)],
    [root('plate-4x6'), on('plate-1x1',0,'stud:2:1'), on('plate-1x1'), on('plate-2x3',1,'stud:0:0','grip:2:0',2*Math.atan(.5)*180/Math.PI)],
    [{a:1,b:3,aPort:'stud:0:0',bPort:'grip:2:0'},{a:2,b:3,aPort:'stud:0:0',bPort:'grip:0:1'}]),
  s('vertical-fin', 'Thin upright fin', 'wing', ['airplane','fin','tail','bird','spaceship'], ['seams'],
    'Turn a plate-thick surface upright instead of making a brick-thick wall.', 'A heavy rectangular wall becomes a thin smooth fin.',
    'Side-stud carrier and an exposed side are required; no guessed hinge connection.', ['layered-wing','tapered-wing'], [root('plate-2x2'), on('brick-1x2')], [root('plate-2x2'), on('sidebrick-1x1'), on('tile-1x3',1,'side:0','grip:0:0',90)]),
  s('tapered-wing', 'Wedge wing tip', 'wing', ['airplane','wing','spaceship','fin','bird'], ['focus'],
    'Spend the distinctive wedge on an exposed outline, not hidden filler.', 'A rectangular wing plan becomes a diagonal tip.',
    'Uses a real left wedge. A right wing needs a separately bound handed part, not a reflected solid.', ['layered-wing','swept-wing'], [root('plate-1x2'), on('plate-2x4')], [root('plate-1x2'), on('wedgeleft-2x4',0,'stud:0:0','grip:0:0',90)]),
  s('paired-feet', 'Feet with a readable gap', 'pose', ['animal','bird','robot','feet','legs'], ['pose','detail'],
    'Preserve the opening between limbs; a solid lower mass obscures anatomy.', 'A full-width lower block becomes two supports separated by air.',
    'This fixture demonstrates the gap. When used upside down as feet, support and assembly order must still validate.', ['seated-haunch','round-neck'], [root('plate-1x4'), on('brick-1x4'), on('plate-1x4',1)], [root('plate-1x4'), on('roundbrick-1x1'), on('roundbrick-1x1',0,'stud:3:0'), on('plate-1x4',1)]),
  s('perch', 'Perch as useful support', 'pose', ['bird','perch','kingfisher','owl','parrot','scene'], ['pose'],
    'A contextual support can explain the pose and carry the model at the same time.', 'A solid pedestal becomes a slender post with a crossbar.',
    'A contextual support must serve the subject, not inflate the piece count. Mounting above the table needs a real host.', ['paired-feet'], [root('plate-2x2'), on('brick-2x2'), on('plate-1x4',1)], [root('plate-2x2'), on('roundbrick-1x1'), on('plate-1x4',1,'stud:0:0','grip:1:0')]),
  s('seated-haunch', 'Seated haunch contour', 'pose', ['animal','cat','dog','rabbit','haunch','sitting'], ['pose'],
    'A seated posture can concentrate available parts into a convincing body and shorter legs.', 'A square upright flank becomes a sloping haunch with a small forward foot.',
    'One side only. Reserve the second side before proposing a symmetric animal.', ['rounded-muzzle','paired-feet'], [root('plate-1x4'), on('brick-2x2')], [root('plate-1x4'), on('slope-2x2',0,'stud:0:0','grip:0:0',90), on('plate-1x2',0,'stud:2:0')]),
  s('turned-head', 'Fixed head turn', 'pose', ['animal','bird','robot','head','pose'], ['pose'],
    'Give the character an intentional gaze direction while keeping its existing connection.', 'A straight head carrier turns 30 degrees on an isolated round stud.',
    'Fixed display pose, not a hinge. Other studs must stay clear of the rotated carrier.', ['offset-neck','round-neck'], [root('plate-2x2'), on('roundbrick-1x1'), on('plate-1x2',1)], [root('plate-2x2'), on('roundbrick-1x1'), on('plate-1x2',1,'stud:0:0','grip:0:0',30)]),
  s('counter-tail', 'Low tapering tail', 'pose', ['animal','tail','fox','dinosaur','lizard','bird'], ['pose','focus'],
    'Use a long low appendage to balance the visual mass of the head.', 'An equally thick bar becomes a stepped tail with a pointed end.',
    'A visual counterweight is not a certified center-of-mass calculation. Keep the carrier attached.', ['layered-wing'], [root('plate-1x4'), on('plate-1x4'), on('plate-1x4',1)], [root('plate-1x4'), on('plate-1x3'), on('cheese-1x1',1,'stud:0:0','grip:0:0',-90)]),
  s('open-working-bay','Supported housing over an open working bay','object',['bay','dispensing','espresso','sewing','press','work','overhang'],['process','detail'],
    'Reserve the functional void and supported overhang before enlarging the machine body. A cup or work surface belongs under the front head.',
    'A filled cabinet becomes a rear support carrying a shaped head above a real opening.',
    'Opening lies along local x=0..2, above the base and below the upper carrier. Rear column lies at x=2..4. Add functional details only where they leave this opening visible. This is a static supported frame, not a working mechanism.',
    ['rounded-muzzle','perch'],block('plate-2x4','brick-2x4'),
    [root('plate-2x4'),on('brick-2x2',0,'stud:2:0'),on('brick-2x2',1),on('plate-2x4',2,'stud:0:0','grip:2:0'),on('curve-1x2',3,'stud:0:0','grip:0:0',-90),on('curve-1x2',3,'stud:0:1','grip:0:0',-90)]),
  s('opposed-roof','Opposed slopes with a protected roof ridge','object',['roof','gable','pitched','cottage','pavilion','house'],['process','focus'],
    'Preserve the roof pitch as a complete paired assembly. The upper ridge is centered over the footprint, so the walls inherit its proportion.',
    'A rectangular cap becomes two slopes meeting at a central ridge.',
    'Four studs along local x and two along y. The two roof halves meet at x=2; add the walls underneath its carrier. No piece may fill the sloping outside faces.',
    ['folded-wing','layered-wing'],block('plate-2x4','brick-2x4'),
    [root('plate-2x4'),on('slope-2x2',0,'stud:0:1','grip:0:0',-90),on('slope-2x2',0,'stud:3:0','grip:0:0',90)]),
  s('mounted-wheels','Four genuinely side-mounted wheel depictions','object',['wheel','wheels','wheelbase','wheeled'],['seams','process'],
    'Reserve the running gear as a complete supported assembly. Four round plates face sideways on confirmed side studs, rather than becoming dots on top of a chassis.',
    'A rectangular lower mass becomes a carrier with two separated wheel pairs on opposite sides.',
    'Uses four actual 1x1 side-stud bricks and four 1x1 round plates. The wheel depictions are fixed; no working axle or rolling mechanism is implied. Build the remaining cab and body through exposed carrier or top studs.',
    ['paired-feet','side-face'],block('plate-2x4','brick-2x4'),
    [root('plate-2x4'),on('sidebrick-1x1',0,'stud:0:0'),on('roundplate-1x1',1,'side:0','grip:0:0',0,'accent'),
      on('sidebrick-1x1',0,'stud:3:0'),on('roundplate-1x1',3,'side:0','grip:0:0',0,'accent'),
      on('sidebrick-1x1',0,'stud:0:1','grip:0:0',180),on('roundplate-1x1',5,'side:0','grip:0:0',0,'accent'),
      on('sidebrick-1x1',0,'stud:3:1','grip:0:0',180),on('roundplate-1x1',7,'side:0','grip:0:0',0,'accent')]),
];

/** Alternate constructions preserve a feature's job, not an equal-volume replacement rule. */
export const FEATURE_VARIANTS: { id:string; studyId:string; name:string; lesson:string; parts:Spec[] }[] = [
  {id:'paired-slopes',studyId:'pointed-muzzle',name:'Muzzle from two narrow slopes',lesson:'Two matched narrow slopes preserve the continuous tapered front when the wide slope is missing.',parts:[root('plate-2x2'),on('slope-1x2'),on('slope-1x2',0,'stud:1:0')]},
  {id:'paired-curves',studyId:'rounded-muzzle',name:'Forehead from two narrow curves',lesson:'A matched pair of narrow curves provides a continuous rounded forehead without a wide curved brick.',parts:[root('plate-2x2'),on('curve-1x2'),on('curve-1x2',0,'stud:1:0')]},
  {id:'thin-plates',studyId:'long-beak',name:'Thin projecting plate bill',lesson:'Two overlapping plates make a three-stud-long, one-stud-wide bill. The stepped end is square, but the thin proportion preserves the feature better than a thick black brick. Long axis local x; tip points +x.',parts:[root('plate-1x2'),on('plate-1x2',0,'stud:1:0')]},
  {id:'curved-bird-head',studyId:'long-beak',name:'Curved bird head with a thin bill',lesson:'A six-part head combines a smooth crown and a separate two-stud projecting bill. Main color is the crown; accent is the bill; support is a mostly hidden rear carrier. Bill points local -y. Preserve the air above and below it. Remove the old head and bill together.',parts:[root('plate-2x2'),on('plate-1x2',0,'stud:0:0','grip:1:0',90,'accent'),on('plate-1x2',0,'stud:0:1','grip:0:0',0,'support'),on('curve-1x2',2,'stud:0:0','grip:0:0'),on('curve-1x2',2,'stud:1:0','grip:0:0'),on('plate-1x2',1,'stud:0:0','grip:1:0',0,'accent')]},
  {id:'centered-bird-head',studyId:'long-beak',name:'Curved bird head with a centered thin bill',lesson:'Eight parts preserve a two-stud wide crown and center the one-stud wide bill using a real half-stud jumper. Prefer this over an off-center bill when the actual jumper and two support plates fit. Bill points local -y. Main color is the crown, accent the bill, support the rear carrier, connector the mostly hidden jumper. The crown is lifted one plate and set one stud rearward to clear the centered bill studs; preserve that clearance.',parts:[root('plate-2x2'),on('jumper-1x2',0,'stud:0:0','grip:0:0',0,'connector'),on('plate-1x2',1,'stud:center','grip:1:0',90,'accent'),on('plate-1x2',0,'stud:0:1','grip:0:0',0,'support'),on('plate-1x2',3,'stud:0:0','grip:0:0',0,'support'),on('curve-1x2',4,'stud:0:0','grip:0:0'),on('curve-1x2',4,'stud:1:0','grip:0:0'),on('plate-1x2',2,'stud:0:0','grip:1:0',0,'accent')]},
];

export interface FeatureChoice {
  id: string; studyId: string; name: string; main: string; accent: string; support?: string; connector?:string; variant?: string;
  program: ConnectionProgram; cost: Record<string, number>; size: number[]; substitution?: string;
}
export function featureProgram(study: FeatureStudy, main: string, accent = main, variant: 'before' | 'after' = 'after'): ConnectionProgram {
  return { name: study.name, description: study.lesson, operations: study[variant].map(({ shape, color, ...op }) => ({ ...op, partId: `${shape}-${color === 'accent' ? accent : main}` })), ...(variant === 'after' && study.contacts ? { requiredContacts: structuredClone(study.contacts) } : {}) };
}
export function featureCost(program: ConnectionProgram) {
  const cost: Record<string, number> = {};
  for (const p of program.operations) cost[p.partId] = (cost[p.partId] ?? 0) + 1;
  return cost;
}
export function studyFixture(study: FeatureStudy, variant: 'before' | 'after'): Build {
  const program = featureProgram(study, 'white', 'black', variant);
  return compileConnections(program, featureCost(program));
}
export function featureChoices(stock: Record<string, number>, subject = '', colors?: string[], limit = 40): FeatureChoice[] {
  if(!Number.isFinite(limit)||limit<1)return [];
  limit=Math.min(500,Math.floor(limit));
  const palette = [...new Set(Object.keys(stock).filter(id => Number.isSafeInteger(stock[id]) && stock[id] > 0).map(id => parsePartId(id)?.color).filter((c): c is NonNullable<typeof c> => !!c))].filter(c => !colors || colors.includes(c)).sort();
  const words = subject.toLowerCase();
  const studies = [...FEATURE_STUDIES].sort((a,b) => Number(b.tags.some(t => words.includes(t))) - Number(a.tags.some(t => words.includes(t))));
  const choices: FeatureChoice[] = [];
  const rgb=(color:string)=>{const v=parseInt((COLORS as Record<string,string>)[color].slice(1),16);return [v>>16,(v>>8)&255,v&255];};
  // One option per family first; more colors follow, so a common plate does not crowd out rare constructions.
  const byStudy = studies.map(study => {
    const recipes=[{id:'standard',name:study.name,lesson:study.lesson,parts:study.after,contacts:study.contacts},...FEATURE_VARIANTS.filter(v=>v.studyId===study.id).map(v=>({...v,contacts:undefined}))];
    const byRecipe=recipes.map(recipe=>{
      // Prune each color role by its own exact part bill before attempting complete bindings.
      const roleColors=(role:Spec['color'])=>{
        const shapes=recipe.parts.filter((p,i)=>i>0&&p.color===role).map(p=>p.shape);
        if(!shapes.length)return [undefined];
        return palette.filter(color=>{const cost:Record<string,number>={};for(const shape of shapes){const id=`${shape}-${color}`;cost[id]=(cost[id]??0)+1;}return Object.entries(cost).every(([id,n])=>(stock[id]??0)>=n&&isMade(id));});
      };
      const variants:FeatureChoice[]=[];
      bindings: for(const main of roleColors('main').filter((c):c is NonNullable<typeof c>=>!!c))for(const accent0 of roleColors('accent'))for(const support0 of roleColors('support'))for(const connector0 of roleColors('connector')){
        const accent=accent0??main,support=support0??main,connector=connector0??main;
        const base:ConnectionProgram={name:recipe.name,description:recipe.lesson,operations:recipe.parts.map(({shape,color,...op})=>({...op,partId:`${shape}-${({main,accent,support,connector})[color]}`})),...(recipe.contacts?{requiredContacts:structuredClone(recipe.contacts)}:{})};
        const rootKind=parsePartId(base.operations[0].partId)!,size0=footprint(rootKind,0);
        // A real carrier with the needed ports may substitute. Exact jumper/handed identities never change.
        const roots=Object.keys(stock).filter(id=>{
          const k=parsePartId(id);if(!k||!palette.includes(k.color)||!(stock[id]>0))return false;
          if(k.type!==rootKind.type)return false;
          if(k.type!=='plate')return k.w===rootKind.w&&k.d===rootKind.d;
          const f=footprint(k,0);return f.fw>=size0.fw&&f.fd>=size0.fd&&f.fw<=size0.fw+2&&f.fd<=size0.fd+1;
        }).sort((a,b)=>{
          const score=(id:string)=>{const k=parsePartId(id)!,f=footprint(k,0);return (f.fw*f.fd-size0.fw*size0.fd)*100+rgb(k.color).reduce((n,v,i)=>n+Math.abs(v-rgb(main)[i]),0);};
          return score(a)-score(b)||a.localeCompare(b);
        });
        let carriers=0;
        for(const root of roots){
          const program={...base,operations:base.operations.map((o,i)=>i?o:{...o,partId:root})},cost=featureCost(program);
          if(Object.entries(cost).some(([id,n])=>(stock[id]??0)<n||!isMade(id)))continue;
          try {
            const build=compileConnections(program,stock),fs=build.steps.flatMap(s=>s.parts).map(frame);
            const size=[0,1,2].map(i=>+(Math.max(...fs.map(f=>f.bounds.max[i]))/20-Math.min(...fs.map(f=>f.bounds.min[i]))/20).toFixed(2));
            variants.push({id:`${study.id}:${recipe.id}:${main}:${accent}:${support}:${root}${connector0?`:connector=${connector}`:''}`,studyId:study.id,name:recipe.name,main,accent,support,...(connector0?{connector}:{}),variant:recipe.id,program,cost,size,
              substitution:root!==base.operations[0].partId?`Carrier ${base.operations[0].partId} replaced by ${root}; exact ports and full geometry rechecked.`:undefined});
            if(variants.length>=Math.min(limit,128))break bindings;
            if(++carriers===2)break;
          }catch { /* No uncompiled recipe can be offered. */ }
        }
      }
      return variants;
    });
    const result:FeatureChoice[]=[];
    for(let i=0;byRecipe.some(cs=>cs[i]);i++)for(const cs of byRecipe)if(cs[i])result.push(cs[i]);
    return result;
  });
  for (let i=0; choices.length<limit && byStudy.some(cs => cs[i]); i++) for (const cs of byStudy) if (cs[i] && choices.length<limit) choices.push(cs[i]);
  return choices;
}
export function featureChoiceText(choices: FeatureChoice[]) {
  return choices.map(c => {
    const s = FEATURE_STUDIES.find(s => s.id === c.studyId)!;
    const ports=definition(parsePartId(c.program.operations[0].partId)!).ports.filter(p=>p.kind==='grip').map(p=>p.id).join(',');
    return `${c.id}: ${c.name}; size ${c.size.join('×')} studs. ${c.variant && c.variant !== 'standard' ? c.program.description : `${s.lesson} ${s.limitation}`} ${c.substitution??''} Cost ${JSON.stringify(c.cost)}. Root ${c.program.operations[0].partId}, childPort one of [${ports}]; output parts numbered 0..${c.program.operations.length-1}. Recipe ${JSON.stringify(c.program.operations)}.`;
  }).join('\n');
}
export function studyGuidance(subject: string, stock: Record<string, number>, colors?: string[]) {
  const choices = featureChoices(stock, subject, colors, 8);
  if (!choices.length) return '';
  return `MOC FEATURE STUDIES (feasible alternatives, not yet placed or reserved):\n${featureChoiceText(choices)}\nUse the lesson to set scale and protect identifying gaps. Keep an accessible attachment surface for a relevant feature. Do not claim these exact assemblies were built by a smooth-volume program. Reserve pairs together when an assembly is actually selected. Keep quiet surfaces around the focal feature; no filler to increase the part count.`;
}
