import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { client } from '../api/client';
import {
  MessageSquare,
  Send,
  RefreshCw,
  ThumbsUp,
  Sparkles,
  User,
  Bot,
  X,
  Plus,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  Award,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { fadeUp } from '../lib/motion';
import { formatTimeOnly } from '../lib/formatDate';
import { GlassCard } from '../components/ui/GlassCard';
import { Button } from '../components/ui/Button';

interface Message {
  role: 'user' | 'assistant' | 'student' | 'counselor';
  content: string;
  timestamp: string;
  feedback?: {
    rating: number;
    explanation?: string;
  };
}

interface ConversationItem {
  _id: string;
  title?: string;
  summary?: string;
  started_at?: string;
  created_at?: string;
  last_message_at?: string;
}

const SUGGESTED_QUESTIONS = [
  'How do I become a Software Engineer according to my recommendations?',
  'What is the growth rate of a Product Manager compared to a UX Designer?',
  'Can you suggest the best certifications to build a career in AI and Data Science?',
  'Does my onboarding profile show a good fit for research roles?'
];

interface RecommendedCareerItem {
  career_code: string;
  name: string;
  match_score: number;
  category?: string;
  description?: string;
}

export const CounselingChat: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { clearAuth } = useAuthStore();
  
  // Conversations list & active selection
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Recommended careers from user profile
  const [recommendedCareers, setRecommendedCareers] = useState<RecommendedCareerItem[]>([]);

  // Messages & input state
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Feedback Modal state
  const [feedbackMsgIndex, setFeedbackMsgIndex] = useState<number | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasAutoSentRef = useRef<boolean>(false);

  useEffect(() => {
    loadConversations();
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      const [recRes, careersRes]: [any, any] = await Promise.all([
        client.get('/recommendations').catch(() => null),
        client.get('/careers').catch(() => []),
      ]);

      if (recRes && recRes.final_recommendations?.length > 0) {
        const careersList: any[] = Array.isArray(careersRes) ? careersRes : [];
        const mapped: RecommendedCareerItem[] = recRes.final_recommendations.map((fr: any) => {
          const career = careersList.find((c: any) => c.career_code === fr.career_code);
          return {
            career_code: fr.career_code,
            name: career ? career.name : fr.career_code,
            match_score: Math.round(fr.match_score || 0),
            category: career?.category_code,
            description: career?.description || fr.roadmap,
          };
        });
        setRecommendedCareers(mapped);
      }
    } catch (e) {
      console.error('Error loading recommendations in chat:', e);
    }
  };

  useEffect(() => {
    if (location.state?.initialPrompt && !hasAutoSentRef.current) {
      hasAutoSentRef.current = true;
      const prompt = location.state.initialPrompt;
      setActiveConvId('');
      setMessages([]);
      handleSendMessage(prompt);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async (autoSelectLatest = true) => {
    try {
      const res: any = await client.get('/counselor/conversations');
      const convs: ConversationItem[] = Array.isArray(res) ? res : res.data || [];
      setConversations(convs);

      // Only auto-select latest if not coming from a direct prompt navigation
      if (autoSelectLatest && convs.length > 0 && !activeConvId && !location.state?.initialPrompt) {
        const firstId = typeof convs[0]._id === 'object' ? String(convs[0]._id) : convs[0]._id;
        setActiveConvId(firstId);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        clearAuth();
        navigate('/login');
      }
    }
  };

  const fetchMessages = async (convId: string) => {
    setLoadingHistory(true);
    try {
      const res: any = await client.get(`/counselor/conversations/${convId}`);
      const rawMsgs = Array.isArray(res) ? res : res.messages || [];
      const mapped = rawMsgs.map((m: any) => ({
        ...m,
        timestamp: m.created_at || m.timestamp || new Date().toISOString(),
      }));
      setMessages(mapped);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleStartNewChat = () => {
    setActiveConvId('');
    setMessages([]);
    setInputText('');
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deletingId) return;
    
    setDeletingId(convId);
    try {
      await client.delete(`/counselor/conversations/${convId}`);
      const updated = conversations.filter(c => c._id !== convId);
      setConversations(updated);

      if (activeConvId === convId) {
        if (updated.length > 0) {
          setActiveConvId(updated[0]._id);
        } else {
          handleStartNewChat();
        }
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete conversation');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    if (!textToSend) setInputText('');
    setSending(true);

    const tempUserMsg: Message = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const payload: any = { message: text };
      if (activeConvId) {
        payload.conversation_id = activeConvId;
      }

      const res: any = await client.post('/counselor/chat', payload);

      const resolvedConvId = res.conversation_id || activeConvId;
      if (!activeConvId && resolvedConvId) {
        setActiveConvId(resolvedConvId);
      }

      await loadConversations(false);

      if (resolvedConvId) {
        const resConv: any = await client.get(`/counselor/conversations/${resolvedConvId}`);
        const rawMsgs = Array.isArray(resConv) ? resConv : resConv.messages || [];
        const mapped = rawMsgs.map((m: any) => ({
          ...m,
          timestamp: m.created_at || m.timestamp || new Date().toISOString(),
        }));
        setMessages(mapped);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleRegenerate = async () => {
    if (!activeConvId) return;
    setRegenerating(true);
    try {
      await client.post('/counselor/regenerate', { conversation_id: activeConvId });
      await fetchMessages(activeConvId);
    } catch (err: any) {
      alert(err.message || 'Regeneration failed');
    } finally {
      setRegenerating(false);
    }
  };

  const handleOpenFeedback = (msgIdx: number) => {
    setFeedbackMsgIndex(msgIdx);
    setFeedbackRating(5);
    setFeedbackComment('');
  };

  const handleSubmitFeedback = async () => {
    if (feedbackMsgIndex === null || !activeConvId) return;
    setSubmittingFeedback(true);
    try {
      await client.post('/counselor/feedback', {
        conversation_id: activeConvId,
        message_index: feedbackMsgIndex,
        rating: feedbackRating,
        explanation: feedbackComment
      });

      await fetchMessages(activeConvId);
      setFeedbackMsgIndex(null);
    } catch (err: any) {
      alert(err.message || 'Failed to submit feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    const title = c.summary || c.title || 'Career Counseling Chat';
    return title.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const activeTitle = conversations.find(c => c._id === activeConvId)?.summary || 
                      conversations.find(c => c._id === activeConvId)?.title || 
                      'New Consultation';

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" className="flex-grow flex h-[calc(100dvh-70px)] min-w-0 overflow-hidden bg-bg-primary text-text-primary">
      
      {/* 1. LEFT SIDEBAR: Chat History & New Chat */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="relative shrink-0 h-full border-r border-solid border-white/[0.08] bg-bg-secondary flex flex-col select-none z-20"
          >
            {/* Collapse Toggle Button (Floating circle chevron on right border) */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute right-[-12px] top-6 w-6 h-6 rounded-full border border-solid border-white/[0.12] bg-[#0A0A0F] text-text-secondary hover:text-text-primary hover:border-brand/50 flex items-center justify-center cursor-pointer shadow-lg transition-all duration-180 z-30 focus:outline-none"
              aria-label="Collapse sidebar"
              title="Collapse history sidebar"
            >
              <ChevronLeft size={13} />
            </button>

            {/* Top Bar: New Chat Button */}
            <div className="p-3.5 space-y-3 border-b border-solid border-white/[0.06]">
              <button
                onClick={handleStartNewChat}
                className="w-full py-2.5 px-3.5 bg-brand hover:bg-brand-hover active:bg-brand-pressed text-white rounded-[14px] flex items-center justify-between font-medium text-xs shadow-lg shadow-brand/20 transition-all duration-150 cursor-pointer focus:outline-none"
              >
                <div className="flex items-center space-x-2">
                  <Plus className="h-4 w-4 stroke-[2.5]" />
                  <span className="font-semibold tracking-wide">New chat</span>
                </div>
                <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white font-mono">⌘N</span>
              </button>

              {/* Search filter */}
              {conversations.length > 3 && (
                <div className="relative">
                  <Search className="h-3.5 w-3.5 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search history..."
                    className="w-full bg-white/[0.03] border border-solid border-white/[0.06] rounded-[10px] py-1.5 pl-8 pr-3 text-[11px] text-text-primary placeholder-text-muted focus:outline-none focus:border-brand/40 transition-colors"
                  />
                </div>
              )}
            </div>

            {/* Conversation History List */}
            <div className="flex-grow overflow-y-auto p-2 space-y-1">
              <div className="px-2 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center justify-between">
                <span>Recent Chats</span>
                <span className="text-[9px] font-mono text-text-muted">{conversations.length}</span>
              </div>

              {filteredConversations.length === 0 ? (
                <div className="p-6 text-center text-text-muted text-xs space-y-2">
                  <MessageSquare className="h-6 w-6 mx-auto opacity-30" />
                  <p className="text-[11px]">No previous sessions found</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isActive = conv._id === activeConvId;
                  const displayTitle = conv.summary || conv.title || 'Career Counseling Chat';

                  return (
                    <div
                      key={conv._id}
                      onClick={() => setActiveConvId(conv._id)}
                      className={`group relative flex items-center justify-between px-3 py-2.5 rounded-[12px] text-xs transition-all duration-150 cursor-pointer select-none ${
                        isActive
                          ? 'bg-brand/15 border border-solid border-brand/35 text-white font-semibold'
                          : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary border border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                        <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-ai-cyan' : 'text-text-muted group-hover:text-text-secondary'}`} />
                        <span className="truncate text-[11.5px] leading-tight">{displayTitle}</span>
                      </div>

                      {/* Delete Button on Hover */}
                      <button
                        onClick={(e) => handleDeleteConversation(conv._id, e)}
                        title="Delete chat"
                        disabled={deletingId === conv._id}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/[0.1] rounded-md text-text-muted hover:text-error transition-all shrink-0 cursor-pointer focus:outline-none"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Counselor Status Footer */}
            <div className="p-3 border-t border-solid border-white/[0.06] flex items-center space-x-2.5 bg-white/[0.01]">
              <div className="h-7 w-7 rounded-lg bg-brand/20 border border-brand/30 flex items-center justify-center shrink-0">
                <Sparkles className="h-3.5 w-3.5 text-ai-cyan" />
              </div>
              <div className="min-w-0 flex-grow">
                <p className="text-[11px] font-semibold text-text-primary truncate">SCPR AI Intelligence</p>
                <p className="text-[9px] text-text-muted truncate">Deterministic & Neural Guidance</p>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* 2. MAIN CHAT AREA */}
      <main className="flex-grow flex flex-col min-w-0 h-full relative overflow-hidden bg-bg-primary">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

        {/* Floating Expand Sidebar Button when collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-2 top-4 w-6 h-6 rounded-full border border-solid border-white/[0.12] bg-[#0A0A0F] text-text-secondary hover:text-text-primary hover:border-brand/50 flex items-center justify-center cursor-pointer shadow-lg transition-all duration-180 z-30 focus:outline-none"
            aria-label="Expand sidebar"
            title="Show history sidebar"
          >
            <ChevronRight size={13} />
          </button>
        )}

        {/* Top Header Bar */}
        <header className="shrink-0 h-14 border-b border-solid border-white/[0.08] px-4 md:px-6 flex items-center justify-between bg-bg-primary/80 backdrop-blur-md z-10">
          <div className="flex items-center space-x-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer focus:outline-none"
            >
              {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </button>

            <div className="h-4 w-[1px] bg-white/[0.1]" />

            <div className="min-w-0 flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <h2 className="text-xs font-bold text-text-primary truncate max-w-sm">
                {activeConvId ? activeTitle : 'New Career Consultation'}
              </h2>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {activeConvId && messages.length > 0 && (
              <Button
                onClick={handleRegenerate}
                disabled={regenerating}
                loading={regenerating}
                variant="secondary"
                size="sm"
                className="text-[11px] h-8 px-2.5"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                <span>Regenerate</span>
              </Button>
            )}

            <button
              onClick={handleStartNewChat}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-colors cursor-pointer focus:outline-none md:hidden"
              title="New chat"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Chat Feed */}
        <div className="flex-grow flex flex-col w-full max-w-4xl mx-auto overflow-hidden relative z-10 p-4 md:p-6 pb-2">
          
          <div className="flex-grow overflow-y-auto space-y-6 pr-2">
            {loadingHistory ? (
              <div className="h-full flex items-center justify-center space-y-2 text-text-muted text-xs">
                <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin mr-2" />
                <span>Loading conversation...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center space-y-5 max-w-lg mx-auto text-center py-6">
                <div className="h-14 w-14 rounded-[22px] bg-brand/10 flex items-center justify-center text-brand border border-solid border-brand/20 shadow-lg shadow-brand/10">
                  <Sparkles className="h-7 w-7 text-ai-cyan" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-text-primary">Ask your AI Career Counselor</h3>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Generate personalized career roadmaps, discover high-impact skills, and track salary progression.
                  </p>
                </div>

                {/* Student's Top AI Recommended Career Paths */}
                {recommendedCareers.length > 0 && (
                  <div className="w-full space-y-2.5 text-left pt-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-brand uppercase tracking-wider flex items-center space-x-1.5">
                        <Award className="h-3.5 w-3.5" />
                        <span>Your Top Recommended Career Paths</span>
                      </p>
                      <span className="text-[9px] text-text-muted">Click to generate roadmap</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {recommendedCareers.slice(0, 4).map((c) => (
                        <button
                          key={c.career_code}
                          onClick={() => handleSendMessage(`How do I become a ${c.name} according to my recommendations? Please provide a comprehensive career roadmap, key skills to acquire, certifications, and expected salary progression.`)}
                          className="p-3 bg-white/[0.03] hover:bg-brand/15 border border-solid border-white/[0.08] hover:border-brand/50 rounded-[16px] text-left transition-all duration-180 group cursor-pointer focus:outline-none flex flex-col justify-between shadow-sm hover:shadow-brand/10"
                        >
                          <div className="flex items-center justify-between gap-1 w-full">
                            <span className="text-xs font-bold text-text-primary group-hover:text-white truncate">{c.name}</span>
                            <span className="text-[9px] font-bold text-brand bg-brand/15 px-2 py-0.5 rounded-full shrink-0">
                              {c.match_score}% Match
                            </span>
                          </div>
                          <p className="text-[10.5px] text-text-muted group-hover:text-text-secondary line-clamp-1 mt-1">
                            Ask counselor for roadmap & strategy
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Inquiries */}
                <div className="w-full space-y-2 pt-1 text-left">
                  <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Suggested Inquiries</p>
                  <div className="space-y-1.5">
                    {SUGGESTED_QUESTIONS.slice(0, 3).map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSendMessage(q)}
                        className="w-full p-2.5 bg-white/[0.02] hover:bg-white/[0.06] border border-solid border-white/[0.06] hover:border-brand/40 rounded-[12px] text-left text-[11px] text-text-secondary hover:text-white transition-all cursor-pointer focus:outline-none flex items-center justify-between group"
                      >
                        <span className="truncate pr-2">{q}</span>
                        <Send className="h-3 w-3 text-text-muted group-hover:text-brand transition-colors shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((m, idx) => {
                const isUser = m.role === 'user' || m.role === 'student';
                return (
                  <div key={idx} className="flex items-start space-x-3.5 py-3 border-b border-solid border-white/[0.03] last:border-b-0">
                    {/* Avatar */}
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 border border-solid ${
                      isUser
                        ? 'bg-white/[0.05] border-white/[0.1] text-text-primary'
                        : 'bg-brand/15 border-brand/30 text-brand'
                    }`}>
                      {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5 text-ai-cyan" />}
                    </div>

                    {/* Message Body */}
                    <div className="flex-grow min-w-0 space-y-1">
                      <div className="flex items-center space-x-2 text-[10px] text-text-secondary">
                        <span className="font-bold text-text-primary">
                          {isUser ? 'You' : 'AI Career Counselor'}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-text-muted">{formatTimeOnly(m.timestamp)}</span>

                        {!isUser && m.feedback && (
                          <span className="text-brand font-bold bg-brand/10 border border-brand/20 px-1.5 py-0.2 rounded text-[8px]">
                            Rated {m.feedback.rating}★
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-text-primary leading-relaxed font-normal mt-1">
                        {isUser ? (
                          <p className="whitespace-pre-wrap leading-relaxed text-white/90">{m.content}</p>
                        ) : (
                          <ChatMarkdown content={m.content} />
                        )}
                      </div>

                      {!isUser && !m.feedback && (
                        <div className="flex items-center space-x-3 text-[10px] text-text-muted pt-1.5">
                          <button
                            onClick={() => handleOpenFeedback(idx)}
                            className="flex items-center space-x-1 hover:text-brand transition-colors cursor-pointer focus:outline-none"
                          >
                            <ThumbsUp className="h-3 w-3" />
                            <span>Helpful?</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {sending && (
              <div className="flex items-start space-x-3.5 py-3">
                <div className="h-7 w-7 rounded-lg bg-brand/15 border border-solid border-brand/30 text-brand flex items-center justify-center shrink-0 animate-pulse">
                  <Bot className="h-3.5 w-3.5 text-ai-cyan" />
                </div>
                <div className="flex-grow min-w-0 space-y-1">
                  <div className="text-[10px] text-text-secondary font-bold">Counselor is preparing your personalized response...</div>
                  <div className="flex items-center space-x-1.5 py-1.5">
                    <div className="h-1.5 w-1.5 bg-brand rounded-full animate-bounce" />
                    <div className="h-1.5 w-1.5 bg-brand rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 bg-brand rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestion Chips */}
          {messages.length > 0 && (
            <div className="shrink-0 flex gap-2 overflow-x-auto py-2 border-t border-solid border-white/[0.06] select-none">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSendMessage(q)}
                  className="shrink-0 px-3 py-1 bg-white/[0.03] hover:bg-white/[0.07] border border-solid border-white/[0.06] rounded-full text-[10px] text-text-secondary hover:text-white transition-all font-medium cursor-pointer focus:outline-none"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <div className="shrink-0 pt-2 pb-1">
            <div className="flex flex-col bg-bg-secondary border border-solid border-white/[0.1] rounded-[18px] focus-within:border-brand/60 focus-within:ring-1 focus-within:ring-brand/30 transition-all p-3 shadow-xl">
              <textarea
                placeholder="Ask your counselor about roadmaps, required skills, colleges, or salary progression..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={sending}
                rows={2}
                className="w-full bg-transparent border-0 p-1 text-xs text-text-primary focus:outline-none placeholder-white/30 resize-none h-14"
              />
              <div className="flex justify-between items-center mt-1 pt-2 border-t border-white/[0.04]">
                <span className="text-[10px] text-text-muted">Press Enter to send, Shift+Enter for new line</span>

                <button
                  onClick={() => handleSendMessage()}
                  disabled={sending || !inputText.trim()}
                  className={`p-2 rounded-xl transition-all cursor-pointer focus:outline-none flex items-center justify-center ${
                    inputText.trim()
                      ? 'bg-brand hover:bg-brand-hover text-white shadow-md shadow-brand/20'
                      : 'bg-white/[0.03] text-text-muted cursor-not-allowed'
                  }`}
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Feedback Modal Overlay */}
      <AnimatePresence>
        {feedbackMsgIndex !== null && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[20px] flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-sm outline-none"
            >
              <GlassCard elevation={4} className="p-6 border border-solid border-white/[0.08] rounded-[24px] space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-text-primary">Share your feedback</h3>
                  <button
                    onClick={() => setFeedbackMsgIndex(null)}
                    className="p-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-text-secondary hover:text-text-primary cursor-pointer focus:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-text-secondary font-bold block">Rating (1 to 5 Stars)</label>
                  <div className="flex space-x-2 justify-center py-2.5 bg-white/[0.02] rounded-[14px] border border-solid border-white/[0.06]">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setFeedbackRating(star)}
                        className="p-1 hover:scale-110 transition-transform cursor-pointer focus:outline-none"
                      >
                        <Sparkles className={`h-6 w-6 ${star <= feedbackRating ? 'fill-brand text-brand' : 'text-text-disabled'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-text-secondary font-bold block">Comments (Optional)</label>
                  <textarea
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    placeholder="Was this answer helpful or accurate for your career track?"
                    rows={3}
                    className="w-full bg-white/[0.05] border border-solid border-white/[0.08] rounded-[14px] p-3 text-xs text-text-primary focus:outline-none focus:border-ai-cyan/50 focus:ring-1 focus:ring-ai-cyan/50 placeholder-white/30 transition-all"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-2">
                  <Button
                    onClick={() => setFeedbackMsgIndex(null)}
                    variant="secondary"
                    size="sm"
                    className="text-xs px-4"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitFeedback}
                    loading={submittingFeedback}
                    size="sm"
                    className="text-xs px-5"
                  >
                    Submit Feedback
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
