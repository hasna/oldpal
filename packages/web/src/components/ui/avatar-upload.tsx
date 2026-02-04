'use client';

import { useState, useRef, useCallback } from 'react';
import { Camera, Loader2, X, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/Button';

interface AvatarUploadProps {
  currentAvatarUrl?: string | null;
  fallback?: string;
  onUpload: (url: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'h-16 w-16',
  md: 'h-24 w-24',
  lg: 'h-32 w-32',
};

const iconSizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

export function AvatarUpload({
  currentAvatarUrl,
  fallback = '?',
  onUpload,
  onRemove,
  size = 'md',
  disabled = false,
  className,
}: AvatarUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (file: File) => {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setError('Please upload a valid image (JPEG, PNG, GIF, or WebP)');
        return;
      }

      // Validate file size (5MB max)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setError('Image must be less than 5MB');
        return;
      }

      setError(null);
      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'avatar');

        const response = await fetch('/api/v1/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error?.message || 'Upload failed');
        }

        await onUpload(data.data.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
      }
    },
    [onUpload]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (disabled || isUploading) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleClick = () => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemove && !isUploading) {
      setIsUploading(true);
      try {
        await onRemove();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove avatar');
      } finally {
        setIsUploading(false);
      }
    }
  };

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'relative rounded-full cursor-pointer transition-all',
          'ring-2 ring-transparent hover:ring-blue-500/50',
          isDragging && 'ring-blue-500 bg-blue-50',
          disabled && 'opacity-50 cursor-not-allowed',
          isUploading && 'cursor-wait'
        )}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label="Upload avatar"
      >
        <Avatar className={cn(sizeClasses[size], 'border-2 border-gray-200')}>
          <AvatarImage src={currentAvatarUrl || undefined} alt="Avatar" />
          <AvatarFallback className="text-lg font-medium bg-gray-100">
            {fallback}
          </AvatarFallback>
        </Avatar>

        {/* Overlay with camera icon */}
        <div
          className={cn(
            'absolute inset-0 rounded-full flex items-center justify-center',
            'bg-black/40 opacity-0 hover:opacity-100 transition-opacity',
            isUploading && 'opacity-100',
            isDragging && 'opacity-100 bg-blue-500/40'
          )}
        >
          {isUploading ? (
            <Loader2 className={cn(iconSizeClasses[size], 'text-white animate-spin')} />
          ) : isDragging ? (
            <Upload className={cn(iconSizeClasses[size], 'text-white')} />
          ) : (
            <Camera className={cn(iconSizeClasses[size], 'text-white')} />
          )}
        </div>

        {/* Remove button */}
        {currentAvatarUrl && onRemove && !isUploading && (
          <button
            onClick={handleRemove}
            className={cn(
              'absolute -top-1 -right-1 p-1 rounded-full',
              'bg-red-500 text-white hover:bg-red-600',
              'transition-colors shadow-md'
            )}
            aria-label="Remove avatar"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <p className="text-xs text-gray-500 text-center">
        Click or drag to upload
        <br />
        JPG, PNG, GIF, or WebP (max 5MB)
      </p>
    </div>
  );
}
