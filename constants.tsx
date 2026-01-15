
import { UserProfile } from "./types";

const STORAGE_KEY = 'fortnite_user_identity_v4';

const generateNewIdentity = (): UserProfile => {
  const seed = Math.floor(Math.random() * 10000);
  return {
    handle: `Player_${seed}`,
    name: `LobbyMember_${seed}`,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`,
    banner: `https://images.unsplash.com/photo-1614850523296-d8c1af93d400?q=80&w=1000&auto=format&fit=crop`,
    color: ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'][seed % 5],
    bio: "Fortnite OG • Dropping bars on the local grid. 🏗️🔥",
    joinDate: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    followers: [],
    following: []
  };
};

const getPersistentIdentity = (): UserProfile => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      return generateNewIdentity();
    }
  }
  const newIdentity = generateNewIdentity();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newIdentity));
  return newIdentity;
};

export const CURRENT_USER: UserProfile = getPersistentIdentity();

export const formatMetric = (num: number): string => {
  if (num >= 1e12) return (num / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
};
