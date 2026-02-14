import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description }) => {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center text-white/40">
      <div className="bg-white/5 p-4 rounded-full mb-4">
        <Icon className="w-8 h-8" />
      </div>
      <h3 className="text-lg font-medium text-white/80 mb-1">{title}</h3>
      <p className="text-sm max-w-xs">{description}</p>
    </div>
  );
};
