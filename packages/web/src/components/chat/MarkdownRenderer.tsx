import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownRendererProps {
  content: string;
  variant?: 'user' | 'assistant';
}

export function MarkdownRenderer({ content, variant = 'assistant' }: MarkdownRendererProps) {
  const className = variant === 'user'
    ? 'markdown whitespace-pre-line break-words text-sm leading-relaxed'
    : 'markdown prose prose-invert max-w-none prose-p:leading-relaxed prose-p:my-2 prose-li:my-1 prose-ol:my-2 prose-ul:my-2 prose-pre:my-2';
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
