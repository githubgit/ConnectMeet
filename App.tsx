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
  const [streamReady, setStreamReady] = useState(false); // To trigger render when stream is acquired
  const [peerConnected, setPeerConnected] = useState(false);
  
  // UI Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Environment Check
  const isPreviewEnv = window.location.protocol === 'blob:';

  // --- Refs for WebRTC ---
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef<{ [peerId: string]: DataConnection }>({});
  const callsRef = useRef<{ [peerId: string]: MediaConnection }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Effects ---

  // Load saved settings from local storage on mount
  useEffect(() => {
    const savedName = localStorage.getItem('connect_meet_username');
    if (savedName) setNameInput(savedName);
    
    const savedAvatar = localStorage.getItem('connect_meet_avatar');
    if (savedAvatar) setAvatarInput(savedAvatar);
  }, []);

  // Helper to start media stream
  const startMediaStream = useCallback(async () => {
      try {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        
        setStreamReady(false);
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 }, 
            audio: true 
        });
        localStreamRef.current = stream;
        
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
        // Cleanup stream on unmount
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
    };
  }, [startMediaStream]);

  // Cleanup reactions automatically
  useEffect(() => {
    const interval = setInterval(() => {
      setParticipants(prev => prev.map(p => ({
        ...p,
        reactions: p.reactions.filter(r => Date.now() - r.timestamp < 2000)
      })));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Sync local controls to participant state (Broadcasting)
  useEffect(() => {
    if (meetingState === MeetingState.IN_MEETING && localUser) {
        // Update local participant state
        setParticipants(prev => prev.map(p => {
            if (p.id === localUser.id) {
                // If stream ref has changed (handled in toggleCamera/Mic), we keep the current one from prev unless explicitly updated elsewhere
                // But here we mainly update flags.
                return { ...p, isMuted, isVideoOff, isScreenSharing, isBlurredBackground };
            }
            return p;
        }));

        // Broadcast state change to peers
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
  }, [isMuted, isVideoOff, isScreenSharing, isBlurredBackground, localUser, meetingState, streamReady]);


  // --- Helper: Broadcast Data ---
  const broadcastData = (data: any) => {
      Object.values(connectionsRef.current).forEach((conn: DataConnection) => {
          if (conn.open) {
              conn.send(data);
          }
      });
  };

  // --- Handlers ---

  // Enhanced Toggle Handlers (Stop tracks completely to release hardware)
  const toggleMic = async () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);

    if (localStreamRef.current) {
        if (newMuted) {
            // Stop tracks to release hardware
            localStreamRef.current.getAudioTracks().forEach(t => {
                t.stop();
            });
            // We keep the stream object but tracks are dead.
        } else {
            // Restart Mic
            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const newTrack = audioStream.getAudioTracks()[0];
                
                // Construct a NEW stream to force reactivity and browser refresh
                const currentVideoTracks = localStreamRef.current.getVideoTracks();
                // Filter out stopped tracks from current stream before creating new one
                const activeVideoTracks = currentVideoTracks.filter(t => t.readyState !== 'ended');
                
                const newStream = new MediaStream([...activeVideoTracks, newTrack]);
                localStreamRef.current = newStream;

                // Update participant state with new stream
                if (localUser) {
                    setParticipants(prev => prev.map(p => {
                        if (p.id === localUser.id || p.id === 'local-temp') {
                            return { ...p, stream: newStream };
                        }
                        return p;
                    }));
                }
                
                // If in meeting, replace track for all peers
                if (meetingState === MeetingState.IN_MEETING) {
                     Object.values(callsRef.current).forEach((call: any) => {
                         const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'audio');
                         if (sender) {
                             sender.replaceTrack(newTrack).catch((e: any) => console.error("Replace Audio Track Error", e));
                         }
                     });
                }
                setStreamReady(prev => !prev); // Force refresh
            } catch (e) {
                console.error("Mic restart failed", e);
                setIsMuted(true);
                setToastMessage("Could not access microphone");
            }
        }
    }
  };

  const toggleCamera = async () => {
    const newVideoOff = !isVideoOff;
    setIsVideoOff(newVideoOff);

    if (localStreamRef.current) {
        if (newVideoOff) {
            // Stop tracks to turn off camera light
            localStreamRef.current.getVideoTracks().forEach(t => {
                t.stop();
            });
        } else {
            // Restart Camera
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
                const newTrack = videoStream.getVideoTracks()[0];
                
                // Construct a NEW stream to force reactivity and browser refresh
                const currentAudioTracks = localStreamRef.current.getAudioTracks();
                // Filter out stopped tracks
                const activeAudioTracks = currentAudioTracks.filter(t => t.readyState !== 'ended');

                const newStream = new MediaStream([...activeAudioTracks, newTrack]);
                localStreamRef.current = newStream;
                
                // Update participant state with new stream
                if (localUser) {
                    setParticipants(prev => prev.map(p => {
                        if (p.id === localUser.id || p.id === 'local-temp') {
                            return { ...p, stream: newStream };
                        }
                        return p;
                    }));
                }
                
                // If in meeting, replace track for all peers
                if (meetingState === MeetingState.IN_MEETING) {
                     Object.values(callsRef.current).forEach((call: any) => {
                         const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video');
                         if (sender) {
                             sender.replaceTrack(newTrack).catch((e: any) => console.error("Replace Video Track Error", e));
                         }
                     });
                }
                setStreamReady(prev => !prev); // Force refresh
            } catch (e) {
                console.error("Camera restart failed", e);
                setIsVideoOff(true);
                setToastMessage("Could not access camera");
            }
        }
    }
  };

  const initializePeer = async (user: User, overrideHostId?: string | null) => {
      // Clean up previous peer if exists
      if (peerRef.current) {
          peerRef.current.destroy();
      }

      setPeerConnected(false);
      const targetHostId = overrideHostId !== undefined ? overrideHostId : hostId;
      
      const peer = new Peer({
          config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:stun1.l.google.com:19302' },
              ]
          },
          debug: 1
      });

      peer.on('open', (id) => {
          console.log('My peer ID is: ' + id);
          setPeerConnected(true);
          
          if (!targetHostId) {
              setMeetingId(id);
              
              if (!isPreviewEnv) {
                  try {
                      const currentUrl = new URL(window.location.href);
                      currentUrl.searchParams.set('meet', id);
                      const newUrl = currentUrl.toString();
                      window.history.pushState({ path: newUrl }, '', newUrl);
                  } catch (e) {
                      console.warn("History push failed:", e);
                  }
              }
          }

          setLocalUser(prev => prev ? { ...prev, id: id } : { ...user, id: id });
          peerRef.current = peer;

          if (targetHostId) {
             connectToHost(targetHostId, peer, id, user);
          }
      });

      peer.on('disconnected', () => {
          console.log('Peer disconnected from server.');
          setPeerConnected(false);
          // Auto-reconnect
          if (peer && !peer.destroyed) {
              peer.reconnect();
          }
      });

      peer.on('connection', (conn) => {
          handleDataConnection(conn);
      });

      peer.on('call', (call) => {
          // IMPORTANT: Answer with local stream immediately
          if (localStreamRef.current) {
              call.answer(localStreamRef.current);
              handleMediaCall(call);
          } else {
             // Fallback if stream isn't ready, though it should be
             navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(stream => {
                 call.answer(stream);
                 handleMediaCall(call);
             }).catch(e => console.error("Failed to answer call", e));
          }
      });

      peer.on('error', (err: any) => {
          console.error('Peer error:', err);
          setPeerConnected(false);
          let msg = `Connection Error: ${err.type}`;
          if (err.type === 'peer-unavailable') {
              msg = "Meeting ID not found. Check the code.";
          } else if (err.type === 'network') {
              msg = "Lost connection to server.";
          }
          setToastMessage(msg);
      });
  };

  const connectToHost = (hostPeerId: string, peer: Peer, myId: string, user: User) => {
      // 1. Establish Data Connection for Metadata
      const conn = peer.connect(hostPeerId, {
          metadata: { name: user.name, avatarUrl: user.avatarUrl }
      });
      handleDataConnection(conn, user);

      // 2. Establish Media Call for Stream
      if (localStreamRef.current) {
          const call = peer.call(hostPeerId, localStreamRef.current);
          handleMediaCall(call);
      }
  };

  const handleDataConnection = (conn: DataConnection, userContext?: User) => {
      connectionsRef.current[conn.peer] = conn;

      conn.on('open', () => {
          const userToSend = userContext || localUser;
          // Send my info to the peer
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

      conn.on('data', (data: any) => {
          handleIncomingData(data, conn.peer);
      });

      conn.on('close', () => {
          removeParticipant(conn.peer);
      });
  };

  const handleMediaCall = (call: MediaConnection) => {
      callsRef.current[call.peer] = call;

      call.on('stream', (remoteStream) => {
          console.log("Received stream from:", call.peer);
          // UPSERT LOGIC: Add stream to existing, or create new placeholder
          setParticipants(prev => {
              const existing = prev.find(p => p.id === call.peer);
              if (existing) {
                  // Participant exists, just attach stream
                  return prev.map(p => p.id === call.peer ? { ...p, stream: remoteStream } : p);
              } else {
                  // Race condition: Stream arrived before USER_INFO. Create placeholder.
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
                      stream: remoteStream // Attach stream immediately
                  }];
              }
          });
      });

      call.on('close', () => {
          removeParticipant(call.peer);
      });
      
      call.on('error', (err) => {
          console.error("Media Call Error:", err);
      });
  };

  const handleIncomingData = (data: any, senderPeerId: string) => {
      switch (data.type) {
          case 'USER_INFO':
              // UPSERT LOGIC: Update metadata, preserve stream if exists
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

      // If I am NOT the host, and I receive info from someone who isn't the host and isn't me...
      // share my peer list with them (mesh networking help)
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

  // Helper to robustly update user info without losing stream
  const handleUserInfoUpdate = (id: string, info: any) => {
      setParticipants(prev => {
          const existing = prev.find(p => p.id === id);
          if (existing) {
              return prev.map(p => p.id === id ? { ...p, ...info } : p);
          } else {
              // New participant from Data connection (stream might come later)
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
                  // Stream undefined initially
              }];
          }
      });
  };

  const connectToPeer = (peerId: string) => {
      if (!peerRef.current) return;
      
      const conn = peerRef.current.connect(peerId);
      handleDataConnection(conn);

      if (localStreamRef.current) {
          const call = peerRef.current.call(peerId, localStreamRef.current);
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
          if (p.id === id) {
              return { ...p, ...newState };
          }
          return p;
      }));
  };
  
  const addReaction = (id: string, emoji: string) => {
      const reaction: Reaction = {
          id: Math.random().toString(36),
          emoji,
          timestamp: Date.now()
      };
      setParticipants(prev => prev.map(p => {
          if (p.id === id) {
              return { ...p, reactions: [...p.reactions, reaction] };
          }
          return p;
      }));
  };

  const handleTriggerAvatarUpload = (e: React.MouseEvent) => {
    e.preventDefault();
    fileInputRef.current?.click();
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size (2MB limit)
    if (file.size > 2 * 1024 * 1024) {
        setToastMessage("Image too large. Please choose an image under 2MB.");
        return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
        const result = reader.result as string;
        setAvatarInput(result);
        try {
            localStorage.setItem('connect_meet_avatar', result);
        } catch (err) {
            console.warn("Avatar too large to save in local storage", err);
            setToastMessage("Avatar set, but couldn't be saved for next time.");
        }
    };
    reader.readAsDataURL(file);
  };

  const handleJoinMeeting = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nameInput.trim()) return;

    const trimmedName = nameInput.trim();
    localStorage.setItem('connect_meet_username', trimmedName);
    
    // Logic to handle joinCodeInput if hostId is missing
    let targetHostId = hostId;
    if (!targetHostId && joinCodeInput.trim()) {
        targetHostId = joinCodeInput.trim();
        setHostId(targetHostId);
    }

    // Ensure we have streams before joining
    // If streams are stopped (because video/mic was toggled off), we might need to refresh them to ensure we have a valid stream object to pass, even if tracks are stopped.
    if (!localStreamRef.current) {
        await startMediaStream();
    }
    
    // Apply initial mute states by stopping tracks if necessary.
    if (localStreamRef.current) {
        if (isMuted) {
            localStreamRef.current.getAudioTracks().forEach(t => t.stop());
        }
        if (isVideoOff) {
            localStreamRef.current.getVideoTracks().forEach(t => t.stop());
        }
    }

    const finalAvatarUrl = avatarInput.trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}&background=2563eb&color=fff`;

    const newUser: User = {
        id: 'temp-init', 
        name: trimmedName,
        avatarUrl: finalAvatarUrl,
        isHost: !targetHostId
    };

    setLocalUser(newUser);
    // Pass the targetHostId explicitly to ensure peer connection logic uses the correct ID
    initializePeer(newUser, targetHostId);
    
    if (localStreamRef.current) {
        setParticipants([{
            ...newUser,
            id: 'local-temp', 
            stream: localStreamRef.current,
            isMuted,
            isVideoOff,
            isScreenSharing: false,
            isBlurredBackground,
            isSpeaking: false,
            connectionQuality: ConnectionQuality.EXCELLENT,
            reactions: []
        }]);
    }
    
    setMeetingState(MeetingState.IN_MEETING);
  };

  // Update local participant ID in the list once Peer is ready
  useEffect(() => {
      if (meetingState === MeetingState.IN_MEETING && localUser?.id && localUser.id !== 'temp-init') {
          setParticipants(prev => prev.map(p => {
              if (p.id === 'local-temp' || p.id === 'temp-init') {
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

    if (!isAiQuery) {
        broadcastData({
            type: 'CHAT_MESSAGE',
            payload: newMessage
        });
    }
  };

  const handleReaction = (emoji: string) => {
    if (!localUser) return;
    addReaction(localUser.id, emoji);
    broadcastData({
        type: 'REACTION',
        payload: {
            peerId: localUser.id,
            emoji
        }
    });
  };
  
  const handleCopyLink = () => {
    const idToShare = meetingId || hostId; 
    if (!idToShare) return;

    if (isPreviewEnv) {
        // In preview/blob environments, we can't generate a valid sharing link.
        // We strictly copy the ID and inform the user.
        navigator.clipboard.writeText(idToShare).then(() => {
            setToastMessage("Meeting Code copied! (Preview Mode)");
            setTimeout(() => setToastMessage(null), 3000);
        }).catch(() => {
            setToastMessage("Failed to copy code");
            setTimeout(() => setToastMessage(null), 3000);
        });
    } else {
        // Standard production link generation
        const url = new URL(window.location.href);
        url.searchParams.set('meet', idToShare);
        const link = url.toString();

        navigator.clipboard.writeText(link).then(() => {
            setToastMessage("Meeting link copied to clipboard");
            setTimeout(() => setToastMessage(null), 3000);
        }).catch(() => {
            setToastMessage("Failed to copy link");
            setTimeout(() => setToastMessage(null), 3000);
        });
    }
  };
  
  const handleManualReconnect = () => {
      if (localUser) {
          initializePeer(localUser);
      }
  };

  const handleLeaveMeeting = () => {
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
    }
    setParticipants([]);
    setMessages([]);
    setMeetingState(MeetingState.LOBBY);
    setMeetingId(null);
    setHostId(null);
    setLocalUser(null);
    setStreamReady(false);
    setJoinCodeInput('');
    setPeerConnected(false);
    
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsBlurredBackground(false);
    
    // Robust URL cleanup
    if (!isPreviewEnv) {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete('meet');
            const cleanUrl = url.toString();
            window.history.pushState({}, '', cleanUrl);
        } catch (e) {
            console.warn("Could not reset history state:", e);
        }
    }
    
    const initStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 }, 
            audio: true 
        });
        localStreamRef.current = stream;
        setStreamReady(true);
      } catch (err) {
        console.error("Error re-accessing media:", err);
      }
    };
    initStream();
  };

  const renderToast = () => {
      if (!toastMessage) return null;
      return (
          <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] animate-float-up">
              <div className="bg-gray-800 text-white px-4 py-3 rounded-lg shadow-xl border border-gray-700 flex items-center gap-3">
                  <div className="bg-green-500/20 p-1 rounded-full">
                    <Check size={16} className="text-green-500" />
                  </div>
                  <span className="text-sm font-medium">{toastMessage}</span>
              </div>
          </div>
      );
  };

  const previewParticipant: Participant = {
    id: 'preview',
    name: nameInput || 'You',
    avatarUrl: avatarInput.trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(nameInput || 'You')}&background=2563eb&color=fff`,
    isHost: false,
    isMuted,
    isVideoOff,
    isScreenSharing: false,
    isBlurredBackground: isBlurredBackground,
    isSpeaking: false,
    connectionQuality: ConnectionQuality.EXCELLENT,
    reactions: [],
    stream: localStreamRef.current || undefined
  };

  if (meetingState === MeetingState.LOBBY) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-950 text-white p-4 relative overflow-hidden">
         {renderToast()}
         
         <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary-900/10 via-gray-950 to-gray-950 -z-10"></div>

         <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center z-10">
            {/* Preview Section */}
            <div className="space-y-4">
                <div className="aspect-video bg-gray-800 rounded-2xl overflow-hidden relative shadow-2xl border border-gray-700">
                    {isVideoOff ? (
                         <div className="w-full h-full flex items-center justify-center bg-gray-900 pb-12">
                            <div className="h-[85%] aspect-square rounded-full overflow-hidden border-4 border-gray-700 shadow-2xl">
                                <img src={previewParticipant.avatarUrl} alt="Me" referrerPolicy="no-referrer" className="w-full h-full object-cover"/>
                            </div>
                         </div>
                    ) : (
                        <VideoTile 
                            participant={previewParticipant} 
                            isLocal 
                        />
                    )}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
                         <Button 
                            variant="secondary" 
                            size="icon" 
                            active={!isMuted} 
                            onClick={toggleMic}
                            className={isMuted ? 'bg-red-500 hover:bg-red-600 border-none' : ''}
                            tooltip={isMuted ? "Unmute" : "Mute"}
                        >
                             {isMuted ? <MicOff /> : <Mic />}
                         </Button>
                         <Button 
                            variant="secondary" 
                            size="icon" 
                            active={!isVideoOff} 
                            onClick={toggleCamera}
                            className={isVideoOff ? 'bg-red-500 hover:bg-red-600 border-none' : ''}
                            tooltip={isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                        >
                             {isVideoOff ? <VideoOff /> : <Video />}
                         </Button>
                         <Button
                            variant="secondary"
                            size="icon"
                            active={isBlurredBackground}
                            onClick={() => setIsBlurredBackground(!isBlurredBackground)}
                            className={isBlurredBackground ? 'bg-primary-600 text-white border-none' : ''}
                            tooltip="Toggle Background Blur"
                         >
                            <Aperture />
                         </Button>
                         <Button
                            variant="secondary"
                            size="icon"
                            onClick={handleTriggerAvatarUpload}
                            tooltip="Upload Avatar"
                         >
                            <ImageIcon />
                         </Button>
                         <input 
                            type="file" 
                            ref={fileInputRef}
                            className="hidden" 
                            accept="image/*"
                            onChange={handleAvatarFileChange}
                         />
                    </div>
                </div>
                <div className="text-center text-sm text-gray-500">
                    Check your audio and video before joining.
                </div>
                
                {isPreviewEnv && (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex gap-3 items-start">
                        <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={16} />
                        <div className="text-left">
                            <h4 className="text-yellow-500 font-semibold text-xs mb-1">Preview Mode Detected</h4>
                            <p className="text-gray-400 text-xs leading-relaxed">
                                You are viewing this app in a sandboxed preview URL (blob:). You cannot share this link with others. 
                                <br/><br/>
                                To test with other devices or browsers, please look for an <span className="text-white font-medium inline-flex items-center gap-1">Open in New Window <ExternalLink size={10}/></span> button (usually at the top-right of this preview pane) to get a shareable URL.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Join Controls Section */}
            <div className="bg-gray-900/50 backdrop-blur-md p-8 rounded-2xl border border-gray-800 shadow-xl space-y-6">
                <div>
                    <h2 className="text-3xl font-bold mb-2 text-white">{APP_NAME}</h2>
                    <p className="text-gray-400">
                        {hostId ? 'You are joining a meeting.' : 'Start a new high-quality video meeting.'}
                    </p>
                </div>
                
                <form onSubmit={handleJoinMeeting} className="space-y-4">
                     <div>
                        <label htmlFor="name" className="block text-xs font-medium text-gray-400 mb-1 ml-1">DISPLAY NAME</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                                <UserIcon size={18} />
                            </div>
                            <input 
                                type="text" 
                                id="name"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                placeholder="Enter your full name"
                                className="w-full bg-gray-950 border border-gray-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all placeholder-gray-600"
                                autoFocus
                            />
                        </div>
                     </div>
                     
                     {/* Manual Join Code Input - Displayed if not already joining a specific meeting */}
                     {!hostId && (
                         <div>
                            <label htmlFor="joinCode" className="block text-xs font-medium text-gray-400 mb-1 ml-1">MEETING CODE (OPTIONAL)</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                                    <Hash size={18} />
                                </div>
                                <input 
                                    type="text" 
                                    id="joinCode"
                                    value={joinCodeInput}
                                    onChange={(e) => setJoinCodeInput(e.target.value)}
                                    placeholder="Enter code to join existing"
                                    className="w-full bg-gray-950 border border-gray-700 text-white rounded-lg py-3 pl-10 pr-4 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all placeholder-gray-600"
                                />
                            </div>
                         </div>
                     )}
                     
                     {hostId && (
                        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 flex items-center justify-between">
                            <div className="overflow-hidden mr-4">
                                <p className="text-xs text-gray-400 mb-0.5 uppercase tracking-wider font-semibold">Meeting Code</p>
                                <p className="text-sm font-mono text-blue-400 truncate">
                                    {hostId}
                                </p>
                            </div>
                        </div>
                    )}

                    <Button 
                        type="submit"
                        disabled={!nameInput.trim()}
                        className="w-full py-3 text-base flex items-center justify-center gap-2 group shadow-lg shadow-primary-900/20"
                    >
                        {hostId ? 'Join Meeting' : (joinCodeInput.trim() ? 'Join Existing' : 'Start New Meeting')}
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </Button>
                </form>
            </div>
         </div>
      </div>
    );
  }

  // --- IN MEETING RENDER ---
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
        
        <div className="flex-1 flex overflow-hidden relative">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex items-center justify-center">
                <div className={`grid ${gridClass} gap-4 w-full max-w-[1800px] auto-rows-fr transition-all duration-500`}>
                    {participants.map((p) => (
                        <VideoTile 
                            key={p.id} 
                            participant={p} 
                            isLocal={p.id === localUser?.id || p.id === 'local-temp'} 
                        />
                    ))}
                    {participants.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                            <span>Connecting...</span>
                            {!peerConnected && (
                                <Button 
                                    variant="secondary" 
                                    size="sm" 
                                    onClick={handleManualReconnect}
                                    className="gap-2"
                                >
                                    <RefreshCw size={14} /> Retry Connection
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showChat && localUser && (
                <ChatPanel 
                    messages={messages} 
                    currentUser={localUser}
                    onSendMessage={handleSendMessage}
                    onClose={() => setShowChat(false)}
                />
            )}
        </div>

        <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-between px-6 z-30 shrink-0">
            <div className="hidden md:flex items-center gap-3">
                <div className="flex flex-col">
                    <span className="font-bold text-sm">Real-Time Meeting</span>
                    <div className="flex items-center gap-2">
                        {(meetingId || hostId) && (
                            <span className="text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded font-mono select-all">
                                ID: {meetingId || hostId}
                            </span>
                        )}
                        <span className="text-xs text-gray-400 flex items-center gap-1 cursor-pointer hover:text-white transition-colors" onClick={handleCopyLink}>
                            {(meetingId || hostId) ? (isPreviewEnv ? 'Copy Code' : 'Copy Link') : 'Generating...'} <Copy size={10} />
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button 
                    variant="secondary" 
                    size="icon" 
                    active={!isMuted} 
                    onClick={toggleMic}
                    className={isMuted ? 'bg-red-600 hover:bg-red-700' : ''}
                    tooltip="Toggle Microphone"
                >
                    {isMuted ? <MicOff /> : <Mic />}
                </Button>
                
                <Button 
                    variant="secondary" 
                    size="icon" 
                    active={!isVideoOff} 
                    onClick={toggleCamera}
                    className={isVideoOff ? 'bg-red-600 hover:bg-red-700' : ''}
                    tooltip="Toggle Camera"
                >
                    {isVideoOff ? <VideoOff /> : <Video />}
                </Button>

                <div className="w-px h-8 bg-gray-700 mx-1"></div>

                <Button 
                    variant="secondary" 
                    size="icon" 
                    active={showChat}
                    onClick={() => setShowChat(!showChat)}
                    tooltip="Chat"
                >
                    <MessageSquare size={20} />
                </Button>
                
                <Button
                    variant="secondary"
                    size="icon"
                    onClick={handleCopyLink}
                    tooltip={isPreviewEnv ? "Copy Meeting Code" : "Copy Invite Link"}
                >
                    <Share size={20} />
                </Button>

                <div className="relative group">
                     <Button variant="secondary" size="icon">
                        <Smile size={20} />
                     </Button>
                     <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-4 bg-gray-800 rounded-full shadow-xl border border-gray-700 p-2 flex gap-1 invisible group-hover:visible transition-all opacity-0 group-hover:opacity-100">
                         {REACTIONS_LIST.map(emoji => (
                             <button 
                                key={emoji} 
                                onClick={() => handleReaction(emoji)}
                                className="hover:bg-gray-700 p-2 rounded-full text-xl transition-transform hover:scale-125"
                             >
                                 {emoji}
                             </button>
                         ))}
                     </div>
                </div>

                <Button 
                    variant="secondary" 
                    size="icon"
                    active={isScreenSharing}
                    onClick={() => setIsScreenSharing(!isScreenSharing)}
                    className={isScreenSharing ? 'bg-green-600 text-white' : ''}
                    tooltip="Share Screen"
                >
                    <MonitorUp size={20} />
                </Button>
                
                 <Button
                    variant="secondary"
                    size="icon"
                    active={isBlurredBackground}
                    onClick={() => setIsBlurredBackground(!isBlurredBackground)}
                    className={isBlurredBackground ? 'bg-primary-600 text-white' : ''}
                    tooltip="Toggle Background Blur"
                >
                    <Aperture size={20} />
                </Button>

                <div className="w-px h-8 bg-gray-700 mx-1"></div>

                <Button 
                    variant="danger" 
                    className="px-6 rounded-full"
                    onClick={handleLeaveMeeting}
                >
                    <PhoneOff size={20} className="mr-2" />
                    Leave
                </Button>
            </div>

            <div className="hidden md:flex items-center gap-3">
                 <Button variant="ghost" size="icon">
                     <Settings size={20} />
                 </Button>
            </div>
        </div>
    </div>
  );
};

export default App;