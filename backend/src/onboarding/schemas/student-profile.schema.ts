import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { encrypt, decrypt } from '../../common/utils/crypto.util';

export type StudentProfileDocument = StudentProfile & Document;

@Schema({ _id: false })
export class StudentDNA {
  @Prop({ required: true, default: 0, min: 0, max: 100 })
  analytical_thinking: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  creativity: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  communication: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  leadership: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  research: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  business_acumen: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  technical_curiosity: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  empathy: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  patience: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  risk_tolerance: number;

  @Prop({ required: true, default: () => new Date() })
  computed_at: Date;

  @Prop({ required: true, default: 'v1' })
  source_version: string;
}

export const StudentDNASchema = SchemaFactory.createForClass(StudentDNA);

@Schema({ _id: false, toJSON: { getters: true }, toObject: { getters: true } })
export class PersonalInfo {
  @Prop({ required: false, get: decrypt, set: encrypt })
  name?: string;

  @Prop({ required: false, get: decrypt, set: encrypt })
  dob?: string;

  @Prop({ required: false })
  age?: number;

  @Prop({ required: false })
  gender?: string;

  @Prop({ required: false, get: decrypt, set: encrypt })
  city?: string;

  @Prop({ required: false, get: decrypt, set: encrypt })
  state?: string;

  @Prop({ required: false, get: decrypt, set: encrypt })
  board?: string; // e.g. "CBSE" | "ICSE" | "State Board"
}

@Schema({ _id: false })
export class Class10Subjects {
  @Prop({ required: true, default: 0, min: 0, max: 100 })
  maths: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  science: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  english: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  sst: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  computer: number;
}

@Schema({ _id: false })
export class Class10Details {
  @Prop({ required: false, default: 'pursuing' })
  status?: string;

  @Prop({ required: false, default: 0 })
  percentage?: number;

  @Prop({ type: Class10Subjects, required: false })
  subjects?: Class10Subjects;

  @Prop({ type: [String], default: [] })
  favorite_subjects: string[];

  @Prop({ type: [String], default: [] })
  weak_subjects: string[];
}

@Schema({ _id: false })
export class Class12Details {
  @Prop({ required: false })
  status?: string;

  @Prop({ required: false })
  stream?: string;

  @Prop({ required: false, default: 0 })
  percentage?: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  subjects?: Record<string, number>;

  @Prop({ type: [String], default: [] })
  favorite_subjects: string[];

  @Prop({ type: [String], default: [] })
  weak_subjects: string[];
}

@Schema({ _id: false })
export class AcademicInfo {
  @Prop({ type: Class10Details, required: false })
  class10?: Class10Details;

  @Prop({ type: Class12Details, required: false })
  class12?: Class12Details;
}

@Schema({ _id: false })
export class StudentInterests {
  @Prop({ required: true, default: 0, min: 0, max: 100 })
  technology: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  business: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  helping_people: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  teaching: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  nature: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  research: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  sports: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  design: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  media: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  government: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  finance: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  machines: number;
}

@Schema({ _id: false })
export class StudentSkills {
  @Prop({ required: true, default: 1, min: 1, max: 5 })
  communication: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  leadership: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  problem_solving: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  creativity: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  logical_thinking: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  coding: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  drawing: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  math: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  observation: number;

  @Prop({ required: true, default: 1, min: 1, max: 5 })
  patience: number;
}

@Schema({ _id: false })
export class StudentConstraints {
  @Prop({ required: false, default: 'any' })
  govt_vs_private?: string; // "govt" | "private" | "any"

  @Prop({ required: true, default: 4, min: 1, max: 4 })
  budget_tier: number; // 1 to 4

  @Prop({ required: true, default: 5, min: 1 })
  study_duration_max: number; // years

  @Prop({ required: true, default: true })
  willing_to_relocate: boolean;

  @Prop({ required: true, default: false })
  abroad_ok: boolean;

  @Prop({ required: false })
  preferred_location?: string;
}

@Schema({ _id: false })
export class ScenarioResponse {
  @Prop({ required: true })
  question_id: string;

  @Prop({ required: true })
  selected_option: string; // 'A' | 'B' | 'C' | 'D'

  @Prop({ type: MongooseSchema.Types.Map, of: Number, required: true })
  trait_weights: Map<string, number>; // Local trait weight impacts from this answer, e.g. { risk_tolerance: 10 }
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'student_profiles',
  toJSON: { getters: true },
  toObject: { getters: true },
})
export class StudentProfile {
  @Prop({ required: true, unique: true, index: true })
  user_id: string; // hyphen-stripped UUID

  @Prop({ required: true, default: 'personal' })
  onboarding_step: string; // current active step: 'personal' | 'academic' | ... | 'complete'

  @Prop({ required: true, default: 0 })
  completion_percentage: number;

  @Prop({ type: PersonalInfo, required: true, default: () => ({}) })
  personal: PersonalInfo;

  @Prop({ type: AcademicInfo, required: true, default: () => ({}) })
  academic: AcademicInfo;

  @Prop({ type: StudentInterests, required: true, default: () => ({}) })
  interests: StudentInterests;

  @Prop({ type: StudentSkills, required: true, default: () => ({}) })
  skills: StudentSkills;

  @Prop({
    type: [String],
    required: false,
    default: [],
    set: (val: any) => {
      if (Array.isArray(val)) return val.map(String);
      if (typeof val === 'object' && val !== null) {
        return [
          ...(Array.isArray(val.target_roles) ? val.target_roles : []),
          ...(Array.isArray(val.preferred_industries) ? val.preferred_industries : []),
        ].map(String);
      }
      return val ? [String(val)] : [];
    },
  })
  goals: string[]; // ranked array

  @Prop({ type: [String], required: true, default: [] })
  work_preferences: string[]; // office, outdoor, remote, etc.

  @Prop({ type: StudentConstraints, required: true, default: () => ({}) })
  constraints: StudentConstraints;

  @Prop({
    type: [SchemaFactory.createForClass(ScenarioResponse)],
    required: true,
    default: [],
  })
  scenario_responses: ScenarioResponse[];

  @Prop({ type: [MongooseSchema.Types.Mixed], required: false })
  pending_scenarios?: any[];

  @Prop({ type: StudentDNASchema, required: false })
  current_dna?: StudentDNA;
}

export const StudentProfileSchema: MongooseSchema =
  SchemaFactory.createForClass(StudentProfile);
