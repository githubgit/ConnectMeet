import React, { useEffect, useRef, useState } from 'react';
import { Participant, ConnectionQuality } from '../types';
import { Mic, MicOff, Wifi } from 'lucide-react';

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
  const [isSegmentationReady, setIsSegmentationReady] = useState(false);
  const requestRef = useRef<number>(0);
  const previousStreamId = useRef<string | null>(null);

  // Handle stream attachment and ensure playback
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && participant.stream) {
      // Check if stream actually changed to avoid unnecessary resets
      if (videoEl.srcObject !== participant.stream) {
        videoEl.srcObject = participant.stream;
        videoEl.onloadedmetadata = () => {
             videoEl.play().catch(e => console.error("Auto-play failed:", e));
        };
      }
    } else if (videoEl) {
       videoEl.srcObject = null;
    }
  }, [participant.stream]);

  // Initialize MediaPipe Segmentation (Only for Local)
  useEffect(() => {
    if (!isLocal || !participant.isBlurredBackground) {
        if (segmentation) {
            // Cleanup existing segmentation if disabled
            setIsSegmentationReady(false);
            setSegmentation(null);
            try { segmentation.close(); } catch(e) {}
        }
        return;
    }

    if (segmentation) return; // Already initialized

    let isActive = true;
    let seg: any = null;

    const initSegmentation = async () => {
        if (!window.SelfieSegmentation) {
             // Script hasn't loaded yet, retry shortly
             setTimeout(initSegmentation, 200);
             return;
        }

        try {
            console.log("Initializing SelfieSegmentation...");
            seg = new window.SelfieSegmentation({
                 locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`
            });
            
            await seg.setOptions({ modelSelection: 1 });
            
            seg.onResults((results: any) => {
                if (!isActive) return;
                
                const canvas = canvasRef.current;
                // If the component unmounted or canvas is gone, stop
                if (!canvas) return;
                
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Sync canvas size with video frame
                if (canvas.width !== results.image.width || canvas.height !== results.image.height) {
                    canvas.width = results.image.width;
                    canvas.height = results.image.height;
                }

                ctx.save();
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // 1. Draw the Segmentation Mask with blur for soft edges
                ctx.filter = 'blur(4px)'; 
                ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
                ctx.filter = 'none';

                // 2. Composite: Keep the Person (Source-In) using the mask
                ctx.globalCompositeOperation = 'source-in';
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

                // 3. Composite: Draw Blurred Background behind (Destination-Over)
                ctx.globalCompositeOperation = 'destination-over';
                ctx.filter = 'blur(15px)';
                ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

                ctx.restore();
                
                setIsSegmentationReady(true);
            });

            if (isActive) {
                setSegmentation(seg);
            } else {
                seg.close();
            }
        } catch (error) {
            console.error("Failed to initialize selfie segmentation:", error);
        }
    };

    initSegmentation();

    return () => {
        isActive = false;
        if (seg) {
            try { seg.close(); } catch(e) {}
        }
    };
  }, [isLocal, participant.isBlurredBackground]); // Intentionally removed 'segmentation' from deps to avoid loop

  // Frame Processing Loop
  const processFrame = async () => {
    const video = videoRef.current;
    
    if (
        isLocal && 
        participant.isBlurredBackground && 
        segmentation && 
        video && 
        video.readyState >= 2 && // ReadyState 2 = HAVE_CURRENT_DATA
        video.videoWidth > 0 && 
        video.videoHeight > 0 &&
        !participant.isVideoOff
    ) {
        try {
             // Ensure video is playing
             if (video.paused) await video.play();
             
             await segmentation.send({ image: video });
        } catch (e) {
             // console.warn("Frame processing error:", e);
        }
    }
    
    requestRef.current = requestAnimationFrame(processFrame);
  };

  useEffect(() => {
     if (isLocal && participant.isBlurredBackground && segmentation) {
         requestRef.current = requestAnimationFrame(processFrame);
     } else {
         if (requestRef.current) cancelAnimationFrame(requestRef.current);
         setIsSegmentationReady(false);
     }
     return () => {
         if (requestRef.current) cancelAnimationFrame(requestRef.current);
     };
  }, [isLocal, participant.isBlurredBackground, segmentation, participant.isVideoOff]);


  const getQualityColor = (q: ConnectionQuality) => {
    switch (q) {
      case ConnectionQuality.EXCELLENT: return 'text-green-500';
      case ConnectionQuality.GOOD: return 'text-yellow-500';
      case ConnectionQuality.POOR: return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  // We show raw video if blur is off, OR if blur is on but not ready yet (so user doesn't see black screen)
  // BUT we only overlay the spinner if blur is requested and not ready.
  const showBlurCanvas = isLocal && participant.isBlurredBackground && isSegmentationReady;
  const showRawVideo = !participant.isVideoOff && !showBlurCanvas;

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
            {/* Raw Video */}
            <video 
                ref={videoRef} 
                autoPlay 
                muted={isLocal || participant.isMuted} 
                playsInline 
                className={`w-full h-full object-cover transform -scale-x-100 absolute inset-0 transition-opacity duration-300 ${showRawVideo ? 'opacity-100' : 'opacity-0'}`}
            />
            
            {/* Processed Canvas */}
            <canvas 
                ref={canvasRef}
                className={`w-full h-full object-cover transform -scale-x-100 absolute inset-0 transition-opacity duration-300 ${showBlurCanvas ? 'opacity-100' : 'opacity-0'}`}
            />
            
            {/* Loading Spinner for Blur */}
            {isLocal && participant.isBlurredBackground && !isSegmentationReady && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                     <div className="bg-black/40 backdrop-blur-md p-3 rounded-2xl flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                        <span className="text-xs font-medium text-white/80">Initializing Blur...</span>
                     </div>
                </div>
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