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
  Share, Smile, MonitorUp, Copy, Link, Check, User as UserIcon, ArrowRight, Aperture
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

  // Controls State
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isBlurredBackground, setIsBlurredBackground] = useState(false);
  const [showChat, setShowChat] = useState(false);
  
  // UI Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // --- Refs for WebRTC ---
  const peerRef = useRef<Peer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectionsRef = useRef<{ [peerId: string]: DataConnection }>({});
  const callsRef = useRef<{ [peerId: string]: MediaConnection }>({});

  // --- Effects ---

  // Load saved name from local storage on mount
  useEffect(() => {
    const savedName = localStorage.getItem('connect_meet_username');
    if (savedName) {
      setNameInput(savedName);
    }
  }, []);

  // Initialize Media Stream in Lobby
  useEffect(() => {
    const initStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 640, height: 480 }, 
            audio: true 
        });
        localStreamRef.current = stream;
        
        // Initial mute/video state application
        stream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        stream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
        
        // Trigger re-render to show video in lobby
        // We do this by updating localUser if it exists, or just force update via state
        if (localUser) {
           // This effect primarily ensures stream is ready. 
           // The video tile reads from localStreamRef via prop or hook in real implementations, 
           // but here we will pass it into the participant object in the join handler.
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
        setToastMessage("Could not access camera/microphone");
      }
    };
    initStream();
    
    return () => {
        // Cleanup stream on unmount
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
        }
    };
  }, []); // Run once on mount

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

  // Sync local controls to stream and participant state
  useEffect(() => {
    if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isMuted);
        localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
    }

    if (meetingState === MeetingState.IN_MEETING && localUser) {
        // Update local participant state
        setParticipants(prev => prev.map(p => {
            if (p.id === localUser.id) {
                return { ...p, isMuted, isVideoOff, isScreenSharing, isBlurredBackground };
            }
            return p;
        }));

        // Broadcast state change to peers
        broadcastData({
            type: 'UPDATE_STATE',
            payload: {
                peerId: localUser.id, // Using user ID as peer ID in this simplified model
                isMuted,
                isVideoOff,
                isBlurredBackground
            }
        });
    }
  }, [isMuted, isVideoOff, isScreenSharing, isBlurredBackground, localUser, meetingState]);


  // --- Helper: Broadcast Data ---
  const broadcastData = (data: any) => {
      Object.values(connectionsRef.current).forEach(conn => {
          if (conn.open) {
              conn.send(data);
          }
      });
  };

  // --- Handlers ---

  const handleContinue = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!nameInput.trim()) return;

    const trimmedName = nameInput.trim();
    localStorage.setItem('connect_meet_username', trimmedName);

    // If no meeting ID in URL, generate one (which will be our Peer ID)
    // If meeting ID exists, we will connect to it
    const isHost = !hostId;
    
    // NOTE: In this simplified PeerJS flow, we don't know our Peer ID until we init PeerJS.
    // So we create the user object first, but the ID will be updated or linked to Peer ID.
    // For simplicity, we will let PeerJS assign the ID, and we use that as User ID.
    
    const tempUser: User = {
      id: 'temp', // Will update
      name: trimmedName,
      avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedName)}&background=2563eb&color=fff`,
      isHost: isHost
    };

    setLocalUser(tempUser);
    setMeetingState(MeetingState.LOBBY);
  };

  const initializePeer = async () => {
      if (!localUser) return;

      // Import PeerJS dynamically if needed or assume it's global/imported
      // const { default: Peer } = await import('peerjs');
      
      const peer = new Peer(hostId ? undefined : undefined); // If host, let PeerJS generate random ID, or we could force one.

      peer.on('open', (id) => {
          console.log('My peer ID is: ' + id);
          
          if (!hostId) {
              // I am the host, my ID is the meeting ID
              setMeetingId(id);
              // Update URL without reload
              const newUrl = `${window.location.pathname}?meet=${id}`;
              window.history.pushState({ path: newUrl }, '', newUrl);
          }

          // Update local user ID to match Peer ID for consistency
          setLocalUser(prev => prev ? { ...prev, id: id } : null);
          peerRef.current = peer;

          // If I am a guest, connect to the host immediately
          if (hostId) {
             connectToHost(hostId, peer, id);
          }
      });

      peer.on('connection', (conn) => {
          console.log('Incoming connection from:', conn.peer);
          handleDataConnection(conn);
      });

      peer.on('call', (call) => {
          console.log('Incoming call from:', call.peer);
          if (localStreamRef.current) {
              call.answer(localStreamRef.current);
              handleMediaCall(call);
          }
      });

      peer.on('error', (err) => {
          console.error('Peer error:', err);
          setToastMessage(`Connection Error: ${err.type}`);
      });
  };

  const connectToHost = (hostPeerId: string, peer: Peer, myId: string) => {
      // 1. Data Connection (for chat, state sync)
      const conn = peer.connect(hostPeerId, {
          metadata: { name: localUser?.name, avatarUrl: localUser?.avatarUrl }
      });
      handleDataConnection(conn);

      // 2. Media Connection
      if (localStreamRef.current) {
          const call = peer.call(hostPeerId, localStreamRef.current);
          handleMediaCall(call);
      }
  };

  const handleDataConnection = (conn: DataConnection) => {
      connectionsRef.current[conn.peer] = conn;

      conn.on('open', () => {
          console.log('Data connection open with:', conn.peer);
          // Send my details
          if (localUser) {
              conn.send({
                  type: 'USER_INFO',
                  payload: {
                      id: peerRef.current?.id,
                      name: localUser.name,
                      avatarUrl: localUser.avatarUrl,
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
          console.log('Connection closed:', conn.peer);
          removeParticipant(conn.peer);
      });
  };

  const handleMediaCall = (call: MediaConnection) => {
      callsRef.current[call.peer] = call;

      call.on('stream', (remoteStream) => {
          console.log('Received stream from:', call.peer);
          setParticipants(prev => prev.map(p => {
              if (p.id === call.peer) {
                  return { ...p, stream: remoteStream };
              }
              return p;
          }));
      });

      call.on('close', () => {
          removeParticipant(call.peer);
      });
  };

  const handleIncomingData = (data: any, senderPeerId: string) => {
      switch (data.type) {
          case 'USER_INFO':
              addParticipant(senderPeerId, data.payload);
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
               // Received by guest from host. Need to connect to these other peers.
               // Mesh Networking: Everyone connects to everyone.
               // data.payload = [{id, ...}, {id, ...}]
               data.payload.forEach((peerInfo: any) => {
                   if (peerInfo.id !== peerRef.current?.id && !connectionsRef.current[peerInfo.id]) {
                       // Initiate connection to this existing peer
                       connectToPeer(peerInfo.id); 
                   }
               });
               break;
      }

      // If I am Host, and I get a USER_INFO from a new Guest, 
      // I should introduce them to everyone else (or send them the list).
      if (!hostId && data.type === 'USER_INFO') {
          // Send the current list of peers (excluding the new guy) to the new guy
          const existingPeers = participants.filter(p => p.id !== senderPeerId && p.id !== localUser?.id).map(p => ({ id: p.id }));
          
          if (existingPeers.length > 0) {
             const conn = connectionsRef.current[senderPeerId];
             if (conn && conn.open) {
                 conn.send({ type: 'PEER_LIST', payload: existingPeers });
             }
          }
      }
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

  const addParticipant = (id: string, info: any) => {
      setParticipants(prev => {
          if (prev.find(p => p.id === id)) return prev;
          return [...prev, {
              id: id,
              name: info.name || 'Guest',
              avatarUrl: info.avatarUrl || `https://ui-avatars.com/api/?name=Guest`,
              isHost: false, // In mesh, only the original creator is conceptually host, but peers are equal
              isMuted: info.isMuted || false,
              isVideoOff: info.isVideoOff || false,
              isScreenSharing: false,
              isBlurredBackground: false,
              isSpeaking: false,
              connectionQuality: ConnectionQuality.GOOD,
              reactions: []
          }];
      });
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

  const handleJoinMeeting = () => {
    initializePeer();
    
    // Set initial local participant
    if (localUser && localStreamRef.current) {
        setParticipants([{
            ...localUser,
            // ID might still be 'temp' here until peer opens, but that's okay, 
            // the peer.on('open') will update localUser state, 
            // and we will update participant list then or via effect.
            // Actually, let's wait for peer open to finalize this, but for UI feedback:
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
      if (meetingState === MeetingState.IN_MEETING && localUser?.id !== 'temp') {
          setParticipants(prev => prev.map(p => {
              if (p.id === 'local-temp' || p.id === 'temp') {
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

    // Broadcast if not AI internal
    if (!isAiQuery) {
        broadcastData({
            type: 'CHAT_MESSAGE',
            payload: newMessage
        });
    }
  };

  const handleReaction = (emoji: string) => {
    if (!localUser) return;
    
    // Local Update
    addReaction(localUser.id, emoji);
    
    // Broadcast
    broadcastData({
        type: 'REACTION',
        payload: {
            peerId: localUser.id,
            emoji
        }
    });
  };
  
  const handleCopyLink = () => {
    // If we are host and just started, meetingId might be null briefly, but UI handles that.
    const idToShare = meetingId || hostId; 
    const link = `${window.location.origin}${window.location.pathname}?meet=${idToShare}`;
    navigator.clipboard.writeText(link).then(() => {
        setToastMessage("Meeting link copied to clipboard");
        setTimeout(() => setToastMessage(null), 3000);
    }).catch(() => {
        setToastMessage("Failed to copy link");
        setTimeout(() => setToastMessage(null), 3000);
    });
  };

  // --- Renders ---
  
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

  if (!localUser) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-gray-950 relative overflow-hidden">
        {renderToast()}
        {/* Animated Background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary-900/20 via-gray-950 to-gray-950"></div>
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden opacity-30">
            <div className="absolute top-[20%] left-[20%] w-72 h-72 bg-purple-600 rounded-full mix-blend-multiply filter blur-xl animate-pulse-slow"></div>
            <div className="absolute top-[20%] right-[20%] w-72 h-72 bg-blue-600 rounded-full mix-blend-multiply filter blur-xl animate-pulse-slow animation-delay-2000"></div>
        </div>

        <div className="z-10 bg-gray-900/80 backdrop-blur-xl p-8 rounded-2xl border border-gray-700 shadow-2xl max-w-md w-full">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
               <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                  <Video size={32} />
               </div>
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">{APP_NAME}</h1>
            <p className="text-gray-400">
                {hostId ? 'Join the meeting with your name.' : 'Start a new meeting instantly.'}
            </p>
          </div>
          
          <form onSubmit={handleContinue} className="space-y-4">
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

             <Button 
                type="submit"
                disabled={!nameInput.trim()}
                className="w-full py-3 text-base flex items-center justify-center gap-2 group"
             >
                Continue
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
             </Button>
          </form>

          <p className="mt-6 text-xs text-gray-500 text-center">
             Using secure peer-to-peer connection.
          </p>
        </div>
      </div>
    );
  }

  if (meetingState === MeetingState.LOBBY) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-950 text-white p-4">
         {renderToast()}
         <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
            {/* Preview */}
            <div className="space-y-4">
                <div className="aspect-video bg-gray-800 rounded-2xl overflow-hidden relative shadow-2xl border border-gray-700">
                    {isVideoOff ? (
                         <div className="w-full h-full flex items-center justify-center bg-gray-900">
                            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-gray-700">
                                <img src={localUser.avatarUrl} alt="Me" referrerPolicy="no-referrer" />
                            </div>
                         </div>
                    ) : (
                        <VideoTile 
                            participant={{
                                ...localUser, 
                                isMuted, 
                                isVideoOff, 
                                isScreenSharing: false, 
                                isBlurredBackground, 
                                isSpeaking: false, 
                                connectionQuality: ConnectionQuality.EXCELLENT, 
                                reactions: [],
                                stream: localStreamRef.current || undefined
                            }} 
                            isLocal 
                        />
                    )}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-4">
                         <Button 
                            variant="secondary" 
                            size="icon" 
                            active={!isMuted} 
                            onClick={() => setIsMuted(!isMuted)}
                            className={isMuted ? 'bg-red-500 hover:bg-red-600 border-none' : ''}
                            tooltip={isMuted ? "Unmute" : "Mute"}
                        >
                             {isMuted ? <MicOff /> : <Mic />}
                         </Button>
                         <Button 
                            variant="secondary" 
                            size="icon" 
                            active={!isVideoOff} 
                            onClick={() => setIsVideoOff(!isVideoOff)}
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
                    </div>
                </div>
            </div>

            {/* Join Controls */}
            <div className="space-y-6">
                <div>
                    <h2 className="text-3xl font-bold mb-2">Ready to join, {localUser.name.split(' ')[0]}?</h2>
                    
                    {/* Only show Link Copy if we are already Host (or have an ID). 
                        Actually, ID isn't generated until we click Join (Peer Init).
                        So we hide the link here until inside, or we can't show it yet.
                    */}
                    {hostId && (
                        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 mt-4 flex items-center justify-between">
                            <div className="overflow-hidden mr-4">
                                <p className="text-xs text-gray-400 mb-0.5 uppercase tracking-wider font-semibold">Joining Meeting</p>
                                <p className="text-sm font-mono text-blue-400 truncate">
                                    {hostId}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-3">
                    <Button size="lg" onClick={handleJoinMeeting} className="w-full shadow-lg shadow-primary-900/50">
                        {hostId ? 'Join Meeting' : 'Start Meeting'}
                    </Button>
                </div>
            </div>
         </div>
      </div>
    );
  }

  // --- IN MEETING RENDER ---
  
  // Grid Calculation
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
        
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden relative">
            
            {/* Video Grid */}
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
                        <div className="col-span-full flex items-center justify-center h-full text-gray-500">
                            Connecting...
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar (Chat/Participants) */}
            {showChat && localUser && (
                <ChatPanel 
                    messages={messages} 
                    currentUser={localUser}
                    onSendMessage={handleSendMessage}
                    onClose={() => setShowChat(false)}
                />
            )}
        </div>

        {/* Control Bar */}
        <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-between px-6 z-30 shrink-0">
            {/* Left Info */}
            <div className="hidden md:flex items-center gap-3">
                <div className="flex flex-col">
                    <span className="font-bold text-sm">Real-Time Meeting</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1 cursor-pointer hover:text-white transition-colors" onClick={handleCopyLink}>
                        {(meetingId || hostId) ? 'Copy Join Link' : 'Generating Link...'} <Copy size={10} />
                    </span>
                </div>
            </div>

            {/* Center Controls */}
            <div className="flex items-center gap-3">
                <Button 
                    variant="secondary" 
                    size="icon" 
                    active={!isMuted} 
                    onClick={() => setIsMuted(!isMuted)}
                    className={isMuted ? 'bg-red-600 hover:bg-red-700' : ''}
                    tooltip="Toggle Microphone"
                >
                    {isMuted ? <MicOff /> : <Mic />}
                </Button>
                
                <Button 
                    variant="secondary" 
                    size="icon" 
                    active={!isVideoOff} 
                    onClick={() => setIsVideoOff(!isVideoOff)}
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

                <div className="relative group">
                     <Button variant="secondary" size="icon">
                        <Smile size={20} />
                     </Button>
                     {/* Reaction Popover */}
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
                    onClick={() => {
                        peerRef.current?.destroy();
                        window.location.href = window.location.origin + window.location.pathname; // Reload to clear
                    }}
                >
                    <PhoneOff size={20} className="mr-2" />
                    Leave
                </Button>
            </div>

            {/* Right Controls */}
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