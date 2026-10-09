import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#5B7CFA',
    primaryTextColor: '#FFFFFF',
    primaryBorderColor: '#5B7CFA',
    lineColor: '#70E1FF',
    secondaryColor: '#0A0A0F',
    tertiaryColor: '#10131A',
    fontSize: '14px',
  },
  flowchart: { useMaxWidth: true, htmlLabels: true },
});

function parseMermaidNodes(diagram: string) {
  const lines = diagram.split('\n');
  const nodes: { id: string; label: string }[] = [];
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\["?(.*?)"?\]\s*$/);
    if (match) {
      nodes.push({ id: match[1], label: match[2] || match[1] });
    }
  });
  return nodes;
}

function MermaidBlock({ diagram }: { diagram: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    if (!diagram) return;
    let isMounted = true;
    const cleanDiagram = diagram.trim();
    // Unique ID per render to prevent Mermaid DOM collisions
    const renderId = `scpr-mermaid-${Math.random().toString(36).substring(2, 9)}`;

    mermaid.render(renderId, cleanDiagram).then(({ svg }) => {
      if (isMounted && ref.current) {
        ref.current.innerHTML = DOMPurify.sanitize(svg);
        setRenderFailed(false);
      }
    }).catch((err) => {
      console.warn('Mermaid rendering notice:', err);
      if (isMounted) {
        setRenderFailed(true);
      }
    });

    return () => {
      isMounted = false;
      // Clean up any temporary DOM elements left by mermaid
      const tempEl = document.getElementById(renderId) || document.getElementById(`d${renderId}`);
      if (tempEl) tempEl.remove();
    };
  }, [diagram]);

  if (renderFailed) {
    const nodes = parseMermaidNodes(diagram);
    if (nodes.length > 0) {
      return (
        <div className="my-5 p-4 rounded-2xl bg-white/[0.02] border border-solid border-white/[0.08] shadow-lg">
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 flex-wrap">
            {nodes.map((node, i) => (
              <div key={node.id} className="flex items-center gap-3">
                <div className="px-4 py-2.5 rounded-xl bg-brand/15 border border-brand/40 text-text-primary text-xs font-semibold shadow-md flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-brand/30 text-ai-cyan text-[10px] flex items-center justify-center font-mono font-bold">
                    {i + 1}
                  </span>
                  <span>{node.label}</span>
                </div>
                {i < nodes.length - 1 && (
                  <span className="text-ai-cyan font-bold text-sm hidden md:inline">➔</span>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }
  }

  return <div ref={ref} className="my-4 flex justify-center w-full overflow-x-auto min-h-[40px]" />;
}

export function ChatMarkdown({ content }: { content: string }) {
  // If the content is simple text, render it directly to avoid any ReactMarkdown/ESM compatibility layout bugs
  const hasMarkdown = /([#*`_|\[\-]|mermaid)/.test(content || '');
  if (!hasMarkdown) {
    return <p className="whitespace-pre-wrap text-xs text-text-primary leading-relaxed font-medium">{content}</p>;
  }

  try {
    return (
      <div className="prose prose-invert prose-sm max-w-none text-text-primary [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-brand [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:text-sm [&_ul]:space-y-1.5 [&_ul]:mb-3 [&_li]:text-text-secondary [&_hr]:border-white/10 [&_hr]:my-4 [&_strong]:text-text-primary [&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-white/[0.03] [&_pre]:border [&_pre]:border-white/5 [&_pre]:rounded-xl [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_a]:text-brand [&_a]:underline">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              if (match && match[1] === 'mermaid') {
                return <MermaidBlock diagram={String(children).replace(/\n$/, '')} />;
              }
              return <code className={className} {...props}>{children}</code>;
            },
            pre({ children }) {
              return <>{children}</>;
            },
            table({ children }) {
              return (
                <div className="my-4 overflow-x-auto rounded-xl border border-solid border-white/[0.08] bg-white/[0.02] shadow-md">
                  <table className="w-full text-left border-collapse text-xs">
                    {children}
                  </table>
                </div>
              );
            },
            thead({ children }) {
              return <thead className="bg-white/[0.06] border-b border-solid border-white/[0.1] text-text-primary font-bold">{children}</thead>;
            },
            th({ children }) {
              return <th className="px-3.5 py-2.5 text-[11px] font-bold tracking-wider uppercase text-text-primary whitespace-nowrap">{children}</th>;
            },
            td({ children }) {
              return <td className="px-3.5 py-2.5 text-xs text-text-secondary border-t border-solid border-white/[0.04] leading-relaxed whitespace-nowrap">{children}</td>;
            },
            tr({ children }) {
              return <tr className="hover:bg-white/[0.03] transition-colors">{children}</tr>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  } catch (err) {
    console.error("ReactMarkdown rendering error:", err);
    return <p className="whitespace-pre-wrap text-xs text-text-primary leading-relaxed font-medium">{content}</p>;
  }
}
