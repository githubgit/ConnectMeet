import React, { useState, useEffect, useCallback, useRef } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { 
  User, Participant, MeetingState, ChatMessage, Reaction, ConnectionQuality 
} from './types';
import { APP_NAME, REACTIONS_LIST } from './constants';
import { VideoTile } from './components/VideoTile';
import { Button } from './components/Button';
import { ChatPanel } from './components/ChatPanel';
import { 
  Mic, MicOff, Video, VideoOff, PhoneOff, 
  MessageSquare, Users, MoreVertical, Settings, 
  Share, Smile, MonitorUp, Copy, Link, Check, User as UserIcon, ArrowRight, Aperture, Image as ImageIcon, Hash, AlertTriangle, ExternalLink, RefreshCw
} from 'lucide-react';

declare global {
    interface Window {
      SelfieSegmentation: any;
    }
}

const App: React.FC = () => {
  // --- State ---
  const [meetingState, setMeetingState] = useState<MeetingState>(MeetingState.LOBBY);
  const [localUser, setLocalUser] = useState<User | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // URL Params for Meeting ID
  const urlParams = new URLSearchParams(window.location.search);
  const initialMeetingId = urlParams.get('meet');
  const [meetingId, setMeetingId] = useState<string | null>(initialMeetingId);
  const [hostId, setHostId] = useState<string | null>(initialMeetingId); // If null, I am host
  
  // Login Input State
  const [nameInput, setNameInput] = useState('');
  const [avatarInput, setAvatarInput] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');

  // Controls State
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isBlurredBackground, setIsBlurredBackground] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [streamReady, setStreamReady] = useState(false); 
  const [peerConnected, setPeerConnected] = useState(false);
  
  // UI Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Environment Check
  const isPreviewEnv = window.location.protocol === 'blob:';

  // --- Refs for WebRTC & Processing ---
  const peerRef = useRef<Peer | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  
  // sourceStreamRef: The RAW camera/mic stream from getUserMedia. Always kept alive.
  const sourceStreamRef = useRef<MediaStream | null>(null);
  // processedStreamRef: The blurred stream from canvas.
  const processedStreamRef = useRef<MediaStream | null>(null);
  // activeStreamRef: The actual stream we are currently showing/sending (points to either source or processed)
  const activeStreamRef = useRef<MediaStream | null>(null);
  
  const connectionsRef = useRef<{ [peerId: string]: DataConnection }>({});
  const callsRef = useRef<{ [peerId: string]: MediaConnection }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing Refs (Hidden)
  const processingVideoRef = useRef<HTMLVideoElement>(null);
  const processingCanvasRef = useRef<HTMLCanvasElement>(null);
  const segmentationRef = useRef<any>(null);
  const requestRef = useRef<number>(0);
  const isSegmentingRef = useRef<boolean>(false);

  // --- Effects ---

  // Load saved settings
  useEffect(() => {
    const savedName = localStorage.getItem('connect_meet_username');
    if (savedName) setNameInput(savedName);
    
    const savedAvatar = localStorage.getItem('connect_meet_avatar');
    if (savedAvatar) setAvatarInput(savedAvatar);
  }, []);

  // Initialize MediaPipe Segmentation globally
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 20; // 10 seconds max

    const initSegmentation = async () => {
        if (window.SelfieSegmentation) {
             try {
                 const seg = new window.SelfieSegmentation({
                     locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/${file}`
                 });
                 await seg.setOptions({ modelSelection: 1 });
                 seg.onResults(onSegmentationResults);
                 segmentationRef.current = seg;
                 console.log("SelfieSegmentation initialized");
             } catch (e) {
                 console.error("Failed to initialize SelfieSegmentation:", e);
                 setToastMessage("Blur effect unavailable (initialization failed)");
             }
        } else {
            if (retryCount < maxRetries) {
                retryCount++;
                setTimeout(initSegmentation, 500);
            } else {
                console.warn("SelfieSegmentation script not loaded after timeout");
                // Don't show toast here to avoid spamming if user doesn't use blur
            }
        }
    };
    initSegmentation();
  }, []);

  const onSegmentationResults = (results: any) => {
      const canvas = processingCanvasRef.current;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== results.image.width || canvas.height !== results.image.height) {
          canvas.width = results.image.width;
          canvas.height = results.image.height;
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw the mask to the canvas
      // We apply a slight blur to the mask to soften the edges
      ctx.filter = 'blur(4px)'; 
      ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';

      // 2. Draw the original image but only where the mask is (the person)
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      // 3. Draw the blurred background
      ctx.globalCompositeOperation = 'destination-over';
      
      // Safari compatibility: Some versions have issues with filter if applied after globalCompositeOperation
      ctx.filter = 'blur(15px)';
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      ctx.restore();
      
      // Safari fix: Ensure the stream is "warmed up" if it was just created
      if (processedStreamRef.current && processedStreamRef.current.getVideoTracks().length === 0) {
          console.log("Safari fix: Re-capturing stream as no tracks found");
          processedStreamRef.current = canvas.captureStream(30);
      }
  };

  const processVideoFrame = async () => {
      if (!isSegmentingRef.current) return;

      const video = processingVideoRef.current;
      if (
          video && 
          segmentationRef.current && 
          !video.paused && 
          !video.ended &&
          video.readyState >= 2 // HAVE_CURRENT_DATA
      ) {
          try {
              await segmentationRef.current.send({ image: video });
          } catch(e) {
              // Ignore frames dropped
          }
      }
      
      // Use requestVideoFrameCallback if available for better sync and performance
      if (video && 'requestVideoFrameCallback' in video) {
          (video as any).requestVideoFrameCallback(processVideoFrame);
      } else {
          requestRef.current = requestAnimationFrame(processVideoFrame);
      }
  };

  // --- Stream Management ---

  // Helper to get the video track we WANT to send
  const getTargetVideoTrack = () => {
      if (isBlurredBackground && processedStreamRef.current) {
          return processedStreamRef.current.getVideoTracks()[0];
      }
      return sourceStreamRef.current?.getVideoTracks()[0];
  };

  // Helper: Replace video track in current calls and update local state
  const refreshTracks = () => {
      const targetVideoTrack = getTargetVideoTrack();
      const currentAudioTrack = sourceStreamRef.current?.getAudioTracks()[0];

      if (!targetVideoTrack) return;

      // 1. Construct the mixed stream we will use for local preview and answering calls
      // Use a new MediaStream to ensure React detects the change if ref logic was simple (but we force update via setParticipants)
      const mixedStream = new MediaStream();
      mixedStream.addTrack(targetVideoTrack);
      if (currentAudioTrack) mixedStream.addTrack(currentAudioTrack);

      activeStreamRef.current = mixedStream;

      // 2. Replace Track in Peer Connections
      Object.values(callsRef.current).forEach((call: any) => {
          const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video');
          if (sender) {
              sender.replaceTrack(targetVideoTrack).catch((e: any) => console.warn("Track replace failed", e));
          }
      });

      // 3. Update Local Participant View
      if (localUser) {
          setParticipants(prev => prev.map(p => {
              if (p.id === localUser.id || p.id === 'local-temp') {
                  return { ...p, stream: mixedStream };
              }
              return p;
          }));
      }

      // 4. Force UI refresh
      setStreamReady(true);
  };

  // --- Blur Toggle Effect ---
  useEffect(() => {
      if (!sourceStreamRef.current) return;

      // Optimization: If video is off, stop processing to save resources and avoid glitches
      if (isVideoOff) {
          isSegmentingRef.current = false;
          cancelAnimationFrame(requestRef.current);
          return;
      }

      const setupBlur = async () => {
          if (isBlurredBackground) {
              // --- ENABLE BLUR ---
              if (!segmentationRef.current) {
                   console.warn("Segmentation model not loaded yet");
                   return;
              }

              // 1. Ensure hidden video is playing source
              if (processingVideoRef.current) {
                  processingVideoRef.current.srcObject = sourceStreamRef.current;
                  await processingVideoRef.current.play().catch(() => {});
              }

              // 2. Initialize Canvas Stream if not exists
              if (processingCanvasRef.current && !processedStreamRef.current) {
                  // Create stream from canvas (30fps)
                  processedStreamRef.current = processingCanvasRef.current.captureStream(30);
              }

              // 3. Start Processing Loop
              isSegmentingRef.current = true;
              cancelAnimationFrame(requestRef.current);
              processVideoFrame();

              // 4. Wait a tiny bit for canvas to populate (avoids black flash) then switch
              setTimeout(() => {
                  refreshTracks();
              }, 100);

          } else {
              // --- DISABLE BLUR ---
              isSegmentingRef.current = false;
              cancelAnimationFrame(requestRef.current);
              
              // Switch back to raw IMMEDIATELY
              refreshTracks();
              
              // Clear canvas for cleanliness (optional)
              if (processingCanvasRef.current) {
                  const ctx = processingCanvasRef.current.getContext('2d');
                  ctx?.clearRect(0,0, processingCanvasRef.current.width, processingCanvasRef.current.height);
              }
          }
      };

      setupBlur();

      return () => {
          cancelAnimationFrame(requestRef.current);
      };
  }, [isBlurredBackground, sourceStreamRef.current, isVideoOff]);

  
  // Helper to start raw media stream
  const startMediaStream = useCallback(async () => {
      try {
        if (sourceStreamRef.current) {
            sourceStreamRef.current.getTracks().forEach(track => track.stop());
        }
        
        setStreamReady(false);
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 }, 
            audio: true 
        });
        
        sourceStreamRef.current = stream;
        activeStreamRef.current = stream; // Default to raw
        
        // Initial setup for hidden video if needed
        if (processingVideoRef.current) {
            processingVideoRef.current.srcObject = stream;
        }

        setStreamReady(true);
        setToastMessage(null);
      } catch (err) {
        console.error("Error accessing media devices:", err);
        setToastMessage("Could not access camera/microphone");
        setStreamReady(false);
      }
  }, []);

  // Initialize Media Stream in Lobby
  useEffect(() => {
    startMediaStream();
    return () => {
        if (sourceStreamRef.current) {
            sourceStreamRef.current.getTracks().forEach(track => track.stop());
        }
    };
  }, [startMediaStream]);

  // Cleanup reactions
  useEffect(() => {
    const interval = setInterval(() => {
      setParticipants(prev => prev.map(p => ({
        ...p,
        reactions: p.reactions.filter(r => Date.now() - r.timestamp < 2000)
      })));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Sync state broadcasting
  useEffect(() => {
    if (meetingState === MeetingState.IN_MEETING && localUser) {
        setParticipants(prev => prev.map(p => {
            if (p.id === localUser.id) {
                return { ...p, isMuted, isVideoOff, isScreenSharing, isBlurredBackground };
            }
            return p;
        }));

        broadcastData({
            type: 'UPDATE_STATE',
            payload: {
                peerId: localUser.id, 
                isMuted,
                isVideoOff,
                isBlurredBackground
            }
        });
    }
  }, [isMuted, isVideoOff, isScreenSharing, isBlurredBackground, localUser, meetingState]);

  const broadcastData = (data: any) => {
      Object.values(connectionsRef.current).forEach((conn: DataConnection) => {
          if (conn.open) conn.send(data);
      });
  };

  const toggleMic = async () => {
    const newMuted = !isMuted;
    
    if (newMuted) {
        // Mute: Stop the tracks to turn off hardware light
        if (sourceStreamRef.current) {
            sourceStreamRef.current.getAudioTracks().forEach(t => t.stop());
        }
        setIsMuted(true);
    } else {
        // Unmute: Get new stream
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const newTrack = stream.getAudioTracks()[0];
            
            if (sourceStreamRef.current) {
                // Clean up old tracks
                sourceStreamRef.current.getAudioTracks().forEach(t => {
                     sourceStreamRef.current?.removeTrack(t);
                });
                sourceStreamRef.current.addTrack(newTrack);
            }
            
            // Replace in all active calls
            Object.values(callsRef.current).forEach((call: any) => {
                const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'audio');
                if (sender) {
                    sender.replaceTrack(newTrack).catch((e: any) => console.warn("Audio track replace failed", e));
                }
            });
            
            setIsMuted(false);
        } catch (err) {
            console.error("Error unmuting:", err);
            setToastMessage("Could not access microphone");
        }
    }
  };

  const toggleCamera = async () => {
    const newVideoOff = !isVideoOff;

    if (newVideoOff) {
        // Stop Video
        if (sourceStreamRef.current) {
            sourceStreamRef.current.getVideoTracks().forEach(t => t.stop());
        }
        setIsVideoOff(true);
    } else {
        // Start Video
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 640, height: 480 } 
            });
            const newTrack = stream.getVideoTracks()[0];
            
            if (sourceStreamRef.current) {
                sourceStreamRef.current.getVideoTracks().forEach(t => {
                    sourceStreamRef.current?.removeTrack(t);
                });
                sourceStreamRef.current.addTrack(newTrack);
            }
            
            setIsVideoOff(false);
            
            // Refresh tracks to peers (useEffect will handle blur pipeline restart if needed)
            refreshTracks();
            
        } catch (err) {
            console.error("Error starting video:", err);
            setToastMessage("Could not access camera");
        }
    }
  };

  const initializePeer = async (user: User, overrideHostId?: string | null) => {
      if (peerRef.current) peerRef.current.destroy();

      setPeerConnected(false);
      const targetHostId = overrideHostId !== undefined ? overrideHostId : hostId;
      
      const peer = new Peer({
          host: '0.peerjs.com',
          port: 443,
          path: '/',
          secure: true,
          config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:stun1.l.google.com:19302' },
                  { urls: 'stun:stun2.l.google.com:19302' },
                  { urls: 'stun:stun3.l.google.com:19302' },
                  { urls: 'stun:stun4.l.google.com:19302' },
              ]
          },
          debug: 1,
          pingInterval: 5000,
      });

      peer.on('open', (id) => {
          setPeerConnected(true);
          
          if (!targetHostId) {
              setMeetingId(id);
              if (!isPreviewEnv) {
                  try {
                      const currentUrl = new URL(window.location.href);
                      currentUrl.searchParams.set('meet', id);
                      window.history.pushState({ path: currentUrl.toString() }, '', currentUrl.toString());
                  } catch (e) {}
              }
          }

          setLocalUser(prev => prev ? { ...prev, id: id } : { ...user, id: id });
          peerRef.current = peer;

          if (targetHostId) connectToHost(targetHostId, peer, id, user);
      });

      peer.on('disconnected', () => {
          setPeerConnected(false);
          console.warn("PeerJS disconnected from server. Attempting to reconnect...");
          
          // Try to reconnect to the server with a delay to avoid thrashing
          if (peer && !peer.destroyed) {
              setTimeout(() => {
                  if (peer && !peer.destroyed) peer.reconnect();
              }, 2000);
          }
      });

      peer.on('error', (err: any) => {
          setPeerConnected(false);
          console.error("PeerJS Error:", err.type, err);
          
          let msg = `Connection Error: ${err.type}`;
          
          if (err.type === 'peer-unavailable') {
              msg = "Meeting ID not found.";
          } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
              msg = "Lost connection to server. Retrying...";
              
              // If we lost connection to the server, try to re-initialize after a delay
              if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = setTimeout(() => {
                  if (localUser) {
                      console.log("Attempting to re-initialize PeerJS...");
                      initializePeer(localUser, hostId);
                  }
              }, 5000);
          } else if (err.type === 'unavailable-id') {
              msg = "ID already in use. Retrying with new ID...";
              setTimeout(() => {
                  if (localUser) initializePeer(localUser, null);
              }, 2000);
          }
          
          setToastMessage(msg);
      });

      peer.on('connection', handleDataConnection);

      peer.on('call', (call) => {
          // Answer with the CURRENT active stream (processed or raw)
          const streamToAnswer = activeStreamRef.current || sourceStreamRef.current;
          
          if (streamToAnswer) {
              call.answer(streamToAnswer);
              handleMediaCall(call);
          } else {
             // Emergency fallback
             navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(stream => {
                 call.answer(stream);
                 handleMediaCall(call);
             });
          }
      });
  };

  const connectToHost = (hostPeerId: string, peer: Peer, myId: string, user: User) => {
      const conn = peer.connect(hostPeerId, {
          metadata: { name: user.name, avatarUrl: user.avatarUrl }
      });
      handleDataConnection(conn, user);

      const streamToCall = activeStreamRef.current || sourceStreamRef.current;
      if (streamToCall) {
          const call = peer.call(hostPeerId, streamToCall);
          handleMediaCall(call);
      }
  };

  const handleDataConnection = (conn: DataConnection, userContext?: User) => {
      connectionsRef.current[conn.peer] = conn;
      conn.on('open', () => {
          const userToSend = userContext || localUser;
          if (userToSend) {
              conn.send({
                  type: 'USER_INFO',
                  payload: {
                      id: peerRef.current?.id,
                      name: userToSend.name,
                      avatarUrl: userToSend.avatarUrl,
                      isMuted,
                      isVideoOff
                  }
              });
          }
      });
      conn.on('data', (data: any) => handleIncomingData(data, conn.peer));
      conn.on('close', () => removeParticipant(conn.peer));
  };

  const handleMediaCall = (call: MediaConnection) => {
      callsRef.current[call.peer] = call;
      call.on('stream', (remoteStream) => {
          setParticipants(prev => {
              const existing = prev.find(p => p.id === call.peer);
              if (existing) {
                  return prev.map(p => p.id === call.peer ? { ...p, stream: remoteStream } : p);
              } else {
                  return [...prev, {
                      id: call.peer,
                      name: 'Connecting...',
                      avatarUrl: 'https://ui-avatars.com/api/?name=?',
                      isHost: false,
                      isMuted: false,
                      isVideoOff: false,
                      isScreenSharing: false,
                      isBlurredBackground: false,
                      isSpeaking: false,
                      connectionQuality: ConnectionQuality.GOOD,
                      reactions: [],
                      stream: remoteStream
                  }];
              }
          });
      });
      call.on('close', () => removeParticipant(call.peer));
  };

  const handleIncomingData = (data: any, senderPeerId: string) => {
      switch (data.type) {
          case 'USER_INFO':
              handleUserInfoUpdate(senderPeerId, data.payload);
              break;
          case 'UPDATE_STATE':
              updateParticipantState(data.payload.peerId, data.payload);
              break;
          case 'CHAT_MESSAGE':
              setMessages(prev => [...prev, data.payload]);
              break;
          case 'REACTION':
              addReaction(data.payload.peerId, data.payload.emoji);
              break;
          case 'PEER_LIST':
               data.payload.forEach((peerInfo: any) => {
                   if (peerInfo.id !== peerRef.current?.id && !connectionsRef.current[peerInfo.id]) {
                       connectToPeer(peerInfo.id); 
                   }
               });
               break;
      }

      if (!hostId && data.type === 'USER_INFO') {
          const existingPeers = participants
            .filter(p => p.id !== senderPeerId && p.id !== localUser?.id)
            .map(p => ({ id: p.id }));
          
          if (existingPeers.length > 0) {
             const conn = connectionsRef.current[senderPeerId];
             if (conn && conn.open) {
                 conn.send({ type: 'PEER_LIST', payload: existingPeers });
             }
          }
      }
  };

  const handleUserInfoUpdate = (id: string, info: any) => {
      setParticipants(prev => {
          const existing = prev.find(p => p.id === id);
          if (existing) {
              return prev.map(p => p.id === id ? { ...p, ...info } : p);
          } else {
              return [...prev, {
                  id: id,
                  name: info.name || 'Guest',
                  avatarUrl: info.avatarUrl || `https://ui-avatars.com/api/?name=Guest`,
                  isHost: false, 
                  isMuted: info.isMuted || false,
                  isVideoOff: info.isVideoOff || false,
                  isScreenSharing: false,
                  isBlurredBackground: false,
                  isSpeaking: false,
                  connectionQuality: ConnectionQuality.GOOD,
                  reactions: [],
              }];
          }
      });
  };

  const connectToPeer = (peerId: string) => {
      if (!peerRef.current) return;
      const conn = peerRef.current.connect(peerId);
      handleDataConnection(conn);
      
      const streamToCall = activeStreamRef.current || sourceStreamRef.current;
      if (streamToCall) {
          const call = peerRef.current.call(peerId, streamToCall);
          handleMediaCall(call);
      }
  };

  const removeParticipant = (id: string) => {
      setParticipants(prev => prev.filter(p => p.id !== id));
      delete connectionsRef.current[id];
      delete callsRef.current[id];
  };

  const updateParticipantState = (id: string, newState: any) => {
      setParticipants(prev => prev.map(p => {
          if (p.id === id) return { ...p, ...newState };
          return p;
      }));
  };
  
  const addReaction = (id: string, emoji: string) => {
      const reaction: Reaction = { id: Math.random().toString(36), emoji, timestamp: Date.now() };
      setParticipants(prev => prev.map(p => {
          if (p.id === id) return { ...p, reactions: [...p.reactions, reaction] };
          return p;
      }));
  };

  const handleTriggerAvatarUpload = (e: React.MouseEvent) => {
    e.preventDefault();
    fileInputRef.current?.click();
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.size <= 2 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            setAvatarInput(result);
            localStorage.setItem('connect_meet_avatar', result);
        };
        reader.readAsDataURL(file);
    } else {
        setToastMessage("Image too large (max 2MB)");
    }
  };

  const handleJoinMeeting = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nameInput.trim()) return;

    const trimmedName = nameInput.trim();
    localStorage.setItem('connect_meet_username', trimmedName);
    
    let targetHostId = hostId;
    if (!targetHostId && joinCodeInput.trim()) {
        targetHostId = joinCodeInput.trim();
        setHostId(targetHostId);
    }

    if (!sourceStreamRef.current) {
        await startMediaStream();
    }
    
    const finalAvatarUrl = avatarInput.trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}&background=2563eb&color=fff`;

    const newUser: User = {
        id: 'local-temp', // Use local-temp from start to match participant ID
        name: trimmedName,
        avatarUrl: finalAvatarUrl,
        isHost: !targetHostId
    };

    setLocalUser(newUser);
    initializePeer(newUser, targetHostId);
    
    // Set initial stream as active stream (raw or processed)
    const streamToUse = activeStreamRef.current || sourceStreamRef.current!;

    setParticipants([{
        ...newUser,
        id: 'local-temp', 
        stream: streamToUse,
        isMuted,
        isVideoOff,
        isScreenSharing: false,
        isBlurredBackground,
        isSpeaking: false,
        connectionQuality: ConnectionQuality.EXCELLENT,
        reactions: []
    }]);
    
    setMeetingState(MeetingState.IN_MEETING);
  };

  // Sync temp ID to real ID
  useEffect(() => {
      if (meetingState === MeetingState.IN_MEETING && localUser?.id && localUser.id !== 'local-temp') {
          setParticipants(prev => prev.map(p => {
              if (p.id === 'local-temp') {
                  return { ...p, id: localUser!.id, name: localUser!.name };
              }
              return p;
          }));
      }
  }, [localUser, meetingState]);


  const handleSendMessage = (text: string, isAiQuery = false) => {
    if (!localUser) return;
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      senderId: isAiQuery && text.startsWith('@gemini') ? 'gemini-bot' : localUser.id,
      senderName: isAiQuery && !text.startsWith('@gemini') ? 'Gemini AI' : localUser.name,
      text: text,
      timestamp: Date.now(),
      isAi: isAiQuery && !text.startsWith('@gemini')
    };
    setMessages(prev => [...prev, newMessage]);
    if (!isAiQuery) broadcastData({ type: 'CHAT_MESSAGE', payload: newMessage });
  };

  const handleReaction = (emoji: string) => {
    if (!localUser) return;
    addReaction(localUser.id, emoji);
    broadcastData({ type: 'REACTION', payload: { peerId: localUser.id, emoji } });
  };
  
  const handleCopyLink = () => {
    const idToShare = meetingId || hostId; 
    if (idToShare) {
        navigator.clipboard.writeText(idToShare)
            .then(() => {
                setToastMessage("Meeting Code Copied");
                setTimeout(() => setToastMessage(null), 3000);
            });
    }
  };
  
  const handleManualReconnect = () => {
      if (localUser) initializePeer(localUser);
  };
  
  const handleLeaveMeeting = () => {
    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
    if (sourceStreamRef.current) { sourceStreamRef.current.getTracks().forEach(track => track.stop()); sourceStreamRef.current = null; }
    setParticipants([]); setMessages([]); setMeetingState(MeetingState.LOBBY);
    setMeetingId(null); setHostId(null); setLocalUser(null); setStreamReady(false);
    setJoinCodeInput(''); setPeerConnected(false); setIsMuted(false); setIsVideoOff(false);
    setIsBlurredBackground(false);
    try { window.history.pushState({}, '', window.location.pathname); } catch(e) {}
    startMediaStream();
  };

  const renderToast = () => {
      if (!toastMessage) return null;
      return (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] animate-float-up">
              <div className="bg-gray-800 text-white px-4 py-3 rounded-lg shadow-xl border border-gray-700 flex items-center gap-3">
                  <div className="bg-green-500/20 p-1 rounded-full"><Check size={16} className="text-green-500" /></div>
                  <span className="text-sm font-medium">{toastMessage}</span>
              </div>
          </div>
      );
  };

  // Preview user object for Lobby
  const previewParticipant: Participant = {
    id: 'preview',
    name: nameInput || 'You',
    avatarUrl: avatarInput.trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(nameInput || 'You')}&background=2563eb&color=fff`,
    isHost: false,
    isMuted,
    isVideoOff,
    isScreenSharing: false,
    isBlurredBackground,
    isSpeaking: false,
    connectionQuality: ConnectionQuality.EXCELLENT,
    reactions: [],
    // In lobby, prioritize showing the ACTIVE stream (which might be blurred)
    stream: activeStreamRef.current || undefined 
  };

  // --- RENDERING ---
  
  // Grid Logic
  const total = participants.length;
  let gridClass = "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
  if (total === 1) gridClass = "grid-cols-1 max-w-4xl";
  else if (total === 2) gridClass = "grid-cols-1 md:grid-cols-2";
  else if (total <= 4) gridClass = "grid-cols-2";
  else if (total <= 9) gridClass = "grid-cols-2 md:grid-cols-3";
  else if (total <= 16) gridClass = "grid-cols-3 md:grid-cols-4";
  else gridClass = "grid-cols-4 md:grid-cols-5 lg:grid-cols-6"; 

  return (
    <div className="h-screen w-full bg-gray-950 text-white flex flex-col overflow-hidden">
        {renderToast()}
        
        {/* Hidden Processing Pipeline - Rendered off-screen to keep processing loop alive */}
        {/* We use opacity-0 instead of visibility-hidden because some browsers stop rendering/playing hidden videos */}
        {/* Safari optimization: keep it in viewport (0,0) with 1px size to prevent aggressive background throttling */}
        <div style={{ position: 'fixed', top: 0, left: 0, width: '1px', height: '1px', opacity: 0, pointerEvents: 'none', zIndex: -1, overflow: 'hidden' }}>
             <video 
                ref={processingVideoRef} 
                playsInline 
                autoPlay 
                muted 
                width={640} 
                height={480}
                onLoadedMetadata={() => {
                    processingVideoRef.current?.play().catch(e => console.log("Hidden video play error", e));
                }}
             />
             <canvas ref={processingCanvasRef} width={640} height={480} />
        </div>

        {meetingState === MeetingState.LOBBY ? (
            <div className="h-full w-full flex flex-col items-center justify-center bg-gray-950 text-white p-4 relative overflow-hidden">
                 <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary-900/10 via-gray-950 to-gray-950 -z-10"></div>
                 <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center z-10">
                    <div className="space-y-4">
                        <div className="aspect-video bg-gray-800 rounded-2xl overflow-hidden relative shadow-2xl border border-gray-700">
                             <VideoTile participant={previewParticipant} isLocal />
                             <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
                                 <Button variant="secondary" size="icon" active={!isMuted} onClick={toggleMic} className={isMuted ? 'bg-red-500 hover:bg-red-600' : ''}>
                                     {isMuted ? <MicOff /> : <Mic />}
                                 </Button>
                                 <Button variant="secondary" size="icon" active={!isVideoOff} onClick={toggleCamera} className={isVideoOff ? 'bg-red-500 hover:bg-red-600' : ''}>
                                     {isVideoOff ? <VideoOff /> : <Video />}
                                 </Button>
                                 <Button variant="secondary" size="icon" active={isBlurredBackground} onClick={() => setIsBlurredBackground(!isBlurredBackground)} className={isBlurredBackground ? 'bg-primary-600 text-white' : ''}>
                                    <Aperture />
                                 </Button>
                                 <Button variant="secondary" size="icon" onClick={handleTriggerAvatarUpload}>
                                    <ImageIcon />
                                 </Button>
                                 <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarFileChange} />
                            </div>
                        </div>
                        <div className="text-center text-sm text-gray-500">Check your audio and video before joining.</div>
                        {isPreviewEnv && (
                            <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex gap-3 items-start">
                                <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={16} />
                                <div className="text-left">
                                    <h4 className="text-yellow-500 font-semibold text-xs mb-1">Preview Mode</h4>
                                    <p className="text-gray-400 text-xs">Sandbox detected. Open in new window to share.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-gray-900/50 backdrop-blur-md p-8 rounded-2xl border border-gray-800 shadow-xl space-y-6">
                        <div>
                            <h2 className="text-3xl font-bold mb-2 text-white">{APP_NAME}</h2>
                            <p className="text-gray-400">{hostId ? 'You are joining a meeting.' : 'Start a new high-quality video meeting.'}</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Your Name</label>
                                <input 
                                    type="text" 
                                    value={nameInput}
                                    onChange={(e) => setNameInput(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                                    placeholder="Enter your name"
                                />
                            </div>

                            {!hostId && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Meeting Code (Optional)</label>
                                    <div className="relative">
                                        <Hash className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
                                        <input 
                                            type="text" 
                                            value={joinCodeInput}
                                            onChange={(e) => setJoinCodeInput(e.target.value)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                                            placeholder="e.g. 74d9-2b1a"
                                        />
                                    </div>
                                </div>
                            )}

                            <Button 
                                onClick={handleJoinMeeting} 
                                className="w-full py-3 text-lg shadow-lg shadow-primary-900/20" 
                                disabled={!nameInput.trim() || !streamReady}
                            >
                                {hostId ? 'Join Meeting' : 'Start New Meeting'} <ArrowRight className="ml-2" size={18} />
                            </Button>
                        </div>
                    </div>
                 </div>
            </div>
        ) : (
            <div className="flex-1 flex relative">
                {/* Main Grid */}
                <div className={`flex-1 p-4 grid gap-4 content-center justify-center overflow-y-auto w-full mx-auto transition-all duration-300 ${gridClass} ${showChat ? 'md:mr-96' : ''}`}>
                    {participants.map(p => (
                        <VideoTile key={p.id} participant={p} isLocal={p.id === localUser?.id} />
                    ))}
                </div>

                {/* Chat Panel */}
                <ChatPanel 
                    messages={messages} 
                    onSendMessage={handleSendMessage} 
                    isOpen={showChat} 
                    onClose={() => setShowChat(false)} 
                />

                {/* Bottom Bar */}
                <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900/90 backdrop-blur-xl border border-gray-700 rounded-2xl px-6 py-3 flex items-center gap-4 shadow-2xl z-40">
                    <Button variant={isMuted ? 'danger' : 'secondary'} size="icon" onClick={toggleMic} tooltip={isMuted ? "Unmute" : "Mute"}>
                        {isMuted ? <MicOff /> : <Mic />}
                    </Button>
                    <Button variant={isVideoOff ? 'danger' : 'secondary'} size="icon" onClick={toggleCamera} tooltip={isVideoOff ? "Turn Video On" : "Turn Video Off"}>
                        {isVideoOff ? <VideoOff /> : <Video />}
                    </Button>
                    <Button variant="secondary" size="icon" active={isBlurredBackground} onClick={() => setIsBlurredBackground(!isBlurredBackground)} className={isBlurredBackground ? 'bg-primary-600 text-white' : ''} tooltip="Toggle Blur">
                        <Aperture />
                    </Button>
                    
                    <div className="w-px h-8 bg-gray-700 mx-2"></div>

                    <Button variant="secondary" size="icon" onClick={() => setShowChat(!showChat)} active={showChat} tooltip="Chat">
                        <MessageSquare />
                        {messages.length > 0 && !showChat && (
                            <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-900"></span>
                        )}
                    </Button>
                    <div className="relative">
                        <Button variant="secondary" size="icon" onClick={() => setShowReactionPicker(!showReactionPicker)} active={showReactionPicker} tooltip="React">
                            <Smile />
                        </Button>
                        {showReactionPicker && (
                            <div className="absolute bottom-14 left-1/2 transform -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-xl p-2 flex gap-2 shadow-xl animate-in fade-in slide-in-from-bottom-2">
                                {REACTIONS_LIST.map(emoji => (
                                    <button 
                                        key={emoji}
                                        onClick={() => {
                                            handleReaction(emoji);
                                            setShowReactionPicker(false);
                                        }}
                                        className="text-2xl hover:scale-125 transition-transform p-1"
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <Button variant="secondary" size="icon" onClick={handleCopyLink} tooltip="Copy Meeting Code">
                        <Link />
                    </Button>

                    <div className="w-px h-8 bg-gray-700 mx-2"></div>

                    <Button variant="danger" onClick={handleLeaveMeeting} className="px-6">
                        <PhoneOff className="mr-2" size={18} /> Leave
                    </Button>
                </div>
                
                {/* Connection Status Indicator */}
                <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/40 backdrop-blur px-3 py-1.5 rounded-full text-xs font-medium text-gray-400">
                    <div className={`w-2 h-2 rounded-full ${peerConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
                    {peerConnected ? 'Connected' : 'Reconnecting...'}
                    {!peerConnected && (
                        <button onClick={handleManualReconnect} className="ml-2 hover:text-white"><RefreshCw size={12}/></button>
                    )}
                </div>
                
                {/* Meeting ID Badge */}
                <div className="absolute top-4 right-4 bg-black/40 backdrop-blur px-3 py-1.5 rounded-full text-xs font-mono text-gray-400 border border-white/5 flex items-center gap-2">
                    <span>ID: {meetingId || '...'}</span>
                    <button onClick={handleCopyLink} className="hover:text-white"><Copy size={12}/></button>
                </div>
            </div>
        )}
    </div>
  );
};

export default App;
