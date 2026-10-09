import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import {
  ConversationMessage,
  ConversationMessageDocument,
} from './schemas/conversation-message.schema';
import { ContextBuilderService } from './context-builder.service';
import {
  StudentProfile,
  StudentProfileDocument,
} from '../onboarding/schemas/student-profile.schema';
import {
  Recommendation,
  RecommendationDocument,
} from '../recommendation/schemas/recommendation.schema';
import { Career, CareerDocument } from '../careers/schemas/career.schema';
import { AIServiceClient } from '../ai-service/ai-service.client';
import { StartSessionDto } from './dto/counselor.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@Injectable()
export class CounselorService {
  private readonly logger = new Logger(CounselorService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(ConversationMessage.name)
    private readonly messageModel: Model<ConversationMessageDocument>,
    @InjectModel(StudentProfile.name)
    private readonly profileModel: Model<StudentProfileDocument>,
    @InjectModel(Recommendation.name)
    private readonly recommendationModel: Model<RecommendationDocument>,
    @InjectModel(Career.name)
    private readonly careerModel: Model<CareerDocument>,
    private readonly contextBuilder: ContextBuilderService,
    private readonly aiServiceClient: AIServiceClient,
  ) {}

  async startSession(
    userId: string,
    dto: StartSessionDto,
  ): Promise<ConversationDocument> {
    this.logger.log(`Starting counseling session for user: ${userId}`);

    // Create new clean conversation
    const conversation = new this.conversationModel({
      user_id: userId,
      summary: '',
    });
    await conversation.save();

    return conversation;
  }

  async getSessions(userId: string): Promise<any[]> {
    const sessions = await this.conversationModel
      .find({ user_id: userId })
      .lean()
      .sort({ last_message_at: -1 })
      .exec();
    return sessions.map((s: any) => ({
      ...s,
      _id: s._id.toString(),
    }));
  }

