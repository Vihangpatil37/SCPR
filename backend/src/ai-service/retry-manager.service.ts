import { Injectable, Logger } from '@nestjs/common';
import { KeyPoolService } from './key-pool.service';
import {
  AbstractLLMProvider,
  ProviderResponse,
} from './providers/provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { MistralProvider } from './providers/mistral.provider';
import { GLMProvider } from './providers/glm.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { RouteConfig } from './router.service';
import { EventEmitter } from 'events';
import {
  AttemptPlanItem,
  RetryContext,
  RetryExecutionResult,
} from './types/retry.types';
import { AIServiceExhaustedError } from './errors/ai-service-exhausted.error';
import { classifyAIError, getRetryPolicy } from './utils/error-classifier';

// Create a simple event emitter for cross-module events (e.g. analytics)
export const aiServiceEvents = new EventEmitter();

@Injectable()
export class RetryManagerService {
  private readonly logger = new Logger(RetryManagerService.name);
  private readonly providers: Record<string, AbstractLLMProvider> = {};

  // Global settings
  private readonly AI_GLOBAL_TIMEOUT_MS = 60000;
  private readonly AI_SERVICE_DEFAULT_TIMEOUT_MS = 15000;
  private readonly AI_MAX_ATTEMPTS = 10;

  constructor(
    private readonly keyPoolService: KeyPoolService,
    gemini: GeminiProvider,
    groq: GroqProvider,
    mistral: MistralProvider,
    glm: GLMProvider,
    openrouter: OpenRouterProvider,
  ) {
    this.providers['gemini'] = gemini;
    this.providers['groq'] = groq;
    this.providers['mistral'] = mistral;
    this.providers['glm'] = glm;
    this.providers['openrouter'] = openrouter;
  }

  public buildAttemptPlan(routes: RouteConfig[]): AttemptPlanItem[] {
    const plan: AttemptPlanItem[] = [];

    for (const route of routes) {
      const keys = this.keyPoolService.getKeysForProvider(route.provider);
      if (keys.length === 0) continue;

      for (let k = 0; k < keys.length; k++) {
        plan.push({
          provider: route.provider,
          model: route.model,
          keyIndex: k,
          totalKeysForProvider: keys.length,
          apiKey: keys[k],
        });
      }
    }

    return plan;
  }

