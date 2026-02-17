export enum ConnectionQuality {
  EXCELLENT = 'Excellent',
  GOOD = 'Good',
  POOR = 'Poor'
}

export enum MeetingState {
  LOBBY = 'LOBBY',
  JOINING = 'JOINING',
  IN_MEETING = 'IN_MEETING',
  LEFT = 'LEFT'
}

export interface User {
  id: string;
  name: string;
  avatarUrl: string;
  isHost: boolean;
  email?: string;
}

export interface Reaction {
  id: string;
  emoji: string;
  timestamp: number;
}

export interface Participant extends User {
  peerId?: string;
  stream?: MediaStream; // The MediaStream object for real video
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isBlurredBackground: boolean;
  isSpeaking: boolean;
  connectionQuality: ConnectionQuality;
  reactions: Reaction[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
  isAi?: boolean;
}

export interface AiSummaryRequest {
  chatHistory: ChatMessage[];
}