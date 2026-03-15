'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Plus, MessageSquare, Search, ChevronRight, Check, RefreshCw, ArrowUpRight, Clock, ShieldCheck, Database, LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

// Mock Data
type Message = {
  id: number;
  role: 'user' | 'assistant';
  type?: 'text' | 'competitive_analysis' | 'recommendations';
  content: string;
  matrix?: any[];
  sources?: string[];
  suggestions?: string[];
  recommendations?: any[];
};

const INITIAL_CONVERSATION: Message[] = [
  {
    id: 1,
    role: 'user',
    content: 'Is Lilian competitive in the AI SDR market right now?',
  },
  {
    id: 2,
    role: 'assistant',
    type: 'competitive_analysis',
    content: 'Lilian is currently facing strong headwinds in the mid-market AI SDR segment. While their outbound email personalization remains top-tier, their lack of native CRM sync and higher pricing has led to a 14% drop in win rates against emerging competitors like Vector over the last quarter.',
    matrix: [
      { feature: 'Outbound Personalization', vector: 'Good', lilian: 'Excellent', vectorColor: 'text-amber-600 bg-amber-50', lilianColor: 'text-emerald-600 bg-emerald-50' },
      { feature: 'CRM Integration', vector: 'Native (Salesforce/HubSpot)', lilian: 'Zapier Only', vectorColor: 'text-emerald-600 bg-emerald-50', lilianColor: 'text-red-600 bg-red-50' },
      { feature: 'Pricing (Per Seat)', vector: '$89/mo', lilian: '$149/mo', vectorColor: 'text-emerald-600 bg-emerald-50', lilianColor: 'text-red-600 bg-red-50' },
      { feature: 'Call Coaching', vector: 'Included', lilian: 'Add-on ($50)', vectorColor: 'text-emerald-600 bg-emerald-50', lilianColor: 'text-amber-600 bg-amber-50' },
      { feature: 'Setup Time', vector: '< 2 hours', lilian: '1-2 weeks', vectorColor: 'text-emerald-600 bg-emerald-50', lilianColor: 'text-red-600 bg-red-50' },
    ],
    sources: ['Meta Ad Library', 'G2 Reviews', 'LinkedIn', 'SerpAPI'],
    suggestions: ['How does Vector\'s pricing compare to others?', 'Show me Lilian\'s recent ad copy', 'What are Lilian\'s top negative G2 reviews?']
  },
  {
    id: 3,
    role: 'user',
    content: 'What should Vector build next?',
  },
  {
    id: 4,
    role: 'assistant',
    type: 'recommendations',
    content: 'Based on current market gaps and competitor weaknesses, here are the prioritized product recommendations for Vector:',
    recommendations: [
      { title: 'Native Outreach.io Integration', rationale: 'Closes the biggest feature gap mentioned in 42% of lost deals last quarter.', score: 94 },
      { title: 'AI Voice Agent Handoff', rationale: 'Emerging trend; early adopters are seeing 3x meeting booked rates. Lilian does not have this.', score: 87 },
      { title: 'Automated LinkedIn Connection Requests', rationale: 'Highly requested by SDRs, but carries platform risk. High reward, medium risk.', score: 72 }
    ],
    sources: ['CRM Lost Reasons', 'Feature Requests Board', 'Competitor Roadmaps'],
    suggestions: ['Draft a PRD for the Outreach integration', 'Analyze the AI Voice Agent market', 'What are the risks of LinkedIn automation?']
  }
];

const HISTORY_ITEMS = [
  { id: 1, title: 'Lilian vs Vector Competitive Analysis' },
  { id: 2, title: 'Q3 Enterprise AI Spending Trends' },
  { id: 3, title: 'Top 10 Fast-Growing Startups in YC W24' },
  { id: 4, title: 'Salesforce Einstein Pricing Strategy' },
];

const DOMAIN_FILTERS = ['SaaS', 'Fintech', 'Healthtech', 'E-commerce'];

