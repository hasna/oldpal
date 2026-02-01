interface FilePreviewProps {
  path: string;
  content: string;
}

export function FilePreview({ path, content }: FilePreviewProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-200">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
        <span>File Preview</span>
        <span className="font-mono">{path}</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed">{content}</pre>
    </div>
  );
}
