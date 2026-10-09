import * as mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ALGORITHM = 'aes-256-cbc';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(process.env.DB_ENCRYPTION_KEY || '', 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

async function seedUsers() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/scpr';
  console.log(`Connecting to ${uri}...`);
  const conn = await mongoose.connect(uri);

  const User = conn.connection.collection('users');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Password123!', salt);

  const demoAccounts = [
    { email: 'demo@example.com', name: 'Demo Student', role: 'student' },
    { email: 'admin@example.com', name: 'Demo Admin', role: 'admin' },
  ];

  for (const acc of demoAccounts) {
    await User.deleteOne({ email: acc.email });
    const user_id = crypto.randomUUID().replace(/-/g, '');
    await User.insertOne({
      user_id,
      email: acc.email,
      full_name: encrypt(acc.name),
      password_hash: passwordHash,
      role: acc.role,
      provider: 'local',
      failed_login_attempts: 0,
      is_two_factor_enabled: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`✓ Created ${acc.role} account: ${acc.email} / Password123!`);

    if (acc.role === 'student') {
      const Profile = conn.connection.collection('student_profiles');
      await Profile.deleteOne({ user_id });
      await Profile.insertOne({
        user_id,
        onboarding_completed: true,
        onboarding_step: 4,
        personal_info: {
          name: encrypt('Demo Student'),
          age: 18,
          gender: 'prefer_not_to_say',
        },
        academic: {
          class10: { board: 'CBSE', percentage: 88, passing_year: 2024 },
          class12: { stream: 'science_pcm', percentage: 85, passing_year: 2026 },
        },
        skills: {
          technical: ['Programming', 'Mathematics', 'Logical Reasoning', 'Web Development'],
          soft: ['Problem Solving', 'Communication', 'Teamwork'],
        },
        interests: {
          riasec: { R: 65, I: 90, A: 75, S: 60, E: 70, C: 80 },
          fields: ['Computer Science', 'Data Science', 'AI & Machine Learning'],
        },
        goals: ['academic_prestige', 'high_salary', 'innovation'],
        work_preferences: ['remote', 'hybrid'],
        constraints: {
          budget_max_inr: 1500000,
          preferred_locations: ['Tier 1', 'Tier 2'],
          diversityMode: 'balanced',
        },
        current_dna: {
          analytical_thinking: 92,
          creativity: 84,
          communication: 78,
          leadership: 72,
          research: 88,
          business_acumen: 70,
          technical_curiosity: 95,
          empathy: 75,
          patience: 80,
          risk_tolerance: 65,
          computed_at: new Date(),
          source_version: 'v1',
        },
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log(`✓ Initialized student assessment profile for ${acc.email}`);
    }
  }

  console.log('\nDemo accounts ready.');
  process.exit(0);
}

seedUsers().catch((err) => {
  console.error('Failed to seed users:', err);
  process.exit(1);
});