export default function VeracityChat() {
  const router = useRouter();
  const supabase = createClient();
  const [messages, setMessages] = useState(INITIAL_CONVERSATION);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(1);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth');
    router.refresh();
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    
    const newUserMsg: Message = { id: Date.now(), role: 'user', content: text };
    setMessages(prev => [...prev, newUserMsg]);
    setInputValue('');
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          type: 'text',
          content: 'Based on live market data, I\'ve analyzed your request. This is a simulated response demonstrating the interface\'s capability to handle dynamic follow-up questions seamlessly.',
          sources: ['Internal Knowledge Base', 'Live Web Search'],
          suggestions: ['Tell me more about this', 'Show me the data sources', 'Summarize the key points']
        }
      ]);
    }, 1500);
  };

  const handleNewQuery = () => {
    setMessages([]);
    setActiveHistoryId(0);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      
      {/* Left Sidebar */}
      <div className="w-[260px] flex-shrink-0 bg-muted border-r border-border flex flex-col h-full">
        <div className="p-6">
          <h1 className="font-serif text-3xl font-bold text-gradient-signature tracking-tight mb-6">
            Veracity
          </h1>
          <button 
            onClick={handleNewQuery}
            className="w-full bg-gradient-signature text-white rounded-xl py-3 px-4 font-medium flex items-center justify-center gap-2 transition-transform hover:-translate-y-[1px] hover:shadow-md"
          >
            <Plus size={18} />
            New Query
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="text-xs font-mono text-muted-foreground mb-3 px-2 uppercase tracking-wider">Recent Queries</div>
          <div className="space-y-1">
            {HISTORY_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveHistoryId(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-colors ${
                  activeHistoryId === item.id 
                    ? 'bg-white shadow-sm border border-border text-foreground font-medium' 
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground'
                }`}
              >
                <MessageSquare size={16} className={activeHistoryId === item.id ? 'text-accent' : 'opacity-50'} />
                <span className="truncate">{item.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-border">
          <div className="text-xs font-mono text-muted-foreground mb-3 px-2 uppercase tracking-wider">Domains</div>
          <div className="flex flex-wrap gap-2 px-2">
            {DOMAIN_FILTERS.map(domain => (
              <span key={domain} className="text-[11px] font-mono bg-black/5 text-muted-foreground px-2.5 py-1 rounded-full border border-black/5 cursor-pointer hover:bg-black/10 transition-colors">
                {domain}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right Main Panel */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Top Header */}
        <div className="h-14 border-b border-border bg-white/80 backdrop-blur-md flex items-center justify-between px-6 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm text-foreground">
              {messages.length > 0 ? 'Lilian vs Vector Competitive Analysis' : 'New Intelligence Query'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-mono flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"></div>
              High Confidence
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground bg-foreground text-white px-4 py-1.5 rounded-full shadow-sm">
              <span className="flex items-center gap-1.5"><Clock size={12} className="text-accent-secondary" /> &lt;5 min</span>
              <span className="w-px h-3 bg-white/20"></span>
              <span className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-accent-secondary" /> 95% grounded</span>
              <span className="w-px h-3 bg-white/20"></span>
              <span className="flex items-center gap-1.5"><Database size={12} className="text-accent-secondary" /> 16+ sources</span>
            </div>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="w-8 h-8 rounded-full bg-gradient-signature text-white flex items-center justify-center text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {userEmail ? userEmail[0].toUpperCase() : <User size={14} />}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-10 w-52 veracity-card py-2 z-50">
                  {userEmail && (
                    <p className="px-4 py-2 text-xs text-muted-foreground truncate border-b border-border mb-1">
                      {userEmail}
                    </p>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <LogOut size={14} className="text-muted-foreground" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Conversation Thread */}
        <div className="flex-1 overflow-y-auto p-6 pb-32">
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-8">
            
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="font-serif text-4xl text-foreground mb-8">What do you want to know?</h2>
                <div className="flex flex-wrap justify-center gap-3 max-w-2xl">
                  {['Analyze Stripe\'s recent pricing changes', 'Who are the key players in AI legal tech?', 'Compare Datadog and New Relic enterprise features'].map(q => (
                    <button 
                      key={q}
                      onClick={() => handleSend(q)}
                      className="veracity-card veracity-card-hover px-5 py-3 text-sm text-foreground flex items-center gap-2"
                    >
                      <Search size={16} className="text-accent" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`} style={{ animationFillMode: 'both', animationDelay: `${idx * 100}ms` }}>
                  
                  {msg.role === 'user' ? (
                    <div className="bg-foreground text-white px-5 py-3.5 rounded-2xl rounded-tr-sm max-w-[85%] text-[15px] leading-relaxed shadow-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[95%] w-full flex flex-col gap-4">
                      
                      {/* Agent Status Pills (only on first response for effect, or all) */}
                      {msg.type === 'competitive_analysis' && (
                        <div className="flex flex-wrap gap-2 mb-1">
                          {['Trend Sensor', 'Win/Loss', 'Competitive'].map(agent => (
                            <span key={agent} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
                              {agent} <Check size={10} className="text-emerald-500" />
                            </span>
                          ))}
                          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                            Positioning <RefreshCw size={10} className="animate-spin text-amber-500" style={{ animationDuration: '3s' }} />
                          </span>
                        </div>
                      )}

                      <div className="veracity-card p-6 flex flex-col gap-5">
                        <div className="text-[15px] leading-relaxed text-foreground">
                          {msg.content}
                        </div>

                        {/* Inline Matrix */}
                        {msg.type === 'competitive_analysis' && msg.matrix && (
                          <div className="overflow-hidden rounded-xl border border-border">
                            <table className="w-full text-sm text-left">
                              <thead className="bg-muted text-xs font-mono uppercase text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-3 font-medium">Feature / Dimension</th>
                                  <th className="px-4 py-3 font-medium border-l border-border">Vector</th>
                                  <th className="px-4 py-3 font-medium border-l border-border">Lilian</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {msg.matrix.map((row: any, i: number) => (
                                  <tr key={i} className="bg-white hover:bg-black/[0.02] transition-colors">
                                    <td className="px-4 py-3 font-medium text-foreground">{row.feature}</td>
                                    <td className={`px-4 py-3 border-l border-border ${row.vectorColor}`}>
                                      <span className="px-2 py-1 rounded-md text-xs font-medium">{row.vector}</span>
                                    </td>
                                    <td className={`px-4 py-3 border-l border-border ${row.lilianColor}`}>
                                      <span className="px-2 py-1 rounded-md text-xs font-medium">{row.lilian}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Recommendations */}
                        {msg.type === 'recommendations' && msg.recommendations && (
                          <div className="flex flex-col gap-3">
                            {msg.recommendations.map((rec: any, i: number) => (
                              <div key={i} className="p-4 rounded-xl border border-border bg-muted/30 flex flex-col gap-3">
                                <div className="flex justify-between items-start gap-4">
                                  <div>
                                    <h4 className="font-medium text-foreground mb-1">{rec.title}</h4>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{rec.rationale}</p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1 shrink-0">
                                    <span className="text-xs font-mono font-medium text-accent">{rec.score}/100</span>
                                  </div>
                                </div>
                                <div className="h-1.5 w-full bg-border rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-gradient-signature rounded-full" 
                                    style={{ width: `${rec.score}%` }}
                                  ></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Sources */}
                        {msg.sources && (
                          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                            <span className="text-xs font-mono text-muted-foreground uppercase">Sources:</span>
                            <div className="flex flex-wrap gap-2">
                              {msg.sources.map((source: string) => (
                                <span key={source} className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md flex items-center gap-1 hover:text-foreground hover:bg-black/5 cursor-pointer transition-colors">
                                  {source} <ArrowUpRight size={10} />
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Suggestions */}
                      {msg.suggestions && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {msg.suggestions.map((sug: string) => (
                            <button 
                              key={sug}
                              onClick={() => handleSend(sug)}
                              className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
                            >
                              {sug} <ChevronRight size={12} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Loading Skeleton */}
            {isLoading && (
              <div className="flex justify-start animate-in fade-in duration-300">
                <div className="max-w-[95%] w-full flex flex-col gap-4">
                  <div className="flex gap-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
                      Synthesizing <RefreshCw size={10} className="animate-spin text-muted-foreground" />
                    </span>
                  </div>
                  <div className="veracity-card p-6 flex flex-col gap-4 w-full max-w-2xl">
                    <div className="h-4 bg-muted rounded w-3/4 animate-pulse-line"></div>
                    <div className="h-4 bg-muted rounded w-full animate-pulse-line"></div>
                    <div className="h-4 bg-muted rounded w-5/6 animate-pulse-line"></div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Bottom Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background to-transparent pt-12">
          <div className="max-w-3xl mx-auto w-full flex flex-col items-center gap-3">
            <div className="relative w-full veracity-card rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-accent/20 focus-within:border-accent/50 transition-all">
              <input 
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend(inputValue)}
                placeholder="Ask a growth intelligence question..."
                className="w-full h-14 pl-5 pr-14 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground"
              />
              <button 
                onClick={() => handleSend(inputValue)}
                disabled={!inputValue.trim() || isLoading}
                className="absolute right-2 top-2 bottom-2 w-10 bg-gradient-signature text-white rounded-xl flex items-center justify-center transition-transform hover:-translate-y-[1px] hover:shadow-md disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                <Send size={16} className={inputValue.trim() ? "translate-x-[-1px] translate-y-[1px]" : ""} />
              </button>
            </div>
            
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"></div>
              Live Data · Sourced · &lt;5 Min
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
