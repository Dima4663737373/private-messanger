import React from 'react';
// Fixed: COLORS is imported from '../constants', not '../types'
import { Status } from '../types';
import { COLORS } from '../ui_constants';

interface AvatarProps {
  src: string;
  status?: Status;
  size?: number;
  isActive?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({ src, status, size = 44, isActive }) => {
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <img
        src={src}
        alt="avatar"
        className={`w-full h-full object-cover transition-colors duration-200`}
        style={{
          borderRadius: '10px',
          border: `2px solid ${isActive ? COLORS.ACCENT : '#2A2A2A'}`,
        }}
      />
      {status && (
        <span
          className="absolute bottom-[-2px] right-[-2px] w-[12px] h-[12px] border-2 border-[#0A0A0A] rounded-full"
          style={{
            backgroundColor: status === 'online' ? COLORS.ONLINE : status === 'away' ? '#FBBF24' : '#666',
          }}
        />
      )}
    </div>
  );
};

export default Avatar;