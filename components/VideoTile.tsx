import React, { useEffect, useRef, useState } from 'react';
import { Participant, Reaction, ConnectionQuality } from '../types';
import { Mic, MicOff, Wifi, Aperture } from 'lucide-react';

interface VideoTileProps {
  participant: Participant;
  isLocal?: boolean;
}

declare global {
  interface Window {
    SelfieSegmentation: any;
  }
}

export const VideoTile: React.FC<VideoTileProps> = ({ participant, isLocal = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [segmentation, setSegmentation] = useState<any>(null);
  const streamInitialized = useRef(false);

  // 1. Initialize Local Stream
  useEffect(() => {
    if (isLocal && !streamInitialized.current) {
        // Local stream is handled by App.tsx passed down via participant.stream or similar,
        // but for this component, we often grab it from props if available.
        // However, the App logic attaches streams. 
        // For consistency with the new App logic, we will check if participant.stream exists.
    }
  }, [isLocal]);

  // Handle stream attachment for both Local and Remote
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
        if (participant.stream) {
            // Only update if different to prevent flickering
            if (videoEl.srcObject !== participant.stream) {
                videoEl.srcObject = participant.stream;
            }
        } else {
            // Ensure we clear the source if stream is gone (e.g. leaving meeting)
            videoEl.srcObject = null;
        }
    }
  }, [participant.stream]);

  // 2. Initialize MediaPipe Segmentation (Only for Local)
  useEffect(() => {
    if (isLocal && participant.isBlurredBackground && !segmentation && window.SelfieSegmentation) {
        const seg = new window.SelfieSegmentation({
             locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
        });
        seg.setOptions({ modelSelection: 1 }); // 1 for landscape/better quality
        
        seg.onResults((results: any) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Ensure canvas matches source dimensions
            if (canvas.width !== results.image.width) {
                canvas.width = results.image.width;
                canvas.height = results.image.height;
            }

            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // 1. Draw the Mask (Person shape)
            // Apply a slight blur to the mask to feather the edges. 
            ctx.filter = 'blur(4px)'; 
            ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
            ctx.filter = 'none';

            // 2. Keep the Person (Source-In)
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

            // 3. Draw Blurred Background behind (Destination-Over)
            ctx.globalCompositeOperation = 'destination-over';
            ctx.filter = 'blur(15px)';
            ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

            ctx.restore();
        });

        setSegmentation(seg);
    }
  }, [isLocal, participant.isBlurredBackground, segmentation]);

  // 3. Frame Processing Loop
  useEffect(() => {
    let animationFrameId: number;
    const processFrame = async () => {
        if (
            isLocal && 
            participant.isBlurredBackground && 
            !participant.isVideoOff && 
            videoRef.current && 
            segmentation && 
            videoRef.current.readyState >= 2 // HAVE_CURRENT_DATA
        ) {
            await segmentation.send({ image: videoRef.current });
        }
        animationFrameId = requestAnimationFrame(processFrame);
    };

    if (isLocal && participant.isBlurredBackground) {
        processFrame();
    }
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [isLocal, participant.isBlurredBackground, participant.isVideoOff, segmentation]);

  const getQualityColor = (q: ConnectionQuality) => {
    switch (q) {
      case ConnectionQuality.EXCELLENT: return 'text-green-500';
      case ConnectionQuality.GOOD: return 'text-yellow-500';
      case ConnectionQuality.POOR: return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <div className={`relative bg-gray-800 rounded-xl overflow-hidden aspect-video group ring-2 transition-all ${participant.isSpeaking ? 'ring-primary-500 shadow-lg shadow-primary-500/20' : 'ring-transparent'}`}>
      
      {/* --- Video Content --- */}
      {participant.isVideoOff ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-750">
          <img 
            src={participant.avatarUrl} 
            alt={participant.name} 
            className="h-[60%] max-h-[300px] aspect-square rounded-full border-4 border-gray-600 object-cover shadow-2xl"
          />
        </div>
      ) : (
        <>
            {/* Raw Video (Hidden when blurred locally, or Visible when normal) */}
            <video 
                ref={videoRef} 
                autoPlay 
                muted={isLocal || participant.isMuted} // Always mute local video to prevent echo
                playsInline 
                className={`w-full h-full object-cover transform -scale-x-100 absolute inset-0 ${isLocal && participant.isBlurredBackground ? 'opacity-0' : 'opacity-100'}`}
            />
            
            {/* Processed Canvas (Visible only when blurred and local) */}
            {isLocal && (
                <canvas 
                    ref={canvasRef}
                    className={`w-full h-full object-cover transform -scale-x-100 absolute inset-0 ${participant.isBlurredBackground ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
        </>
      )}

      {/* --- Overlays --- */}
      <div className="absolute bottom-3 left-3 flex items-center space-x-2 z-10">
        <div className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-medium text-white flex items-center gap-2">
           <span>{participant.name} {isLocal && '(You)'}</span>
           {participant.isMuted ? <MicOff size={12} className="text-red-400" /> : <Mic size={12} className="text-green-400" />}
        </div>
      </div>

      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end z-10">
         <div className="bg-black/40 backdrop-blur-sm p-1 rounded-full">
            <Wifi size={14} className={getQualityColor(participant.connectionQuality)} />
         </div>
      </div>

      {/* Floating Reactions */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
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
         <div className="absolute bottom-3 right-3 flex gap-0.5 items-end h-4 z-10">
             <div className="w-1 bg-green-500 animate-[bounce_1s_infinite] h-full"></div>
             <div className="w-1 bg-green-500 animate-[bounce_1.2s_infinite] h-2/3"></div>
             <div className="w-1 bg-green-500 animate-[bounce_0.8s_infinite] h-full"></div>
         </div>
      )}
    </div>
  );
};