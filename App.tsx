
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RapPost, NetworkStatus, LobbyPresence, UserProfile, DirectMessage, AppTab } from './types';
import { CURRENT_USER } from './constants';
import { checkSafety } from './services/gemini';
import Layout from './components/Layout';
import Composer from './components/Composer';
import Feed from './components/Feed';
import ProfileView from './components/ProfileView';
import AboutView from './components/AboutView';
import MessagesView from './components/MessagesView';

const channel = new BroadcastChannel('fortnite_cypher_v3');
const TAB_ID = Math.random().toString(36).substr(2, 9);

const hydratePosts = (items: any[]): RapPost[] => {
  return items.map(p => ({
    ...p,
    timestamp: p.timestamp instanceof Date ? p.timestamp : new Date(p.timestamp),
    likedBy: Array.isArray(p.likedBy) ? p.likedBy : [],
    sharedBy: Array.isArray(p.sharedBy) ? p.sharedBy : [],
    viewedBy: Array.isArray(p.viewedBy) ? p.viewedBy : [],
    replies: Array.isArray(p.replies) ? hydratePosts(p.replies) : []
  }));
};

const App: React.FC = () => {
  const [posts, setPosts] = useState<RapPost[]>([]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({ [CURRENT_USER.handle]: CURRENT_USER });
  const [presence, setPresence] = useState<Record<string, LobbyPresence>>({});
  const [activeViewers, setActiveViewers] = useState<Record<string, Record<string, number>>>({});
  const [status, setStatus] = useState<NetworkStatus>(NetworkStatus.IDLE);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('posts');
  const [isSyncing, setIsSyncing] = useState(true);

  const FEED_KEY = 'fortnite_v3_feed';
  const MSG_KEY = 'fortnite_v3_messages';
  const PROFILE_KEY = 'fortnite_user_identity_v4';

  const updatePostInTree = (tree: RapPost[], postId: string, updater: (p: RapPost) => RapPost): RapPost[] => {
    return tree.map(p => {
      if (p.id === postId) return updater(p);
      if (p.replies.length > 0) return { ...p, replies: updatePostInTree(p.replies, postId, updater) };
      return p;
    });
  };

  const handleProfileUpdate = (user: UserProfile) => {
    setProfiles(prev => ({ ...prev, [user.handle]: user }));
  };

  useEffect(() => {
    const savedPosts = localStorage.getItem(FEED_KEY);
    const savedMsgs = localStorage.getItem(MSG_KEY);
    
    if (savedPosts) {
      try { setPosts(hydratePosts(JSON.parse(savedPosts))); } catch (e) {}
    }
    if (savedMsgs) {
      try { setMessages(JSON.parse(savedMsgs)); } catch (e) {}
    }

    channel.postMessage({ type: 'SYNC_REQ', tabId: TAB_ID });
    const syncTimeout = setTimeout(() => setIsSyncing(false), 1500);

    const heartbeat = setInterval(() => {
      const myProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
      channel.postMessage({ type: 'PRESENCE', user: myProfile, tabId: TAB_ID });
      handleProfileUpdate(myProfile);
    }, 2000);

    const cleanup = setInterval(() => {
      const now = Date.now();
      setPresence(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(id => {
          if (now - next[id].lastSeen > 5000) { delete next[id]; changed = true; }
        });
        return changed ? next : prev;
      });

      setActiveViewers(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(postId => {
          const viewers = { ...next[postId] };
          let viewerChanged = false;
          Object.keys(viewers).forEach(vTabId => {
            if (now - viewers[vTabId] > 5000) { delete viewers[vTabId]; viewerChanged = true; }
          });
          if (viewerChanged) {
            if (Object.keys(viewers).length === 0) delete next[postId];
            else next[postId] = viewers;
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 3000);

    const handleNetworkMessage = (event: MessageEvent) => {
      const { type, post, user, tabId, postId, parentId, userHandle, posts: syncPosts, message: directMsg } = event.data;

      switch (type) {
        case 'SYNC_REQ':
          if (posts.length > 0) channel.postMessage({ type: 'SYNC_RES', posts, messages, tabId: TAB_ID });
          break;
        case 'SYNC_RES':
          if (isSyncing && syncPosts && syncPosts.length >= posts.length) {
            const hydrated = hydratePosts(syncPosts);
            setPosts(hydrated);
            localStorage.setItem(FEED_KEY, JSON.stringify(hydrated));
            if (event.data.messages) {
              setMessages(event.data.messages);
              localStorage.setItem(MSG_KEY, JSON.stringify(event.data.messages));
            }
            setIsSyncing(false);
          }
          break;
        case 'NEW_POST':
          setPosts(prev => {
            const next = hydratePosts([post, ...prev]);
            localStorage.setItem(FEED_KEY, JSON.stringify(next));
            return next;
          });
          // Check for mentions
          const myHandle = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER)).handle;
          if (post.content.includes(`@${myHandle}`)) {
            setToast(`🔔 @${post.author.handle} mentioned you in a post!`);
            setTimeout(() => setToast(null), 4000);
          }
          break;
        case 'NEW_MESSAGE':
          if (directMsg) {
            setMessages(prev => {
              const next = [...prev, directMsg];
              localStorage.setItem(MSG_KEY, JSON.stringify(next));
              return next;
            });
            const me = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
            if (directMsg.receiverHandle === me.handle) {
              setToast(`📩 New message from @${directMsg.senderHandle}`);
              setTimeout(() => setToast(null), 3000);
            }
          }
          break;
        case 'NEW_REPLY':
          setPosts(prev => {
            const next = updatePostInTree(prev, parentId, (p) => ({
              ...p,
              replies: hydratePosts([post, ...p.replies])
            }));
            localStorage.setItem(FEED_KEY, JSON.stringify(next));
            return next;
          });
          break;
        case 'DELETE_POST':
          setPosts(prev => {
            const removeRecursive = (items: RapPost[]): RapPost[] => 
              items.filter(p => p.id !== postId).map(p => ({ ...p, replies: removeRecursive(p.replies) }));
            const next = removeRecursive(prev);
            localStorage.setItem(FEED_KEY, JSON.stringify(next));
            return next;
          });
          break;
        case 'PROFILE_UPLINK':
          if (user) handleProfileUpdate(user);
          break;
        case 'FOLLOW_UPDATE':
          const { followerHandle, followedHandle, action } = event.data;
          setProfiles(prev => {
            const next = { ...prev };
            if (next[followerHandle]) {
              const following = action === 'follow' 
                ? [...new Set([...next[followerHandle].following, followedHandle])]
                : next[followerHandle].following.filter(h => h !== followedHandle);
              next[followerHandle] = { ...next[followerHandle], following };
              if (followerHandle === CURRENT_USER.handle) localStorage.setItem(PROFILE_KEY, JSON.stringify(next[followerHandle]));
            }
            if (next[followedHandle]) {
              const followers = action === 'follow'
                ? [...new Set([...next[followedHandle].followers, followerHandle])]
                : next[followedHandle].followers.filter(h => h !== followerHandle);
              next[followedHandle] = { ...next[followedHandle], followers };
              if (followedHandle === CURRENT_USER.handle) localStorage.setItem(PROFILE_KEY, JSON.stringify(next[followedHandle]));
            }
            return next;
          });
          break;
        case 'METRIC_UPDATE':
          setPosts(prev => {
            const next = updatePostInTree(prev, postId, (p) => {
              let { likes, likedBy, views, shares, sharedBy, viewedBy } = p;
              if (event.data.metric === 'view' && userHandle) {
                if (!viewedBy.includes(userHandle)) { viewedBy = [...viewedBy, userHandle]; views = viewedBy.length; }
              }
              if (event.data.metric === 'share' && userHandle) {
                if (sharedBy.includes(userHandle)) { sharedBy = sharedBy.filter(h => h !== userHandle); shares = Math.max(0, shares - 1); }
                else { sharedBy = [...sharedBy, userHandle]; shares++; }
              }
              if (event.data.metric === 'like' && userHandle) {
                if (likedBy.includes(userHandle)) { likedBy = likedBy.filter(h => h !== userHandle); likes = Math.max(0, likes - 1); }
                else { likedBy = [...likedBy, userHandle]; likes++; }
              }
              return { ...p, likes, likedBy, views, shares, sharedBy, viewedBy };
            });
            localStorage.setItem(FEED_KEY, JSON.stringify(next));
            return next;
          });
          break;
        case 'LIVE_VIEW_HEARTBEAT':
          setActiveViewers(prev => ({ ...prev, [postId]: { ...(prev[postId] || {}), [tabId]: Date.now() } }));
          break;
        case 'PRESENCE':
          if (tabId !== TAB_ID) {
            setPresence(prev => ({ ...prev, [tabId]: { user, lastSeen: Date.now(), tabId } }));
            handleProfileUpdate(user);
          }
          break;
      }
    };

    channel.addEventListener('message', handleNetworkMessage);
    return () => {
      channel.removeEventListener('message', handleNetworkMessage);
      clearInterval(heartbeat);
      clearInterval(cleanup);
      clearTimeout(syncTimeout);
    };
  }, [isSyncing, posts.length, messages.length]);

  const handlePost = async (content: string, media?: any, parentId?: string) => {
    setStatus(NetworkStatus.MODERATING);
    const isSafe = await checkSafety(content);
    if (!isSafe) {
      setToast("🚫 SHIELD: Toxic content blocked.");
      setTimeout(() => setToast(null), 3000);
      setStatus(NetworkStatus.IDLE);
      return;
    }
    const myProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
    const newPost: RapPost = {
      id: Math.random().toString(36).substr(2, 9),
      author: myProfile,
      content,
      media,
      timestamp: new Date(),
      likes: 0, likedBy: [], shares: 0, sharedBy: [], views: 0, viewedBy: [], replies: []
    };
    if (parentId) {
      setPosts(prev => {
        const next = updatePostInTree(prev, parentId, (p) => ({ ...p, replies: [newPost, ...p.replies] }));
        localStorage.setItem(FEED_KEY, JSON.stringify(next));
        return next;
      });
      channel.postMessage({ type: 'NEW_REPLY', post: newPost, parentId });
    } else {
      setPosts(prev => {
        const next = [newPost, ...prev];
        localStorage.setItem(FEED_KEY, JSON.stringify(next));
        return next;
      });
      channel.postMessage({ type: 'NEW_POST', post: newPost });
    }
    setStatus(NetworkStatus.IDLE);
  };

  const handleSendMessage = async (receiverHandle: string, content: string) => {
    const isSafe = await checkSafety(content);
    if (!isSafe) return;
    const me = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
    const msg: DirectMessage = {
      id: Math.random().toString(36).substr(2, 9),
      senderHandle: me.handle,
      receiverHandle,
      content,
      timestamp: Date.now()
    };
    setMessages(prev => {
      const next = [...prev, msg];
      localStorage.setItem(MSG_KEY, JSON.stringify(next));
      return next;
    });
    channel.postMessage({ type: 'NEW_MESSAGE', message: msg });
  };

  const handleFollow = (targetHandle: string) => {
    const me = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
    const target = profiles[targetHandle];
    if (!target || targetHandle === me.handle) return;
    const action = me.following.includes(targetHandle) ? 'unfollow' : 'follow';
    channel.postMessage({ type: 'FOLLOW_UPDATE', followerHandle: me.handle, followedHandle: targetHandle, action });
    setProfiles(prev => {
      const next = { ...prev };
      const myFollowing = action === 'follow' 
        ? [...new Set([...next[me.handle].following, targetHandle])]
        : next[me.handle].following.filter(h => h !== targetHandle);
      next[me.handle] = { ...next[me.handle], following: myFollowing };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next[me.handle]));
      if (next[targetHandle]) {
        const targetFollowers = action === 'follow'
          ? [...new Set([...next[targetHandle].followers, me.handle])]
          : next[targetHandle].followers.filter(h => h !== me.handle);
        next[targetHandle] = { ...next[targetHandle], followers: targetFollowers };
      }
      return next;
    });
  };

  const handleProfileFullUpdate = (updates: Partial<UserProfile>) => {
    const saved = localStorage.getItem(PROFILE_KEY);
    const current = saved ? JSON.parse(saved) : CURRENT_USER;
    const oldHandle = current.handle;
    const nextProfile = { ...current, ...updates };
    setProfiles(prev => {
      const next = { ...prev };
      if (oldHandle !== nextProfile.handle) delete next[oldHandle];
      next[nextProfile.handle] = nextProfile;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
      channel.postMessage({ type: 'PROFILE_UPLINK', user: nextProfile });
      return next;
    });
  };

  const handleDeletePost = (postId: string) => {
    setPosts(prev => {
      const removeRecursive = (items: RapPost[]): RapPost[] => 
        items.filter(p => p.id !== postId).map(p => ({ ...p, replies: removeRecursive(p.replies) }));
      const next = removeRecursive(prev);
      localStorage.setItem(FEED_KEY, JSON.stringify(next));
      return next;
    });
    channel.postMessage({ type: 'DELETE_POST', postId });
  };

  const handleMetric = (postId: string, metric: 'view' | 'share' | 'like') => {
    const currentIdentity = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
    const userHandle = currentIdentity.handle;
    setPosts(prev => {
      const next = updatePostInTree(prev, postId, (p) => {
        let { likes, likedBy, views, shares, sharedBy, viewedBy } = p;
        if (metric === 'view') { if (!viewedBy.includes(userHandle)) { viewedBy = [...viewedBy, userHandle]; views = viewedBy.length; } }
        if (metric === 'share') { if (sharedBy.includes(userHandle)) { sharedBy = sharedBy.filter(h => h !== userHandle); shares = Math.max(0, shares - 1); } else { sharedBy = [...sharedBy, userHandle]; shares++; } }
        if (metric === 'like') { if (likedBy.includes(userHandle)) { likedBy = likedBy.filter(h => h !== userHandle); likes = Math.max(0, likes - 1); } else { likedBy = [...likedBy, userHandle]; likes++; } }
        return { ...p, likes, likedBy, views, shares, sharedBy, viewedBy };
      });
      localStorage.setItem(FEED_KEY, JSON.stringify(next));
      return next;
    });
    channel.postMessage({ type: 'METRIC_UPDATE', postId, metric, userHandle });
  };

  const onHeartbeatView = (postId: string) => { channel.postMessage({ type: 'LIVE_VIEW_HEARTBEAT', postId, tabId: TAB_ID }); };

  const currentIdentity = JSON.parse(localStorage.getItem(PROFILE_KEY) || JSON.stringify(CURRENT_USER));
  const myProfile = profiles[currentIdentity.handle] || currentIdentity;

  const getHeaderTitle = () => {
    switch (activeTab) {
      case 'posts': return 'FORTNITE POSTS';
      case 'profile': return 'PLAYER PROFILE';
      case 'messages': return 'DIRECT UPLINK';
      case 'about': return 'FORTNITE SHARE INFO';
      default: return 'FORTNITE SHARE';
    }
  };

  return (
    <Layout 
      presence={Object.values(presence)} 
      postCount={posts.length} 
      activeTab={activeTab} 
      onTabChange={setActiveTab}
      currentUser={myProfile}
      posts={posts}
      onViewProfile={(h) => { setActiveTab('profile'); /* In a real app we'd scroll to or load that profile */ }}
    >
      <div className="max-w-2xl mx-auto border-x border-zinc-800 min-h-screen bg-black">
        {toast && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-8 py-4 rounded-2xl font-black z-50 border-2 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.5)] animate-in slide-in-from-top duration-300">
            {toast}
          </div>
        )}
        <header className="sticky top-0 bg-black/95 backdrop-blur-md z-10 p-5 border-b border-zinc-800 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black italic tracking-tighter text-blue-500 uppercase">
              {getHeaderTitle()}
            </h1>
            <p className="text-[10px] text-zinc-500 font-bold uppercase mt-0.5 tracking-widest">
              Fortnite Share • v4.0.1
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {isSyncing ? (
              <span className="text-[9px] font-black text-yellow-500 uppercase tracking-widest animate-pulse">Linking...</span>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span className="text-[9px] font-black text-blue-500/80 uppercase tracking-widest">Grid Active</span>
              </>
            )}
          </div>
        </header>

        {activeTab === 'posts' ? (
          <>
            <Composer onPost={handlePost} status={status} currentUser={myProfile} />
            <Feed 
              posts={posts} 
              profiles={profiles}
              onReply={handlePost} 
              onDelete={handleDeletePost}
              onMetric={handleMetric} 
              onFollow={handleFollow}
              activeViewers={activeViewers}
              onHeartbeatView={onHeartbeatView}
            />
          </>
        ) : activeTab === 'profile' ? (
          <ProfileView 
            user={myProfile} 
            profiles={profiles}
            posts={posts.filter(p => p.author.handle === myProfile.handle)} 
            presenceCount={Object.keys(presence).length}
            onReply={handlePost}
            onDelete={handleDeletePost}
            onMetric={handleMetric}
            onFollow={handleFollow}
            onProfileUpdate={handleProfileFullUpdate}
            activeViewers={activeViewers}
            onHeartbeatView={onHeartbeatView}
          />
        ) : activeTab === 'messages' ? (
          <MessagesView 
            messages={messages} 
            myProfile={myProfile} 
            profiles={profiles} 
            onlineUsers={Object.values(presence).map(p => p.user)}
            onSendMessage={handleSendMessage}
          />
        ) : (
          <AboutView />
        )}
      </div>
    </Layout>
  );
};

export default App;
