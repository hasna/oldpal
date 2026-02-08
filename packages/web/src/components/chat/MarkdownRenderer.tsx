import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  variant?: 'user' | 'assistant';
}

export function MarkdownRenderer({ content, variant = 'assistant' }: MarkdownRendererProps) {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (variant === 'user') {
    const compact = normalized.replace(/\n{2,}/g, '\n');
    return (
      <div className="whitespace-pre-line break-words text-sm leading-relaxed">
        {compact}
      </div>
    );
  }

  const className = 'markdown prose prose-invert max-w-none break-words prose-p:leading-relaxed prose-p:my-2 prose-li:my-1 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2';
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
