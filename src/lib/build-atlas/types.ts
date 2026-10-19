import type { IdeaFamily } from '../shape-first/discovery';
import type { SubjectOpportunity } from './opportunity';

/** Optional authored constraints; absent rules never acquire dimensions or
 * pairing requirements from subject names, prose or generic count values. */
export interface FeaturePartRule {
  w?: number; d?: number; heightPlates?: number;
  port?: { kind:'stud'|'grip'; direction:'top'|'bottom'|'side'; id?:string };
}
export interface FeatureOpportunityRule extends FeaturePartRule {
  pairing?: 'same-shape' | 'identical-id';
  colors?: string[];
  carrier?: FeaturePartRule & { types:string[]; count:number;
    /** One independently compiled carrier per feature part. */
    connection?: { parentPort:string; childPort:string; twist?:number } };
}

/** Authored concept knowledge; successful construction is recorded separately. */
export type ConstructionProfile = 'rounded-shell' | 'open-bay' | 'open-frame' | 'column-and-cap' | 'pitched-roof'
  | 'stepped-mass' | 'layered-surface' | 'projecting-arm' | 'wheeled-chassis' | 'tracked-chassis'
  | 'boat-hull' | 'wing-and-fuselage' | 'radial-form' | 'organic-body' | 'figure-and-equipment';
export interface FeatureNeed {
  name: string;
  /** Alternative part types that can express this feature. Alternatives share one stock ledger. */
  types: string[];
  count: number;
  required: boolean;
  substitution: string;
  opportunity?: FeatureOpportunityRule;
}
export interface ColorRole { role: string; colors: string[]; share: number; natural: boolean }
/** A subject row always has two concrete identifying traits; adjectives alone are not new subjects. */
export type SubjectRow = [name: string, trait: string, secondTrait: string];
export interface AtlasSourceGroup {
  id: string; family: IdeaFamily; label: string;
  profile: ConstructionProfile; form: string;
  parts: [number, number]; colors: ColorRole[];
  features: FeatureNeed[]; alternatives: string[];
  subjects: SubjectRow[];
}
export interface ConstructionApproach {
  id: string; name: string; profile: ConstructionProfile;
  plan: string; checks: string[];
}
export interface BuildBrief {
  id: string; name: string; family: IdeaFamily; category: string; categoryId: string;
  silhouette: string; traits: string[]; tags: string[];
  parts: [number,number]; colors: ColorRole[]; features: FeatureNeed[];
  approaches: ConstructionApproach[]; alternatives: string[];
  status: 'idea';
}
export interface AtlasAssessment {
  brief: BuildBrief; score: number; coverage: number;
  status: 'promising' | 'adapt' | 'needs-parts';
  matched: { name:string; count:number; available:number; types:string[] }[];
  missing: { name:string; count:number; available:number; substitution:string }[];
  palette: { role:string; color:string; share:number }[];
  reasons: string[];
  opportunity?: SubjectOpportunity;
}
