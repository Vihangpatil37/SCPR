import {
  Injectable,
  OnModuleInit,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Career, CareerDocument } from './schemas/career.schema';
import {
  SavedCareer,
  SavedCareerDocument,
} from './schemas/saved-career.schema';
import { CreateCareerDto, UpdateCareerDto } from './dto/career.dto';
import { AIServiceClient } from '../ai-service/ai-service.client';
import { CareerSeedService } from './import/seed.service';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class CareersService implements OnModuleInit {
  private readonly logger = new Logger(CareersService.name);

  constructor(
    @InjectModel(Career.name)
    private readonly careerModel: Model<CareerDocument>,
    @InjectModel(SavedCareer.name)
    private readonly savedCareerModel: Model<SavedCareerDocument>,
    private readonly aiServiceClient: AIServiceClient,
    private readonly careerSeedService: CareerSeedService,
  ) {}

  async onModuleInit() {
    await this.seedCareers();
  }

  private async seedCareers() {
    const sample = await this.careerModel.findOne().exec();
    if (sample && sample.trait_weights?.analytical_thinking === 0) {
      this.logger.log('Detected placeholder seed. Re-seeding...');
      await this.careerModel.deleteMany({}).exec();
    }

    const oldCategoryCodes = [
      'technology',
      'business_and_finance',
      'healthcare',
      'science_and_research',
      'creative_and_design',
      'education_and_social',
      'engineering',
      'communication_and_media',
    ];
    const oldCategoryCount = await this.careerModel
      .countDocuments({ category_code: { $in: oldCategoryCodes } })
      .exec();
    if (oldCategoryCount > 0) {
      this.logger.log('Detected old seed. Re-seeding...');
      await this.careerModel.deleteMany({}).exec();
    }

    const count = await this.careerModel.countDocuments().exec();
    if (count > 0) {
      this.logger.log('Careers catalog already seeded.');
      return;
    }

    const catalogRoot = fs.existsSync(
      '/app/catalogs/SCPR_Master_Career_Catalog_Part_1_Science_v2.md',
    )
      ? '/app/catalogs'
      : [
          path.resolve(process.cwd(), '..'),
          process.cwd(),
          path.resolve(__dirname, '../../../'),
          path.resolve(__dirname, '../../../../'),
        ].find((dir) =>
          fs.existsSync(
            path.join(
              dir,
              'SCPR_Master_Career_Catalog_Part_1_Science_v2.md',
            ),
          ),
        ) || path.resolve(__dirname, '../../../');

    const catalogFiles = [
      {
        part: 'part_1_science',
        file: 'SCPR_Master_Career_Catalog_Part_1_Science_v2.md',
        label: 'Science',
      },
      {
        part: 'part_2_commerce',
        file: 'SCPR_Master_Career_Catalog_Part_2_Commerce.md',
        label: 'Commerce',
      },
      {
        part: 'part_3_arts_humanities',
        file: 'SCPR_Master_Career_Catalog_Part_3_Arts_Humanities.md',
        label: 'Arts & Humanities',
      },
      {
        part: 'part_4_diploma',
        file: 'SCPR_Master_Career_Catalog_Part_4_Diploma.md',
        label: 'Diploma',
      },
      {
        part: 'part_5_iti_polytechnic',
        file: 'SCPR_Master_Career_Catalog_Part_5_ITI_Polytechnic.md',
        label: 'ITI & Polytechnic',
      },
      {
        part: 'part_6_vocational',
        file: 'SCPR_Master_Career_Catalog_Part_6_Vocational_Skill_Development.md',
        label: 'Vocational',
      },
      {
        part: 'part_7_government_defence',
        file: 'SCPR_Master_Career_Catalog_Part_7_Government_Defence.md',
        label: 'Government & Defence',
      },
      {
        part: 'part_8_emerging_future',
        file: 'SCPR_Master_Career_Catalog_Part_8_Emerging_Future_Careers.md',
        label: 'Emerging & Future',
      },
    ];

    let anyCatalogFailed = false;
    for (const cat of catalogFiles) {
      const filePath = path.join(catalogRoot, cat.file);
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`Catalog file not found: ${filePath}`);
        anyCatalogFailed = true;
        continue;
      }
      try {
        this.logger.log(`Importing ${cat.label} catalog...`);
        const result = await this.careerSeedService.seedFromCatalog(
          filePath,
          cat.part,
        );
        this.logger.log(
          `  ${cat.label}: ${result.new_inserts} new, ${result.merged_duplicates} merged`,
        );
      } catch (err: any) {
        this.logger.error(`Failed to import ${cat.label}: ${err.message}`);
        anyCatalogFailed = true;
      }
    }

    const finalCount = await this.careerModel.countDocuments().exec();
    if (anyCatalogFailed && finalCount < 50) {
      this.logger.log(
        'Catalog import incomplete. Falling back to 40 inline careers...',
      );
      try {
        await this.careerModel.insertMany(this.getCareersSeedData());
        this.logger.log('Fallback seeding completed.');
      } catch (e: any) {
        this.logger.error(`Fallback seeding failed: ${e.message}`);
      }
    } else {
      this.logger.log(
        `Catalog seeding complete: ${finalCount} careers in database.`,
      );
    }
  }

  async findAll(category?: string, search?: string) {
    const filter: any = { is_active: true };
    if (category) {
      filter.category_code = category;
    }
    if (search) {
      // Escape regex special chars to prevent ReDoS / injection
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: escaped, $options: 'i' };
    }
    return this.careerModel
      .find(filter)
      .select(
        '-trait_weights_draft -eligibility_draft -backfill_status -needs_enrichment -source_catalog_parts',
      )
      .exec();
  }

  async findCategories() {
    return this.careerModel.distinct('category_code').exec();
  }

  async findOne(careerCode: string) {
    const career = await this.careerModel
      .findOne({ career_code: careerCode })
      .exec();
    if (!career) {
      throw new NotFoundException(`Career with code ${careerCode} not found`);
    }
    return career;
  }

  async findRelated(careerCode: string) {
    const career = await this.findOne(careerCode);
    return this.careerModel
      .find({
        category_code: career.category_code,
        career_code: { $ne: careerCode },
        is_active: true,
      })
      .select(
        '-trait_weights_draft -eligibility_draft -backfill_status -needs_enrichment -source_catalog_parts',
      )
      .limit(5)
      .exec();
  }

  async findByCodes(codes: string[]) {
    return this.careerModel
      .find({ career_code: { $in: codes }, is_active: true })
      .select(
        '-trait_weights_draft -eligibility_draft -backfill_status -needs_enrichment -source_catalog_parts',
      )
      .exec();
  }

  // Saved careers
  async saveCareer(userId: string, careerCode: string) {
    await this.findOne(careerCode);

    const existing = await this.savedCareerModel
      .findOne({ user_id: userId, career_code: careerCode })
      .exec();
    if (existing) {
      return { success: true, message: 'Career already saved' };
    }

    const saved = new this.savedCareerModel({
      user_id: userId,
      career_code: careerCode,
    });
    await saved.save();
    return { success: true, message: 'Career saved successfully' };
  }

  async unsaveCareer(userId: string, careerCode: string) {
    await this.savedCareerModel
      .deleteOne({ user_id: userId, career_code: careerCode })
      .exec();
    return { success: true };
  }

  async getSavedCareers(userId: string) {
    const saved = await this.savedCareerModel.find({ user_id: userId }).exec();
    const codes = saved.map((s) => s.career_code);
    return this.findByCodes(codes);
  }

  async getSavedStatus(userId: string, careerCode: string) {
    const saved = await this.savedCareerModel
      .findOne({ user_id: userId, career_code: careerCode })
      .exec();
    return { saved: !!saved };
  }

  // Admin CRUD
  async create(dto: CreateCareerDto) {
    const existing = await this.careerModel
      .findOne({ career_code: dto.career_code })
      .exec();
    if (existing) {
      throw new ConflictException(
        `Career with code ${dto.career_code} already exists`,
      );
    }
    const newCareer = new this.careerModel(dto);
    return newCareer.save();
  }

  async update(careerCode: string, dto: UpdateCareerDto) {
    const career = await this.careerModel
      .findOneAndUpdate(
        { career_code: careerCode },
        { $set: dto },
        { new: true },
      )
      .exec();
    if (!career) {
      throw new NotFoundException(`Career with code ${careerCode} not found`);
    }
    return career;
  }

  async delete(careerCode: string) {
    const result = await this.careerModel
      .deleteOne({ career_code: careerCode })
      .exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Career with code ${careerCode} not found`);
    }
    return { success: true };
  }

  // Backfill LLM logic
  async backfillTraitWeightsForAllCareers() {
    this.logger.log('Starting LLM backfill process for all careers...');
    const careers = await this.careerModel.find().exec();
    let successCount = 0;

    for (const career of careers) {
      try {
        const response = await this.aiServiceClient.run(
          'career_trait_backfill',
          {
            career_name: career.name,
            career_description: career.description,
            required_skills: career.required_skills,
          },
          {
            trait_weights: {
              analytical_thinking: 0,
              creativity: 0,
              communication: 0,
              leadership: 0,
              research: 0,
              business_acumen: 0,
              technical_curiosity: 0,
              empathy: 0,
              patience: 0,
              risk_tolerance: 0,
            },
            eligibility: {
              min_maths: 0,
              min_science: 0,

              min_study_duration_years: 0,
            },
          },
        );

        if (response.success && response.data) {
          const { trait_weights, eligibility } = response.data;
          career.trait_weights_draft = trait_weights;
          career.eligibility_draft = {
            min_maths: eligibility.min_maths || 0,
            min_science: eligibility.min_science || 0,
            min_biology: 0,
            min_english: 0,

            min_study_duration_years: eligibility.min_study_duration_years || 3,
            max_study_duration_years:
              (eligibility.min_study_duration_years || 3) + 2,
            required_stream: 'any',
            abroad_required: false,
          };
          await career.save();
          successCount++;
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to backfill traits for ${career.career_code}: ${err.message}`,
        );
      }
    }

    return {
      message: `Completed trait weights backfill for ${successCount}/${careers.length} careers.`,
      success_count: successCount,
      total_count: careers.length,
    };
  }

  async promoteDraft(careerCode: string, approve: boolean) {
    const career = await this.findOne(careerCode);

    if (approve) {
      if (!career.trait_weights_draft) {
        throw new NotFoundException(
          `No draft trait weights found for ${careerCode}`,
        );
      }
      career.trait_weights = career.trait_weights_draft;
      career.eligibility = career.eligibility_draft;
    }

    career.trait_weights_draft = undefined;
    career.eligibility_draft = undefined;

    await career.save();
    return {
      success: true,
      message: approve
        ? `Draft promoted to live for ${careerCode}`
        : `Draft discarded for ${careerCode}`,
    };
  }

  // ============ Phase 10 Admin Methods ============

  async adminFindAll(filters: {
    page: number;
    limit: number;
    category_code?: string;
    backfill_status?: string;
    needs_enrichment?: boolean;
    is_active?: boolean;
    search?: string;
    sort_by: string;
    sort_order: 1 | -1;
  }) {
    const query: any = {};

    if (filters.category_code) {
      query.category_code = filters.category_code;
    }
    if (filters.backfill_status) {
      query.backfill_status = filters.backfill_status;
    }
    if (filters.needs_enrichment !== undefined) {
      query.needs_enrichment = filters.needs_enrichment;
    }
    if (filters.is_active !== undefined) {
      query.is_active = filters.is_active;
    }
    if (filters.search) {
      const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = { $regex: escaped, $options: 'i' };
    }

    const total = await this.careerModel.countDocuments(query).exec();
    const careers = await this.careerModel
      .find(query)
      .sort({ [filters.sort_by]: filters.sort_order })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .exec();

    return {
      data: careers,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.ceil(total / filters.limit),
      },
    };
  }

  async adminFindOne(careerCode: string) {
    const career = await this.findOne(careerCode);
    return {
      ...career.toObject(),
      // Side-by-side view data
      has_draft: !!(career.trait_weights_draft || career.eligibility_draft),
      live_trait_weights: career.trait_weights,
      draft_trait_weights: career.trait_weights_draft,
      live_eligibility: career.eligibility,
      draft_eligibility: career.eligibility_draft,
    };
  }

  async adminUpdate(careerCode: string, updates: Record<string, any>) {
    const career = await this.findOne(careerCode);

    // Whitelist of updatable fields
    const allowedFields = [
      'name',
      'description',
      'category_code',
      'sub_domain_code',
      'required_skills',
      'technical_skills',
      'soft_skills',
      'market_demand',
      'future_scope',
      'career_progression',
      'pathway_tags',
      'source_catalog_parts',
      'trait_weights',
      'eligibility',
      'trait_weights_draft',
      'eligibility_draft',
      'backfill_status',
      'needs_enrichment',
    ];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        (career as any)[key] = updates[key];
      }
    }

    await career.save();
    return career;
  }

  async adminPublishDraft(careerCode: string) {
    const career = await this.findOne(careerCode);

    if (!career.trait_weights_draft && !career.eligibility_draft) {
      throw new NotFoundException(`No draft found for ${careerCode}`);
    }

    if (career.trait_weights_draft) {
      career.trait_weights = career.trait_weights_draft;
      career.trait_weights_draft = undefined;
    }
    if (career.eligibility_draft) {
      career.eligibility = career.eligibility_draft;
      career.eligibility_draft = undefined;
    }

    career.backfill_status = 'published';
    await career.save();

    return { success: true, message: `Draft published for ${careerCode}` };
  }

  async adminRejectDraft(careerCode: string) {
    const career = await this.findOne(careerCode);

    career.trait_weights_draft = undefined;
    career.eligibility_draft = undefined;
    career.backfill_status = 'rule_based';
    await career.save();

    return { success: true, message: `Draft rejected for ${careerCode}` };
  }

  async adminBulkPublish(filter: Record<string, any>) {
    const query: any = {
      $or: [
        { trait_weights_draft: { $exists: true, $ne: null } },
        { eligibility_draft: { $exists: true, $ne: null } },
      ],
    };

    // Apply additional filters
    if (filter.category_code) {
      query.category_code = filter.category_code;
    }
    if (filter.backfill_status) {
      query.backfill_status = filter.backfill_status;
    }

    const careers = await this.careerModel.find(query).exec();
    let published = 0;

    for (const career of careers) {
      if (career.trait_weights_draft) {
        career.trait_weights = career.trait_weights_draft;
        career.trait_weights_draft = undefined;
      }
      if (career.eligibility_draft) {
        career.eligibility = career.eligibility_draft;
        career.eligibility_draft = undefined;
      }
      career.backfill_status = 'published';
      await career.save();
      published++;
    }

    return {
      success: true,
      message: `Published drafts for ${published} careers`,
      published_count: published,
    };
  }

  async adminGetImportAudit() {
    // Query careers with import metadata
    const total = await this.careerModel.countDocuments().exec();
    const byCategory = await this.careerModel
      .aggregate([
        { $group: { _id: '$category_code', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();

    const byBackfillStatus = await this.careerModel
      .aggregate([{ $group: { _id: '$backfill_status', count: { $sum: 1 } } }])
      .exec();

    const bySubDomain = await this.careerModel
      .aggregate([
        { $match: { sub_domain_code: { $exists: true, $ne: '' } } },
        { $group: { _id: '$sub_domain_code', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ])
      .exec();

    const enrichmentCount = await this.careerModel
      .countDocuments({ needs_enrichment: true })
      .exec();
    const backfillAwaitingReview = await this.careerModel
      .countDocuments({
        backfill_status: 'ai_refined',
      })
      .exec();

    return {
      total_careers: total,
      by_category: byCategory,
      by_backfill_status: byBackfillStatus,
      top_sub_domains: bySubDomain,
      needs_enrichment_count: enrichmentCount,
      backfill_awaiting_review: backfillAwaitingReview,
      catalog_parts: [
        { part: 'part_1_science', name: 'Science' },
        { part: 'part_2_commerce', name: 'Commerce' },
        { part: 'part_3_arts_humanities', name: 'Arts & Humanities' },
        { part: 'part_4_diploma', name: 'Diploma' },
        { part: 'part_5_iti_polytechnic', name: 'ITI & Polytechnic' },
        { part: 'part_6_vocational', name: 'Vocational' },
        { part: 'part_7_government_defence', name: 'Government & Defence' },
        { part: 'part_8_emerging_future', name: 'Emerging & Future' },
      ],
    };
  }

  async adminToggleActive(careerCode: string) {
    const career = await this.findOne(careerCode);
    career.is_active = !career.is_active;
    await career.save();
    return {
      success: true,
      is_active: career.is_active,
      message: `${careerCode} ${career.is_active ? 'activated' : 'deactivated'}`,
    };
  }

  private getCareersSeedData(): Partial<Career>[] {
    const categories = {
      tech: 'emerging_future',
      biz: 'commerce',
      health: 'science',
      sci: 'science',
      design: 'arts_humanities',
      edu: 'arts_humanities',
      eng: 'science',
      media: 'arts_humanities',
    };

    const makeWeights = (w: Partial<Career['trait_weights']> = {}) => ({
      analytical_thinking: w.analytical_thinking ?? 50,
      creativity: w.creativity ?? 50,
      communication: w.communication ?? 50,
      leadership: w.leadership ?? 50,
      research: w.research ?? 50,
      business_acumen: w.business_acumen ?? 50,
      technical_curiosity: w.technical_curiosity ?? 50,
      empathy: w.empathy ?? 50,
      patience: w.patience ?? 50,
      risk_tolerance: w.risk_tolerance ?? 50,
    });

    const makeEligibility = (e: Partial<Career['eligibility']> = {}) => ({
      min_maths: e.min_maths ?? 0,
      min_science: e.min_science ?? 0,
      min_biology: e.min_biology ?? 0,
      min_english: e.min_english ?? 0,

      min_study_duration_years: e.min_study_duration_years ?? 3,
      max_study_duration_years: e.max_study_duration_years ?? 5,
      required_stream: e.required_stream ?? 'any',
      abroad_required: e.abroad_required ?? false,
    });

    const seeds: Partial<Career>[] = [
      {
        career_code: 'software_engineer',
        category_code: categories.tech,
        name: 'Software Engineer',
        description:
          'Designs, develops, and tests software systems and application platforms.',
        required_skills: ['Coding', 'Logical thinking', 'Problem solving'],
        technical_skills: ['JavaScript', 'Python', 'Web Development'],
        soft_skills: ['Communication', 'Teamwork', 'Patience'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression: 'Junior Dev -> Senior Dev -> Tech Lead -> CTO',
        trait_weights: makeWeights({
          analytical_thinking: 85,
          creativity: 75,
          technical_curiosity: 90,
          patience: 70,
        }),
        eligibility: makeEligibility({
          min_maths: 70,
          min_science: 65,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'data_scientist',
        category_code: categories.tech,
        name: 'Data Scientist',
        description:
          'Analyzes massive volumes of data to discover trends, build predictive models, and optimize decisions.',
        required_skills: ['Math', 'Logical thinking', 'Research'],
        technical_skills: ['SQL', 'Machine Learning', 'Python'],
        soft_skills: ['Observation', 'Communication', 'Patience'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Analyst -> Data Scientist -> Lead Scientist -> Chief Data Officer',
        trait_weights: makeWeights({
          analytical_thinking: 90,
          research: 85,
          technical_curiosity: 80,
          business_acumen: 60,
        }),
        eligibility: makeEligibility({
          min_maths: 80,
          min_science: 70,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'cybersecurity_analyst',
        category_code: categories.tech,
        name: 'Cybersecurity Analyst',
        description:
          'Defends digital networks, servers, and sensitive data from cyber threats and breaches.',
        required_skills: ['Observation', 'Logical thinking', 'Problem solving'],
        technical_skills: ['Network Security', 'Cryptography', 'Linux'],
        soft_skills: ['Patience', 'Communication', 'Teamwork'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression: 'Analyst -> Security Engineer -> CISO',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          technical_curiosity: 85,
          patience: 85,
          risk_tolerance: 50,
        }),
        eligibility: makeEligibility({
          min_maths: 65,
          min_science: 65,
          min_study_duration_years: 3,
        }),
      },
      {
        career_code: 'cloud_architect',
        category_code: categories.tech,
        name: 'Cloud Architect',
        description:
          'Designs and manages scalable, resilient cloud computing infrastructures.',
        required_skills: ['Logical thinking', 'Problem solving', 'Leadership'],
        technical_skills: ['AWS', 'Docker', 'Systems Architecture'],
        soft_skills: ['Communication', 'Teamwork', 'Patience'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Cloud Engineer -> Cloud Architect -> Enterprise Architect',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          leadership: 75,
          communication: 70,
          business_acumen: 60,
        }),
        eligibility: makeEligibility({
          min_maths: 65,
          min_science: 65,
          min_study_duration_years: 4,
        }),
      },
      {
        career_code: 'ai_engineer',
        category_code: categories.tech,
        name: 'AI Engineer',
        description:
          'Builds and deploys artificial intelligence systems and neural networks.',
        required_skills: ['Coding', 'Math', 'Logical thinking'],
        technical_skills: ['Deep Learning', 'PyTorch', 'Python'],
        soft_skills: ['Creativity', 'Patience', 'Observation'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression: 'AI Developer -> AI Architect -> AI Research Lead',
        trait_weights: makeWeights({
          analytical_thinking: 90,
          creativity: 80,
          technical_curiosity: 95,
          research: 80,
        }),
        eligibility: makeEligibility({
          min_maths: 80,
          min_science: 75,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'investment_banker',
        category_code: categories.biz,
        name: 'Investment Banker',
        description:
          'Helps corporations raise capital, structure mergers, and make acquisitions.',
        required_skills: ['Logical thinking', 'Communication', 'Leadership'],
        technical_skills: ['Financial Modeling', 'Corporate Finance', 'Excel'],
        soft_skills: ['Risk tolerance', 'Patience', 'Negotiation'],
        market_demand: 'High',
        future_scope: 'Stable',
        career_progression: 'Analyst -> Associate -> VP -> Managing Director',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          business_acumen: 90,
          communication: 80,
          risk_tolerance: 75,
        }),
        eligibility: makeEligibility({ min_maths: 75 }),
      },
      {
        career_code: 'financial_analyst',
        category_code: categories.biz,
        name: 'Financial Analyst',
        description:
          'Guides companies and individuals in investment strategies, asset allocation, and market analysis.',
        required_skills: ['Logical thinking', 'Math', 'Research'],
        technical_skills: ['Data Analysis', 'Excel', 'CFA curriculum'],
        soft_skills: ['Observation', 'Communication', 'Patience'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Junior Analyst -> Senior Analyst -> Portfolio Manager',
        trait_weights: makeWeights({
          analytical_thinking: 85,
          business_acumen: 80,
          research: 75,
          patience: 70,
        }),
        eligibility: makeEligibility({ min_maths: 70 }),
      },
      {
        career_code: 'chartered_accountant',
        category_code: categories.biz,
        name: 'Chartered Accountant',
        description:
          'Manages audits, taxation, financial records, and regulatory compliance for corporations.',
        required_skills: ['Logical thinking', 'Observation', 'Problem solving'],
        technical_skills: ['Auditing', 'Taxation Laws', 'Accounting Standards'],
        soft_skills: ['Patience', 'Communication', 'Integrity'],
        market_demand: 'High',
        future_scope: 'Stable',
        career_progression: 'Article Assistant -> Audit Manager -> CFO',
        trait_weights: makeWeights({
          analytical_thinking: 85,
          patience: 90,
          business_acumen: 75,
          communication: 70,
        }),
        eligibility: makeEligibility({
          min_maths: 70,
          required_stream: 'commerce',
        }),
      },
      {
        career_code: 'marketing_manager',
        category_code: categories.biz,
        name: 'Marketing Manager',
        description:
          'Orchestrates campaigns, brands, and public outreach strategies to drive sales and engagement.',
        required_skills: ['Creativity', 'Communication', 'Leadership'],
        technical_skills: ['SEO', 'Google Analytics', 'Brand Strategy'],
        soft_skills: ['Patience', 'Observation', 'Teamwork'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression: 'Marketing Exec -> Manager -> CMO',
        trait_weights: makeWeights({
          creativity: 85,
          communication: 90,
          leadership: 80,
          business_acumen: 80,
        }),
        eligibility: makeEligibility({ min_english: 60 }),
      },
      {
        career_code: 'entrepreneur',
        category_code: categories.biz,
        name: 'Entrepreneur',
        description:
          'Launches and grows new commercial enterprises, taking on financial and operations risks.',
        required_skills: ['Leadership', 'Creativity', 'Communication'],
        technical_skills: ['Business Strategy', 'Pitching', 'Sales'],
        soft_skills: ['Risk tolerance', 'Patience', 'Resilience'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression: 'Founder -> Serial Entrepreneur -> Board Director',
        trait_weights: makeWeights({
          leadership: 90,
          creativity: 85,
          business_acumen: 90,
          risk_tolerance: 90,
          communication: 80,
        }),
        eligibility: makeEligibility({}),
      },
      {
        career_code: 'medical_doctor',
        category_code: categories.health,
        name: 'Medical Doctor',
        description:
          'Diagnoses illnesses, prescribes treatments, and guides patient wellness programs.',
        required_skills: ['Problem solving', 'Observation', 'Research'],
        technical_skills: [
          'Clinical Diagnosis',
          'Medical Science',
          'Surgery basics',
        ],
        soft_skills: ['Empathy', 'Patience', 'Communication'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression: 'Resident -> Specialist -> Chief of Medicine',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          empathy: 95,
          patience: 90,
          research: 75,
          communication: 80,
        }),
        eligibility: makeEligibility({
          min_science: 80,
          min_biology: 80,
          min_study_duration_years: 5,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'dentist',
        category_code: categories.health,
        name: 'Dentist',
        description:
          'Specializes in oral health, dental surgeries, and reconstructive aesthetics.',
        required_skills: ['Observation', 'Drawing', 'Problem solving'],
        technical_skills: ['Oral Surgery', 'Dentistry Science', 'Radiology'],
        soft_skills: ['Empathy', 'Patience', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression: 'Associate Dentist -> Private Practice Owner',
        trait_weights: makeWeights({
          empathy: 85,
          patience: 85,
          creativity: 70,
          communication: 75,
        }),
        eligibility: makeEligibility({
          min_science: 75,
          min_biology: 75,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'pharmacist',
        category_code: categories.health,
        name: 'Pharmacist',
        description:
          'Prepares and dispenses medicines, explaining dosages and clinical interactions.',
        required_skills: ['Observation', 'Logical thinking', 'Math'],
        technical_skills: [
          'Pharmacology',
          'Drug Formulations',
          'Inventory Management',
        ],
        soft_skills: ['Patience', 'Communication', 'Integrity'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Pharmacist -> Pharmacy Manager -> Director of Pharmacy',
        trait_weights: makeWeights({
          analytical_thinking: 70,
          patience: 85,
          communication: 75,
          empathy: 70,
        }),
        eligibility: makeEligibility({
          min_science: 70,
          min_study_duration_years: 4,
        }),
      },
      {
        career_code: 'nurse',
        category_code: categories.health,
        name: 'Registered Nurse',
        description:
          'Provides critical bedside care, monitors patient vitals, and assists surgeons.',
        required_skills: ['Problem solving', 'Observation', 'Communication'],
        technical_skills: [
          'Patient Care',
          'Emergency Procedures',
          'Vitals Monitoring',
        ],
        soft_skills: ['Empathy', 'Patience', 'Teamwork'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Staff Nurse -> Senior Nurse -> Nurse Practitioner -> Chief Nursing Officer',
        trait_weights: makeWeights({
          empathy: 95,
          patience: 90,
          communication: 80,
          leadership: 60,
        }),
        eligibility: makeEligibility({
          min_science: 60,
          min_study_duration_years: 3,
        }),
      },
      {
        career_code: 'physiotherapist',
        category_code: categories.health,
        name: 'Physiotherapist',
        description:
          'Rehabilitates patients with movement limitations, physical traumas, and post-surgery recovering.',
        required_skills: ['Observation', 'Problem solving', 'Communication'],
        technical_skills: ['Anatomy', 'Exercise Therapy', 'Massage Techniques'],
        soft_skills: ['Empathy', 'Patience', 'Teamwork'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression: 'Physio -> Senior Therapist -> Clinic Owner',
        trait_weights: makeWeights({
          empathy: 90,
          patience: 90,
          communication: 80,
          analytical_thinking: 65,
        }),
        eligibility: makeEligibility({
          min_science: 65,
          min_study_duration_years: 4,
        }),
      },
      {
        career_code: 'biotechnologist',
        category_code: categories.sci,
        name: 'Biotechnologist',
        description:
          'Develops biological agents, medical vaccines, and agricultural products in lab environments.',
        required_skills: ['Research', 'Observation', 'Logical thinking'],
        technical_skills: [
          'Gene Editing',
          'Cell Culture',
          'Lab Safety Protocols',
        ],
        soft_skills: ['Patience', 'Communication', 'Teamwork'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression: 'Lab Associate -> Researcher -> Lab Director',
        trait_weights: makeWeights({
          research: 90,
          analytical_thinking: 80,
          technical_curiosity: 85,
          patience: 80,
        }),
        eligibility: makeEligibility({
          min_science: 75,
          min_biology: 75,
          min_study_duration_years: 3,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'research_scientist',
        category_code: categories.sci,
        name: 'Research Scientist',
        description:
          'Conducts systematic physical and life science investigations to expand theoretical frontiers.',
        required_skills: ['Research', 'Logical thinking', 'Problem solving'],
        technical_skills: [
          'Scientific Method',
          'Data Analysis',
          'Grant Writing',
        ],
        soft_skills: ['Patience', 'Creativity', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression: 'Postdoc -> Senior Researcher -> Research Fellow',
        trait_weights: makeWeights({
          research: 95,
          analytical_thinking: 85,
          patience: 90,
          technical_curiosity: 85,
        }),
        eligibility: makeEligibility({
          min_science: 80,
          min_maths: 70,
          min_study_duration_years: 4,
        }),
      },
      {
        career_code: 'astrophysicist',
        category_code: categories.sci,
        name: 'Astrophysicist',
        description:
          'Studies universe dynamics, planetary orbits, black holes, and deep space physics.',
        required_skills: ['Math', 'Logical thinking', 'Research'],
        technical_skills: [
          'Cosmology',
          'Quantum Mechanics',
          'Python Scripting',
        ],
        soft_skills: ['Patience', 'Creativity', 'Observation'],
        market_demand: 'Low',
        future_scope: 'Stable',
        career_progression:
          'Research Assistant -> Professor -> Principal Investigator',
        trait_weights: makeWeights({
          analytical_thinking: 95,
          research: 90,
          patience: 90,
          technical_curiosity: 90,
        }),
        eligibility: makeEligibility({
          min_maths: 85,
          min_science: 85,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'environmental_scientist',
        category_code: categories.sci,
        name: 'Environmental Scientist',
        description:
          'Formulates policies and technologies to mitigate pollution, global warming, and ecosystem crashes.',
        required_skills: ['Observation', 'Research', 'Problem solving'],
        technical_skills: ['GIS Mapping', 'Ecology Analysis', 'Field Sampling'],
        soft_skills: ['Communication', 'Patience', 'Passion for conservation'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression:
          'Field Analyst -> Project Manager -> Policy Consultant',
        trait_weights: makeWeights({
          research: 80,
          analytical_thinking: 75,
          communication: 75,
          empathy: 80,
        }),
        eligibility: makeEligibility({
          min_science: 70,
          min_study_duration_years: 3,
        }),
      },
      {
        career_code: 'clinical_psychologist',
        category_code: categories.edu,
        name: 'Clinical Psychologist',
        description:
          'Evaluates and treats emotional, cognitive, and mental health conditions in clinics.',
        required_skills: ['Observation', 'Communication', 'Research'],
        technical_skills: [
          'Cognitive Behavioral Therapy',
          'Psychological Assessment',
          'Research Methodologies',
        ],
        soft_skills: ['Empathy', 'Patience', 'Active Listening'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Intern -> Clinical Psychologist -> Private practice owner',
        trait_weights: makeWeights({
          empathy: 95,
          patience: 90,
          communication: 85,
          research: 80,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 4 }),
      },
      {
        career_code: 'graphic_designer',
        category_code: categories.design,
        name: 'Graphic Designer',
        description:
          'Translates corporate and product concepts into visual assets, layouts, and logos.',
        required_skills: ['Drawing', 'Creativity', 'Observation'],
        technical_skills: ['Photoshop', 'Illustrator', 'Typography'],
        soft_skills: ['Communication', 'Patience', 'Accepting feedback'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Junior Designer -> Art Director -> Creative Director',
        trait_weights: makeWeights({
          creativity: 95,
          communication: 75,
          patience: 70,
          technical_curiosity: 60,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'animator',
        category_code: categories.design,
        name: 'Animator',
        description:
          'Crafts 2D/3D moving sequences, visual effects, and gaming motions.',
        required_skills: ['Drawing', 'Creativity', 'Observation'],
        technical_skills: ['Maya', 'Blender', 'After Effects'],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression:
          'Junior Animator -> Lead Animator -> Director of Animation',
        trait_weights: makeWeights({
          creativity: 90,
          patience: 85,
          communication: 70,
          technical_curiosity: 70,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'fashion_designer',
        category_code: categories.design,
        name: 'Fashion Designer',
        description:
          'Ideates clothing, accessories, and footwear sketches and guides sewing collections.',
        required_skills: ['Drawing', 'Creativity', 'Observation'],
        technical_skills: [
          'Fashion Illustration',
          'Pattern Making',
          'CAD software',
        ],
        soft_skills: ['Communication', 'Patience', 'Risk tolerance'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Design Assistant -> Head Designer -> Fashion Brand Founder',
        trait_weights: makeWeights({
          creativity: 95,
          risk_tolerance: 70,
          business_acumen: 75,
          communication: 75,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'architect',
        category_code: categories.design,
        name: 'Architect',
        description:
          'Designs residential and industrial structures, drafting blueprints and overseeing build operations.',
        required_skills: ['Drawing', 'Logical thinking', 'Math'],
        technical_skills: ['AutoCAD', 'Revit', 'Structural Engineering basics'],
        soft_skills: ['Communication', 'Patience', 'Leadership'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Draftsman -> Associate Architect -> Principal Architect',
        trait_weights: makeWeights({
          creativity: 85,
          analytical_thinking: 80,
          leadership: 70,
          patience: 75,
        }),
        eligibility: makeEligibility({
          min_maths: 75,
          min_science: 70,
          min_study_duration_years: 5,
        }),
      },
      {
        career_code: 'ui_ux_designer',
        category_code: categories.design,
        name: 'UI/UX Designer',
        description:
          'Optimizes digital screens, mockups, and application navigation flows for human layouts.',
        required_skills: ['Observation', 'Creativity', 'Logical thinking'],
        technical_skills: ['Figma', 'Wireframing', 'User Research'],
        soft_skills: ['Empathy', 'Communication', 'Patience'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Designer -> Senior Designer -> Product Designer -> VP Design',
        trait_weights: makeWeights({
          empathy: 85,
          creativity: 85,
          analytical_thinking: 75,
          communication: 80,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'school_teacher',
        category_code: categories.edu,
        name: 'School Teacher',
        description:
          'Instructs school children in core subjects, designing class tasks and grading reports.',
        required_skills: ['Communication', 'Leadership', 'Observation'],
        technical_skills: [
          'Pedagogy',
          'Classroom Management',
          'Lesson Planning',
        ],
        soft_skills: ['Patience', 'Empathy', 'Creativity'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression: 'Teacher -> Head of Department -> Principal',
        trait_weights: makeWeights({
          patience: 95,
          communication: 90,
          empathy: 90,
          leadership: 75,
        }),
        eligibility: makeEligibility({
          min_english: 60,
          min_study_duration_years: 3,
        }),
      },
      {
        career_code: 'university_professor',
        category_code: categories.edu,
        name: 'University Professor',
        description:
          'Delivers collegiate lectures, conducts academic research, and publishes review papers.',
        required_skills: ['Research', 'Communication', 'Logical thinking'],
        technical_skills: [
          'Academic Writing',
          'Public Speaking',
          'Course Curriculum Design',
        ],
        soft_skills: ['Patience', 'Leadership', 'Observation'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression: 'Assistant Professor -> Tenured Professor -> Dean',
        trait_weights: makeWeights({
          research: 90,
          communication: 85,
          patience: 85,
          analytical_thinking: 80,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 4 }),
      },
      {
        career_code: 'social_worker',
        category_code: categories.edu,
        name: 'Social Worker',
        description:
          'Assists marginalized communities in accessing public welfare, education, and legal protection.',
        required_skills: ['Communication', 'Problem solving', 'Observation'],
        technical_skills: [
          'Case Management',
          'Community Outreach',
          'Crisis Intervention',
        ],
        soft_skills: ['Empathy', 'Patience', 'Active Listening'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression: 'Social Worker -> Program Manager -> NGO Director',
        trait_weights: makeWeights({
          empathy: 95,
          patience: 90,
          communication: 85,
          leadership: 70,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'mechanical_engineer',
        category_code: categories.eng,
        name: 'Mechanical Engineer',
        description:
          'Designs, manufactures, and tests heating systems, engines, and heavy machinery.',
        required_skills: ['Logical thinking', 'Math', 'Problem solving'],
        technical_skills: ['Thermodynamics', 'SolidWorks', 'CAD drawing'],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Design Engineer -> Senior Engineer -> Engineering Manager',
        trait_weights: makeWeights({
          analytical_thinking: 85,
          technical_curiosity: 80,
          patience: 75,
          leadership: 60,
        }),
        eligibility: makeEligibility({
          min_maths: 70,
          min_science: 70,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'civil_engineer',
        category_code: categories.eng,
        name: 'Civil Engineer',
        description:
          'Directs the engineering computations, planning, and execution of dams, roads, and bridges.',
        required_skills: ['Logical thinking', 'Math', 'Leadership'],
        technical_skills: ['Structural Mechanics', 'Surveying', 'STAAD Pro'],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Site Engineer -> Project Engineer -> Project Director',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          leadership: 75,
          patience: 80,
          teamwork: 70,
        } as any),
        eligibility: makeEligibility({
          min_maths: 70,
          min_science: 70,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'electrical_engineer',
        category_code: categories.eng,
        name: 'Electrical Engineer',
        description:
          'Designs power grids, semiconductor microchips, and electromagnetic devices.',
        required_skills: ['Logical thinking', 'Math', 'Problem solving'],
        technical_skills: ['Circuit Design', 'MATLAB', 'Power Systems'],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Electrical Engineer -> Project Manager -> Technical Lead',
        trait_weights: makeWeights({
          analytical_thinking: 85,
          technical_curiosity: 85,
          patience: 75,
        }),
        eligibility: makeEligibility({
          min_maths: 75,
          min_science: 70,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'aerospace_engineer',
        category_code: categories.eng,
        name: 'Aerospace Engineer',
        description:
          'Calculates dynamics and assembly layouts of satellites, aeroplanes, and rockets.',
        required_skills: ['Math', 'Logical thinking', 'Research'],
        technical_skills: ['Aerodynamics', 'Fluid Mechanics', 'ANSYS modeling'],
        soft_skills: ['Patience', 'Observation', 'Teamwork'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression:
          'Systems Engineer -> Senior Aerospace Specialist -> Project Lead',
        trait_weights: makeWeights({
          analytical_thinking: 90,
          research: 80,
          technical_curiosity: 90,
          patience: 80,
        }),
        eligibility: makeEligibility({
          min_maths: 80,
          min_science: 80,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'chemical_engineer',
        category_code: categories.eng,
        name: 'Chemical Engineer',
        description:
          'Designs industrial refinery processes, synthetic plastic production, and chemical safety equipment.',
        required_skills: ['Logical thinking', 'Math', 'Research'],
        technical_skills: [
          'Process Control',
          'Mass Transfer',
          'Refinery Design',
        ],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Process Engineer -> Plant Manager -> Technical Director',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          research: 75,
          patience: 80,
          technical_curiosity: 75,
        }),
        eligibility: makeEligibility({
          min_maths: 70,
          min_science: 75,
          min_study_duration_years: 4,
          required_stream: 'science',
        }),
      },
      {
        career_code: 'journalist',
        category_code: categories.media,
        name: 'Journalist',
        description:
          'Investigates political, commercial, and local news events to write public reports.',
        required_skills: ['Communication', 'Research', 'Observation'],
        technical_skills: [
          'News Writing',
          'Interviewing Techniques',
          'Video Editing',
        ],
        soft_skills: ['Risk tolerance', 'Patience', 'Resilience'],
        market_demand: 'Low',
        future_scope: 'Stable',
        career_progression: 'Reporter -> Senior Editor -> Editor in Chief',
        trait_weights: makeWeights({
          communication: 90,
          research: 85,
          risk_tolerance: 80,
          observation: 85,
        } as any),
        eligibility: makeEligibility({ min_english: 65 }),
      },
      {
        career_code: 'content_writer',
        category_code: categories.media,
        name: 'Content Writer',
        description:
          'Drafts articles, blog posts, scripts, and promotional texts for digital sites.',
        required_skills: ['Creativity', 'Communication', 'Observation'],
        technical_skills: [
          'SEO copywriting',
          'CMS platforms',
          'Content Marketing',
        ],
        soft_skills: ['Patience', 'Adaptability', 'Time management'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'Junior Writer -> Content Strategist -> Head of Content',
        trait_weights: makeWeights({
          creativity: 85,
          communication: 85,
          patience: 80,
        }),
        eligibility: makeEligibility({ min_english: 60 }),
      },
      {
        career_code: 'pr_specialist',
        category_code: categories.media,
        name: 'Public Relations Specialist',
        description:
          'Coordinates media communications, press releases, and public campaigns to maintain brand image.',
        required_skills: ['Communication', 'Leadership', 'Observation'],
        technical_skills: [
          'Media Relations',
          'Press Kit Design',
          'Crisis Communication',
        ],
        soft_skills: ['Patience', 'Networking', 'Adaptability'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'PR Coordinator -> PR Manager -> Director of Communications',
        trait_weights: makeWeights({
          communication: 95,
          leadership: 75,
          business_acumen: 70,
          risk_tolerance: 60,
        }),
        eligibility: makeEligibility({ min_english: 65 }),
      },
      {
        career_code: 'product_manager',
        category_code: categories.tech,
        name: 'Product Manager',
        description:
          'Bridges technical, business, and design layers to coordinate product lifecycles and feature maps.',
        required_skills: ['Leadership', 'Logical thinking', 'Communication'],
        technical_skills: [
          'Product Lifecycle',
          'Data Analytics',
          'Agile Methodologies',
        ],
        soft_skills: ['Patience', 'Empathy', 'Influence without authority'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Associate PM -> Product Manager -> VP Product -> CPO',
        trait_weights: makeWeights({
          leadership: 85,
          communication: 90,
          analytical_thinking: 75,
          business_acumen: 85,
          empathy: 70,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'hr_manager',
        category_code: categories.biz,
        name: 'HR Manager',
        description:
          'Oversees employee onboarding, performance appraisals, workplace benefits, and conflict mediation.',
        required_skills: ['Communication', 'Leadership', 'Observation'],
        technical_skills: ['Labour Laws', 'HRIS systems', 'Talent Acquisition'],
        soft_skills: ['Empathy', 'Patience', 'Mediation'],
        market_demand: 'Medium',
        future_scope: 'Stable',
        career_progression:
          'HR Specialist -> HR Manager -> HR Director -> CHRO',
        trait_weights: makeWeights({
          empathy: 90,
          communication: 85,
          patience: 90,
          leadership: 75,
        }),
        eligibility: makeEligibility({ min_study_duration_years: 3 }),
      },
      {
        career_code: 'data_analyst',
        category_code: categories.tech,
        name: 'Data Analyst',
        description:
          'Cleans and evaluates numeric records, constructing dashboard dashboards to guide operations.',
        required_skills: ['Math', 'Logical thinking', 'Observation'],
        technical_skills: ['Power BI', 'SQL', 'Excel dashboards'],
        soft_skills: ['Patience', 'Communication', 'Attention to detail'],
        market_demand: 'High',
        future_scope: 'Growing',
        career_progression:
          'Junior Analyst -> Senior Analyst -> Analytics Manager',
        trait_weights: makeWeights({
          analytical_thinking: 80,
          math: 80,
          patience: 85,
          communication: 70,
        } as any),
        eligibility: makeEligibility({
          min_maths: 65,
          min_study_duration_years: 3,
        }),
      },
      {
        career_code: 'game_developer',
        category_code: categories.tech,
        name: 'Game Developer',
        description:
          'Programs gaming engines, controls rendering speeds, and compiles mechanical physics code.',
        required_skills: ['Coding', 'Logical thinking', 'Creativity'],
        technical_skills: ['C++', 'Unity', 'Unreal Engine'],
        soft_skills: ['Patience', 'Teamwork', 'Communication'],
        market_demand: 'Medium',
        future_scope: 'Growing',
        career_progression:
          'Junior Dev -> Lead Game Developer -> Technical Director',
        trait_weights: makeWeights({
          creativity: 85,
          coding: 85,
          analytical_thinking: 75,
          technical_curiosity: 80,
        } as any),
        eligibility: makeEligibility({
          min_maths: 70,
          min_science: 65,
          min_study_duration_years: 4,
        }),
      },
    ];

    return seeds;
  }
}
