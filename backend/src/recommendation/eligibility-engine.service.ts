import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Career, CareerDocument } from '../careers/schemas/career.schema';
import { StudentProfile } from '../onboarding/schemas/student-profile.schema';

@Injectable()
export class EligibilityEngineService {
  private readonly logger = new Logger(EligibilityEngineService.name);

  constructor(
    @InjectModel(Career.name)
    private readonly careerModel: Model<CareerDocument>,
  ) {}

  async getEligibleCareers(student: StudentProfile): Promise<CareerDocument[]> {
    this.logger.log(
      `Running Eligibility Engine for student: ${student.user_id}`,
    );

    const rawMaths = student.academic?.class10?.subjects?.maths;
    const rawScience = student.academic?.class10?.subjects?.science;
    const overallPct = student.academic?.class10?.percentage ?? 60;

    const mathsScore = rawMaths !== undefined && rawMaths > 0 ? rawMaths : overallPct;
    const scienceScore = rawScience !== undefined && rawScience > 0 ? rawScience : overallPct;
    const studyDurationMax = Math.max(student.constraints?.study_duration_max ?? 5, 4);

    // 1. Strict Query
    let eligible = await this.careerModel
      .find({
        'eligibility.min_maths': { $lte: mathsScore },
        'eligibility.min_science': { $lte: scienceScore },
        'eligibility.min_study_duration_years': { $lte: studyDurationMax },
      })
      .exec();

    if (eligible.length >= 5) {
      this.logger.log(
        `Eligibility check (strict): found ${eligible.length} careers matching hard gates`,
      );
      return eligible;
    }

    // 2. Relaxed Query (allow careers where either subject matches, or stream is non-science/any)
    eligible = await this.careerModel
      .find({
        $or: [
          { 'eligibility.min_maths': { $lte: mathsScore + 20 } },
          { 'eligibility.min_science': { $lte: scienceScore + 20 } },
          { 'eligibility.required_stream': { $in: ['any', 'commerce', 'arts', 'vocational', null] } },
          { eligibility: { $exists: false } },
        ],
      })
      .exec();

    if (eligible.length >= 5) {
      this.logger.log(
        `Eligibility check (relaxed): found ${eligible.length} careers`,
      );
      return eligible;
    }

    // 3. Broad Fallback (return all available careers so student always receives guidance)
    eligible = await this.careerModel.find().limit(40).exec();
    this.logger.log(
      `Eligibility check (full catalog fallback): found ${eligible.length} careers`,
    );

    return eligible;
  }
}
