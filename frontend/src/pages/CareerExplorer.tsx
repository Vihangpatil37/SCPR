import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { client } from '../api/client';
import {
  Bookmark,
  BookmarkCheck,
  Award,
  RefreshCw,
  TrendingUp,
  X,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fadeUp } from '../lib/motion';
import { catalogFor } from '../lib/catalogs';
import { GlassCard } from '../components/ui/GlassCard';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';

interface Career {
  career_code: string;
  name: string;
  sector: string;
  category_code: string;
  source_catalog_parts: string[];
  description: string;
  growth_rate: string;
  average_salary: string;
  entry_requirements: string;
  skills_required: string[];
  trait_weights: Record<string, number>;
}

export const CareerExplorer: React.FC = () => {
  const navigate = useNavigate();
  const { clearAuth } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [latestRec, setLatestRec] = useState<any>(null);
  const [savedCodes, setSavedCodes] = useState<string[]>([]);
  
  // Data
  const [careersList, setCareersList] = useState<Career[]>([]);
  
  // Detail Modal
  const [selectedCareer, setSelectedCareer] = useState<Career | null>(null);
  const [selectedRecDetail, setSelectedRecDetail] = useState<any>(null);
  const [relatedCareers, setRelatedCareers] = useState<any[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      try {
        const recRes: any = await client.get('/recommendations/latest');
        setLatestRec(recRes);
      } catch (e) {
        setLatestRec(null);
      }

      const savedRes: any = await client.get('/careers/saved');
      setSavedCodes(savedRes.map((sc: any) => sc.career_code));

      const careersRes: any = await client.get('/careers');
      setCareersList(careersRes);
    } catch (err: any) {
      if (err.response?.status === 401) {
        clearAuth();
        navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBookmark = async (careerCode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isBookmarked = savedCodes.includes(careerCode);
    try {
      if (isBookmarked) {
        await client.delete(`/careers/save/${careerCode}`);
        setSavedCodes(savedCodes.filter(c => c !== careerCode));
      } else {
        await client.post('/careers/save', { career_code: careerCode });
        setSavedCodes([...savedCodes, careerCode]);
      }
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res: any = await client.post('/recommendations/regenerate');
      setLatestRec(res);
    } catch (err: any) {
      alert(err.message || 'Regeneration failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleViewDetails = async (careerCode: string) => {
    try {
      const recItem = latestRec?.final_recommendations?.find((fr: any) => fr.career_code === careerCode);
      setSelectedRecDetail(recItem || null);

      const career: any = await client.get(`/careers/${careerCode}`);
      setSelectedCareer(career);

      const related: any = await client.get(`/careers/related/${careerCode}`);
      setRelatedCareers(related);
    } catch (err) {
      console.error(err);
    }
  };



  if (loading) {
    return (
      <div className="space-y-8 p-4 md:p-8">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-[220px] w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[180px]" />
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="space-y-8 p-4 md:p-8">
      {/* Title */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
        <div>
          <h1 className="text-3xl font-black text-text-primary">Career Path Explorer</h1>
          <p className="text-text-secondary text-sm mt-1">Review your AI-generated matches, bookmarked profiles, and catalog requirements.</p>
        </div>
        {latestRec && (
          <Button
            onClick={handleRegenerate}
            disabled={regenerating}
            loading={regenerating}
            variant="secondary"
            size="sm"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Regenerate Matches</span>
          </Button>
        )}
      </div>

      {/* Empty State — no recommendations yet */}
      {!latestRec && (
        <section className="relative z-10 flex flex-col items-center justify-center text-center py-24 px-6">
          <div className="absolute inset-0 bg-gradient-to-b from-brand/5 via-transparent to-transparent blur-[80px] rounded-full pointer-events-none" />
          <div className="relative z-10 max-w-md space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
              <Award className="h-7 w-7 text-text-muted" />
            </div>
            <h2 className="text-xl font-bold text-text-primary">No Recommendations Yet</h2>
            <p className="text-sm text-text-secondary leading-relaxed">
              Your AI-powered career matches haven't been generated yet. This could be because
              the generation process is still running or encountered a temporary issue.
            </p>
            <Button
              onClick={handleRegenerate}
              disabled={regenerating}
              loading={regenerating}
              variant="primary"
              size="md"
              className="mt-4"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Generate AI Matches</span>
            </Button>
          </div>
        </section>
      )}

      {/* AI Recommendations Section */}
      {latestRec ? (
        <section className="space-y-6 relative z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-text-primary flex items-center space-x-2">
              <Award className="h-5 w-5 text-brand" />
              <span>Your Top AI Recommended Career Paths</span>
            </h2>
            {latestRec.stale && (
              <span className="text-xs font-semibold bg-warning/10 border border-solid border-warning/20 text-warning px-3.5 py-1 rounded-full animate-pulse">
                ⚠️ Profile Edited — Matches Stale
              </span>
            )}
          </div>

          {/* Asymmetric Recommendation cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {latestRec.final_recommendations?.map((rec: any, idx: number) => {
              const career = careersList.find(c => c.career_code === rec.career_code);
              const isBookmarked = savedCodes.includes(rec.career_code);
              const isLarge = idx === 0; // First match spans wide/asymmetric
              
              if (!career) return null;
              const cat = catalogFor(career.category_code);

              return (
                <GlassCard
                  key={rec.career_code}
                  elevation={2}
                  onClick={() => handleViewDetails(rec.career_code)}
                  className={`p-6 border border-solid border-white/[0.08] hover:border-brand/40 hover:-translate-y-0.5 transition-all duration-180 cursor-pointer flex flex-col justify-between group relative overflow-hidden ${
                    isLarge ? 'md:col-span-2' : ''
                  }`}
                  style={{ boxShadow: 'inset 1px 1px 0px rgba(255, 255, 255, 0.08)' }}
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-brand/5 blur-[50px] rounded-full pointer-events-none" />
                  
                  <div className="space-y-3 relative z-10">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-solid ${cat.badge}`}>
                          {cat.label}
                        </span>
                        <span className="text-xs text-brand font-bold">
                          {Math.round(rec.match_score)}% Match
                        </span>
                      </div>
                      
                      <button
                        onClick={(e) => handleToggleBookmark(rec.career_code, e)}
                        className="p-2 rounded-full bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-brand cursor-pointer focus:outline-none"
                      >
                        {isBookmarked ? (
                          <BookmarkCheck className="h-4 w-4 text-brand" />
                        ) : (
                          <Bookmark className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    <h3 className="text-lg font-bold text-text-primary group-hover:text-brand transition-colors">{career.name}</h3>
                    <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{career.description}</p>
                    
                    {/* Hover Stats Section */}
                    <div className="max-h-0 opacity-0 group-hover:max-h-32 group-hover:opacity-100 transition-all duration-350 overflow-hidden mt-3 pt-3 border-t border-white/[0.06]">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-text-muted">Salary Range</span>
                          <p className="font-semibold text-text-primary">{career.average_salary}</p>
                        </div>
                        <div>
                          <span className="text-text-muted">Job Growth</span>
                          <p className="font-semibold text-brand">{career.growth_rate}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-white/[0.06] relative z-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('/chat', {
                          state: {
                            initialPrompt: `How do I become a ${career.name} according to my recommendations? Please provide a comprehensive career roadmap, required skills, and salary progression.`,
                            careerCode: career.career_code,
                            careerName: career.name,
                            autoSend: true,
                          },
                        });
                      }}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-brand/15 hover:bg-brand text-brand hover:text-white border border-brand/30 transition-all text-xs font-semibold cursor-pointer shadow-sm focus:outline-none group/btn"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-ai-cyan group-hover/btn:text-white transition-colors" />
                      <span>Get Roadmap in Chat</span>
                    </button>

                    <div className="flex items-center space-x-1 text-xs text-text-secondary group-hover:text-brand font-medium">
                      <span>View Details</span>
                      <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="space-y-6 relative z-10 flex flex-col items-center justify-center text-center py-16 px-4 bg-white/[0.02] border border-solid border-white/[0.06] rounded-[24px]">
          <div className="h-12 w-12 rounded-[18px] bg-brand/10 flex items-center justify-center text-brand border border-solid border-brand/20">
            <Award className="h-6 w-6" />
          </div>
          <div className="max-w-md space-y-2">
            <h3 className="text-base font-bold text-text-primary">No Recommendations Found</h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Your onboarding is complete, but your career recommendations haven't been generated yet or failed. Generate them now to unlock your matches.
            </p>
          </div>
          <Button
            onClick={handleRegenerate}
            disabled={regenerating}
            loading={regenerating}
            className="mt-4"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Generate Career Recommendations</span>
          </Button>
        </section>
      )}



      {/* Detailed Modal (GlassCard Elevation 4) */}
      <AnimatePresence>
        {selectedCareer && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[20px] flex items-center justify-end z-50">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.35, ease: 'easeOut' }} // maps to medium timings
              className="w-full max-w-xl h-full outline-none"
            >
              <GlassCard
                elevation={4}
                className="h-full rounded-none border-t-0 border-b-0 border-r-0 border-l border-solid border-white/[0.08] p-8 flex flex-col justify-between overflow-y-auto"
              >
                <div className="space-y-6">
                  {/* Header */}
                  <div className="flex justify-between items-start border-b border-white/[0.06] pb-5">
                    <div className="space-y-1">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-solid ${catalogFor(selectedCareer.category_code).badge}`}>
                        {catalogFor(selectedCareer.category_code).label}
                      </span>
                      <h2 className="text-2xl font-black text-text-primary mt-2">{selectedCareer.name}</h2>
                    </div>
                    <button
                      onClick={() => setSelectedCareer(null)}
                      className="p-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary cursor-pointer focus:outline-none"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Overview */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wide">Overview</span>
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">{selectedCareer.description}</p>
                  </div>

                  {/* Traits */}
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wide">Core Traits Requirements</span>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(selectedCareer.trait_weights).map(([trait, weight]) => (
                        <div key={trait} className="p-3 bg-white/[0.02] border border-solid border-white/[0.06] rounded-[18px] flex items-center justify-between">
                          <span className="text-[10px] text-text-secondary capitalize">{trait.replace('_', ' ')}</span>
                          <span className="text-[10px] font-bold text-brand">{weight}/10</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Insights card */}
                  <div className="space-y-2 bg-white/[0.02] p-4 border border-solid border-white/[0.06] rounded-[24px]">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wide flex items-center space-x-1.5">
                      <TrendingUp className="h-4 w-4 text-brand" />
                      <span>Career Insights</span>
                    </span>
                    <div className="grid grid-cols-2 gap-4 mt-2 text-xs">
                      <div>
                        <span className="text-text-muted">Average Salary</span>
                        <p className="font-bold text-text-primary mt-0.5">{selectedCareer.average_salary || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-text-muted">Growth Rate</span>
                        <p className="font-bold text-brand mt-0.5">{selectedCareer.growth_rate || 'N/A'}</p>
                      </div>
                      <div className="col-span-2 border-t border-white/[0.04] pt-2">
                        <span className="text-text-muted">Minimum Academic Requirements</span>
                        <p className="text-text-secondary mt-0.5 font-medium leading-relaxed">{selectedCareer.entry_requirements || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {/* AI roadmap details */}
                  {selectedRecDetail && (
                    <div className="space-y-4 border-t border-white/[0.06] pt-5">
                      <span className="text-xs font-bold text-brand uppercase tracking-wider block">AI Generated Roadmaps & Guidance</span>
                      
                      <div className="space-y-1.5">
                        <span className="text-xs text-text-secondary font-bold">Suggested Path:</span>
                        <p className="text-xs text-text-secondary bg-brand/5 border border-brand/10 p-3.5 rounded-[18px] font-medium leading-relaxed">
                          {selectedRecDetail.roadmap}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-xs text-text-secondary font-bold block mb-1">Target Colleges</span>
                          <div className="space-y-1">
                            {selectedRecDetail.suggested_colleges?.map((col: string) => (
                              <span key={col} className="block text-[10px] text-text-primary bg-white/[0.03] px-2.5 py-1.5 rounded-lg border border-solid border-white/[0.06] truncate font-semibold">
                                🎓 {col}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-text-secondary font-bold block mb-1">Certifications</span>
                          <div className="space-y-1">
                            {selectedRecDetail.suggested_certifications?.map((cert: string) => (
                              <span key={cert} className="block text-[10px] text-text-primary bg-white/[0.03] px-2.5 py-1.5 rounded-lg border border-solid border-white/[0.06] truncate font-semibold">
                                🏆 {cert}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Related Careers */}
                  {relatedCareers.length > 0 && (
                    <div className="space-y-3 border-t border-white/[0.06] pt-5">
                      <span className="text-xs font-bold text-text-secondary uppercase tracking-wide block">Related Careers</span>
                      <div className="grid grid-cols-2 gap-2">
                        {relatedCareers.map((rc) => (
                          <button
                            key={rc.career_code}
                            onClick={() => handleViewDetails(rc.career_code)}
                            className="p-3 bg-white/[0.02] border border-solid border-white/[0.06] hover:border-brand/40 text-left rounded-[18px] transition-all hover:scale-[1.01] cursor-pointer focus:outline-none"
                          >
                            <span className="block text-[11px] font-bold text-text-primary truncate">{rc.name}</span>
                            <span className="text-[9px] text-text-muted capitalize">{catalogFor(rc.category_code).label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-white/[0.06] mt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
                  <Button
                    onClick={() => {
                      const careerName = selectedCareer.name;
                      setSelectedCareer(null);
                      navigate('/chat', {
                        state: {
                          initialPrompt: `How do I become a ${careerName} according to my recommendations? Please provide a comprehensive career roadmap, required skills, and salary progression.`,
                          careerCode: selectedCareer.career_code,
                          careerName: careerName,
                          autoSend: true,
                        },
                      });
                    }}
                    className="w-full sm:w-auto flex-grow text-xs bg-brand hover:bg-brand-hover shadow-lg shadow-brand/20"
                    variant="primary"
                  >
                    <Sparkles className="h-4 w-4 text-ai-cyan" />
                    <span>Get Roadmap in AI Chat</span>
                  </Button>

                  <Button
                    onClick={(e) => handleToggleBookmark(selectedCareer.career_code, e)}
                    className="w-full sm:w-auto text-xs"
                    variant={savedCodes.includes(selectedCareer.career_code) ? 'secondary' : 'ghost'}
                  >
                    {savedCodes.includes(selectedCareer.career_code) ? (
                      <>
                        <BookmarkCheck className="h-4 w-4" />
                        <span>Saved</span>
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-4 w-4" />
                        <span>Bookmark</span>
                      </>
                    )}
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
