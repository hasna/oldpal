interface FilePreviewProps {
  path: string;
  content: string;
}

export function FilePreview({ path, content }: FilePreviewProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-800">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-gray-500">
        <span>File Preview</span>
        <span className="font-mono">{path}</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed">{content}</pre>
    </div>
  );
}
