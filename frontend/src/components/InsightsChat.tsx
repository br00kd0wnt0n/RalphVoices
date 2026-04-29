import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, Loader2, MessageSquare } from 'lucide-react';
import { authHeaders } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Inline `**bold**` rendering. Splits on the bold pattern; mismatched/half-open
// `**` during streaming pass through unchanged until the closing pair arrives.
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, j) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length >= 4) {
      return <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>;
    }
    return <span key={j}>{p}</span>;
  });
}

// Lightweight markdown renderer for chat output. Handles the four shapes
// OpenAI reliably emits: bold, headers (## / ###), bullets (with indent), and
// plain paragraphs. Numbered lists render as paragraphs (still readable). No
// new dependency — matches the inline pattern used in TestResults for GWI
// narrative.
function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((rawLine, i) => {
        if (!rawLine.trim()) return <div key={i} className="h-1.5" />;

        const indent = (rawLine.match(/^[ \t]*/)?.[0].length) || 0;
        const line = rawLine.trimStart();

        if (/^#{1,3}\s/.test(line)) {
          return (
            <p key={i} className="font-semibold mt-2">
              {renderInline(line.replace(/^#+\s*/, ''))}
            </p>
          );
        }

        const bullet = line.match(/^([-*•])\s+(.*)$/);
        if (bullet) {
          const indentPx = Math.min(indent, 8) * 6;
          return (
            <div key={i} className="flex gap-2 leading-relaxed" style={{ paddingLeft: `${indentPx}px` }}>
              <span className="text-muted-foreground select-none">•</span>
              <span className="flex-1">{renderInline(bullet[2])}</span>
            </div>
          );
        }

        return <p key={i} className="leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

interface InsightsChatProps {
  testId: string;
}

const SUGGESTIONS = [
  'Summarize the key findings',
  'What are the biggest concerns?',
  'How did skeptics vs enthusiasts differ?',
  'What messaging would work best for TikTok?',
];

export function InsightsChat({ testId }: InsightsChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(content: string) {
    if (!content.trim() || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: content.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    // Add empty assistant message for streaming
    setMessages([...newMessages, { role: 'assistant', content: '' }]);

    try {
      const response = await fetch(`${API_BASE}/tests/${testId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          message: content.trim(),
          history: messages,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.done) break;
              if (data.token) {
                assistantContent += data.token;
                setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
              }
              if (data.error) {
                assistantContent += '\n\n*Error: ' + data.error + '*';
                setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Finalize the assistant message
      if (assistantContent) {
        setMessages([...newMessages, { role: 'assistant', content: assistantContent }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([
        ...newMessages,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex flex-col h-[500px]">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <MessageSquare className="h-10 w-10 mx-auto mb-4 text-muted-foreground/30" />
            <h3 className="text-lg font-medium mb-2">Chat with your results</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Ask questions about your test findings, audience reactions, and strategic implications.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  className="text-xs hover:border-[#D94D8F]/50 hover:text-[#D94D8F] transition-colors"
                  onClick={() => sendMessage(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence mode="popLayout">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-[#D94D8F] text-white rounded-br-sm'
                    : 'bg-muted rounded-bl-sm'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#D94D8F]" />
                    <span className="text-xs font-medium text-[#D94D8F]">Ralph Insights</span>
                  </div>
                )}
                <div className="text-sm leading-relaxed">
                  {msg.content ? (
                    msg.role === 'assistant'
                      ? <ChatMarkdown text={msg.content} />
                      : <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    streaming && i === messages.length - 1 ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                      </span>
                    ) : ''
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input area */}
      <div className="border-t p-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your test results..."
            disabled={streaming}
            className="flex-1 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[#D94D8F]/30 focus:border-[#D94D8F]/50 disabled:opacity-50"
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            size="icon"
            className="h-10 w-10 rounded-xl bg-[#D94D8F] hover:bg-[#D94D8F]/90 text-white shrink-0"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