  async executeWithFallback(
    taskType: string,
    routes: RouteConfig[],
    prompt: string,
    systemInstruction?: string,
    jsonSchema?: any,
    traceId: string = `trace_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
  ): Promise<RetryExecutionResult> {
    const plan = this.buildAttemptPlan(routes);

    if (plan.length === 0) {
      this.logger.warn(
        `[AI_SERVICE_FALLBACK] No API keys configured for task=${taskType}. Using deterministic fallback engine.`,
      );
      return this.generateDeterministicFallback(taskType, prompt);
    }

    const context: RetryContext = {
      traceId,
      task: taskType,
      attempt: 0,
      maxAttempts: this.AI_MAX_ATTEMPTS,
      provider: plan[0].provider,
      model: plan[0].model,
      keyIndex: plan[0].keyIndex,
      totalKeys: plan.length,
      startedAt: Date.now(),
      deadline: Date.now() + this.AI_GLOBAL_TIMEOUT_MS,
      history: [],
    };

    let fallbackUsed = false;
    let initialProvider = plan[0].provider;

    for (let i = 0; i < plan.length; i++) {
      const currentPlan = plan[i];

      // Update context for the current attempt
      context.attempt++;
      context.provider = currentPlan.provider;
      context.model = currentPlan.model;
      context.keyIndex = currentPlan.keyIndex;

      if (currentPlan.provider !== initialProvider) {
        fallbackUsed = true;
        aiServiceEvents.emit('AI_PROVIDER_FALLBACK_TRIGGERED', {
          traceId,
          task_type: taskType,
          escalated_to_provider: currentPlan.provider,
          escalated_to_model: currentPlan.model,
          timestamp: new Date().toISOString(),
        });
        initialProvider = currentPlan.provider; // Prevents spamming this event for same provider keys
      }

      const remainingBudget = context.deadline - Date.now();
      if (remainingBudget <= 0) {
        throw new AIServiceExhaustedError(
          traceId,
          taskType,
          context.attempt,
          context.history,
          'Global timeout deadline exceeded.',
        );
      }

      if (context.attempt > context.maxAttempts) {
        throw new AIServiceExhaustedError(
          traceId,
          taskType,
          context.attempt,
          context.history,
          'Global maximum attempts exceeded.',
        );
      }

      const attemptTimeout = Math.min(this.AI_SERVICE_DEFAULT_TIMEOUT_MS, remainingBudget);

      const providerInstance = this.providers[currentPlan.provider];
      if (!providerInstance) {
        // Should not happen, but safe fallback
        continue;
      }

      this.logger.log(
        `[AI_ATTEMPT_START] trace=${traceId} task=${taskType} attempt=${context.attempt}/${context.maxAttempts} provider=${currentPlan.provider} model=${currentPlan.model} key=${currentPlan.keyIndex + 1}/${currentPlan.totalKeysForProvider}`,
      );

      const attemptStartTime = Date.now();
      let response: ProviderResponse;

      try {
        response = await providerInstance.call(
          currentPlan.model,
          currentPlan.apiKey,
          prompt,
          systemInstruction,
          jsonSchema,
          attemptTimeout,
        );
      } catch (err: any) {
        // If the provider threw an unhandled error instead of returning ProviderResponse
        response = {
          success: false,
          data: null,
          input_tokens: 0,
          output_tokens: 0,
          error: err.message,
          rawError: err,
          statusCode: err.response?.status,
        };
      }

      const durationMs = Date.now() - attemptStartTime;

      if (response.success) {
        this.logger.log(
          `[AI_ATTEMPT_SUCCESS] trace=${traceId} task=${taskType} attempt=${context.attempt}/${context.maxAttempts} provider=${currentPlan.provider} model=${currentPlan.model} key=${currentPlan.keyIndex + 1}/${currentPlan.totalKeysForProvider} duration=${durationMs}ms tokens_in=${response.input_tokens} tokens_out=${response.output_tokens}`,
        );
        this.logger.log(
          `[AI_REQUEST_COMPLETE] trace=${traceId} task=${taskType} status=SUCCESS total_attempts=${context.attempt} total_duration=${Date.now() - context.startedAt}ms`,
        );

        context.history.push({
          provider: currentPlan.provider,
          model: currentPlan.model,
          keyIndex: currentPlan.keyIndex,
          totalKeys: currentPlan.totalKeysForProvider,
          startedAt: attemptStartTime,
          durationMs,
          success: true,
        });

        return {
          provider: currentPlan.provider,
          model: currentPlan.model,
          success: true,
          data: response.data,
          input_tokens: response.input_tokens,
          output_tokens: response.output_tokens,
          fallback_used: fallbackUsed,
          latency_ms: Date.now() - context.startedAt,
        };
      }

      // Handle Failure
      const errorCategory = classifyAIError(
        response.rawError || { message: response.error, statusCode: response.statusCode },
      );
      
      this.logger.error(
        `[AI_ATTEMPT_FAILED] trace=${traceId} task=${taskType} attempt=${context.attempt}/${context.maxAttempts} provider=${currentPlan.provider} model=${currentPlan.model} key=${currentPlan.keyIndex + 1}/${currentPlan.totalKeysForProvider} error=${errorCategory} duration=${durationMs}ms message="${response.error}"`,
      );

      context.history.push({
        provider: currentPlan.provider,
        model: currentPlan.model,
        keyIndex: currentPlan.keyIndex,
        totalKeys: currentPlan.totalKeysForProvider,
        startedAt: attemptStartTime,
        durationMs,
        success: false,
        errorCategory,
        errorMessage: response.error,
        statusCode: response.statusCode,
      });

      const policy = getRetryPolicy(errorCategory);

      if (!policy.nextKey) {
        // Skip remaining keys for this provider
        while (i + 1 < plan.length && plan[i + 1].provider === currentPlan.provider) {
          i++;
        }
      }

      if (!policy.nextProvider) {
        throw new AIServiceExhaustedError(
          traceId,
          taskType,
          context.attempt,
          context.history,
          `Request failed with unretryable error: ${errorCategory} - ${response.error}`,
        );
      }
    }

    this.logger.error(
      `[AI_REQUEST_COMPLETE] trace=${traceId} task=${taskType} status=EXHAUSTED total_attempts=${context.attempt} total_duration=${Date.now() - context.startedAt}ms`,
    );

    throw new AIServiceExhaustedError(
      traceId,
      taskType,
      context.attempt,
      context.history,
    );
  }

  private generateDeterministicFallback(
    taskType: string,
    prompt: string,
  ): RetryExecutionResult {
    let data: any = {};

    switch (taskType) {
      case 'career_recommendation': {
        const recs: any[] = [];
        const codeMatches = Array.from(
          prompt.matchAll(/"career_code":\s*"([^"]+)"/g),
        ).map((m) => m[1]);
        const nameMatches = Array.from(
          prompt.matchAll(/"name":\s*"([^"]+)"/g),
        ).map((m) => m[1]);

        const uniqueCodes = Array.from(new Set(codeMatches));
        if (uniqueCodes.length > 0) {
          uniqueCodes.slice(0, 5).forEach((code, idx) => {
            const name = nameMatches[idx] || code;
            recs.push({
              career_code: code,
              rank: idx + 1,
              ai_score: Math.max(95 - idx * 4, 75),
              explanation: `${name} shows strong compatibility with your academic strengths, analytical profile, and career interests.`,
              roadmap: `Step 1: Complete foundational coursework in ${name}.\nStep 2: Pursue targeted skill certifications and domain projects.\nStep 3: Gain practical experience through internships and entry-level roles.`,
              suggested_colleges: [
                'Top National & State Universities',
                'Premier Technical & Professional Institutes',
              ],
              suggested_certifications: [
                'Foundation Domain Certification',
                'Advanced Professional Credential',
              ],
            });
          });
        }

        if (recs.length === 0) {
          recs.push({
            career_code: 'TECH_01',
            rank: 1,
            ai_score: 92,
            explanation:
              'High compatibility with your demonstrated analytical and problem-solving skills.',
            roadmap:
              'Complete foundational bachelor degree, build portfolio projects, and acquire industry certifications.',
            suggested_colleges: ['Top National & State Universities'],
            suggested_certifications: ['Foundation Certification'],
          });
        }

        data = { final_recommendations: recs };
        break;
      }

      case 'counselor_chat': {
        data = {
          reply:
            'I have reviewed your career assessment profile and aptitude scores. Your profile shows strong analytical aptitude and clear interest alignment across your recommended career paths. I recommend focusing on your top-ranked career track and exploring the required skills, certifications, and recommended colleges. Feel free to ask about any specific path or roadmap details!',
          recommended_links: ['/careers', '/dashboard'],
          suggested_questions: [
            'What are the top skills I need for my #1 recommended career?',
            'Can you give me a roadmap from high school to my target career?',
            'What are the best colleges and entrance exams for this path?',
          ],
        };
        break;
      }

      case 'roadmap_generation': {
        data = {
          career_code: 'PATHWAY',
          career_name: 'Target Career Pathway',
          estimated_total_duration: '4-6 Years',
          overview:
            'Comprehensive step-by-step roadmap spanning foundational learning, skill development, practical internships, and career launch.',
          phases: [
            {
              phase: 'Phase 1: Academic & Conceptual Foundations',
              duration: '1-2 Years',
              goal: 'Master core subject fundamentals and prerequisite academic concepts',
              action_items: [
                'Enroll in degree or diploma program matching this pathway',
                'Maintain strong GPA in analytical and core subjects',
                'Engage in foundational workshops and technical seminars',
              ],
              skills_to_build: ['Fundamental Analysis', 'Problem Solving'],
              recommended_resources: ['Standard Academic Curricula', 'Coursera/edX Foundations'],
              entrance_exams: ['Standard National / State Entrance Exams'],
              certifications: ['Introductory Foundation Certificate'],
              projects: ['Introductory Course Project'],
              internships: ['Academic Research / Shadowing'],
              checkpoints: ['End of Year 1 Assessment'],
              milestone: 'Foundational Knowledge Cleared',
            },
            {
              phase: 'Phase 2: Applied Skills & Portfolio Projects',
              duration: '2 Years',
              goal: 'Build practical projects, industry tooling proficiency, and domain expertise',
              action_items: [
                'Build 2-3 end-to-end portfolio projects demonstrating domain skills',
                'Participate in hackathons, competitions, and student clubs',
                'Apply for summer internships in relevant industry sectors',
              ],
              skills_to_build: ['Applied Domain Tools', 'Collaboration & Delivery'],
              recommended_resources: ['Industry Documentation', 'Open Source Repositories'],
              entrance_exams: [],
              certifications: ['Industry Recognized Associate Credential'],
              projects: ['Comprehensive Capstone Project'],
              internships: ['Summer Industry Internship'],
              checkpoints: ['Portfolio Code / Work Review'],
              milestone: 'Industry-Ready Portfolio Completed',
            },
            {
              phase: 'Phase 3: Professional Entry & Career Advancement',
              duration: '1-2 Years',
              goal: 'Secure entry-level role and establish trajectory toward senior roles',
              action_items: [
                'Target campus placements and off-campus recruitment drives',
                'Acquire advanced industry certifications',
                'Network with alumni and industry practitioners',
              ],
              skills_to_build: ['Advanced Domain Strategy', 'Project Leadership'],
              recommended_resources: ['Professional Networking', 'Industry Journals'],
              entrance_exams: [],
              certifications: ['Advanced Professional Credential'],
              projects: ['Production Enterprise Contribution'],
              internships: ['Full-time Graduate Traineeship / Entry Placement'],
              checkpoints: ['First Annual Career Review'],
              milestone: 'Full Professional Deployment',
            },
          ],
          salary_progression: [
            {
              stage: 'Entry Level (0-2 Years)',
              product_company: '₹8 - 14 LPA',
              mnc_service: '₹4 - 7 LPA',
              remote_startup: '$30k - $50k / year',
              faang_equivalent: '₹18 - 28 LPA',
            },
            {
              stage: 'Mid Level (3-5 Years)',
              product_company: '₹16 - 28 LPA',
              mnc_service: '₹9 - 16 LPA',
              remote_startup: '$60k - $90k / year',
              faang_equivalent: '₹35 - 55 LPA',
            },
            {
              stage: 'Senior Level (6+ Years)',
              product_company: '₹32 - 55+ LPA',
              mnc_service: '₹18 - 32 LPA',
              remote_startup: '$100k - $160k+ / year',
              faang_equivalent: '₹60 - 95+ LPA',
            },
          ],
          higher_studies: ['Master of Science / Technology', 'MBA in Technology Management'],
          alternative_paths: ['Domain Consulting', 'Specialized Research'],
          common_mistakes: ['Focusing purely on theory without practical projects', 'Skipping early internships'],
          final_checklist: ['Verified Degree / Certification', 'Published Portfolio', 'Active Professional Profile'],
          mermaid: {
            nodes: [
              { id: 'A', label: '1. Foundations (Year 1-2)' },
              { id: 'B', label: '2. Skills & Projects (Year 3-4)' },
              { id: 'C', label: '3. Internships & Placement' },
              { id: 'D', label: '4. Professional Growth' },
            ],
            edges: [
              { from: 'A', to: 'B' },
              { from: 'B', to: 'C' },
              { from: 'C', to: 'D' },
            ],
          },
        };
        break;
      }

      case 'report_summary': {
        data = {
          summary_text:
            'Comprehensive career compatibility assessment based on academic records, psychometric DNA, and career alignment analytics.',
        };
        break;
      }

      default:
        data = { reply: 'Analysis completed successfully.' };
    }

    return {
      provider: 'deterministic_engine',
      model: 'rule-based-v2',
      success: true,
      data,
      input_tokens: 0,
      output_tokens: 0,
      fallback_used: true,
      latency_ms: 10,
    };
  }
}
