import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import ePub, { type Book as EpubBook, type Location, type NavItem, type Rendition } from "epubjs";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import {
  BookMarked,
  BookOpen,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  Headphones,
  Home,
  Library,
  List,
  ListMusic,
  Mic2,
  Moon,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  Shuffle,
  Settings,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  UserRound,
  Plus,
  X,
  Menu,
  Network,
  Radio,
  Search,
  Copy,
  Edit3
} from "lucide-react";

import { AnimatePresence, motion } from "framer-motion";
import "./styles/app.css";

const API_BASE = resolveApiBase();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const HIGHLIGHT_COLORS = ["#f1bd65", "#52c41a", "#1890ff", "#ff4d4f"];

type View = "home" | "books" | "reader" | "music" | "podcasts" | "settings";
type Theme = "night" | "day";
type PlayMode = "shuffle" | "repeat-all" | "repeat-one";

type User = {
  id: string;
  name: string;
  avatar: string;
  role: string;
};

type BookItem = {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  description: string | null;
  format: "epub" | "pdf";
  createdAt: string;
  updatedAt: string;
  progress: number;
  cfi: string | null;
  chapterTitle: string | null;
  recentReadAt: string | null;
  bookmarkCount: number;
};

type AudioTrack = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  coverPath: string | null;
  kind: "music" | "podcast";
  filePath?: string | null;
};

type ScanRoot = {
  id: string;
  path: string;
  enabled: number;
  lastScannedAt: string | null;
};



type BookmarkItem = {
  id: string;
  bookId: string;
  cfi: string;
  title: string | null;
  note: string | null;
  color: string | null;
  createdAt: string;
};

type LyricLine = {
  time: number | null;
  text: string;
};

type ReadingActivity = {
  day: string;
  seconds: number;
};

