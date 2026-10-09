import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  StudentProfile,
  StudentProfileDocument,
  StudentDNA,
} from './schemas/student-profile.schema';
import {
  StudentDNAHistory,
  StudentDNAHistoryDocument,
} from './schemas/student-dna-history.schema';
import { OnboardingFlowService } from './onboarding-flow.service';
import { TraitEngineService } from './trait-engine.service';
import { AIServiceClient } from '../ai-service/ai-service.client';
import { EventEmitter } from 'events';

// Create event emitter for recommendation wiring in Phase 4
export const onboardingEvents = new EventEmitter();

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectModel(StudentProfile.name)
    private readonly profileModel: Model<StudentProfileDocument>,
    @InjectModel(StudentDNAHistory.name)
    private readonly dnaHistoryModel: Model<StudentDNAHistoryDocument>,
    private readonly flowService: OnboardingFlowService,
    private readonly traitEngine: TraitEngineService,
    private readonly aiClient: AIServiceClient,
  ) {}

  async startOnboarding(userId: string) {
    let profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      profile = new this.profileModel({
        user_id: userId,
        onboarding_step: 'personal',
        completion_percentage: 0,
      });
      await profile.save();
      this.logger.log(`Started onboarding session for user: ${userId}`);
      onboardingEvents.emit('ONBOARDING_STARTED', { user_id: userId });
    }
    return profile;
  }

  async resumeOnboarding(userId: string) {
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      // Auto-start if not exists
      return this.startOnboarding(userId);
    }
    return profile;
  }

  async saveStep(userId: string, stepKey: string, stepData: any) {
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      throw new NotFoundException(
        'Onboarding profile not found. Call start first.',
      );
    }

    const normalizedStep = stepKey.toLowerCase();

    // Validate step transition
    this.flowService.validateStepTransition(
      profile.onboarding_step,
      normalizedStep,
    );

    // Save the step data dynamically into the corresponding sub-document/field
    switch (normalizedStep) {
      case 'personal':
        profile.personal = stepData;
        break;
      case 'academic':
        profile.academic = stepData;
        break;
      case 'interests':
        profile.interests = stepData;
        break;
      case 'skills':
        profile.skills = stepData;
        break;
      case 'goals':
        profile.goals = stepData.goals;
        break;
      case 'work_preferences':
        profile.work_preferences = stepData.work_preferences;
        break;
      case 'constraints':
        profile.constraints = stepData;
        break;
      case 'scenarios':
        profile.scenario_responses = stepData.scenario_responses;
        break;
      default:
        throw new BadRequestException(`Unknown step key: ${stepKey}`);
    }

    // Update current step index and progression percentage if onboarding is not complete
    if (profile.onboarding_step !== 'complete') {
      const nextStep = this.flowService.getNextStep(normalizedStep);
      if (
        this.flowService.getStepIndex(normalizedStep) >=
        this.flowService.getStepIndex(profile.onboarding_step)
      ) {
        profile.onboarding_step = nextStep;
      }
      profile.completion_percentage =
        this.flowService.getCompletionPercentage(normalizedStep);
    }

    // Ensure array fields are sanitized to prevent CastErrors
    if (!Array.isArray(profile.goals)) {
      if (typeof profile.goals === 'object' && profile.goals !== null) {
        const obj = profile.goals as any;
        profile.goals = [
          ...(Array.isArray(obj.target_roles) ? obj.target_roles : []),
          ...(Array.isArray(obj.preferred_industries) ? obj.preferred_industries : []),
        ];
      } else {
        profile.goals = [];
      }
    }
    if (!Array.isArray(profile.work_preferences)) {
      profile.work_preferences = [];
    }
    if (!Array.isArray(profile.scenario_responses)) {
      profile.scenario_responses = [];
    }

    await profile.save();
    this.logger.log(
      `Saved onboarding step ${normalizedStep} for user: ${userId}`,
    );

    onboardingEvents.emit('ONBOARDING_STEP_COMPLETED', {
      user_id: userId,
      step: normalizedStep,
      completion_percentage: profile.completion_percentage,
    });

    // Emit profile updated event if step is not personal (profile-relevant change)
    if (normalizedStep !== 'personal') {
      onboardingEvents.emit('PROFILE_UPDATED', { user_id: userId });
    }

    return profile;
  }

  async completeOnboarding(userId: string) {
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      throw new NotFoundException('Onboarding profile not found');
    }

    // Ensure all steps are completed (step key must be 'complete' or we are on the final step 'scenarios')
    if (
      profile.onboarding_step !== 'complete' &&
      profile.onboarding_step !== 'scenarios'
    ) {
      throw new BadRequestException(
        `Cannot complete onboarding yet. Current step is: ${profile.onboarding_step}`,
      );
    }

    // 1. Compute DNA traits deterministically
    const dna = this.traitEngine.computeDNA(profile);

    // 2. Save DNA traits to profile
    profile.current_dna = dna;
    profile.onboarding_step = 'complete';
    profile.completion_percentage = 100;
    await profile.save();

    // 3. Log DNA Snapshot in history
    const history = new this.dnaHistoryModel({
      user_id: userId,
      dna_snapshot: dna,
      trigger: 'onboarding_complete',
    });
    await history.save();

    this.logger.log(
      `Completed onboarding and generated DNA for user: ${userId}`,
    );

    // 4. Emit event to trigger recommendation pipeline (Phase 4 stub)
    onboardingEvents.emit('ONBOARDING_COMPLETED', {
      user_id: userId,
      dna,
    });

    return dna;
  }

  async generateScenarios(userId: string): Promise<any> {
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      throw new NotFoundException('Onboarding profile not found.');
    }

    const context = {
      student_profile: {
        personal: profile.personal,
        academic: profile.academic,
        interests: profile.interests,
        skills: profile.skills,
        goals: profile.goals,
        work_preferences: profile.work_preferences,
        constraints: profile.constraints,
      },
    };

    let scenarios: any[];
    try {
      const response = await this.aiClient.run('scenario_generation', context);
      scenarios = response.data?.scenarios || [];
    } catch (err: any) {
      this.logger.warn(
        `AI scenario generation failed (${err?.message || 'unknown'}), falling back to offline scenarios.`,
      );
      scenarios = this.buildOfflineScenarios();
    }
    profile.pending_scenarios = scenarios;
    await profile.save();
    return { scenarios };
  }

  // ponytail: deterministic static scenarios so the step works with no AI keys/quota;
  // swap with richer AI variants when a provider is configured
  private buildOfflineScenarios(): any[] {
    const templates: Array<{
      trait: string;
      question: string;
      options: string[];
    }> = [
      {
        trait: 'leadership',
        question:
          'Your class has been given a small budget to organize the annual day event. No one wants to lead. What do you do?',
        options: [
          'Step forward and take charge of assigning roles and running the event',
          'Wait for someone else to volunteer first',
          'Propose splitting the work with no single leader',
          'Focus only on the tasks you are personally assigned',
        ],
      },
      {
        trait: 'analytical_thinking',
        question:
          'Your monthly pocket money is not enough after a few big spends. How do you figure out where it went?',
        options: [
          'List every expense and compare it against income to spot patterns',
          'Decide to spend less from now on without checking past spending',
          'Ask a friend what they normally do',
          'Ignore it and hope next month is better',
        ],
      },
      {
        trait: 'business_acumen',
        question:
          'A small local shop wants to attract more students. What idea do you pitch?',
        options: [
          'A student-friendly offer that keeps customers coming back regularly',
          'A one-time deep discount on everything',
          'Better shop lighting and music',
          'Nothing changes, the shop already does fine',
        ],
      },
      {
        trait: 'communication',
        question:
          'You need to explain a tricky science topic to a younger cousin. How do you start?',
        options: [
          'Break it into simple, everyday examples they can relate to',
          'Repeat the textbook lines slowly',
          'Show them the diagram and leave them to read it',
          'Tell them to just memorise the topic',
        ],
      },
      {
        trait: 'empathy',
        question:
          'A classmate quietly tells you they are struggling to keep up. What do you do?',
        options: [
          'Listen properly and offer specific, private help',
          'Give them a quick pep talk and move on',
          'Mention it in front of the class for study groups',
          'Say everyone struggles and change the topic',
        ],
      },
      {
        trait: 'creativity',
        question:
          'You have to present a topic the class has heard before. How do you make it interesting?',
        options: [
          'Invent a new story, analogy or visual twist to retell it',
          'Repeat the standard slides with more details',
          'Keep it short and quiet',
          'Present through a long, direct question-session',
        ],
      },
      {
        trait: 'patience',
        question:
          'A robotics project keeps failing even after many tries. What do you do?',
        options: [
          'Stay focused and test one small change at a time',
          'Try random big changes until one works',
          'Take a break and abandon the project',
          'Ask everyone to restart from scratch',
        ],
      },
      {
        trait: 'risk_tolerance',
        question:
          'You can either keep your safe weekly routine or try a new competitive opportunity. What now?',
        options: [
          'Weigh the upside and take a measured risk',
          'Always stick with what is safe and known',
          'Jump in only if it needs no extra effort',
          'Try it only if everyone else does too',
        ],
      },
      {
        trait: 'technical_curiosity',
        question:
          'A tool or app at home breaks in an unfamiliar way. How do you react?',
        options: [
          'Try to understand how it works and tinker to fix it',
          'Reset it and hope for the best',
          'Unplug it and leave it for someone else',
          'Use a different tool instead',
        ],
      },
      {
        trait: 'research',
        question:
          'You are asked to write on a new topic you know little about. How do you begin?',
        options: [
          'Look up several reliable sources and note what makes sense',
          'Write from memory and keep it short',
          'Ask one friend their thoughts and copy it',
          'Rewrite an article you find',
        ],
      },
    ];

    return templates.map((t, i) => ({
      id: i + 1,
      question: t.question,
      options: t.options,
      trait: t.trait,
    }));
  }

  async getDNA(userId: string): Promise<StudentDNA> {
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile || !profile.current_dna) {
      throw new NotFoundException(
        'Student DNA not found. Onboarding must be completed first.',
      );
    }
    return profile.current_dna;
  }
}
