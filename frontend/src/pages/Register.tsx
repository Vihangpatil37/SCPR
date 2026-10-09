import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { client } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { AuthLayout } from '../components/layout/AuthLayout';
import { GlassCard } from '../components/ui/GlassCard';
import { Button } from '../components/ui/Button';
import { motion } from 'framer-motion';
import { fadeUp } from '../lib/motion';

export const Register = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);



  const passwordReqs = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'At least 1 lowercase character', met: /[a-z]/.test(password) },
    { label: 'At least 1 uppercase character', met: /[A-Z]/.test(password) },
    { label: 'At least 1 number or special character', met: /[^a-zA-Z]/.test(password) }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data: any = await client.post('/auth/register', { email, password, full_name: fullName });
      useAuthStore.getState().setAuth(data.user, data.access_token, data.refresh_token);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <motion.div variants={fadeUp} initial="hidden" animate="visible">
        <GlassCard elevation={3} className="p-8 md:p-10 border border-solid rounded-[24px]">
          <div className="font-anton text-brand text-2xl tracking-wider mb-6 select-none">SCPR</div>
          <h2 className="font-semibold text-xl text-text-primary mb-1">Create Account</h2>
          <p className="text-text-secondary text-sm mb-8">Sign up to begin your journey</p>

          {error && (
            <div className="p-4 mb-6 text-sm text-error bg-error/10 border border-solid border-error/20 rounded-[18px]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/[0.05] border border-solid border-white/[0.08] rounded-[18px] text-text-primary placeholder-white/30 focus:outline-none focus:border-ai-cyan/50 focus:ring-1 focus:ring-ai-cyan/50 transition-all duration-180"
                placeholder="Alex Johnson"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/[0.05] border border-solid border-white/[0.08] rounded-[18px] text-text-primary placeholder-white/30 focus:outline-none focus:border-ai-cyan/50 focus:ring-1 focus:ring-ai-cyan/50 transition-all duration-180"
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-text-secondary">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-white/[0.05] border border-solid border-white/[0.08] rounded-[18px] text-text-primary placeholder-white/30 focus:outline-none focus:border-ai-cyan/50 focus:ring-1 focus:ring-ai-cyan/50 transition-all duration-180 pr-12"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-black hover:text-black/80 transition-colors flex items-center justify-center"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="mt-4 text-sm text-text-secondary space-y-2 bg-white/[0.02] p-4 rounded-xl border border-solid border-white/[0.05]">
                <p className="font-medium text-text-primary mb-3">New password must contain:</p>
                {passwordReqs.map((req, idx) => (
                  <div key={idx} className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${req.met ? 'bg-[#10B981]' : 'bg-text-secondary/50'}`} />
                    <span className={req.met ? 'text-text-primary' : 'text-text-secondary'}>{req.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button type="submit" loading={loading} className="w-full py-4 text-base mt-2">
              Create Account
            </Button>

          </form>

          <div className="mt-8 text-center text-sm text-text-secondary">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand hover:underline">
              Sign in here
            </Link>
          </div>
        </GlassCard>
      </motion.div>
    </AuthLayout>
  );
};