function App() {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<Theme>("day");
  const [users, setUsers] = useState<User[]>([]);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [music, setMusic] = useState<AudioTrack[]>([]);
  const [recentMusic, setRecentMusic] = useState<AudioTrack[]>([]);
  const [podcasts, setPodcasts] = useState<AudioTrack[]>([]);
  const [activeQueue, setActiveQueue] = useState<AudioTrack[]>([]);
  const queue = useMemo(() => [...music, ...podcasts], [music, podcasts]);
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [readingActivity, setReadingActivity] = useState<ReadingActivity[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState(() => {
    return localStorage.getItem("shufang.activeUserId") || "";
  });
  const [isReaderOpen, setIsReaderOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<AudioTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>("repeat-all");
  const [audioPosition, setAudioPosition] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricText, setCurrentLyricText] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const mainPanelRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousViewRef = useRef<View>("books");
  const returningFromReaderRef = useRef(false);

  const [isSyncEnabled, setIsSyncEnabled] = useState(false);
  const [pendingSession, setPendingSession] = useState<{ trackId: string; position: number; isPlaying: boolean; playMode?: PlayMode; track?: AudioTrack } | null>(null);

  const clientId = useMemo(() => {
    let id = localStorage.getItem("shufang.clientId");
    if (!id) {
      id = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem("shufang.clientId", id);
    }
    return id;
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const isApplyingWsUpdateRef = useRef(false);
  const lastSentPositionRef = useRef(0);
  const lastSentTimeRef = useRef(0);

  const sendWsMessage = (
    type: string,
    payload: {
      trackId?: string;
      position?: number;
      isPlaying?: boolean;
      playMode?: PlayMode;
      track?: AudioTrack;
    }
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!isSyncEnabled) return;
    if (isApplyingWsUpdateRef.current) return;

    const activeTrack = payload.track ?? (payload.trackId ? undefined : currentTrack);

    wsRef.current.send(
      JSON.stringify({
        type,
        clientId,
        trackId: payload.trackId ?? currentTrack?.id,
        position: payload.position ?? audioPosition,
        isPlaying: payload.isPlaying ?? isPlaying,
        playMode: payload.playMode,
        track: activeTrack ? {
          id: activeTrack.id,
          title: activeTrack.title,
          artist: activeTrack.artist,
          album: activeTrack.album,
          duration: activeTrack.duration,
          coverPath: activeTrack.coverPath,
          kind: activeTrack.kind,
          filePath: activeTrack.filePath
        } : undefined
      })
    );
  };

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) ?? null,
    [activeBookId, books]
  );
  const activeUser = users.find((user) => user.id === activeUserId) ?? users[0] ?? {
    id: "",
    name: "访客",
    avatar: "👤",
    role: "member"
  };

  useEffect(() => {
    const wsUrl = `${resolveWsBase()}/ws/sync`;
    let ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const setupWs = () => {
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { type, clientId: msgClientId, trackId, position, isPlaying: msgIsPlaying, playMode: msgPlayMode } = message;

          if (msgClientId === clientId) return;

          if (type === "SESSION_STATE") {
            if (message.hasOtherClients) {
              setPendingSession({ trackId, position, isPlaying: msgIsPlaying, playMode: msgPlayMode, track: message.track });
            } else if (isSyncEnabled) {
              const track = queue.find((t) => t.id === trackId) || message.track;
              if (track) {
                isApplyingWsUpdateRef.current = true;
                setCurrentTrack(track);
                setIsPlaying(msgIsPlaying);
                if (msgPlayMode) setPlayMode(msgPlayMode);
                setTimeout(() => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = position;
                    setAudioPosition(position);
                  }
                  isApplyingWsUpdateRef.current = false;
                }, 100);
              }
            }
          } else if (isSyncEnabled) {
            isApplyingWsUpdateRef.current = true;

            if (type === "PLAY_MODE_CHANGE") {
              if (msgPlayMode) {
                setPlayMode(msgPlayMode);
              }
            } else if (type === "TRACK_CHANGE") {
              const track = queue.find((t) => t.id === trackId) || message.track;
              if (track) {
                setCurrentTrack(track);
                setIsPlaying(msgIsPlaying);
                if (audioRef.current) {
                  audioRef.current.currentTime = position;
                  setAudioPosition(position);
                }
              }
            } else if (type === "PLAY") {
              setIsPlaying(true);
              if (audioRef.current) {
                if (Math.abs(audioRef.current.currentTime - position) > 2) {
                  audioRef.current.currentTime = position;
                  setAudioPosition(position);
                }
              }
            } else if (type === "PAUSE") {
              setIsPlaying(false);
              if (audioRef.current) {
                if (Math.abs(audioRef.current.currentTime - position) > 2) {
                  audioRef.current.currentTime = position;
                  setAudioPosition(position);
                }
              }
            } else if (type === "SEEK") {
              if (audioRef.current) {
                audioRef.current.currentTime = position;
                setAudioPosition(position);
              }
            }

            setTimeout(() => {
              isApplyingWsUpdateRef.current = false;
            }, 500);
          }
        } catch (err) {
          console.error("Failed to parse websocket message", err);
        }
      };

      ws.onclose = () => {
        setTimeout(() => {
          if (wsRef.current === ws) {
            let nextWs = new WebSocket(wsUrl);
            wsRef.current = nextWs;
            ws = nextWs;
            setupWs();
          }
        }, 3000);
      };
    };

    setupWs();

    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [clientId, queue, isSyncEnabled]);

  const handleToggleSync = (value: boolean) => {
    if (value) {
      if (pendingSession) {
        const track = queue.find((t) => t.id === pendingSession.trackId) || pendingSession.track;
        if (track) {
          isApplyingWsUpdateRef.current = true;
          setCurrentTrack(track);
          setIsPlaying(true);
          setIsSyncEnabled(true);
          if (pendingSession.playMode) {
            setPlayMode(pendingSession.playMode);
          }

          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.currentTime = pendingSession.position;
              setAudioPosition(pendingSession.position);
              void audioRef.current.play().catch((err) => {
                console.error("Autoplay failed:", err);
              });
            }
            isApplyingWsUpdateRef.current = false;
          }, 150);
        }
        setPendingSession(null);
      } else {
        setIsSyncEnabled(true);
      }
    } else {
      setIsSyncEnabled(false);
      setPendingSession(null);
    }
  };

  useEffect(() => {
    if (activeUserId) {
      localStorage.setItem("shufang.activeUserId", activeUserId);
      void refreshAll(activeUserId);
    } else {
      api<User[]>("/api/users").then(setUsers).catch(console.error);
    }
  }, [activeUserId]);

  useEffect(() => {
    if (users.length > 0) {
      if (!activeUserId || !users.some((user) => user.id === activeUserId)) {
        setIsUserModalOpen(true);
      }
    }
  }, [users, activeUserId]);

  useEffect(() => {
    if (!activeBookId && books.length > 0) {
      setActiveBookId(books[0].id);
    }
  }, [activeBookId, books]);

  useEffect(() => {
    if (returningFromReaderRef.current) {
      returningFromReaderRef.current = false;
      return;
    }
    mainPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);

  useEffect(() => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      void audioRef.current.play().catch(() => setIsPlaying(false));
    } else {
      audioRef.current.pause();
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    setAudioPosition(0);
    setAudioDuration(currentTrack?.duration ?? 0);
    setLyrics([]);
    setCurrentLyricText("");
    if (!currentTrack) return;
    void api<{ lines: LyricLine[] }>(`/api/audio/${currentTrack.id}/lyrics`)
      .then((result) => setLyrics(result.lines))
      .catch(() => setLyrics([]));
  }, [currentTrack]);

  useEffect(() => {
    setCurrentLyricText(currentLyric(lyrics, audioPosition));
  }, [lyrics, audioPosition]);

  const refreshAll = async (userId = activeUserId) => {
    const [nextUsers, nextBooks, nextMusic, nextPodcasts, nextRoots, nextRecentMusic] = await Promise.all([
      api<User[]>("/api/users"),
      api<BookItem[]>(`/api/books?userId=${encodeURIComponent(userId)}`),
      api<AudioTrack[]>("/api/audio?kind=music"),
      api<AudioTrack[]>("/api/audio?kind=podcast"),
      api<ScanRoot[]>("/api/roots"),
      api<AudioTrack[]>(`/api/audio/recent?userId=${encodeURIComponent(userId)}&kind=music`).catch(() => [])
    ]);
    setUsers(nextUsers);
    setBooks(nextBooks);
    setMusic(nextMusic);
    setPodcasts(nextPodcasts);
    setRoots(nextRoots);
    setRecentMusic(nextRecentMusic);
    await refreshReadingActivity(userId);
  };

  const refreshReadingActivity = async (userId = activeUserId) => {
    const activity = await api<ReadingActivity[]>(`/api/reading/activity?userId=${encodeURIComponent(userId)}&days=10000`);
    setReadingActivity(activity);
  };

  const openBook = (bookId: string) => {
    setActiveBookId(bookId);
    setIsReaderOpen(true);
  };

  const updateBookProgress = (bookId: string, cfi: string, progress: number, chapterTitle: string) => {
    const now = new Date().toISOString();
    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.id === bookId
          ? {
              ...book,
              cfi,
              progress,
              chapterTitle,
              recentReadAt: now
            }
          : book
      )
    );
  };

  const clearBookProgress = async (bookId: string) => {
    try {
      await api(`/api/books/${bookId}/progress?userId=${encodeURIComponent(activeUserId)}`, {
        method: "DELETE"
      });
      setBooks((currentBooks) =>
        currentBooks.map((book) =>
          book.id === bookId
            ? {
                ...book,
                cfi: null,
                progress: 0,
                chapterTitle: null,
                recentReadAt: null
              }
            : book
        )
      );
    } catch (err) {
      console.error("Failed to clear book progress:", err);
    }
  };

  const updateBookCover = (bookId: string, coverPath: string) => {
    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.id === bookId
          ? {
              ...book,
              coverPath
            }
          : book
      )
    );
  };

  const addReadingSeconds = (seconds: number) => {
    const day = calendarDateKey(new Date());
    setReadingActivity((items) => {
      const existing = items.find((item) => item.day === day);
      if (existing) {
        return items.map((item) => (item.day === day ? { ...item, seconds: item.seconds + seconds } : item));
      }
      return [...items, { day, seconds }].sort((a, b) => a.day.localeCompare(b.day));
    });
    void api("/api/reading/activity", {
      method: "POST",
      body: JSON.stringify({ userId: activeUserId, seconds, day })
    });
  };

  const saveAudioProgress = async (track: AudioTrack, position: number) => {
    try {
      await api(`/api/audio/${track.id}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: activeUserId,
          position,
          track: track.kind === "podcast" ? {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            coverPath: track.coverPath,
            kind: track.kind,
            filePath: track.filePath
          } : undefined
        })
      });
      if (position === 0) {
        const nextRecent = await api<AudioTrack[]>(`/api/audio/recent?userId=${encodeURIComponent(activeUserId)}&kind=music`);
        setRecentMusic(nextRecent);
      }
    } catch (err) {
      console.error("Failed to save audio progress:", err);
    }
  };

  const playTrack = (track: AudioTrack, customQueue?: AudioTrack[]) => {
    setCurrentTrack(track);
    setIsPlaying(true);
    if (customQueue) {
      setActiveQueue(customQueue);
    } else {
      if (track.kind === "podcast") {
        setActiveQueue(podcasts.filter(t => t.album === track.album));
      } else {
        setActiveQueue(music);
      }
    }
    sendWsMessage("TRACK_CHANGE", { trackId: track.id, position: 0, isPlaying: true, track });
    void saveAudioProgress(track, 0);
  };



  const playNextTrack = () => {
    if (!currentTrack) {
      if (queue.length === 0) return;
      playTrack(queue[0]);
      return;
    }

    if (currentTrack.kind === "podcast") {
      if (playMode === "repeat-one") {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          void audioRef.current.play();
        }
        setIsPlaying(true);
        return;
      }

      // Find the episodes of the current program
      let programTracks: AudioTrack[] = [];
      if (activeQueue.length > 0 && activeQueue.some(t => t.kind === "podcast" && t.album === currentTrack.album)) {
        programTracks = activeQueue.filter(t => t.kind === "podcast" && t.album === currentTrack.album);
      } else {
        programTracks = podcasts.filter(t => t.album === currentTrack.album);
      }

      if (programTracks.length === 0) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        return;
      }

      const index = programTracks.findIndex(t => t.id === currentTrack.id || (t.filePath && t.filePath === currentTrack.filePath));
      if (index === -1) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        return;
      }

      if (playMode === "shuffle") {
        const choices = programTracks.filter((track) => track.id !== currentTrack.id && track.filePath !== currentTrack.filePath);
        if (choices.length > 0) {
          const nextTrack = choices[Math.floor(Math.random() * choices.length)];
          playTrack(nextTrack, programTracks);
        } else {
          setIsPlaying(false);
          if (audioRef.current) {
            audioRef.current.pause();
          }
        }
        return;
      }

      const nextIndex = index + 1;
      if (nextIndex < programTracks.length) {
        const nextTrack = programTracks[nextIndex];
        playTrack(nextTrack, programTracks);
      } else {
        // Automatically stop playing when current program is finished
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
      return;
    }

    if (queue.length === 0) return;
    if (playMode === "repeat-one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        void audioRef.current.play();
      }
      setIsPlaying(true);
      return;
    }
    if (playMode === "shuffle") {
      const choices = queue.filter((track) => track.id !== currentTrack.id);
      const nextTrack = choices[Math.floor(Math.random() * choices.length)] ?? currentTrack;
      if (nextTrack.id === currentTrack.id) restartCurrentTrack(audioRef.current, setIsPlaying);
      else playTrack(nextTrack);
      return;
    }
    const index = queue.findIndex((track) => track.id === currentTrack.id);
    const nextTrack = queue[(index + 1) % queue.length];
    if (nextTrack.id === currentTrack.id) restartCurrentTrack(audioRef.current, setIsPlaying);
    else playTrack(nextTrack);
  };

  const seekAudio = (position: number) => {
    if (!audioRef.current) return;
    if (!Number.isFinite(position)) return;
    const duration = finiteDuration(audioRef.current.duration) ?? audioDuration;
    audioRef.current.currentTime = duration ? Math.min(position, duration) : position;
    setAudioPosition(position);
    sendWsMessage("SEEK", { position });
  };

  const runScan = async () => {
    setIsScanning(true);
    setMessage("");
    try {
      const result = await api<{ books: number; audio: number; files: number; errors: unknown[] }>("/api/scan", {
        method: "POST"
      });
      setMessage(`扫描完成：${result.books} 本书，${result.audio} 个音频，检查 ${result.files} 个文件`);
      await refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsScanning(false);
    }
  };

  const navigateTo = (nextView: View) => {
    setView(nextView);
    setIsSidebarOpen(false);
  };

  return (
    <div className="app-shell" data-theme={theme} data-view={view}>
      {isSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />}
      
      <header className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setIsSidebarOpen(true)} aria-label="打开导航">
          <Menu size={22} />
        </button>
        <div className="mobile-brand-title">
          <strong>书房</strong>
        </div>
      </header>

      <aside className={`sidebar ${isSidebarOpen ? "open" : ""}`} aria-label="主导航">
        <div className="brand">
          <button
            className="brand-mark brand-mark-btn"
            onClick={() => setIsUserModalOpen(true)}
            aria-label="切换用户"
            title="切换用户"
            style={{ cursor: "pointer", transition: "transform 0.16s, border-color 0.16s", outline: "none" }}
          >
            {activeUser.avatar ? (
              <span style={{ fontSize: "18px", lineHeight: 1 }}>{activeUser.avatar}</span>
            ) : (
              <UserRound size={18} />
            )}
          </button>
          <div>
            <strong>书房</strong>
            <span>shufang.local</span>
          </div>
          <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)} aria-label="关闭导航">
            <X size={20} />
          </button>
        </div>

        <nav className="nav-list">
          <NavButton icon={<Home size={19} />} active={view === "home"} onClick={() => navigateTo("home")} label="首页" />
          <NavButton icon={<Library size={19} />} active={view === "books"} onClick={() => navigateTo("books")} label="书架" />
          <NavButton icon={<Music2 size={19} />} active={view === "music"} onClick={() => navigateTo("music")} label="音乐" />
          <NavButton icon={<Radio size={19} />} active={view === "podcasts"} onClick={() => navigateTo("podcasts")} label="播客" />
          <NavButton icon={<Settings size={19} />} active={view === "settings"} onClick={() => navigateTo("settings")} label="资源" />
        </nav>

        <div className="sidebar-footer">
          <button className="user-chip" onClick={() => setIsUserModalOpen(true)}>
            <span>{activeUser.avatar}</span>
            <div>
              <strong>{activeUser.name}</strong>
              <small>切换/管理用户</small>
            </div>
          </button>
        </div>
      </aside>

      <main className="main-panel" ref={mainPanelRef}>
        <AnimatePresence mode="wait">
          <motion.section
            key={view}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="view-stage"
          >
            {view === "home" && (
              <HomeView
                books={books}
                tracks={recentMusic.length > 0 ? recentMusic : music}
                openBook={openBook}
                playTrack={playTrack}
                readingActivity={readingActivity}
                goBooks={() => navigateTo("books")}
                goMusic={() => navigateTo("music")}
                goSettings={() => navigateTo("settings")}
                onCoverExtracted={updateBookCover}
                onClearProgress={clearBookProgress}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
              />
            )}
            {view === "books" && (
              <BooksView
                books={books}
                openBook={openBook}
                goSettings={() => navigateTo("settings")}
                onCoverExtracted={updateBookCover}
                onClearProgress={clearBookProgress}
              />
            )}
            {view === "music" && (
              <AudioView
                kind="music"
                tracks={music}
                playTrack={playTrack}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onTogglePlay={() => {
                  if (currentTrack) {
                    setIsPlaying(!isPlaying);
                  } else if (music.length > 0) {
                    playTrack(music[0]);
                  }
                }}
              />
            )}
            {view === "podcasts" && (
              <PodcastsView
                books={books}
                playTrack={playTrack}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
              />
            )}
            {view === "settings" && (
              <SettingsView
                roots={roots}
                runScan={runScan}
                isScanning={isScanning}
                message={message}
                refresh={refreshAll}
              />
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      <audio
        ref={audioRef}
        src={
          currentTrack 
            ? currentTrack.filePath?.startsWith("http") 
              ? currentTrack.filePath 
              : `${API_BASE}/api/audio/${currentTrack.id}/stream` 
            : undefined
        }
        loop={playMode === "repeat-one"}
        preload="metadata"
        onPlay={() => {
          setIsPlaying(true);
          sendWsMessage("PLAY", { isPlaying: true });
        }}
        onPause={() => {
          setIsPlaying(false);
          sendWsMessage("PAUSE", { isPlaying: false });
        }}
        onLoadedMetadata={(event) => setAudioDuration(finiteDuration(event.currentTarget.duration) ?? currentTrack?.duration ?? 0)}
        onDurationChange={(event) => setAudioDuration(finiteDuration(event.currentTarget.duration) ?? currentTrack?.duration ?? 0)}
        onTimeUpdate={(event) => {
          const currentTime = event.currentTarget.currentTime;
          setAudioPosition(currentTime);

          // Throttle progress updates: send every 2 seconds during playback
          const now = Date.now();
          if (isPlaying && now - lastSentTimeRef.current > 2000) {
            if (Math.abs(currentTime - lastSentPositionRef.current) > 1) {
              sendWsMessage("PLAY", { position: currentTime, isPlaying: true });
              lastSentPositionRef.current = currentTime;
              lastSentTimeRef.current = now;
              if (currentTrack) {
                void saveAudioProgress(currentTrack, currentTime);
              }
            }
          }
        }}
        onEnded={playNextTrack}
      />
      <GlobalPlayer
        track={currentTrack}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playMode={playMode}
        setPlayMode={(mode) => {
          setPlayMode(mode);
          sendWsMessage("PLAY_MODE_CHANGE", { playMode: mode });
        }}
        position={audioPosition}
        duration={audioDuration || currentTrack?.duration || 0}
        seek={seekAudio}
        activeLyric={currentLyricText}
        isSyncEnabled={isSyncEnabled}
        setIsSyncEnabled={handleToggleSync}
        hasLyrics={lyrics.length > 0}
      />
      <AnimatePresence>
        {isReaderOpen && activeBook && (
          <ReaderView
            book={activeBook}
            user={activeUser}
            theme={theme}
            setTheme={setTheme}
            onBack={async () => {
              setIsReaderOpen(false);
              await refreshReadingActivity(activeUserId);
            }}
            onProgressSaved={updateBookProgress}
            onReadingTick={addReadingSeconds}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isUserModalOpen && (
          <UserModal
            users={users}
            activeUserId={activeUserId}
            onSelectUser={(userId) => {
              setActiveUserId(userId);
              setIsUserModalOpen(false);
            }}
            onClose={() => {
              if (activeUserId && users.some((u) => u.id === activeUserId)) {
                setIsUserModalOpen(false);
              }
            }}
            refreshUsers={async () => {
              const nextUsers = await api<User[]>("/api/users");
              setUsers(nextUsers);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton(props: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function HomeView({
  books,
  tracks,
  openBook,
  playTrack,
  readingActivity,
  goBooks,
  goMusic,
  goSettings,
  onCoverExtracted,
  onClearProgress,
  currentTrack,
  isPlaying
}: {
  books: BookItem[];
  tracks: AudioTrack[];
  openBook: (bookId: string) => void;
  playTrack: (track: AudioTrack, customQueue?: AudioTrack[]) => void;
  readingActivity: ReadingActivity[];
  goBooks: () => void;
  goMusic: () => void;
  goSettings: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
  onClearProgress?: (bookId: string) => void;
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
}) {
  const heroBook = books[0];
  const recentBooks = readingBooks(books).slice(0, 10);
  const todaySeconds = readingActivity.find((item) => item.day === calendarDateKey(new Date()))?.seconds ?? 0;

  if (!heroBook && tracks.length === 0) return <EmptyLibrary goSettings={goSettings} />;

  return (
    <div className="home-grid">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">阅读日历</p>
          <h2>今天已阅读 {formatReadingTime(todaySeconds)}</h2>
          <div className="reading-stats">
            <span>
              <Timer size={16} />
              {formatReadingTime(totalReadingSeconds(readingActivity, 7))} / 近 7 天
            </span>
            <span>
              <CalendarDays size={16} />
              {activeReadingDays(readingActivity)} 天有阅读
            </span>
          </div>
          <ReadingCalendar activity={readingActivity} />
        </div>
        <div className="hero-stack" aria-hidden="true">
          {books.slice(0, 4).map((book, index) => (
            <div
              className="floating-book"
              key={book.id}
              style={{
                backgroundImage: coverBackground(book.coverPath),
                transform: `translateX(${index * 22}px) translateY(${index * -12}px) rotate(${index * 3 - 5}deg)`
              }}
            >
              <span>{book.title}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rail-section">
        <SectionTitle icon={<Bookmark size={18} />} title="正在阅读" actionLabel="更多" onAction={goBooks} />
        <div className="book-row">
          {recentBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => openBook(book.id)}
              onCoverExtracted={onCoverExtracted}
              onClearProgress={onClearProgress ? () => onClearProgress(book.id) : undefined}
            />
          ))}
        </div>
      </section>

      <section className="audio-panel">
        <SectionTitle icon={<ListMusic size={18} />} title="正在收听" actionLabel="更多" onAction={goMusic} />
        <TrackList 
          tracks={tracks.slice(0, 20)} 
          playTrack={playTrack} 
          currentTrackId={currentTrack?.id}
          isPlaying={isPlaying}
        />
      </section>
    </div>
  );
}

function ReadingCalendar({ activity }: { activity: ReadingActivity[] }) {
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const [weekCount, setWeekCount] = useState(13);
  const activityByDay = new Map(activity.map((item) => [item.day, item.seconds]));
  const weeks = calendarWeeks(weekCount);
  const monthLabels = weeks.map((week, index) => {
    const firstDate = week.find((date) => date !== null);
    if (!firstDate) return "";

    if (index === 0) {
      return firstDate.toLocaleDateString(undefined, { month: "short" });
    }

    const prevWeek = weeks[index - 1];
    const prevDate = prevWeek ? prevWeek.find((date) => date !== null) : null;
    if (prevDate && firstDate.getMonth() !== prevDate.getMonth()) {
      return firstDate.toLocaleDateString(undefined, { month: "short" });
    }

    return "";
  });

  useEffect(() => {
    const calendar = calendarRef.current;
    if (!calendar) return;

    const updateColumns = () => {
      const styles = window.getComputedStyle(calendar);
      const cellSize = parseFloat(styles.getPropertyValue("--calendar-cell")) || 10;
      const gapSize = parseFloat(styles.getPropertyValue("--calendar-gap")) || 3;
      const labelWidth = parseFloat(styles.getPropertyValue("--calendar-label-width")) || 24;
      const availableWidth = calendar.clientWidth || calendar.parentElement?.clientWidth || 0;
      const maxColumns = Math.floor((availableWidth - labelWidth - 6 + gapSize) / (cellSize + gapSize));
      setWeekCount((current) => {
        const next = Math.max(13, maxColumns || 13);
        return next === current ? current : next;
      });
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(calendar);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="reading-calendar" ref={calendarRef}>
      <div className="calendar-grid" aria-label="阅读日历">
        <div className="calendar-months">
          {monthLabels.map((label, index) => (
            <div className="calendar-month" key={`${label}-${index}`}>
              {label}
            </div>
          ))}
        </div>
        <div className="calendar-weekdays">
          {["", "一", "", "三", "", "五", ""].map((label, index) => (
            <div className="calendar-weekday" key={index}>
              {label}
            </div>
          ))}
        </div>
        <div className="calendar-weeks">
          {weeks.map((week, weekIndex) => (
            <div className="calendar-col" key={weekIndex}>
              {week.map((date, dayIndex) => {
                if (!date) return <div className="calendar-cell empty" key={dayIndex} />;
                const day = calendarDateKey(date);
                const seconds = activityByDay.get(day) ?? 0;
                return (
                  <div
                    className="calendar-cell"
                    data-level={readingLevel(seconds)}
                    title={`${day} ${formatReadingTime(seconds)}`}
                    key={day}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BooksView({
  books,
  openBook,
  goSettings,
  onCoverExtracted,
  onClearProgress
}: {
  books: BookItem[];
  openBook: (bookId: string) => void;
  goSettings: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
  onClearProgress?: (bookId: string) => void;
}) {
  const [mode, setMode] = useState<"recent" | "added" | "bookmarked" | "unfinished">("recent");
  if (books.length === 0) return <EmptyLibrary goSettings={goSettings} />;
  const visibleBooks = sortBooksForMode(books, mode);

  return (
    <div className="library-layout">
      <div className="filter-row">
        <button className={`filter-chip ${mode === "recent" ? "active" : ""}`} onClick={() => setMode("recent")}>
          最近阅读
        </button>
        <button className={`filter-chip ${mode === "added" ? "active" : ""}`} onClick={() => setMode("added")}>
          最近加入
        </button>
        <button className={`filter-chip ${mode === "bookmarked" ? "active" : ""}`} onClick={() => setMode("bookmarked")}>
          有书签
        </button>
        <button className={`filter-chip ${mode === "unfinished" ? "active" : ""}`} onClick={() => setMode("unfinished")}>
          未读完
        </button>
      </div>
      <div className="book-grid">
        {visibleBooks.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onOpen={() => openBook(book.id)}
            onCoverExtracted={onCoverExtracted}
            onClearProgress={onClearProgress ? () => onClearProgress(book.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function ReaderView({
  book,
  user,
  theme,
  setTheme,
  onBack,
  onProgressSaved,
  onReadingTick
}: {
  book: BookItem;
  user: User;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onBack: () => void;
  onProgressSaved: (bookId: string, cfi: string, progress: number, chapterTitle: string) => void;
  onReadingTick: (seconds: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const renderedHighlightsRef = useRef(new Map<string, string>());
  const saveTimerRef = useRef<number | null>(null);
  const wheelLockRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const currentCfiRef = useRef(book.cfi ?? "");
  const locationsReadyRef = useRef(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [drawer, setDrawer] = useState<"toc" | "bookmarks" | "review" | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [progress, setProgress] = useState(Math.round(book.progress));
  const [chapterTitle, setChapterTitle] = useState(book.chapterTitle ?? "");
  const [note, setNote] = useState("");
  const [isReaderReady, setIsReaderReady] = useState(false);
  const [readerError, setReaderError] = useState("");
  const [fontSize, setFontSize] = useState(() => readReaderFontSize());
  const isPdf = book.format === "pdf";

  const [selectionMenu, setSelectionMenu] = useState<{
    cfiRange: string;
    text: string;
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    contents: any;
  } | null>(null);

  const [selectedHighlight, setSelectedHighlight] = useState<{
    bookmark: BookmarkItem;
    top: number;
    left: number;
  } | null>(null);

  const [footnotePopover, setFootnotePopover] = useState<{
    title: string;
    text: string;
    top: number;
    left: number;
    right?: number;
    bottom?: number;
  } | null>(null);

  const [userNotePopover, setUserNotePopover] = useState<{
    bookmark: BookmarkItem;
    top: number;
    left: number;
  } | null>(null);

  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewResults, setReviewResults] = useState<Array<{ chapterTitle: string; href: string; context: string }>>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const turnPage = (direction: "previous" | "next") => {
    void (direction === "next" ? renditionRef.current?.next() : renditionRef.current?.prev());
  };

  const handleHorizontalWheel = (event: WheelEvent) => {
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.15 && Math.abs(event.deltaX) > 36;
    if (!horizontal || wheelLockRef.current) return;
    event.preventDefault();
    wheelLockRef.current = true;
    turnPage(event.deltaX > 0 ? "next" : "previous");
    window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 460);
  };

  const startTouch = (clientX: number, clientY: number) => {
    touchStartRef.current = { x: clientX, y: clientY };
  };

  const endTouch = (clientX: number, clientY: number) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const deltaX = clientX - start.x;
    const deltaY = clientY - start.y;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    turnPage(deltaX < 0 ? "next" : "previous");
  };

  useEffect(() => {
    let disposed = false;
    setToc([]);
    setProgress(Math.round(book.progress));
    setChapterTitle(isPdf ? "PDF" : book.chapterTitle ?? "");
    setIsReaderReady(false);
    setReaderError("");
    setFootnotePopover(null);
    setUserNotePopover(null);
    currentCfiRef.current = book.cfi ?? "";
    locationsReadyRef.current = false;

    if (isPdf) {
      setIsReaderReady(true);
      currentCfiRef.current = "";
      renditionRef.current?.destroy();
      epubBookRef.current?.destroy();
      renditionRef.current = null;
      epubBookRef.current = null;
      renderedHighlightsRef.current.clear();
      return () => {
        disposed = true;
      };
    }

    const setup = async () => {
      try {
        await mountReader(`${API_BASE}/api/books/${book.id}/file`);
      } catch {
        try {
          const response = await fetch(`${API_BASE}/api/books/${book.id}/file`);
          if (!response.ok) throw new Error("book_fetch_failed");
          await mountReader(await response.arrayBuffer());
        } catch {
          if (!disposed) setReaderError("这本 EPUB 暂时无法在网页阅读器中打开，可以先下载原文件。");
        }
      }
    };

    const mountReader = async (source: string | ArrayBuffer) => {
      if (!hostRef.current || disposed) return;
      hostRef.current.innerHTML = "";
      const epubBook = ePub(source, { openAs: "epub", replacements: "blobUrl" });
      epubBookRef.current = epubBook;
      const rendition = epubBook.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        spread: readerSpreadForElement(hostRef.current),
        minSpreadWidth: 860,
        flow: "paginated",
        allowScriptedContent: true
      } as any);
      renditionRef.current = rendition;
      applyReaderTheme(rendition, theme, fontSize);
      rendition.hooks.content.register((contents: any) => {
        contents.document.addEventListener(
          "click",
          async (event: MouseEvent) => {
            const target = event.target as Element | null;
            const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!link || !isEpubFootnoteReference(link)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            const footnote = await readEpubFootnote(epubBook, contents.document, link.getAttribute("href") ?? "");
            if (!footnote) return;
            const linkRect = link.getBoundingClientRect();
            const iframeRect = contents.document.defaultView?.frameElement?.getBoundingClientRect();
            if (!iframeRect) return;

            setSelectionMenu(null);
            setSelectedHighlight(null);
            setUserNotePopover(null);
            setFootnotePopover({
              title: footnote.title,
              text: footnote.text,
              top: linkRect.top + iframeRect.top,
              left: linkRect.left + iframeRect.left,
              right: linkRect.right + iframeRect.left,
              bottom: linkRect.bottom + iframeRect.top
            });
          },
          true
        );
        contents.document.addEventListener("wheel", handleHorizontalWheel, { passive: false });
        contents.document.addEventListener("touchstart", (event: any) => {
          const touch = event.touches[0];
          if (touch) startTouch(touch.clientX, touch.clientY);
        });
        contents.document.addEventListener("touchend", (event: any) => {
          const touch = event.changedTouches[0];
          if (touch) endTouch(touch.clientX, touch.clientY);
        });

        // Direct selection check on mouseup
        contents.document.addEventListener("mouseup", (event: MouseEvent) => {
          const win = contents.document.defaultView;
          if (!win) return;
          const selection = win.getSelection();
          const text = selection?.toString().trim();
          if (selection && text && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const anchor = getRangeAnchor(range, event);
            const cfiRange = contents.cfiFromRange(range);

            setSelectionMenu({
              cfiRange,
              text,
              ...anchor,
              contents
            });
          }
        });

        // Direct selection check on touchend (mobile selection)
        contents.document.addEventListener("touchend", () => {
          setTimeout(() => {
            const win = contents.document.defaultView;
            if (!win) return;
            const selection = win.getSelection();
            const text = selection?.toString().trim();
            if (selection && text && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              const anchor = getRangeAnchor(range);
              const cfiRange = contents.cfiFromRange(range);

              setSelectionMenu({
                cfiRange,
                text,
                ...anchor,
                contents
              });
            }
          }, 150);
        });

        // Click on iframe document to dismiss popovers only if selection is empty
        contents.document.addEventListener("click", () => {
          const selection = contents.document.defaultView?.getSelection();
          if (!selection || !selection.toString().trim()) {
            setSelectionMenu(null);
            setSelectedHighlight(null);
            setFootnotePopover(null);
            setUserNotePopover(null);
          }
        });
      });

      await Promise.race([
        epubBook.opened,
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("reader_timeout")), 20000))
      ]);
      if (disposed) return;
      await repairEpubResourceReplacements(epubBook);
      const cacheKey = `shufang.locations.${book.id}`;
      const cachedLocations = window.localStorage.getItem(cacheKey);
      if (cachedLocations) {
        try {
          epubBook.locations.load(cachedLocations);
          locationsReadyRef.current = true;
        } catch {
          window.localStorage.removeItem(cacheKey);
        }
      }
      setToc(epubBook.navigation.toc);
      rendition.on("relocated", (location: Location) => {
        const cfi = location.start.cfi;
        currentCfiRef.current = cfi;
        const nextProgress = locationsReadyRef.current
          ? Math.round(epubBook.locations.percentageFromCfi(cfi) * 100)
          : progressFromLocation(location, progress);
        setProgress(nextProgress);
        const navItem = epubBook.navigation.get(location.start.href);
        const nextChapter = navItem?.label ?? "";
        setChapterTitle(nextChapter);
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          void saveProgress(book.id, user.id, cfi, nextProgress, nextChapter).then(() => {
            onProgressSaved(book.id, cfi, nextProgress, nextChapter);
          });
        }, 500);
      });
      await rendition.display(book.cfi ?? undefined);
      setIsReaderReady(true);
      await loadBookmarks(book.id, user.id, setBookmarks);
      if (!locationsReadyRef.current) {
        window.setTimeout(() => {
          if (disposed) return;
          void epubBook.locations.generate(800).then(() => {
            if (disposed) return;
            locationsReadyRef.current = true;
            window.localStorage.setItem(cacheKey, epubBook.locations.save());
            if (currentCfiRef.current) {
              setProgress(Math.round(epubBook.locations.percentageFromCfi(currentCfiRef.current) * 100));
            }
          });
        }, 600);
      }
    };

    void setup();

    return () => {
      disposed = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      renditionRef.current?.destroy();
      epubBookRef.current?.destroy();
      renditionRef.current = null;
      epubBookRef.current = null;
    };
  }, [book.id, user.id, isPdf]);

  useEffect(() => {
    if (renditionRef.current) applyReaderTheme(renditionRef.current, theme, fontSize);
    window.localStorage.setItem("shufang.readerFontSize", String(fontSize));
  }, [theme, fontSize]);

  // Load and apply highlights in rendition
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !isReaderReady || isPdf) return;

    const nextHighlights = new Map<string, BookmarkItem>();
    bookmarks.forEach((bookmark) => {
      if (bookmark.cfi?.includes(",") && !nextHighlights.has(bookmark.cfi)) {
        nextHighlights.set(bookmark.cfi, bookmark);
      }
    });

    renderedHighlightsRef.current.forEach((signature, cfi) => {
      const next = nextHighlights.get(cfi);
      if (!next || highlightSignature(next) !== signature) {
        try {
          rendition.annotations.remove(cfi, "highlight");
        } catch (error) {
          console.warn("Failed to remove highlight:", error);
        }
        renderedHighlightsRef.current.delete(cfi);
      }
    });

    nextHighlights.forEach((bm, cfi) => {
      const signature = highlightSignature(bm);
      if (!renderedHighlightsRef.current.has(cfi)) {
        try {
          rendition.annotations.add(
            "highlight",
            cfi,
            { id: bm.id },
            (e: MouseEvent) => {
              const workspaceRect = workspaceRef.current?.getBoundingClientRect();
              if (!workspaceRect) return;
              const anchor = getHighlightAnchor(rendition, cfi, e, workspaceRect);
              setSelectionMenu(null);
              setFootnotePopover(null);
              setSelectedHighlight(null);
              setUserNotePopover({
                bookmark: bm,
                ...anchor
              });
            },
            "epubjs-highlight",
            {
              fill: highlightFillColor(bm.color),
              "fill-opacity": "0.3",
              "mix-blend-mode": "multiply",
              "cursor": "pointer"
            }
          );
          renderedHighlightsRef.current.set(cfi, signature);
        } catch (err) {
          console.error("Failed to render highlight:", err);
        }
      }
    });
  }, [bookmarks, isReaderReady, isPdf]);

  // Handle global clicks on the parent page to close floating menus
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".selection-toolbar") && !target.closest(".highlight-popover") && !target.closest(".footnote-popover")) {
        setSelectionMenu(null);
        setSelectedHighlight(null);
        setFootnotePopover(null);
        setUserNotePopover(null);
      }
    };
    document.addEventListener("click", handleGlobalClick);
    return () => document.removeEventListener("click", handleGlobalClick);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rendition = renditionRef.current;
        if (!rendition || !(rendition as any).manager || !hostRef.current) return;
        const nextSpread = readerSpreadForElement(hostRef.current);
        rendition.spread(nextSpread, 860);
        rendition.resize(hostRef.current.clientWidth, hostRef.current.clientHeight);
      });
    });
    observer.observe(host);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [book.id]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const onWheel = (event: WheelEvent) => {
      handleHorizontalWheel(event);
    };

    workspace.addEventListener("wheel", onWheel, { passive: false });
    return () => workspace.removeEventListener("wheel", onWheel);
  }, [book.id]);

  useEffect(() => {
    if (!isReaderReady) return;
    let lastTick = Date.now();
    const timer = window.setInterval(() => {
      if (document.hidden) {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      const seconds = Math.max(0, Math.round((now - lastTick) / 1000));
      lastTick = now;
      if (seconds > 0) onReadingTick(Math.min(seconds, 90));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [book.id, isReaderReady, onReadingTick]);

  const addBookmark = async () => {
    if (!currentCfiRef.current || isPdf) return;
    await api<BookmarkItem>("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        bookId: book.id,
        cfi: currentCfiRef.current,
        title: chapterTitle || book.title,
        note: note.trim() || null,
        color: "#f1bd65"
      })
    });
    setNote("");
    await loadBookmarks(book.id, user.id, setBookmarks);
    setDrawer("bookmarks");
  };

  const handleReviewSearch = async () => {
    const q = reviewQuery.trim();
    if (!q) return;
    setReviewLoading(true);
    setReviewError("");
    setReviewResults([]);
    try {
      const currentCfi = currentCfiRef.current || "";
      const results = await api<Array<{ chapterTitle: string; href: string; context: string }>>(
        `/api/books/${book.id}/search-context?query=${encodeURIComponent(q)}&cfi=${encodeURIComponent(currentCfi)}`
      );
      setReviewResults(results);
    } catch (err) {
      setReviewError("回顾查询失败，请稍后重试。");
    } finally {
      setReviewLoading(false);
    }
  };

  const renderHighlightedContext = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, index) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={index} className="review-highlight">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="reader-shell">
      <div className="reader-command-bar">
        <button className="icon-button" onClick={onBack} aria-label="返回书架" title="返回书架">
          <Library size={18} />
        </button>
        <button className="icon-button" onClick={() => setDrawer(drawer === "toc" ? null : "toc")} aria-label="目录" title="目录">
          <List size={18} />
        </button>
        <div className="reader-status">
          <strong>{book.title}</strong>
          <span>{chapterTitle || `${progress}%`}</span>
        </div>
        {!isPdf && <button className="icon-button" onClick={addBookmark} aria-label="标记此处" title="标记此处">
          <Bookmark size={18} />
        </button>}
        {!isPdf && <button className="icon-button" onClick={() => setDrawer(drawer === "bookmarks" ? null : "bookmarks")} aria-label="书签" title="书签">
          <BookMarked size={18} />
        </button>}
        {!isPdf && <button className="icon-button" onClick={() => setDrawer(drawer === "review" ? null : "review")} aria-label="快速回顾" title="快速回顾">
          <Search size={18} />
        </button>}
        {!isPdf && (
          <div className="font-size-control" aria-label="字号">
            <button className="font-button" onClick={() => setFontSize((size) => Math.max(16, size - 1))} aria-label="减小字号">
              A-
            </button>
            <span>{fontSize}</span>
            <button className="font-button" onClick={() => setFontSize((size) => Math.min(30, size + 1))} aria-label="增大字号">
              A+
            </button>
          </div>
        )}
        <button className="icon-button" onClick={() => setTheme(theme === "night" ? "day" : "night")} aria-label="切换主题" title="切换主题">
          {theme === "night" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <a className="icon-button" href={`${API_BASE}/api/books/${book.id}/file`} download aria-label="下载" title="下载">
          <Download size={18} />
        </a>
        <button className="icon-button close-btn" onClick={onBack} aria-label="关闭" title="关闭" style={{ marginLeft: "auto" }}>
          <X size={18} />
        </button>
      </div>

      <div
        className="reader-workspace"
        ref={workspaceRef}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) startTouch(touch.clientX, touch.clientY);
        }}
        onTouchEnd={(event) => {
          const touch = event.changedTouches[0];
          if (touch) endTouch(touch.clientX, touch.clientY);
        }}
      >
        <AnimatePresence>
          {drawer === "toc" && (
            <ReaderDrawer title="目录" icon={<BookOpen size={18} />} onClose={() => setDrawer(null)}>
              {toc.map((item) => (
                <button
                  className="toc-item"
                  key={item.href}
                  onClick={() => {
                    void renditionRef.current?.display(item.href);
                    setDrawer(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </ReaderDrawer>
          )}
          {drawer === "bookmarks" && (
            <ReaderDrawer title="我的书签" icon={<Bookmark size={18} />} onClose={() => setDrawer(null)}>
              <div className="bookmark-editor">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注这一页" />
                <button className="primary-action compact" onClick={addBookmark}>
                  添加
                </button>
              </div>
              {bookmarks.map((item) => {
                const isHighlight = item.cfi && item.cfi.includes(",");
                return (
                  <button
                    className={`note-card ${isHighlight ? "highlight-card" : ""}`}
                    key={item.id}
                    onClick={() => {
                      void renditionRef.current?.display(item.cfi);
                      setDrawer(null);
                    }}
                  >
                    {isHighlight ? (
                      <>
                        <div className="highlight-indicator-bar" style={{ backgroundColor: item.color || "rgba(241, 189, 101, 0.38)" }} />
                        <blockquote className="card-highlight-text">
                          "{item.title}"
                        </blockquote>
                        {item.note && <span className="card-note-text">{item.note}</span>}
                      </>
                    ) : (
                      <>
                        <strong>{item.title ?? "书签"}</strong>
                        <span>{item.note ?? "无备注"}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </ReaderDrawer>
          )}
          {drawer === "review" && (
            <ReaderDrawer title="快速回顾" icon={<Search size={18} />} onClose={() => setDrawer(null)}>
              <div className="review-search-box">
                <div className="search-input-wrapper">
                  <input
                    value={reviewQuery}
                    onChange={(event) => setReviewQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleReviewSearch();
                      }
                    }}
                    placeholder="回忆一个角色/地名..."
                  />
                  <button className="search-btn" onClick={handleReviewSearch}>
                    <Search size={16} />
                  </button>
                </div>
              </div>
              
              {reviewLoading && <div className="review-status-msg">正在翻找看过的部分...</div>}
              {reviewError && <div className="review-status-msg error">{reviewError}</div>}
              
              {!reviewLoading && !reviewError && reviewResults.length === 0 && reviewQuery && (
                <div className="review-status-msg">在看过的部分没有找到该词。</div>
              )}

              <div className="review-results-list">
                {reviewResults.map((match, idx) => (
                  <div
                    key={idx}
                    className="review-result-card"
                    onClick={() => {
                      if (renditionRef.current) {
                        void renditionRef.current.display(match.href);
                        setDrawer(null);
                      }
                    }}
                  >
                    <div className="result-card-header">
                      <span className="chapter-badge">{match.chapterTitle}</span>
                    </div>
                    <p className="result-snippet">
                      {renderHighlightedContext(match.context, reviewQuery)}
                    </p>
                  </div>
                ))}
              </div>
            </ReaderDrawer>
          )}
        </AnimatePresence>

        <article className="reader-page real-reader">
          {!isReaderReady && !readerError && <div className="reader-loading">正在打开《{book.title}》</div>}
          {readerError && (
            <div className="reader-loading reader-error">
              <span>{readerError}</span>
              <a className="primary-action" href={`${API_BASE}/api/books/${book.id}/file`} download>
                下载 EPUB
              </a>
            </div>
          )}
          {isPdf ? (
            <PdfReader book={book} user={user} onProgressSaved={onProgressSaved} />
          ) : (
            <div ref={hostRef} className="epub-host" />
          )}
        </article>
        {!isPdf && <button className="reader-turn-button previous" onClick={() => turnPage("previous")} aria-label="上一页">
          <ChevronLeft size={28} />
        </button>}
        {!isPdf && <button className="reader-turn-button next" onClick={() => turnPage("next")} aria-label="下一页">
          <ChevronRight size={28} />
        </button>}
      </div>

      <div className="reader-bottom">
        <div className="progress-line">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Floating Selection Toolbar */}
      {selectionMenu && (
        <ReaderPopover
          anchor={selectionMenu}
          boundaryRef={workspaceRef}
          className="selection-toolbar"
          arrowClassName="selection-toolbar-arrow"
        >
          <div className="selection-toolbar-inner">
            <div className="color-selectors">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  className="color-dot"
                  style={{ backgroundColor: color }}
                  onClick={async () => {
                    await api("/api/bookmarks", {
                      method: "POST",
                      body: JSON.stringify({
                        userId: user.id,
                        bookId: book.id,
                        cfi: selectionMenu.cfiRange,
                        title: selectionMenu.text,
                        note: null,
                        color
                      })
                    });
                    selectionMenu.contents.window.getSelection().removeAllRanges();
                    setSelectionMenu(null);
                    await loadBookmarks(book.id, user.id, setBookmarks);
                  }}
                />
              ))}
            </div>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn"
              title="写备注"
              onClick={() => {
                const tempId = "temp-" + Date.now();
                setSelectedHighlight({
                  bookmark: {
                    id: tempId,
                    bookId: book.id,
                    cfi: selectionMenu.cfiRange,
                    title: selectionMenu.text,
                    note: "",
                    color: "rgba(241, 189, 101, 0.38)",
                    createdAt: new Date().toISOString()
                  },
                  top: (selectionMenu.top + selectionMenu.bottom) / 2,
                  left: (selectionMenu.left + selectionMenu.right) / 2
                });
                selectionMenu.contents.window.getSelection().removeAllRanges();
                setSelectionMenu(null);
              }}
            >
              <Edit3 size={14} />
              <span>备注</span>
            </button>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn"
              title="回顾"
              onClick={async () => {
                setReviewQuery(selectionMenu.text);
                setDrawer("review");
                setReviewLoading(true);
                setReviewError("");
                setReviewResults([]);
                try {
                  const currentCfi = currentCfiRef.current || "";
                  const results = await api<Array<{ chapterTitle: string; href: string; context: string }>>(
                    `/api/books/${book.id}/search-context?query=${encodeURIComponent(selectionMenu.text)}&cfi=${encodeURIComponent(currentCfi)}`
                  );
                  setReviewResults(results);
                } catch (err) {
                  setReviewError("回顾查询失败，请稍后重试。");
                } finally {
                  setReviewLoading(false);
                }
                selectionMenu.contents.window.getSelection().removeAllRanges();
                setSelectionMenu(null);
              }}
            >
              <Search size={14} />
              <span>回顾</span>
            </button>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn"
              title="复制"
              onClick={() => {
                navigator.clipboard.writeText(selectionMenu.text);
                selectionMenu.contents.window.getSelection().removeAllRanges();
                setSelectionMenu(null);
              }}
            >
              <Copy size={14} />
              <span>复制</span>
            </button>
            <div className="toolbar-separator" />
            <button
              className="toolbar-btn close-btn"
              title="取消"
              onClick={() => {
                selectionMenu.contents.window.getSelection().removeAllRanges();
                setSelectionMenu(null);
              }}
            >
              <X size={14} />
            </button>
          </div>
        </ReaderPopover>
      )}

      {/* Floating Highlight & Annotation Editor */}
      {selectedHighlight && (
        <ReaderPopover
          anchor={selectedHighlight}
          boundaryRef={workspaceRef}
          className="highlight-popover"
          arrowClassName="highlight-popover-arrow"
        >
          <div className="highlight-popover-inner">
            <div className="highlight-popover-header">
              <span className="quote-label">选中文本：</span>
              <button
                className="close-btn"
                onClick={() => setSelectedHighlight(null)}
              >
                <X size={14} />
              </button>
            </div>
            <blockquote className="highlight-quote">
              "{selectedHighlight.bookmark.title}"
            </blockquote>
            
            <div className="note-section">
              <label>备注感悟：</label>
              <textarea
                className="note-textarea"
                defaultValue={selectedHighlight.bookmark.note || ""}
                placeholder="在此处写下你的备注感悟..."
                onBlur={async (e) => {
                  const noteVal = e.target.value.trim();
                  const isTemp = selectedHighlight.bookmark.id.startsWith("temp-");
                  
                  if (isTemp) {
                    if (noteVal) {
                      await api("/api/bookmarks", {
                        method: "POST",
                        body: JSON.stringify({
                          userId: user.id,
                          bookId: book.id,
                          cfi: selectedHighlight.bookmark.cfi,
                          title: selectedHighlight.bookmark.title,
                          note: noteVal,
                          color: selectedHighlight.bookmark.color
                        })
                      });
                    }
                  } else {
                    await api(`/api/bookmarks/${selectedHighlight.bookmark.id}`, {
                      method: "PUT",
                      body: JSON.stringify({
                        note: noteVal || null
                      })
                    });
                  }
                  await loadBookmarks(book.id, user.id, setBookmarks);
                }}
              />
            </div>

            <div className="popover-footer">
              <div className="color-dots-row">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`color-dot ${selectedHighlight.bookmark.color === color ? "active" : ""}`}
                    style={{ backgroundColor: color }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={async () => {
                      const isTemp = selectedHighlight.bookmark.id.startsWith("temp-");
                      if (isTemp) {
                        setSelectedHighlight({
                          ...selectedHighlight,
                          bookmark: {
                            ...selectedHighlight.bookmark,
                            color
                          }
                        });
                      } else {
                        setSelectedHighlight({
                          ...selectedHighlight,
                          bookmark: {
                            ...selectedHighlight.bookmark,
                            color
                          }
                        });
                        await api(`/api/bookmarks/${selectedHighlight.bookmark.id}`, {
                          method: "PUT",
                          body: JSON.stringify({
                            color
                          })
                        });
                        await loadBookmarks(book.id, user.id, setBookmarks);
                      }
                    }}
                  />
                ))}
              </div>
              
              {!selectedHighlight.bookmark.id.startsWith("temp-") && (
                <button
                  className="delete-btn"
                  title="删除"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={async () => {
                    await api(`/api/bookmarks/${selectedHighlight.bookmark.id}`, {
                      method: "DELETE"
                    });
                    setSelectedHighlight(null);
                    await loadBookmarks(book.id, user.id, setBookmarks);
                  }}
                >
                  <Trash2 size={13} />
                  <span>删除</span>
                </button>
              )}
              
              {selectedHighlight.bookmark.id.startsWith("temp-") && (
                <button
                  className="save-btn"
                  onClick={() => setSelectedHighlight(null)}
                >
                  完成
                </button>
              )}
            </div>
          </div>
        </ReaderPopover>
      )}

      {userNotePopover && (
        <ReaderPopover anchor={userNotePopover} boundaryRef={workspaceRef} className="footnote-popover user-note-popover">
          <div className="footnote-popover-header">
            <strong>我的备注</strong>
            <button className="close-btn" onClick={() => setUserNotePopover(null)} aria-label="关闭备注">
              <X size={14} />
            </button>
          </div>
          <blockquote className="user-note-quote">{userNotePopover.bookmark.title}</blockquote>
          <p>{userNotePopover.bookmark.note || "暂无备注"}</p>
          <button
            className="user-note-edit"
            onClick={() => {
              setSelectedHighlight(userNotePopover);
              setUserNotePopover(null);
            }}
          >
            <Edit3 size={13} />
            编辑备注
          </button>
        </ReaderPopover>
      )}

      {footnotePopover && (
        <ReaderPopover anchor={footnotePopover} boundaryRef={workspaceRef} className="footnote-popover">
          <div className="footnote-popover-header">
            <strong>{footnotePopover.title}</strong>
            <button className="close-btn" onClick={() => setFootnotePopover(null)} aria-label="关闭注解">
              <X size={14} />
            </button>
          </div>
          <p>{footnotePopover.text}</p>
        </ReaderPopover>
      )}
    </div>
  );
}

function ReaderPopover({
  anchor,
  boundaryRef,
  className,
  arrowClassName = "footnote-popover-arrow",
  children
}: {
  anchor: { top: number; left: number; right?: number; bottom?: number };
  boundaryRef: React.RefObject<HTMLElement>;
  className: string;
  arrowClassName?: string;
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    arrowTop: number;
    placement: "above" | "below" | "left" | "right";
  } | null>(null);

  useEffect(() => {
    const updatePosition = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      const boundary = boundaryRef.current?.getBoundingClientRect() ?? {
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight
      };
      const width = popover.offsetWidth;
      const height = popover.offsetHeight;
      const safe = 12;
      const gap = 10;
      const anchorRight = anchor.right ?? anchor.left;
      const anchorBottom = anchor.bottom ?? anchor.top;
      const anchorCenterX = (anchor.left + anchorRight) / 2;
      const anchorCenterY = (anchor.top + anchorBottom) / 2;
      const spaces = {
        above: anchor.top - boundary.top - safe,
        below: boundary.bottom - anchorBottom - safe,
        left: anchor.left - boundary.left - safe,
        right: boundary.right - anchorRight - safe
      };
      const fits = {
        above: spaces.above >= height + gap,
        below: spaces.below >= height + gap,
        left: spaces.left >= width + gap,
        right: spaces.right >= width + gap
      };
      const boundaryWidth = boundary.right - boundary.left;
      const spreadMiddle = boundary.left + boundaryWidth / 2;
      const pageLeft = boundaryWidth >= 980 && anchorCenterX >= spreadMiddle ? spreadMiddle : boundary.left;
      const pageRight = boundaryWidth >= 980 && anchorCenterX < spreadMiddle ? spreadMiddle : boundary.right;
      const nearLeftEdge = anchorCenterX - pageLeft < width / 2 + safe;
      const nearRightEdge = pageRight - anchorCenterX < width / 2 + safe;
      let placement: "above" | "below" | "left" | "right";
      if (nearLeftEdge && fits.right) placement = "right";
      else if (nearRightEdge && fits.left) placement = "left";
      else if (fits.below) placement = "below";
      else if (fits.above) placement = "above";
      else if (fits.right) placement = "right";
      else if (fits.left) placement = "left";
      else {
        placement = (Object.entries(spaces) as Array<[typeof placement, number]>)
          .sort((a, b) => b[1] - a[1])[0][0];
      }
      const minLeft = boundary.left + safe;
      const maxLeft = Math.max(minLeft, boundary.right - safe - width);
      const desiredLeft = placement === "right"
        ? anchorRight + gap
        : placement === "left"
          ? anchor.left - gap - width
          : anchorCenterX - width / 2;
      const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
      const desiredTop = placement === "below"
        ? anchorBottom + gap
        : placement === "above"
          ? anchor.top - gap - height
          : anchorCenterY - height / 2;
      const maxTop = Math.max(boundary.top + safe, boundary.bottom - safe - height);
      const top = Math.min(Math.max(desiredTop, boundary.top + safe), maxTop);
      const arrowLeft = Math.min(Math.max(anchorCenterX - left, 18), width - 18);
      const arrowTop = Math.min(Math.max(anchorCenterY - top, 18), height - 18);
      setPosition({ top, left, arrowLeft, arrowTop, placement });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    const observer = new ResizeObserver(updatePosition);
    if (popoverRef.current) observer.observe(popoverRef.current);
    if (boundaryRef.current) observer.observe(boundaryRef.current);
    return () => {
      window.removeEventListener("resize", updatePosition);
      observer.disconnect();
    };
  }, [anchor.bottom, anchor.left, anchor.right, anchor.top, boundaryRef]);

  return (
    <div
      ref={popoverRef}
      className={`${className} reader-positioned-popover ${position?.placement ?? "below"}`}
      style={{
        position: "fixed",
        top: `${position?.top ?? anchor.top}px`,
        left: `${position?.left ?? anchor.left}px`,
        zIndex: 1000,
        visibility: position ? "visible" : "hidden",
        ["--popover-arrow-left" as string]: `${position?.arrowLeft ?? 24}px`,
        ["--popover-arrow-top" as string]: `${position?.arrowTop ?? 24}px`
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
      <div className={arrowClassName} />
    </div>
  );
}

function getHighlightAnchor(
  rendition: Rendition,
  cfi: string,
  event: MouseEvent,
  boundary: DOMRect
): { top: number; left: number } {
  const safe = 12;
  const clampToBoundary = (point: { top: number; left: number }) => ({
    top: Math.min(Math.max(point.top, boundary.top + safe), boundary.bottom - safe),
    left: Math.min(Math.max(point.left, boundary.left + safe), boundary.right - safe)
  });
  const isInBoundary = (point: { top: number; left: number }) =>
    point.left >= boundary.left &&
    point.left <= boundary.right &&
    point.top >= boundary.top &&
    point.top <= boundary.bottom;
  const pointFromFrame = (
    frame: Element | null | undefined,
    point: { top: number; left: number }
  ) => {
    if (!frame) return point;
    const frameRect = frame.getBoundingClientRect();
    return { top: point.top + frameRect.top, left: point.left + frameRect.left };
  };

  const target = event.currentTarget instanceof Element
    ? event.currentTarget
    : event.target instanceof Element
      ? event.target
      : null;
  const eventFrame = target?.ownerDocument.defaultView?.frameElement;
  const eventPoint = pointFromFrame(eventFrame, { top: event.clientY, left: event.clientX });
  if (isInBoundary(eventPoint)) return clampToBoundary(eventPoint);

  try {
    const range = rendition.getRange(cfi);
    const rangeFrame = range?.startContainer.ownerDocument?.defaultView?.frameElement;
    const visibleRects = Array.from(range?.getClientRects() ?? [])
      .map((rect) => {
        const topLeft = pointFromFrame(rangeFrame, { top: rect.top, left: rect.left });
        return {
          top: topLeft.top,
          left: topLeft.left,
          right: topLeft.left + rect.width,
          bottom: topLeft.top + rect.height
        };
      })
      .filter((rect) =>
        rect.right >= boundary.left &&
        rect.left <= boundary.right &&
        rect.bottom >= boundary.top &&
        rect.top <= boundary.bottom
      );
    const rect = visibleRects[0];
    if (rect) {
      return clampToBoundary({
        top: (rect.top + rect.bottom) / 2,
        left: (rect.left + rect.right) / 2
      });
    }
  } catch (error) {
    console.warn("Failed to locate highlight range:", error);
  }

  return {
    top: (boundary.top + boundary.bottom) / 2,
    left: (boundary.left + boundary.right) / 2
  };
}

function getRangeAnchor(range: Range, event?: MouseEvent) {
  const frameRect = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  const fallback = range.getBoundingClientRect();
  const rect = event && rects.length > 0
    ? rects.reduce((closest, candidate) => {
        const distance = Math.hypot(
          event.clientX - Math.min(Math.max(event.clientX, candidate.left), candidate.right),
          event.clientY - Math.min(Math.max(event.clientY, candidate.top), candidate.bottom)
        );
        const closestDistance = Math.hypot(
          event.clientX - Math.min(Math.max(event.clientX, closest.left), closest.right),
          event.clientY - Math.min(Math.max(event.clientY, closest.top), closest.bottom)
        );
        return distance < closestDistance ? candidate : closest;
      })
    : rects.at(-1) ?? fallback;
  const offsetLeft = frameRect?.left ?? 0;
  const offsetTop = frameRect?.top ?? 0;
  return {
    top: rect.top + offsetTop,
    left: rect.left + offsetLeft,
    right: rect.right + offsetLeft,
    bottom: rect.bottom + offsetTop,
    width: rect.width,
    height: rect.height
  };
}

function highlightSignature(bookmark: BookmarkItem) {
  return JSON.stringify([bookmark.id, bookmark.title, bookmark.note, bookmark.color]);
}

function highlightFillColor(color: string | null) {
  const value = color?.trim() || HIGHLIGHT_COLORS[0];
  const rgba = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgba ? `rgb(${rgba[1]}, ${rgba[2]}, ${rgba[3]})` : value;
}

function ReaderDrawer({
  title,
  icon,
  children,
  onClose
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <motion.aside
      className="reader-drawer"
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      transition={{ duration: 0.2 }}
    >
      <div className="reader-drawer-header">
        <SectionTitle icon={icon} title={title} />
        {onClose && (
          <button className="drawer-close-btn" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={16} />
          </button>
        )}
      </div>
      {children}
    </motion.aside>
  );
}

function PdfReader({
  book,
  user,
  onProgressSaved
}: {
  book: BookItem;
  user: User;
  onProgressSaved: (bookId: string, cfi: string, progress: number, chapterTitle: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [error, setError] = useState("");

  const src = `${API_BASE}/api/books/${book.id}/file`;
  const title = book.title;

  const lastSavedPageRef = useRef<number>(0);
  const activePageRef = useRef<number>(0);
  const pageCountRef = useRef<number>(0);
  const saveTimerRef = useRef<number | null>(null);
  const isScrollingToSavedRef = useRef<boolean>(false);

  useEffect(() => {
    let disposed = false;
    setPageCount(0);
    pageCountRef.current = 0;
    setError("");
    pdfRef.current = null;
    lastSavedPageRef.current = 0;
    activePageRef.current = 0;
    isScrollingToSavedRef.current = false;

    const loadingTask = pdfjsLib.getDocument(src);
    void loadingTask.promise
      .then((pdf) => {
        if (disposed) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        pageCountRef.current = pdf.numPages;
      })
      .catch(() => {
        if (!disposed) setError("这份 PDF 暂时无法渲染。");
      });

    return () => {
      disposed = true;
      loadingTask.destroy();
      void pdfRef.current?.destroy();
      pdfRef.current = null;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [src]);

  // Scroll to the last read page once the PDF is loaded
  useEffect(() => {
    if (pageCount > 0 && book.cfi && containerRef.current) {
      const match = book.cfi.match(/page-(\d+)/);
      if (match) {
        const savedPage = parseInt(match[1], 10);
        if (savedPage > 0 && savedPage <= pageCount) {
          isScrollingToSavedRef.current = true;
          activePageRef.current = savedPage;
          lastSavedPageRef.current = savedPage;

          if (savedPage > 1) {
            setTimeout(() => {
              const el = document.getElementById(`pdf-page-${savedPage}`);
              if (el) {
                el.scrollIntoView({ block: "start" });
              }
              setTimeout(() => {
                isScrollingToSavedRef.current = false;
              }, 300);
            }, 150);
          } else {
            isScrollingToSavedRef.current = false;
          }
        }
      }
    } else if (pageCount > 0) {
      activePageRef.current = 1;
      lastSavedPageRef.current = 1;
    }
  }, [pageCount, book.id]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Listen to scrolling to track and save current page progress
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pageCount === 0) return;

    const handleScroll = () => {
      if (isScrollingToSavedRef.current) return;

      const children = container.getElementsByClassName("pdf-page");
      let activePageNum = 1;
      let maxVisibleHeight = -1;
      const containerRect = container.getBoundingClientRect();

      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);

        if (visibleHeight > maxVisibleHeight) {
          maxVisibleHeight = visibleHeight;
          const pageIdMatch = el.id.match(/pdf-page-(\d+)/);
          if (pageIdMatch) {
            activePageNum = parseInt(pageIdMatch[1], 10);
          }
        }
      }

      if (maxVisibleHeight > 0 && activePageNum !== activePageRef.current) {
        activePageRef.current = activePageNum;
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          const pageToSave = activePageNum;
          const percentage = Math.round((pageToSave / pageCount) * 100);
          const chapter = `第 ${pageToSave} 页`;
          const cfi = `page-${pageToSave}`;
          void saveProgress(book.id, user.id, cfi, percentage, chapter).then(() => {
            lastSavedPageRef.current = pageToSave;
            onProgressSaved(book.id, cfi, percentage, chapter);
          });
        }, 1000);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [pageCount, book.id, user.id, onProgressSaved]);

  // Save progress on unmount if there is pending unsaved progress
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (
        activePageRef.current > 0 &&
        activePageRef.current !== lastSavedPageRef.current &&
        pageCountRef.current > 0
      ) {
        const pageToSave = activePageRef.current;
        const totalPages = pageCountRef.current;
        const percentage = Math.round((pageToSave / totalPages) * 100);
        const chapter = `第 ${pageToSave} 页`;
        const cfi = `page-${pageToSave}`;
        void saveProgress(book.id, user.id, cfi, percentage, chapter).then(() => {
          onProgressSaved(book.id, cfi, percentage, chapter);
        });
      }
    };
  }, [book.id, user.id, onProgressSaved]);

  if (error) {
    return (
      <div className="pdf-host pdf-message">
        <span>{error}</span>
        <a className="primary-action" href={src} download>
          下载 PDF
        </a>
      </div>
    );
  }

  return (
    <div className="pdf-host" ref={containerRef} aria-label={title}>
      {pageCount === 0 && <div className="pdf-message">正在打开《{title}》</div>}
      {Array.from({ length: pageCount }, (_, index) => (
        <PdfPageCanvas
          key={index + 1}
          pageNumber={index + 1}
          pdfDocument={pdfRef.current}
          containerRef={containerRef}
          layoutVersion={layoutVersion}
        />
      ))}
    </div>
  );
}

function PdfPageCanvas({
  pageNumber,
  pdfDocument,
  containerRef,
  layoutVersion
}: {
  pageNumber: number;
  pdfDocument: any;
  containerRef: React.RefObject<HTMLDivElement>;
  layoutVersion: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(pageNumber <= 2);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = containerRef.current;
    if (!canvas || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsVisible(true);
      },
      { root, rootMargin: "900px 0px" }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDocument || !isVisible) return;
    let disposed = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const render = async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (disposed) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max((containerRef.current?.clientWidth ?? window.innerWidth) - 48, 320);
      const scale = Math.min(availableWidth / baseViewport.width, 2.2);
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const task = page.render({ canvasContext: context, viewport });
      renderTask = task;
      await task.promise.catch((error: unknown) => {
        if (!disposed && !(error instanceof Error && error.name === "RenderingCancelledException")) {
          throw error;
        }
      });
    };

    void render();

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [containerRef, isVisible, layoutVersion, pageNumber, pdfDocument]);

  return (
    <div className="pdf-page" id={`pdf-page-${pageNumber}`} aria-label={`第 ${pageNumber} 页`}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function PodcastsView({
  books,
  playTrack,
  currentTrack,
  isPlaying,
  setIsPlaying
}: {
  books: BookItem[];
  playTrack: (track: AudioTrack, customQueue?: AudioTrack[]) => void;
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  setIsPlaying: (value: boolean) => void;
}) {
  const readingBooks = useMemo(() => {
    return books.filter((b) => b.progress > 0 && b.progress < 100);
  }, [books]);

  const recommendedByBooks = useMemo(() => {
    const seen = new Set<string>();
    const candidates = [
      ...[...books]
        .filter((book) => book.recentReadAt)
        .sort((a, b) => dateValue(b.recentReadAt) - dateValue(a.recentReadAt)),
      ...[...readingBooks].sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt)),
      ...[...books].sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt))
    ];

    return candidates.filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    }).slice(0, 3);
  }, [readingBooks, books]);

  const latestReadBook = recommendedByBooks[0] ?? null;

  const keywords = useMemo(() => {
    return recommendedByBooks
      .flatMap((b) => {
        const title = b.title.replace(/[:：(（].*$/, "").trim();
        return [title, b.author ? `${title} ${b.author}` : ""];
      })
      .filter(Boolean);
  }, [recommendedByBooks]);

  const [podcasts, setPodcasts] = useState<any[]>([]);
  const [popularPodcasts, setPopularPodcasts] = useState<any[]>([]);
  const [musicPodcasts, setMusicPodcasts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPodcast, setSelectedPodcast] = useState<any | null>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [expandedEpisodeIndex, setExpandedEpisodeIndex] = useState<number | null>(null);
  const [recommendationRefreshKey, setRecommendationRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      setError("");
      try {
        const [popular, musicChart] = await Promise.all([
          fetchPopular(),
          fetchPopularMusicPodcasts()
        ]);
        if (!active) return;

        setMusicPodcasts(musicChart.slice(0, 15));

        if (keywords.length === 0) {
          setPodcasts(popular.slice(0, 10));
          setPopularPodcasts(popular.slice(10));
        } else {
          const results = await Promise.all(
            keywords.map((kw) =>
              fetch(
                `https://itunes.apple.com/search?term=${encodeURIComponent(kw)}&media=podcast&limit=16&country=cn`
              )
                .then((res) => res.json())
                .then((data) => data.results || [])
                .catch(() => [])
            )
          );

          if (!active) return;

          const flat = results.flat();
          const seen = new Set();
          const unique = flat.filter((item) => {
            if (seen.has(item.collectionId)) return false;
            seen.add(item.collectionId);
            return true;
          }).map((item) => {
            const rawCover = item.artworkUrl600 || item.artworkUrl100 || "";
            const highResCover = rawCover.replace(/\/\d+x\d+/g, "/600x600");
            return {
              ...item,
              artworkUrl100: highResCover,
              artworkUrl600: highResCover
            };
          });

          if (unique.length === 0) {
            setPodcasts(popular.slice(0, 10));
            setPopularPodcasts(popular.slice(10));
          } else {
            const offset = recommendationRefreshKey % Math.max(unique.length - 9, 1);
            setPodcasts(unique.slice(offset, offset + 10));
            setPopularPodcasts(popular);
          }
        }
      } catch (err) {
        console.error(err);
        setError("加载播客内容失败");
      } finally {
        if (active) setLoading(false);
      }
    };

    const fetchPopular = async () => {
      try {
        const res = await fetch("https://itunes.apple.com/cn/rss/toppodcasts/limit=30/json");
        const data = await res.json();
        const entries = data.feed?.entry || [];
        return entries.map((entry: any) => {
          const rawCover = entry["im:image"][2]?.label || "";
          const highResCover = rawCover.replace(/\/\d+x\d+/g, "/600x600");
          return {
            collectionId: entry.id.attributes["im:id"],
            collectionName: entry["im:name"].label,
            artistName: entry["im:artist"].label,
            artworkUrl100: highResCover,
            artworkUrl600: highResCover,
            primaryGenreName: entry.category.attributes.label,
            isPopular: true
          };
        });
      } catch (err) {
        console.error("Fetch popular failed", err);
        return [];
      }
    };

    const fetchPopularMusicPodcasts = async () => {
      try {
        const res = await fetch("https://itunes.apple.com/cn/rss/toppodcasts/limit=30/genre=1310/json");
        const data = await res.json();
        const entries = data.feed?.entry || [];
        return entries.map((entry: any, index: number) => {
          const rawCover = entry["im:image"][2]?.label || "";
          const highResCover = rawCover.replace(/\/\d+x\d+/g, "/600x600");
          return {
            collectionId: entry.id.attributes["im:id"],
            collectionName: entry["im:name"].label,
            artistName: entry["im:artist"].label,
            artworkUrl100: highResCover,
            artworkUrl600: highResCover,
            primaryGenreName: "音乐播客",
            chartRank: index + 1,
            isMusicChart: true
          };
        });
      } catch (err) {
        console.error("Fetch music podcasts failed", err);
        return [];
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [keywords, recommendationRefreshKey]);

  useEffect(() => {
    if (!selectedPodcast) {
      setEpisodes([]);
      setExpandedEpisodeIndex(null);
      return;
    }
    let active = true;
    const loadEpisodes = async () => {
      setEpisodesLoading(true);
      try {
        const res = await fetch(
          `https://itunes.apple.com/lookup?id=${selectedPodcast.collectionId}&entity=podcastEpisode&limit=15`
        );
        const data = await res.json();
        const results = data.results || [];
        if (results.length > 1) {
          if (active) setEpisodes(results.slice(1));
        } else {
          if (active) setEpisodes([]);
        }
      } catch (err) {
        console.error("Load episodes failed", err);
      } finally {
        if (active) setEpisodesLoading(false);
      }
    };
    void loadEpisodes();
    return () => {
      active = false;
    };
  }, [selectedPodcast]);

  return (
    <div className="podcasts-layout">
      {selectedPodcast ? (
        <div className="podcast-detail-view animate-fade-in">
          <div className="podcast-detail-header">
            <button className="podcast-back-btn" onClick={() => setSelectedPodcast(null)}>
              <ChevronLeft size={16} />
              <span>返回播客书窗</span>
            </button>
          </div>

          <div className="podcast-detail-container">
            {/* Left Column: Rich Metadata Card */}
            <div className="podcast-detail-sidebar">
              <div 
                className="podcast-detail-cover"
                style={{ backgroundImage: coverBackground(selectedPodcast.artworkUrl600 || selectedPodcast.artworkUrl100) }}
              />
              <div className="podcast-detail-info">
                <span className="podcast-detail-genre">{selectedPodcast.primaryGenreName || "播客"}</span>
                <h2>{selectedPodcast.collectionName}</h2>
                <p className="podcast-detail-artist">{selectedPodcast.artistName}</p>
              </div>
              
              <div className="podcast-meta-list">
                <div className="podcast-meta-item">
                  <span className="meta-label">📅 首播日期</span>
                  <span className="meta-value">
                    {selectedPodcast.releaseDate ? new Date(selectedPodcast.releaseDate).toLocaleDateString() : "未知"}
                  </span>
                </div>
                <div className="podcast-meta-item">
                  <span className="meta-label">🎵 单集数量</span>
                  <span className="meta-value">{episodes.length || selectedPodcast.trackCount || 0} 集</span>
                </div>
                <div className="podcast-meta-item">
                  <span className="meta-label">🌍 发行地区</span>
                  <span className="meta-value">{selectedPodcast.country || "CN"}</span>
                </div>
                {selectedPodcast.feedUrl && (
                  <div className="podcast-meta-item feed-section">
                    <span className="meta-label">🔗 订阅源 (RSS Feed)</span>
                    <button 
                      className="copy-feed-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedPodcast.feedUrl);
                        alert("播客订阅源已成功复制到剪贴板！");
                      }}
                    >
                      复制 RSS 链接
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Rich Interactive Episode List */}
            <div className="podcast-detail-content">
              <h3>近期单集 ({episodes.length})</h3>
              {episodesLoading ? (
                <div className="episodes-loading">
                  <RefreshCw size={24} className="spin" />
                  <span>加载单集中...</span>
                </div>
              ) : episodes.length > 0 ? (
                <div className="episodes-list inline-list">
                  {episodes.map((ep, idx) => {
                    const isCurrentEp = currentTrack?.filePath === ep.episodeUrl;
                    const isExpanded = expandedEpisodeIndex === idx;
                    
                    return (
                      <div 
                        className={`episode-item rich-card ${isCurrentEp ? "active" : ""}`} 
                        key={ep.trackId || idx}
                      >
                        <div className="episode-item-header" onClick={() => setExpandedEpisodeIndex(isExpanded ? null : idx)}>
                          <div className="episode-title-block">
                            <h4>{ep.trackName}</h4>
                            <div className="episode-meta-row">
                              <span>🗓️ {ep.releaseDate ? new Date(ep.releaseDate).toLocaleDateString() : "未知"}</span>
                              <span>⏱️ {ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 60000) : 0} 分钟</span>
                              {isCurrentEp && isPlaying && (
                                <span className="playing-badge">
                                  <span className="wave-bar wave-1"></span>
                                  <span className="wave-bar wave-2"></span>
                                  <span className="wave-bar wave-3"></span>
                                  正在播放
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="episode-actions" onClick={(e) => e.stopPropagation()}>
                            <button 
                              className="text-action-btn"
                              onClick={() => setExpandedEpisodeIndex(isExpanded ? null : idx)}
                            >
                              {isExpanded ? "收起介绍" : "查看介绍"}
                            </button>
                            
                            <button 
                              className={`play-episode-btn ${isCurrentEp && isPlaying ? "playing" : ""}`}
                              onClick={() => {
                                if (isCurrentEp) {
                                  setIsPlaying(!isPlaying);
                                } else {
                                  const trackList: AudioTrack[] = episodes.map((item, index) => ({
                                    id: `podcast-ep-${item.trackId || item.collectionId}-${index}`,
                                    title: item.trackName,
                                    artist: selectedPodcast.artistName,
                                    album: selectedPodcast.collectionName,
                                    duration: item.trackTimeMillis ? item.trackTimeMillis / 1000 : 0,
                                    coverPath: item.artworkUrl600 || selectedPodcast.artworkUrl600 || selectedPodcast.artworkUrl100,
                                    kind: "podcast",
                                    filePath: item.episodeUrl
                                  }));
                                  const clickedTrack = trackList[idx] || {
                                    id: `podcast-ep-${ep.trackId || ep.collectionId}-${idx}`,
                                    title: ep.trackName,
                                    artist: selectedPodcast.artistName,
                                    album: selectedPodcast.collectionName,
                                    duration: ep.trackTimeMillis ? ep.trackTimeMillis / 1000 : 0,
                                    coverPath: ep.artworkUrl600 || selectedPodcast.artworkUrl600 || selectedPodcast.artworkUrl100,
                                    kind: "podcast",
                                    filePath: ep.episodeUrl
                                  };
                                  playTrack(clickedTrack, trackList);
                                }
                              }}
                            >
                              {isCurrentEp && isPlaying ? (
                                <Pause size={14} fill="currentColor" />
                              ) : (
                                <Play size={14} fill="currentColor" />
                              )}
                            </button>
                          </div>
                        </div>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div 
                              className="episode-description"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              style={{ overflow: "hidden" }}
                            >
                              <div 
                                style={{ padding: "12px 0 4px 0" }}
                                dangerouslySetInnerHTML={{ __html: ep.description || "暂无单集介绍" }}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="episodes-empty">暂无可用播放单集</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <section className="podcast-hero">
            <div className="podcast-hero-content">
              <button 
                className="podcast-badge podcast-ai-button"
                onClick={() => setRecommendationRefreshKey((key) => key + 1)}
                disabled={loading}
                type="button"
                title="根据最近阅读的书重新推荐播客"
              >
                <Sparkles size={13} />
                {loading ? "正在推荐" : "AI 智能推荐"}
                <RefreshCw size={12} className={loading ? "spin" : ""} />
              </button>
              <h1>播客书窗</h1>
              <p className="podcast-desc">将好书的声音带进耳朵。根据您的书架内容智能定制推荐。</p>
              
              <div className="podcast-sources">
                <span className="source-label">
                  {latestReadBook ? "优先根据最近阅读推荐：" : "推荐源自您正在看的书："}
                </span>
                <div className="source-chips">
                  {recommendedByBooks.length > 0 ? (
                    recommendedByBooks.map((b, index) => (
                      <span className={`source-chip ${index === 0 ? "latest" : ""}`} key={b.id}>
                        {index === 0 ? "最近" : "阅读"} · {b.title}
                      </span>
                    ))
                  ) : (
                    <span className="source-chip popular">当前最热门播客</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div className="podcast-section">
            <h2 className="podcast-section-title">智能推荐节目</h2>
            {loading ? (
              <div className="podcast-loading">
                <RefreshCw size={24} className="spin" />
                <span>正在搜寻与书籍相关的电台...</span>
              </div>
            ) : podcasts.length > 0 ? (
              <div className="podcast-recommendation-row">
                {podcasts.map((p) => (
                  <div className="podcast-card" key={p.collectionId} onClick={() => setSelectedPodcast(p)}>
                    <div 
                      className="podcast-card-cover"
                      style={{ backgroundImage: coverBackground(p.artworkUrl600 || p.artworkUrl100) }}
                    />
                    <div className="podcast-card-body">
                      <span className="podcast-card-genre">{p.primaryGenreName || "播客"}</span>
                      <h3 className="podcast-card-title" title={p.collectionName}>{p.collectionName}</h3>
                      <p className="podcast-card-artist" title={p.artistName}>{p.artistName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="podcast-empty">暂无推荐节目</div>
            )}
          </div>

          <div className="podcast-section">
            <h2 className="podcast-section-title">
              热门音乐播客
              <span className="podcast-badge-bgm">
                Apple Podcasts 音乐榜
              </span>
            </h2>
            {loading ? (
              <div className="podcast-loading">
                <RefreshCw size={24} className="spin" />
                <span>加载当前热门音乐播客中...</span>
              </div>
            ) : musicPodcasts.length > 0 ? (
              <div className="podcast-recommendation-row">
                {musicPodcasts.map((p) => (
                  <div className="podcast-card bgm-card" key={p.collectionId} onClick={() => setSelectedPodcast(p)}>
                    <div 
                      className="podcast-card-cover"
                      style={{ backgroundImage: coverBackground(p.artworkUrl600 || p.artworkUrl100) }}
                    />
                    <div className="podcast-card-body">
                      <span className="podcast-card-genre bgm-genre">
                        {p.chartRank ? `音乐榜 #${p.chartRank}` : (p.primaryGenreName || "音乐播客")}
                      </span>
                      <h3 className="podcast-card-title" title={p.collectionName}>{p.collectionName}</h3>
                      <p className="podcast-card-artist" title={p.artistName}>{p.artistName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="podcast-empty">暂无热门音乐播客</div>
            )}
          </div>

          <div className="podcast-section">
            <h2 className="podcast-section-title">热门电台排行榜</h2>
            {loading ? (
              <div className="podcast-loading">
                <RefreshCw size={24} className="spin" />
                <span>加载热门电台中...</span>
              </div>
            ) : popularPodcasts.length > 0 ? (
              <div className="podcast-grid">
                {popularPodcasts.map((p) => (
                  <div className="podcast-card" key={p.collectionId} onClick={() => setSelectedPodcast(p)}>
                    <div 
                      className="podcast-card-cover"
                      style={{ backgroundImage: coverBackground(p.artworkUrl600 || p.artworkUrl100) }}
                    />
                    <div className="podcast-card-body">
                      <span className="podcast-card-genre">{p.primaryGenreName || "播客"}</span>
                      <h3 className="podcast-card-title" title={p.collectionName}>{p.collectionName}</h3>
                      <p className="podcast-card-artist" title={p.artistName}>{p.artistName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="podcast-empty">暂无热门电台</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


function AudioView({
  kind,
  tracks,
  playTrack,
  currentTrack,
  isPlaying,
  onTogglePlay
}: {
  kind: "music" | "podcasts";
  tracks: AudioTrack[];
  playTrack: (track: AudioTrack, customQueue?: AudioTrack[]) => void;
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const coverUrl = currentTrack?.coverPath ? coverBackground(currentTrack.coverPath) : undefined;

  return (
    <div className="audio-library-v2">
      {/* Left Premium Card */}
      <div className="premium-player-card">
        <div className="vinyl-wrapper">
          <div className="vinyl-glow" style={{ backgroundImage: coverUrl || "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)" }} />
          <div 
            className={`vinyl-disc ${isPlaying && currentTrack ? "spinning" : ""}`}
            onClick={onTogglePlay}
            style={{ cursor: "pointer" }}
            title={isPlaying && currentTrack ? "点击暂停" : "点击播放"}
          >
            <div className="vinyl-grooves" />
            <div className="vinyl-label" style={{ backgroundImage: coverUrl || "linear-gradient(135deg, #222, #444)" }}>
              {!coverUrl && currentTrack?.title && (
                <span className="vinyl-fallback-text" style={{
                  fontSize: "36px",
                  fontWeight: "bold",
                  color: "#e0e0e0",
                  textShadow: "0 2px 4px rgba(0,0,0,0.5)",
                  zIndex: 2,
                  pointerEvents: "none"
                }}>
                  {currentTrack.title.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="vinyl-center-dot" />
          </div>
          <div className={`vinyl-tonearm ${isPlaying && currentTrack ? "playing" : ""}`}>
            <div className="tonearm-base" />
            <div className="tonearm-arm" />
            <div className="tonearm-head" />
          </div>
        </div>

        <div className="premium-player-info">
          <h3>{currentTrack?.title ?? "选择曲目"}</h3>
          <p>{currentTrack ? [currentTrack.artist, currentTrack.album].filter(Boolean).join(" · ") : "点按右侧列表开启沉浸收听"}</p>
          <div className={`visualizer-wave ${isPlaying && currentTrack ? "active" : ""}`}>
            <span className="bar bar-1"></span>
            <span className="bar bar-2"></span>
            <span className="bar bar-3"></span>
            <span className="bar bar-4"></span>
            <span className="bar bar-5"></span>
            <span className="bar bar-6"></span>
            <span className="bar bar-7"></span>
            <span className="bar bar-8"></span>
            <span className="bar bar-9"></span>
            <span className="bar bar-10"></span>
            <span className="bar bar-11"></span>
            <span className="bar bar-12"></span>
          </div>
        </div>
      </div>

      {/* Right Tracks Panel */}
      <div className="tracks-panel">
        <div className="tracks-header">
          <p className="eyebrow">{kind === "music" ? "本地高清音乐" : "播客与有声内容"}</p>
          <h2>{kind === "music" ? "音乐馆" : "有声电台"}</h2>
        </div>
        <div className="tracks-list-container">
          <TrackList
            tracks={tracks}
            playTrack={playTrack}
            currentTrackId={currentTrack?.id}
            isPlaying={isPlaying}
            large
          />
        </div>
      </div>
    </div>
  );
}

function TrackList({
  tracks,
  playTrack,
  currentTrackId,
  isPlaying = false,
  large = false
}: {
  tracks: AudioTrack[];
  playTrack: (track: AudioTrack, customQueue?: AudioTrack[]) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
  large?: boolean;
}) {
  if (tracks.length === 0) {
    return <p className="muted-copy">还没有音频。到“资源”里添加目录并扫描。</p>;
  }

  return (
    <div className={`list-stack ${large ? "wide" : ""}`}>
      {tracks.map((item) => {
        const isCurrent = item.id === currentTrackId;
        return (
          <button
            className={`list-item ${large ? "large" : ""} ${isCurrent ? "active-track" : ""}`}
            key={item.id}
            onClick={() => playTrack(item)}
          >
            <span 
              className="album-dot cover-dot" 
              style={{ 
                backgroundImage: item.coverPath ? coverBackground(item.coverPath) : "linear-gradient(135deg, var(--accent), var(--green))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: "bold",
                fontSize: "16px",
                userSelect: "none",
                position: "relative"
              }}
            >
              {!item.coverPath && (!isCurrent || !isPlaying) && (
                <span className="cover-fallback-char">
                  {item.title.charAt(0).toUpperCase()}
                </span>
              )}
              {isCurrent && isPlaying && (
                <div 
                  className="playing-cover-overlay" 
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0, 0, 0, 0.48)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "inherit"
                  }}
                >
                  <span className="playing-indicator-gif" style={{ margin: 0 }}>
                    <span className="playing-bar playing-bar-1" style={{ backgroundColor: "#fff" }}></span>
                    <span className="playing-bar playing-bar-2" style={{ backgroundColor: "#fff" }}></span>
                    <span className="playing-bar playing-bar-3" style={{ backgroundColor: "#fff" }}></span>
                  </span>
                </div>
              )}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{[item.artist, item.album].filter(Boolean).join(" · ") || item.kind}</small>
            </span>
            <em>{formatDuration(item.duration)}</em>
          </button>
        );
      })}
    </div>
  );
}

function SettingsView({
  roots,
  runScan,
  isScanning,
  message,
  refresh
}: {
  roots: ScanRoot[];
  runScan: () => void;
  isScanning: boolean;
  message: string;
  refresh: () => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState("");

  const addRoot = async () => {
    setError("");
    try {
      await api("/api/roots", { method: "POST", body: JSON.stringify({ path }) });
      setPath("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const removeRoot = async (rootId: string) => {
    await api(`/api/roots/${rootId}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="settings-layout">
      <section className="settings-panel">
        <SectionTitle icon={<Folder size={18} />} title="本地资源路径" />
        <p className="muted-copy">添加包含 EPUB、音乐或播客的本地目录。之后测试和开发都会使用真实资源。</p>
        <div className="path-row">
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Volumes/Media/Books" />
          <button className="primary-action" onClick={addRoot}>
            添加
          </button>
        </div>
        {error && <p className="error-copy">{error}</p>}
        <div className="root-list">
          {roots.map((root) => (
            <div className="root-item" key={root.id}>
              <div>
                <span>{root.path}</span>
                <small>{root.lastScannedAt ? `上次扫描 ${root.lastScannedAt}` : "尚未扫描"}</small>
              </div>
              <button className="icon-button compact-icon" onClick={() => removeRoot(root.id)} aria-label={`删除 ${root.path}`}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-panel">
        <SectionTitle icon={<RefreshCw size={18} />} title="扫描" />
        <p className="muted-copy">扫描会读取本地资源路径中的 EPUB 元数据、内置封面、音频标签和内嵌专辑图。</p>
        <button className="primary-action" onClick={runScan} disabled={isScanning}>
          {isScanning ? "扫描中" : "开始扫描"}
        </button>
        {message && <p className="muted-copy">{message}</p>}
      </section>
    </div>
  );
}

function EmptyLibrary({ goSettings }: { goSettings: () => void }) {
  return (
    <section className="empty-panel">
      <Folder size={42} />
      <h2>先添加资源路径</h2>
      <p>书房会扫描目录里的 EPUB、音乐和播客文件，后续阅读和播放都基于真实资源。</p>
      <button className="primary-action" onClick={goSettings}>
        设置资源
      </button>
    </section>
  );
}

function PdfCover({
  bookId,
  title,
  onCoverExtracted
}: {
  bookId: string;
  title: string;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let disposed = false;
    let loadingTask: any = null;
    let pdfDoc: any = null;

    const renderCover = async () => {
      try {
        const src = `${API_BASE}/api/books/${bookId}/file`;
        loadingTask = pdfjsLib.getDocument(src);
        pdfDoc = await loadingTask.promise;
        if (disposed) return;

        const page = await pdfDoc.getPage(1);
        if (disposed) return;

        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        context.clearRect(0, 0, viewport.width, viewport.height);

        await page.render({ canvasContext: context, viewport }).promise;
        if (disposed) return;

        setRendered(true);

        const coverDataUrl = canvas.toDataURL("image/png");
        const result = await api<{ ok: boolean; coverPath: string }>(`/api/books/${bookId}/cover`, {
          method: "PUT",
          body: JSON.stringify({ cover: coverDataUrl })
        });
        if (disposed) return;

        if (result && result.coverPath && onCoverExtracted) {
          onCoverExtracted(bookId, result.coverPath);
        }
      } catch (err) {
        console.error("Failed to render PDF cover on-the-fly:", err);
      }
    };

    void renderCover();

    return () => {
      disposed = true;
      if (loadingTask) {
        try {
          loadingTask.destroy();
        } catch {
          // ignore
        }
      }
      if (pdfDoc) {
        try {
          void pdfDoc.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, [bookId]);

  return (
    <span className="pdf-cover-canvas-container" style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%", display: "block" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "cover", display: rendered ? "block" : "none" }} />
      {!rendered && <span style={{ padding: "0 8px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.5)", fontWeight: "bold" }}>{title}</span>}
    </span>
  );
}

function BookCard({
  book,
  onOpen,
  onCoverExtracted,
  onClearProgress
}: {
  book: BookItem;
  onOpen: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
  onClearProgress?: () => void;
}) {
  const isPdf = book.format === "pdf";
  const hasCover = !!book.coverPath;

  return (
    <div className="book-card" onClick={onOpen}>
      <span className="book-cover" style={{ backgroundImage: hasCover ? coverBackground(book.coverPath) : undefined }}>
        <span className={`format-ribbon ${book.format}`}>{book.format.toUpperCase()}</span>
        {hasCover ? (
          ""
        ) : isPdf ? (
          <PdfCover bookId={book.id} title={book.title} onCoverExtracted={onCoverExtracted} />
        ) : (
          <span>{book.title}</span>
        )}
        {onClearProgress && (book.progress > 0 || !!book.cfi || !!book.recentReadAt) && (
          <button
            className="book-delete-progress-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClearProgress();
            }}
            title="从阅读记录中删除"
            aria-label="从阅读记录中删除"
          >
            <X size={12} />
          </button>
        )}
      </span>
      <strong>{book.title}</strong>
      <small>{book.author ?? "未知作者"}</small>
      <span className="mini-progress">
        <i style={{ width: `${Math.round(book.progress)}%` }} />
      </span>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  actionLabel,
  onAction
}: {
  icon: React.ReactNode;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <span className="section-title-main">
        {icon}
        <h2>{title}</h2>
      </span>
      {actionLabel && onAction && (
        <button className="section-more" onClick={onAction}>
          {actionLabel}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

function GlobalPlayer({
  track,
  isPlaying,
  setIsPlaying,
  playMode,
  setPlayMode,
  position,
  duration,
  seek,
  activeLyric,
  isSyncEnabled,
  setIsSyncEnabled,
  hasLyrics
}: {
  track: AudioTrack | null;
  isPlaying: boolean;
  setIsPlaying: (value: boolean) => void;
  playMode: PlayMode;
  setPlayMode: (value: PlayMode) => void;
  position: number;
  duration: number;
  seek: (position: number) => void;
  activeLyric: string;
  isSyncEnabled: boolean;
  setIsSyncEnabled: (value: boolean) => void;
  hasLyrics: boolean;
}) {
  const nextMode = playMode === "repeat-all" ? "repeat-one" : playMode === "repeat-one" ? "shuffle" : "repeat-all";
  const playableDuration = finiteDuration(duration) ?? 0;
  const playablePosition = Number.isFinite(position) ? position : 0;
  const hasCover = !!track?.coverPath;

  return (
    <footer className={`global-player ${hasLyrics ? "with-lyrics" : "no-lyrics"}`}>
      <div 
        className="now-playing-art" 
        onClick={() => track && setIsPlaying(!isPlaying)}
        style={{ 
          backgroundImage: hasCover ? coverBackground(track.coverPath) : "linear-gradient(135deg, var(--accent), var(--green))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "18px",
          fontWeight: "bold",
          userSelect: "none",
          position: "relative",
          cursor: track ? "pointer" : "default"
        }}
      >
        {track && (
          <div className="now-playing-art-overlay">
            <span className="art-play-icon-wrapper">
              {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
            </span>
          </div>
        )}
        {!hasCover && track?.title && (
          <span className="cover-fallback-char">
            {track.title.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="player-middle">
        {hasLyrics && (
          <div className="lyric-line">
            {track ? activeLyric || "暂无本地歌词" : " "}
          </div>
        )}

        <div className="player-metadata-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1px", gap: "12px" }}>
          {track ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
              <strong style={{ fontSize: "14px", fontWeight: "700", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</strong>
              <span className="player-metadata-artist" style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                { [track.artist, track.album].filter(Boolean).join(" · ") }
              </span>
            </div>
          ) : (
            <span style={{ fontSize: "14px", color: "var(--muted)" }}>还没有播放内容</span>
          )}

          {track && (
            <button
              className={`player-sync-indicator clickable-sync ${isSyncEnabled ? "synced" : "unsynced"}`}
              onClick={() => setIsSyncEnabled(!isSyncEnabled)}
              title={isSyncEnabled ? "已启用播放同步，点击退出同步" : "已暂停播放同步，点击开启同步"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 8px",
                borderRadius: "999px",
                border: "1px solid",
                borderColor: isSyncEnabled ? "rgba(15, 159, 110, 0.15)" : "rgba(255, 69, 58, 0.15)",
                background: isSyncEnabled ? "rgba(15, 159, 110, 0.08)" : "rgba(255, 69, 58, 0.08)",
                color: isSyncEnabled ? "var(--green)" : "var(--red, #ff453a)",
                fontSize: "10px",
                fontWeight: "700",
                cursor: "pointer",
                transition: "all 0.2s ease",
                flexShrink: 0
              }}
            >
              <span className={`sync-dot ${isSyncEnabled ? "" : "dot-red"}`} style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: isSyncEnabled ? "var(--green)" : "var(--red, #ff453a)",
                boxShadow: isSyncEnabled ? "0 0 6px var(--green)" : "0 0 6px var(--red, #ff453a)",
                display: "inline-block"
              }} />
              <span>{isSyncEnabled ? "已同步" : "未同步"}</span>
            </button>
          )}
        </div>

        <div className="player-seek-row">
          <input
            className="player-seek"
            type="range"
            min="0"
            max={playableDuration}
            step="0.1"
            value={playableDuration ? Math.min(playablePosition, playableDuration) : 0}
            disabled={!track || !playableDuration}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <div className="player-time-row">
            <span>{formatDuration(position)}</span>
            <span>{formatDuration(playableDuration)}</span>
          </div>
        </div>
      </div>

      <button className="icon-button" onClick={() => setPlayMode(nextMode)} aria-label="切换循环模式" title={playModeLabel(playMode)}>
        {playMode === "shuffle" ? <Shuffle size={18} /> : playMode === "repeat-one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
      </button>
    </footer>
  );
}

function nextUserId(current: string, users: User[]) {
  if (users.length === 0) return current;
  const index = users.findIndex((user) => user.id === current);
  return users[(index + 1) % users.length].id;
}

function restartCurrentTrack(audio: HTMLAudioElement | null, setIsPlaying: (value: boolean) => void) {
  if (!audio) return;
  audio.currentTime = 0;
  void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
}

function finiteDuration(duration: number) {
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function readingBooks(books: BookItem[]) {
  const activeBooks = books.filter((book) => book.recentReadAt || book.progress > 0 || book.cfi);
  return (activeBooks.length > 0 ? activeBooks : books)
    .slice()
    .sort((a, b) => dateValue(b.recentReadAt ?? b.updatedAt) - dateValue(a.recentReadAt ?? a.updatedAt));
}

function sortBooksForMode(books: BookItem[], mode: "recent" | "added" | "bookmarked" | "unfinished") {
  const candidates =
    mode === "bookmarked"
      ? books.filter((book) => book.bookmarkCount > 0)
      : mode === "unfinished"
        ? books.filter((book) => Math.round(book.progress) < 100)
        : books;
  return candidates.slice().sort((a, b) => {
    if (mode === "added") return dateValue(b.createdAt) - dateValue(a.createdAt);
    if (mode === "bookmarked") {
      return b.bookmarkCount - a.bookmarkCount || dateValue(b.recentReadAt ?? b.updatedAt) - dateValue(a.recentReadAt ?? a.updatedAt);
    }
    return dateValue(b.recentReadAt ?? b.updatedAt) - dateValue(a.recentReadAt ?? a.updatedAt);
  });
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarWeeks(weekCount: number) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const currentWeekStart = new Date(end);
  currentWeekStart.setDate(end.getDate() - end.getDay());
  const start = new Date(currentWeekStart);
  start.setDate(currentWeekStart.getDate() - (weekCount - 1) * 7);

  return Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(start);
      date.setDate(start.getDate() + weekIndex * 7 + dayIndex);
      if (date > end) return null;
      return date;
    })
  );
}

function readingLevel(seconds: number) {
  if (seconds >= 3600) return 4;
  if (seconds >= 1800) return 3;
  if (seconds >= 600) return 2;
  if (seconds > 0) return 1;
  return 0;
}

function totalReadingSeconds(activity: ReadingActivity[], days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);
  return activity.reduce((total, item) => {
    const date = new Date(`${item.day}T00:00:00`);
    return date >= cutoff ? total + item.seconds : total;
  }, 0);
}

function activeReadingDays(activity: ReadingActivity[]) {
  return activity.filter((item) => item.seconds > 0).length;
}

function formatReadingTime(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (seconds <= 0) return "0 分钟";
  if (minutes < 1) return "1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

function coverBackground(path: string | null | undefined) {
  if (!path) return "linear-gradient(150deg, #384b4f, #c7a35c 58%, #f1dfb6)";
  return `linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.28)), url("${assetUrl(path)}")`;
}

function assetUrl(path: string) {
  return path.startsWith("http") ? path : `${API_BASE}${path}`;
}

function resolveApiBase() {
  const configured = import.meta.env.VITE_API_BASE as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return "http://localhost:4141";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4141`;
}

function resolveWsBase() {
  const apiBase = resolveApiBase();
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  try {
    const url = new URL(apiBase);
    return `${wsProtocol}//${url.host}`;
  } catch {
    const host = window.location.host || "localhost:4141";
    const wsHost = host.includes(":") ? host : `${host}:4141`;
    return `${wsProtocol}//${wsHost}`;
  }
}

function formatDuration(duration: number | null) {
  if (!duration || !Number.isFinite(duration)) return "0:00";
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function currentLyric(lines: LyricLine[], position: number) {
  if (lines.length === 0) return "";
  const timedLines = lines.filter((line) => line.time !== null) as Array<{ time: number; text: string }>;
  if (timedLines.length === 0) return lines[0]?.text ?? "";
  let active = timedLines[0]?.text ?? "";
  for (const line of timedLines) {
    if (line.time <= position + 0.2) active = line.text;
    else break;
  }
  return active;
}

function progressFromLocation(location: Location, fallback: number) {
  const percentage = location.start.percentage;
  if (Number.isFinite(percentage) && percentage > 0) {
    return Math.round(percentage * 100);
  }
  return fallback;
}

function readerSpreadForElement(element: HTMLElement | null) {
  const width = element?.clientWidth || window.innerWidth;
  const height = element?.clientHeight || window.innerHeight;
  return width >= 980 && width / Math.max(height, 1) >= 1.25 ? "always" : "none";
}

function readReaderFontSize() {
  const stored = Number(window.localStorage.getItem("shufang.readerFontSize"));
  if (Number.isFinite(stored)) return Math.min(Math.max(stored, 16), 30);
  return 22;
}

function playModeLabel(mode: PlayMode) {
  if (mode === "shuffle") return "随机播放";
  if (mode === "repeat-one") return "单曲循环";
  return "列表循环";
}

async function saveProgress(bookId: string, userId: string, cfi: string, percentage: number, chapterTitle: string) {
  await api(`/api/books/${bookId}/progress`, {
    method: "PUT",
    body: JSON.stringify({ userId, cfi, percentage, chapterTitle })
  });
}

async function loadBookmarks(bookId: string, userId: string, setBookmarks: (items: BookmarkItem[]) => void) {
  const items = await api<BookmarkItem[]>(`/api/bookmarks?userId=${encodeURIComponent(userId)}&bookId=${encodeURIComponent(bookId)}`);
  setBookmarks(items);
}

function isEpubFootnoteReference(link: HTMLAnchorElement) {
  const epubType = link.getAttribute("epub:type") ?? link.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "";
  const role = link.getAttribute("role") ?? "";
  return (
    epubType.split(/\s+/).includes("noteref") ||
    role === "doc-noteref" ||
    link.matches(".duokan-footnote, .noteref, .footnote-ref, .note-ref") ||
    Boolean(link.closest("sup"))
  );
}

function readFootnoteFromDocument(document: Document, href: string) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) return null;
  const rawId = href.slice(hashIndex + 1);
  if (!rawId) return null;

  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // Keep the original fragment when an EPUB contains malformed escaping.
  }

  const target = document.getElementById(id);
  if (!target) return null;
  const paragraphs = Array.from(target.querySelectorAll("p"))
    .map((paragraph) => paragraph.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
  const text = (paragraphs.length ? paragraphs.join("\n\n") : target.textContent?.replace(/\s+/g, " ").trim()) ?? "";
  if (!text) return null;
  return { title: "注解", text };
}

async function readEpubFootnote(book: EpubBook, document: Document, href: string) {
  const localFootnote = readFootnoteFromDocument(document, href);
  if (localFootnote || !href.includes("#") || href.startsWith("#")) return localFootnote;

  try {
    const base = document.querySelector("base")?.href || document.baseURI;
    const absolute = new URL(href, base).href;
    const relative = (book as any).path.relative(absolute).split("#")[0];
    const targetDocument = (await (book as any).load(relative)) as Document;
    return readFootnoteFromDocument(targetDocument, href);
  } catch {
    return null;
  }
}

async function repairEpubResourceReplacements(book: EpubBook) {
  const resources = (book as any).resources;
  if (!resources?.urls?.length || !resources.settings?.resolver) return;

  const replacements = await Promise.all(
    resources.urls.map(async (url: string) => {
      try {
        return await resources.createUrl(resources.settings.resolver(url));
      } catch {
        return null;
      }
    })
  );

  // epub.js 0.3.93 filters failed resources and shifts every later URL out of
  // alignment. Preserve null entries so one missing asset cannot replace others.
  resources.replacementUrls = replacements;
  await resources.replaceCss();
}

function applyReaderTheme(rendition: Rendition, theme: Theme, fontSize: number) {
  const semanticSelectors = {
    headings: "h1, h2, h3, h4, h5, h6",
    notes:
      "aside, [role='doc-footnote'], [role='doc-endnote'], [epub\\:type~='footnote'], [epub\\:type~='endnote'], [epub\\:type~='annotation'], .note, .notes, .annotation, .comment, .commentary, .footnote, .footnotes, .endnote, .endnotes, .remark, .remarks, .zhu, .zhushi, .duokan-footnote-content, .duokan-footnote-item",
    noteMarkers:
      "a[role='doc-noteref'], a[epub\\:type~='noteref'], sup, .noteref, .footnote-ref, .note-ref, .duokan-footnote",
    commentaryBlocks: ".zp, .criticism, .commentary-block, .review-note",
    inlineCommentary: ".pz, .marginnote, .sidenote, .annotation-inline, .commentary-inline",
    commentaryLabels: ".zp1, .commentary-label",
    verse: "[epub\\:type~='poem'], .poem, .poetry, .verse"
  };

  rendition.themes.register("shufang-day", {
    "html, body": {
      color: "#2f2923",
      background: "#fbf4e9",
      "font-family": "'Songti SC', STSong, SimSun, Georgia, serif",
      "line-height": "1.72",
      "font-size": `${fontSize}px`,
      "user-select": "text !important",
      "-webkit-user-select": "text !important"
    },
    body: {
      margin: "0 !important",
      padding: "0 4% !important"
    },
    "body *": {
      color: "inherit !important",
      "background-color": "transparent !important",
      "font-family": "inherit !important",
      "user-select": "text !important",
      "-webkit-user-select": "text !important"
    },
    "p, div": { "line-height": "1.72" },
    [semanticSelectors.headings]: {
      color: "#244c46 !important",
      "font-family": "'Songti SC', STSong, SimSun, Georgia, serif !important",
      "font-weight": "700",
      "line-height": "1.35"
    },
    "blockquote": {
      color: "#64584c !important",
      "background-color": "rgba(42, 130, 120, 0.07) !important",
      "border-left": "3px solid #86afa8",
      margin: "1.25em 0",
      padding: "0.7em 1em",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important",
      "line-height": "1.68"
    },
    "q, cite": {
      color: "#546f69 !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    [semanticSelectors.notes]: {
      color: "#765d31 !important",
      "background-color": "rgba(241, 189, 101, 0.13) !important",
      border: "1px solid rgba(185, 134, 57, 0.28)",
      "border-radius": "5px",
      margin: "1em 0",
      padding: "0.65em 0.85em",
      "font-family": "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif !important",
      "font-size": "0.86em",
      "line-height": "1.62"
    },
    [semanticSelectors.noteMarkers]: {
      color: "#a56328 !important",
      "font-family": "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif !important",
      "font-size": "0.78em",
      "font-weight": "700"
    },
    [semanticSelectors.commentaryBlocks]: {
      color: "#486b65 !important",
      "border-top": "1px solid rgba(72, 107, 101, 0.24)",
      "border-bottom": "1px solid rgba(72, 107, 101, 0.24)",
      margin: "1.5em 0",
      padding: "0.8em 0.35em",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    [semanticSelectors.inlineCommentary]: {
      color: "#9a5634 !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important",
      "font-size": "0.84em",
      "line-height": "1.55"
    },
    [semanticSelectors.commentaryLabels]: {
      color: "#fffaf0 !important",
      "background-color": "#55766f !important",
      "border-color": "#55766f !important",
      "border-radius": "2px",
      padding: "0 0.15em"
    },
    [semanticSelectors.verse]: {
      color: "#53645f !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    "pre, code, kbd, samp": {
      color: "#6c4e31 !important",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace !important"
    },
    img: { "max-width": "100% !important", "height": "auto !important" },
    a: { color: "#2a8278 !important" },
    hr: { border: "0", "border-top": "1px solid rgba(47, 41, 35, 0.2)" },
    "::selection": {
      background: "rgba(241, 189, 101, 0.4) !important"
    }
  });
  rendition.themes.register("shufang-night", {
    "html, body": {
      color: "#efe3d0",
      background: "#171615",
      "font-family": "'Songti SC', STSong, SimSun, Georgia, serif",
      "line-height": "1.72",
      "font-size": `${fontSize}px`,
      "user-select": "text !important",
      "-webkit-user-select": "text !important"
    },
    body: {
      margin: "0 !important",
      padding: "0 4% !important"
    },
    "body *": {
      color: "inherit !important",
      "background-color": "transparent !important",
      "font-family": "inherit !important",
      "user-select": "text !important",
      "-webkit-user-select": "text !important"
    },
    "p, div": { "line-height": "1.72" },
    [semanticSelectors.headings]: {
      color: "#b8ddd6 !important",
      "font-family": "'Songti SC', STSong, SimSun, Georgia, serif !important",
      "font-weight": "700",
      "line-height": "1.35"
    },
    "blockquote": {
      color: "#d3c5b3 !important",
      "background-color": "rgba(121, 217, 203, 0.08) !important",
      "border-left": "3px solid #567f78",
      margin: "1.25em 0",
      padding: "0.7em 1em",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important",
      "line-height": "1.68"
    },
    "q, cite": {
      color: "#a8cbc5 !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    [semanticSelectors.notes]: {
      color: "#e4c990 !important",
      "background-color": "rgba(241, 189, 101, 0.08) !important",
      border: "1px solid rgba(228, 201, 144, 0.2)",
      "border-radius": "5px",
      margin: "1em 0",
      padding: "0.65em 0.85em",
      "font-family": "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif !important",
      "font-size": "0.86em",
      "line-height": "1.62"
    },
    [semanticSelectors.noteMarkers]: {
      color: "#e5ad6b !important",
      "font-family": "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif !important",
      "font-size": "0.78em",
      "font-weight": "700"
    },
    [semanticSelectors.commentaryBlocks]: {
      color: "#a8cbc5 !important",
      "border-top": "1px solid rgba(168, 203, 197, 0.2)",
      "border-bottom": "1px solid rgba(168, 203, 197, 0.2)",
      margin: "1.5em 0",
      padding: "0.8em 0.35em",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    [semanticSelectors.inlineCommentary]: {
      color: "#e4a37d !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important",
      "font-size": "0.84em",
      "line-height": "1.55"
    },
    [semanticSelectors.commentaryLabels]: {
      color: "#fff7e9 !important",
      "background-color": "#496d67 !important",
      "border-color": "#496d67 !important",
      "border-radius": "2px",
      padding: "0 0.15em"
    },
    [semanticSelectors.verse]: {
      color: "#b4cbc6 !important",
      "font-family": "'Kaiti SC', STKaiti, KaiTi, Georgia, serif !important"
    },
    "pre, code, kbd, samp": {
      color: "#dab68b !important",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace !important"
    },
    img: { "max-width": "100% !important", "height": "auto !important" },
    a: { color: "#79d9cb !important" },
    hr: { border: "0", "border-top": "1px solid rgba(239, 227, 208, 0.2)" },
    "::selection": {
      background: "rgba(121, 217, 203, 0.4) !important"
    }
  });
  rendition.themes.select(theme === "day" ? "shufang-day" : "shufang-night");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
function UserModal({
  users,
  activeUserId,
  onSelectUser,
  onClose,
  refreshUsers
}: {
  users: User[];
  activeUserId: string;
  onSelectUser: (userId: string) => void;
  onClose: () => void;
  refreshUsers: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const emojis = ['🐱', '🐶', '🦊', '🐨', '🐼', '🦁', '🦉', '🦄', '🌟', '🍀', '🚀', '🎨', '📚', '🎵', '🎧', '👾', '🧁', '🍦', '🍩', '🍕'];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("名称不能为空");
      return;
    }
    try {
      const randomAvatar = emojis[Math.floor(Math.random() * emojis.length)];
      const newUser = await api<User>("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, avatar: randomAvatar })
      });
      await refreshUsers();
      setName("");
      setIsCreating(false);
      onSelectUser(newUser.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    const confirmed = window.confirm(`确定要删除用户 "${userName}" 吗？\n\n注意：删除后仅在此处不显示。如果以后重新新建相同名字的用户，所有的阅读记录与进度数据都会完好保留。`);
    if (!confirmed) return;

    try {
      await api(`/api/users/${userId}`, { method: "DELETE" });
      await refreshUsers();
      if (userId === activeUserId) {
        onSelectUser("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showClose = activeUserId && users.some((u) => u.id === activeUserId);

  return (
    <div className="user-modal-overlay">
      <motion.div
        className="user-modal-card"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.24 }}
      >
        <div className="user-modal-header">
          <h2>{users.length === 0 ? "欢迎来到书房" : "切换/管理用户"}</h2>
          {showClose && (
            <button className="icon-button close-btn" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          )}
        </div>

        {users.length === 0 ? (
          <div className="user-modal-welcome">
            <p className="welcome-desc">这是您第一次在此设备上打开书房，或者系统中尚无用户。请先创建一个成员账号开始使用：</p>
            <form onSubmit={handleSubmit} className="user-create-inline">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入您的名字，例如：小明"
                autoFocus
              />
              <button type="submit" className="primary-action">
                创建并开始
              </button>
            </form>
            {error && <p className="error-copy">{error}</p>}
          </div>
        ) : (
          <div className="user-modal-body">
            {!isCreating ? (
              <>
                <p className="section-label">请选择当前使用者：</p>
                <div className="user-grid">
                  {users.map((u) => (
                    <div
                      key={u.id}
                      className={`user-select-item ${u.id === activeUserId ? "active" : ""}`}
                      onClick={() => onSelectUser(u.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onSelectUser(u.id);
                        }
                      }}
                    >
                      <button
                        className="user-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteUser(u.id, u.name);
                        }}
                        aria-label={`删除用户 ${u.name}`}
                        title="删除用户"
                      >
                        <Trash2 size={13} />
                      </button>
                      <span className="user-avatar">{u.avatar}</span>
                      <span className="user-name">{u.name}</span>
                      {u.id === activeUserId && <span className="active-indicator">当前</span>}
                    </div>
                  ))}
                  <button className="user-select-item create-btn" onClick={() => setIsCreating(true)}>
                    <span className="user-avatar plus"><Plus size={18} /></span>
                    <span className="user-name">新建用户</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="user-create-pane">
                <p className="section-label">创建新成员：</p>
                <form onSubmit={handleSubmit} className="user-create-form">
                  <div className="input-group">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="输入新成员的名字..."
                      autoFocus
                    />
                  </div>
                  {error && <p className="error-copy">{error}</p>}
                  <div className="btn-group">
                    <button type="button" className="ghost-action" onClick={() => { setIsCreating(false); setError(""); setName(""); }}>
                      取消
                    </button>
                    <button type="submit" className="primary-action">
                      确认创建
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