  async getSessionHistory(
    userId: string,
    sessionId: string,
  ): Promise<ConversationMessage[]> {
    const conversation = await this.conversationModel
      .findById(sessionId)
      .exec();
    if (!conversation || conversation.user_id !== userId) {
      throw new NotFoundException('Conversation not found or unauthorized');
    }
    const messages = await this.messageModel
      .find({ conversation_id: sessionId })
      .sort({ created_at: 1 })
      .exec();

    return messages.map((m: any) => {
      const obj = m.toObject ? m.toObject() : m;
      if (typeof obj.content === 'string') {
        obj.content = obj.content.replace(/### 🧭 Roadmap Flow[\s\S]*?(?=(###|$))/g, '').trim();
      }
      return obj;
    });
  }

  async sendMessage(
    userId: string,
    sessionId: string,
    messageText: string,
  ): Promise<ChatResponseDto> {
    const conversation = await this.conversationModel
      .findById(sessionId)
      .exec();
    if (!conversation || conversation.user_id !== userId) {
      throw new NotFoundException('Conversation not found or unauthorized');
    }

    // 1. Simple Intent Classification Step
    const intent = this.classifyIntent(messageText);

    // 2. Save user message to database
    const userMessage = new this.messageModel({
      conversation_id: sessionId,
      role: 'student',
      content: messageText,
      intent,
      is_structured: false,
    });
    await userMessage.save();

    // Update conversation last_message_at and auto-generate summary/title from first message
    if (!conversation.summary || conversation.summary.trim() === '') {
      conversation.summary = messageText.length > 36 ? messageText.substring(0, 36) + '...' : messageText;
    }
    conversation.set('last_message_at', new Date());
    await conversation.save();

    // 3. Retrieve student profile and latest recommendations
    const profile = await this.profileModel.findOne({ user_id: userId }).exec();
    if (!profile) {
      throw new BadRequestException(
        'Student profile not found. Please complete onboarding first.',
      );
    }

    const latestRec = await this.recommendationModel
      .findOne({ user_id: userId })
      .sort({ generated_at: -1 })
      .exec();

    // Load actual careers for the shortlist or top recommendations
    let candidateCareersList: string[] = [];
    if (latestRec && latestRec.shortlist && latestRec.shortlist.length > 0) {
      const careerCodes = latestRec.shortlist.map((c) => c.career_code);
      const careers = await this.careerModel
        .find({ career_code: { $in: careerCodes } })
        .exec();
      candidateCareersList = careers.map(
        (c) => `- ${c.name} (Code: ${c.career_code}): ${c.description}`,
      );
    } else {
      // Fallback to top seeding careers
      const careers = await this.careerModel.find().limit(20).exec();
      candidateCareersList = careers.map(
        (c) => `- ${c.name} (Code: ${c.career_code}): ${c.description}`,
      );
    }

    // Build the Top-5 suggested careers shown in the student's career section
    let suggestedCareersList: string[] = [];
    if (latestRec && latestRec.final_recommendations?.length > 0) {
      const recCodes = latestRec.final_recommendations.map(
        (r) => r.career_code,
      );
      const careers = await this.careerModel
        .find({ career_code: { $in: recCodes } })
        .exec();
      const careerMap = new Map(careers.map((c) => [c.career_code, c]));
      suggestedCareersList = latestRec.final_recommendations.map((rec) => {
        const career = careerMap.get(rec.career_code);
        const name = career ? career.name : rec.career_code;
        return (
          `Rank ${rec.rank}: ${name} (Match: ${Math.round(rec.ai_score)}%)` +
          (career ? `\n  Description: ${career.description}` : '') +
          (rec.explanation ? `\n  Why recommended: ${rec.explanation}` : '') +
          (rec.roadmap ? `\n  Roadmap summary: ${rec.roadmap}` : '')
        );
      });
    }

    // 4. Load recent messages for history
    const allMessages = await this.messageModel
      .find({ conversation_id: sessionId })
      .sort({ created_at: 1 })
      .exec();

    // Build chat context
    const aiContext = await this.contextBuilder.buildContext(
      conversation,
      allMessages,
      profile,
      messageText,
    );
    aiContext.candidate_careers = candidateCareersList.join('\n');
    aiContext.suggested_careers = suggestedCareersList.join('\n\n');

    // 5. Call AI Service Client (routed to Groq/Mistral)
    let promptName = 'counselor_chat';
    let fallbackObj: any = {
      reply: '',
      recommended_links: [''],
      suggested_questions: [''],
    };

    if (intent === 'roadmap_question') {
      promptName = 'roadmap_generation';
      fallbackObj = {
        career_code: '',
        career_name: '',
        estimated_total_duration: '',
        overview: '',
        phases: [],
        salary_progression: [],
        higher_studies: [],
        alternative_paths: [],
        common_mistakes: [],
        final_checklist: [],
        mermaid: { nodes: [], edges: [] },
      };
    }

    // 5b. Call AI — JsonValidatorService now returns {error:string} for refusals instead of crashing (see json-validator.service.ts:3c)
    let aiResponse: any;
    try {
      aiResponse = await this.aiServiceClient.run(
        promptName,
        aiContext,
        fallbackObj,
      );
    } catch (e: any) {
      const rawMsg = e.message || e.response?.message || 'AI Counselor failed to respond.';
      // Convert technical validator errors into a friendly counselor reply (200) instead of 400 crash
      const isSchemaError =
        rawMsg.includes('must NOT have additional properties') ||
        rawMsg.includes('must have required property') ||
        rawMsg.includes('failed schema validation') ||
        rawMsg.includes('not valid JSON');
      const friendly = isSchemaError
        ? "I couldn't generate a structured roadmap at this time due to an unexpected AI response format. Please try rephrasing your question or ask about one of your recommended careers."
        : rawMsg.slice(0, 1000);
      this.logger.warn(`AI call failed, returning friendly fallback: ${friendly.slice(0, 200)}`);
      const fallbackMsg = new this.messageModel({
        conversation_id: sessionId,
        role: 'counselor',
        content: friendly,
        intent,
        is_structured: false,
      });
      await fallbackMsg.save();
      return {
        response: friendly,
        model_used: 'fallback',
        cached: false,
        latency_ms: 0,
      };
    }

    if (!aiResponse.success || !aiResponse.data) {
      throw new BadRequestException('AI Counselor failed to respond.');
    }

    // 5c. Handle LLM refusal gracefully — rendered as normal counselor message, not a 400
    if (aiResponse.data && typeof aiResponse.data.error === 'string') {
      const refusalText = aiResponse.data.error.trim();
      const counselorMessage = new this.messageModel({
        conversation_id: sessionId,
        role: 'counselor',
        content: refusalText,
        intent,
        is_structured: false,
      });
      await counselorMessage.save();
      return {
        response: refusalText,
        model_used: aiResponse.model,
        cached: aiResponse.cached,
        latency_ms: aiResponse.latency_ms,
      };
    }

    let replyText = '';

    if (intent === 'roadmap_question') {
      replyText = this.buildRoadmapReply(aiResponse.data);
    } else {
      replyText = aiResponse.data.reply || JSON.stringify(aiResponse.data);
    }

    // 6. Post-process AI response with safety filter
    replyText = this.applySafetyFilter(replyText);

    // Save AI counselor reply
    const counselorMessage = new this.messageModel({
      conversation_id: sessionId,
      role: 'counselor',
      content: replyText,
      intent,
      is_structured: true,
    });
    await counselorMessage.save();

    return {
      response: replyText,
      model_used: aiResponse.model,
      cached: aiResponse.cached,
      latency_ms: aiResponse.latency_ms,
    };
  }

  private buildRoadmapReply(data: any): string {
    if (data && typeof data.error === 'string') {
      return data.error;
    }
    if (!data.phases || data.phases.length === 0) {
      return "I couldn't generate a structured roadmap at this time. Please try again.";
    }

    let md = `## 🗺️ Career Roadmap: ${data.career_name || data.career_code || ''}\n\n`;

    if (data.estimated_total_duration)
      md += `**Total Duration:** ${data.estimated_total_duration}\n\n`;
    if (data.overview) md += `${data.overview}\n\n`;

    data.phases.forEach((phase: any, index: number) => {
      md += `### Phase ${index + 1}: ${phase.phase} (${phase.duration})\n`;
      if (phase.goal) md += `**Goal:** ${phase.goal}\n\n`;
      if (phase.milestone) md += `**Milestone:** ${phase.milestone}\n\n`;

      if (phase.action_items?.length) {
        md += `**Action Items:**\n`;
        phase.action_items.forEach((item: string) => (md += `- ${item}\n`));
        md += `\n`;
      }
      if (phase.skills_to_build?.length) {
        md += `**Skills to Build:** ${phase.skills_to_build.join(', ')}\n\n`;
      }
      if (phase.entrance_exams?.length) {
        md += `**Entrance Exams:** ${phase.entrance_exams.join(', ')}\n\n`;
      }
      if (phase.certifications?.length) {
        md += `**Certifications:**\n`;
        phase.certifications.forEach((c: string) => (md += `- ${c}\n`));
        md += `\n`;
      }
      if (phase.projects?.length) {
        md += `**Projects:**\n`;
        phase.projects.forEach((p: string) => (md += `- ${p}\n`));
        md += `\n`;
      }
      if (phase.internships?.length) {
        md += `**Internships:**\n`;
        phase.internships.forEach((i: string) => (md += `- ${i}\n`));
        md += `\n`;
      }
      if (phase.recommended_resources?.length) {
        md += `**Resources:**\n`;
        phase.recommended_resources.forEach((r: string) => (md += `- ${r}\n`));
        md += `\n`;
      }
      if (phase.checkpoints?.length) {
        md += `**Checkpoints:**\n`;
        phase.checkpoints.forEach((c: string) => (md += `- ${c}\n`));
        md += `\n`;
      }
      md += `---\n\n`;
    });

    if (data.salary_progression?.length) {
      md += `### 💰 Salary Progression\n\n`;
      md += `| Stage | Product Company | MNC / Service | Remote / Startup | FAANG Equivalent |\n`;
      md += `|------|----------------|--------------|-----------------|-----------------|\n`;
      data.salary_progression.forEach((s: any) => {
        const prod = s.product_company || '-';
        const mnc = s.mnc_service || '-';
        const remote = s.remote_startup || '-';
        const faang = s.faang_equivalent || '-';
        md += `| ${s.stage} | ${prod} | ${mnc} | ${remote} | ${faang} |\n`;
      });
      md += `\n`;
    }

    if (data.higher_studies?.length) {
      md += `### 🎓 Higher Studies\n\n`;
      data.higher_studies.forEach((h: string) => (md += `- ${h}\n`));
      md += `\n`;
    }

    if (data.alternative_paths?.length) {
      md += `### 🔀 Alternative Career Paths\n\n`;
      data.alternative_paths.forEach((a: string) => (md += `- ${a}\n`));
      md += `\n`;
    }

    if (data.common_mistakes?.length) {
      md += `### ⚠️ Common Mistakes to Avoid\n\n`;
      data.common_mistakes.forEach((m: string) => (md += `- ${m}\n`));
      md += `\n`;
    }

    if (data.final_checklist?.length) {
      md += `### ✅ Final Checklist\n\n`;
      data.final_checklist.forEach((c: string) => (md += `- [ ] ${c}\n`));
      md += `\n`;
    }

    return md;
  }

  private classifyIntent(text: string): string {
    const lower = text.toLowerCase();
    if (
      lower.includes('roadmap') ||
      lower.includes('step') ||
      lower.includes('path') ||
      lower.includes('how to')
    ) {
      return 'roadmap_question';
    }
    if (
      lower.includes('career') ||
      lower.includes('salary') ||
      lower.includes('job') ||
      lower.includes('work')
    ) {
      return 'career_question';
    }
    return 'general_chat';
  }

  private applySafetyFilter(text: string): string {
    // Simple filter to catch and moderate unwanted content
    let cleanText = text;
    const blockList = ['hack', 'kill', 'suicide', 'die', 'explode', 'bomb'];

    for (const word of blockList) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      if (regex.test(cleanText)) {
        this.logger.warn(`Safety filter flagged word: "${word}" in response.`);
        cleanText = cleanText.replace(regex, '***');
      }
    }
    return cleanText;
  }

  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const conversation = await this.conversationModel.findById(sessionId).exec();
    if (!conversation || conversation.user_id !== userId) {
      throw new NotFoundException('Conversation not found or unauthorized');
    }
    
    await this.conversationModel.findByIdAndDelete(sessionId).exec();
    await this.messageModel.deleteMany({ conversation_id: sessionId }).exec();
  }
}
