
export interface RapPost {
  id: string;
  author: UserProfile;
  content: string;
  media?: {
    type: 'image' | 'video' | 'gif';
    url: string;
  };
  timestamp: Date;
  likes: number;
  likedBy: string[]; // Track handles of users who liked
  shares: number;
  sharedBy: string[]; // Track handles of users who shared
  views: number;
  viewedBy: string[]; // Track unique handles of users who viewed
  replies: RapPost[];
}

export interface DirectMessage {
  id: string;
  senderHandle: string;
  receiverHandle: string;
  content: string;
  timestamp: number;
}

export interface UserProfile {
  handle: string;
  name: string;
  avatar: string;
  banner?: string;
  color: string;
  bio: string;
  joinDate: string;
  followers: string[]; // Array of handles
  following: string[]; // Array of handles
}

export interface LobbyPresence {
  user: UserProfile;
  lastSeen: number;
  tabId: string;
}

export enum NetworkStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  MODERATING = 'MODERATING',
  ERROR = 'ERROR'
}

export type AppTab = 'posts' | 'profile' | 'messages' | 'about';
