import React, { useEffect, useRef, useState } from 'react';
import { Participant, ConnectionQuality } from '../types';
import { Mic, MicOff, Wifi } from 'lucide-react';

interface VideoTileProps {
  participant: Participant;
  isLocal?: boolean;
}

export const VideoTile: React.FC<VideoTileProps> = ({ participant, isLocal = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Reset image state if avatar url changes
  useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
  }, [participant.avatarUrl]);

  // Handle stream attachment and ensure playback
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && participant.stream && !participant.isVideoOff) {
      if (videoEl.srcObject !== participant.stream) {
        videoEl.srcObject = participant.stream;
        videoEl.onloadedmetadata = () => {
             videoEl.play().catch(e => console.error("Auto-play failed:", e));
        };
      }
    } else if (videoEl) {
       videoEl.srcObject = null;
    }
  }, [participant.stream, participant.isVideoOff]); 

  const getQualityColor = (q: ConnectionQuality) => {
    switch (q) {
      case ConnectionQuality.EXCELLENT: return 'text-green-500';
      case ConnectionQuality.GOOD: return 'text-yellow-500';
      case ConnectionQuality.POOR: return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getInitials = (name: string) => {
    return (name || 'Guest')
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className={`relative bg-gray-800 rounded-xl overflow-hidden aspect-video group ring-2 transition-all ${participant.isSpeaking ? 'ring-primary-500 shadow-lg shadow-primary-500/20' : 'ring-transparent'}`}>
      
      {/* --- Content Area --- */}
      {participant.isVideoOff ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-750 p-4">
           {/* Fallback/Base Layer: Initials */}
           <div className="absolute flex items-center justify-center w-24 h-24 md:w-32 md:h-32 rounded-full bg-primary-600 border-4 border-gray-700 shadow-xl select-none z-0">
                 <span className="text-3xl md:text-5xl font-bold text-white tracking-wider">
                     {getInitials(participant.name)}
                 </span>
           </div>

           {/* Top Layer: Image (if available and no error) */}
           {!imgError && participant.avatarUrl && (
             <img 
               src={participant.avatarUrl} 
               alt={participant.name} 
               className={`relative w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-gray-700 object-cover shadow-xl z-10 transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
               onLoad={() => setImgLoaded(true)}
               onError={() => setImgError(true)}
             />
           )}
        </div>
      ) : (
        <video 
            ref={videoRef} 
            autoPlay 
            muted={isLocal || participant.isMuted} // Mute local to prevent feedback
            playsInline 
            className="w-full h-full object-cover transform -scale-x-100"
        />
      )}

      {/* --- Overlays --- */}
      <div className="absolute bottom-3 left-3 flex items-center space-x-2 z-20">
        <div className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-medium text-white flex items-center gap-2">
           <span>{participant.name} {isLocal && '(You)'}</span>
           {participant.isMuted ? <MicOff size={12} className="text-red-400" /> : <Mic size={12} className="text-green-400" />}
        </div>
      </div>

      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end z-20">
         <div className="bg-black/40 backdrop-blur-sm p-1 rounded-full">
            <Wifi size={14} className={getQualityColor(participant.connectionQuality)} />
         </div>
      </div>

      {/* Floating Reactions */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
        {participant.reactions.map((reaction) => (
          <div 
            key={reaction.id}
            className="absolute bottom-10 right-1/2 transform translate-x-1/2 text-4xl animate-float-up"
          >
            {reaction.emoji}
          </div>
        ))}
      </div>
      
      {/* Speaking Indicator Visualizer */}
      {participant.isSpeaking && !participant.isMuted && (
         <div className="absolute bottom-3 right-3 flex gap-0.5 items-end h-4 z-20">
             <div className="w-1 bg-green-500 animate-[bounce_1s_infinite] h-full"></div>
             <div className="w-1 bg-green-500 animate-[bounce_1.2s_infinite] h-2/3"></div>
             <div className="w-1 bg-green-500 animate-[bounce_0.8s_infinite] h-full"></div>
         </div>
      )}
    </div>
  );
};