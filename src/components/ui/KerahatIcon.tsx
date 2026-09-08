import React from 'react';
import { motion } from 'motion/react';

export const KerahatIcon = ({ className = '', size = 48 }: { className?: string; size?: number }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: [0.6, 1, 0.6],
        scale: [1, 1.05, 1],
      }}
      transition={{
        duration: 4,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      className={`relative flex items-center justify-center ${className}`}
    >
      {/* Outer Glow */}
      <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full" />

      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="relative z-10">
        {/* Sun Core */}
        <circle cx="24" cy="24" r="10" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.9" />

        {/* Solar Rays */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1="24"
            y1="8"
            x2="24"
            y2="11"
            transform={`rotate(${angle} 24 24)`}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.5"
          />
        ))}

        {/* Horizon Line */}
        <line x1="12" y1="32" x2="36" y2="32" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />

        {/* The "Caution" Strike (Glass Effect Style) */}
        <motion.line
          x1="18"
          y1="18"
          x2="30"
          y2="30"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        />
      </svg>
    </motion.div>
  );
};
