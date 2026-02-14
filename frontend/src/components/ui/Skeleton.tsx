import React from 'react';
import { cn } from './Spinner';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div className={cn("animate-pulse bg-white/10 rounded", className)} />
  );
};

export const MessageSkeleton = () => (
  <div className="space-y-4 p-4">
    {[1, 2, 3].map((i) => (
      <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[70%] rounded-2xl p-4 ${i % 2 === 0 ? 'bg-white/10 rounded-tr-none' : 'bg-white/5 rounded-tl-none'}`}>
           <Skeleton className="h-4 w-32 mb-2" />
           <Skeleton className="h-3 w-16 opacity-50" />
        </div>
      </div>
    ))}
  </div>
);

export const ContactSkeleton = () => (
  <div className="space-y-2 p-2">
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-32 opacity-50" />
        </div>
      </div>
    ))}
  </div>
);
