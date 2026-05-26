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
  X
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import "./styles/app.css";

const API_BASE = resolveApiBase();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  const [podcasts, setPodcasts] = useState<AudioTrack[]>([]);
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
  const mainPanelRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousViewRef = useRef<View>("books");
  const returningFromReaderRef = useRef(false);

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
    const [nextUsers, nextBooks, nextMusic, nextPodcasts, nextRoots] = await Promise.all([
      api<User[]>("/api/users"),
      api<BookItem[]>(`/api/books?userId=${encodeURIComponent(userId)}`),
      api<AudioTrack[]>("/api/audio?kind=music"),
      api<AudioTrack[]>("/api/audio?kind=podcast"),
      api<ScanRoot[]>("/api/roots")
    ]);
    setUsers(nextUsers);
    setBooks(nextBooks);
    setMusic(nextMusic);
    setPodcasts(nextPodcasts);
    setRoots(nextRoots);
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

  const playTrack = (track: AudioTrack) => {
    setCurrentTrack(track);
    setIsPlaying(true);
  };

  const queue = useMemo(() => [...music, ...podcasts], [music, podcasts]);

  const playNextTrack = () => {
    if (queue.length === 0) return;
    if (!currentTrack) {
      playTrack(queue[0]);
      return;
    }
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

  return (
    <div className="app-shell" data-theme={theme} data-view={view}>
      <aside className="sidebar" aria-label="主导航">
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
        </div>

        <nav className="nav-list">
          <NavButton icon={<Home size={19} />} active={view === "home"} onClick={() => setView("home")} label="首页" />
          <NavButton icon={<Library size={19} />} active={view === "books"} onClick={() => setView("books")} label="书架" />
          <NavButton icon={<Music2 size={19} />} active={view === "music"} onClick={() => setView("music")} label="音乐" />
          <NavButton icon={<Mic2 size={19} />} active={view === "podcasts"} onClick={() => setView("podcasts")} label="播客" />
          <NavButton icon={<Settings size={19} />} active={view === "settings"} onClick={() => setView("settings")} label="资源" />
        </nav>

        <div className="sidebar-footer">
          <button className="user-chip" onClick={() => setIsUserModalOpen(true)}>
            <span>{activeUser.avatar}</span>
            <div>
              <strong>{activeUser.name}</strong>
              <small>切换/管理用户</small>
            </div>
          </button>
          <button className="icon-button" onClick={() => setTheme(theme === "night" ? "day" : "night")} aria-label="切换主题">
            {theme === "night" ? <Sun size={18} /> : <Moon size={18} />}
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
                tracks={[...music, ...podcasts]}
                openBook={openBook}
                playTrack={playTrack}
                readingActivity={readingActivity}
                goBooks={() => setView("books")}
                goMusic={() => setView("music")}
                goSettings={() => setView("settings")}
                onCoverExtracted={updateBookCover}
              />
            )}
            {view === "books" && <BooksView books={books} openBook={openBook} goSettings={() => setView("settings")} onCoverExtracted={updateBookCover} />}
            {view === "music" && <AudioView kind="music" tracks={music} playTrack={playTrack} />}
            {view === "podcasts" && <AudioView kind="podcasts" tracks={podcasts} playTrack={playTrack} />}
            {view === "settings" && (
              <SettingsView roots={roots} runScan={runScan} isScanning={isScanning} message={message} refresh={refreshAll} />
            )}
          </motion.section>
        </AnimatePresence>
      </main>

      <audio
        ref={audioRef}
        src={currentTrack ? `${API_BASE}/api/audio/${currentTrack.id}/stream` : undefined}
        loop={playMode === "repeat-one"}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(event) => setAudioDuration(finiteDuration(event.currentTarget.duration) ?? currentTrack?.duration ?? 0)}
        onDurationChange={(event) => setAudioDuration(finiteDuration(event.currentTarget.duration) ?? currentTrack?.duration ?? 0)}
        onTimeUpdate={(event) => setAudioPosition(event.currentTarget.currentTime)}
        onEnded={playNextTrack}
      />
      <GlobalPlayer
        track={currentTrack}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        playMode={playMode}
        setPlayMode={setPlayMode}
        position={audioPosition}
        duration={audioDuration || currentTrack?.duration || 0}
        seek={seekAudio}
        activeLyric={currentLyricText}
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
  onCoverExtracted
}: {
  books: BookItem[];
  tracks: AudioTrack[];
  openBook: (bookId: string) => void;
  playTrack: (track: AudioTrack) => void;
  readingActivity: ReadingActivity[];
  goBooks: () => void;
  goMusic: () => void;
  goSettings: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
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
            <BookCard key={book.id} book={book} onOpen={() => openBook(book.id)} onCoverExtracted={onCoverExtracted} />
          ))}
        </div>
      </section>

      <section className="audio-panel">
        <SectionTitle icon={<ListMusic size={18} />} title="正在收听" actionLabel="更多" onAction={goMusic} />
        <TrackList tracks={tracks.slice(0, 20)} playTrack={playTrack} />
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
  onCoverExtracted
}: {
  books: BookItem[];
  openBook: (bookId: string) => void;
  goSettings: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
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
          <BookCard key={book.id} book={book} onOpen={() => openBook(book.id)} onCoverExtracted={onCoverExtracted} />
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
  const saveTimerRef = useRef<number | null>(null);
  const wheelLockRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const currentCfiRef = useRef(book.cfi ?? "");
  const locationsReadyRef = useRef(false);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [drawer, setDrawer] = useState<"toc" | "bookmarks" | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [progress, setProgress] = useState(Math.round(book.progress));
  const [chapterTitle, setChapterTitle] = useState(book.chapterTitle ?? "");
  const [note, setNote] = useState("");
  const [isReaderReady, setIsReaderReady] = useState(false);
  const [readerError, setReaderError] = useState("");
  const [fontSize, setFontSize] = useState(() => readReaderFontSize());
  const isPdf = book.format === "pdf";

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
    currentCfiRef.current = book.cfi ?? "";
    locationsReadyRef.current = false;

    if (isPdf) {
      setIsReaderReady(true);
      currentCfiRef.current = "";
      renditionRef.current?.destroy();
      epubBookRef.current?.destroy();
      renditionRef.current = null;
      epubBookRef.current = null;
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
        flow: "paginated"
      });
      renditionRef.current = rendition;
      applyReaderTheme(rendition, theme, fontSize);
      rendition.hooks.content.register((contents: { document: Document }) => {
        contents.document.addEventListener("wheel", handleHorizontalWheel, { passive: false });
        contents.document.addEventListener("touchstart", (event) => {
          const touch = event.touches[0];
          if (touch) startTouch(touch.clientX, touch.clientY);
        });
        contents.document.addEventListener("touchend", (event) => {
          const touch = event.changedTouches[0];
          if (touch) endTouch(touch.clientX, touch.clientY);
        });
      });

      await Promise.race([
        epubBook.ready,
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("reader_timeout")), 8000))
      ]);
      if (disposed) return;
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rendition = renditionRef.current;
        if (!rendition || !hostRef.current) return;
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
            <ReaderDrawer title="目录" icon={<BookOpen size={18} />}>
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
            <ReaderDrawer title="我的书签" icon={<Bookmark size={18} />}>
              <div className="bookmark-editor">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="备注这一页" />
                <button className="primary-action compact" onClick={addBookmark}>
                  添加
                </button>
              </div>
              {bookmarks.map((item) => (
                <button
                  className="note-card"
                  key={item.id}
                  onClick={() => {
                    void renditionRef.current?.display(item.cfi);
                    setDrawer(null);
                  }}
                >
                  <strong>{item.title ?? "书签"}</strong>
                  <span>{item.note ?? "无备注"}</span>
                </button>
              ))}
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
            <>
              <div ref={hostRef} className="epub-host" />
              <div className="reader-gesture-layer" aria-hidden="true" />
            </>
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
    </div>
  );
}

function ReaderDrawer({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.aside
      className="reader-drawer"
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -18 }}
      transition={{ duration: 0.2 }}
    >
      <SectionTitle icon={icon} title={title} />
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
  const saveTimerRef = useRef<number | null>(null);
  const isScrollingToSavedRef = useRef<boolean>(false);

  useEffect(() => {
    let disposed = false;
    setPageCount(0);
    setError("");
    pdfRef.current = null;
    lastSavedPageRef.current = 0;
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
        if (savedPage > 1 && savedPage <= pageCount) {
          isScrollingToSavedRef.current = true;
          setTimeout(() => {
            const el = document.getElementById(`pdf-page-${savedPage}`);
            if (el) {
              el.scrollIntoView({ block: "start" });
              lastSavedPageRef.current = savedPage;
            }
            setTimeout(() => {
              isScrollingToSavedRef.current = false;
            }, 300);
          }, 150);
        }
      }
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
      let minDiff = Infinity;
      const containerCenter = container.scrollTop + container.clientHeight / 2;

      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const elCenter = el.offsetTop + el.clientHeight / 2;
        const diff = Math.abs(containerCenter - elCenter);
        if (diff < minDiff) {
          minDiff = diff;
          const pageIdMatch = el.id.match(/pdf-page-(\d+)/);
          if (pageIdMatch) {
            activePageNum = parseInt(pageIdMatch[1], 10);
          }
        }
      }

      if (activePageNum !== lastSavedPageRef.current) {
        lastSavedPageRef.current = activePageNum;
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          const percentage = Math.round((activePageNum / pageCount) * 100);
          const chapter = `第 ${activePageNum} 页`;
          const cfi = `page-${activePageNum}`;
          void saveProgress(book.id, user.id, cfi, percentage, chapter).then(() => {
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

function AudioView({
  kind,
  tracks,
  playTrack
}: {
  kind: "music" | "podcasts";
  tracks: AudioTrack[];
  playTrack: (track: AudioTrack) => void;
}) {
  return (
    <div className="audio-library">
      <div className="audio-hero">
        <div className="vinyl">
          <Music2 size={42} />
        </div>
        <div>
          <p className="eyebrow">{kind === "music" ? "本地高清音乐" : "播客与有声内容"}</p>
          <h2>{kind === "music" ? "音乐库" : "继续收听"}</h2>
          <p>直接播放本地文件，切换到书架或阅读器时不中断。</p>
        </div>
      </div>
      <TrackList tracks={tracks} playTrack={playTrack} large />
    </div>
  );
}

function TrackList({
  tracks,
  playTrack,
  large = false
}: {
  tracks: AudioTrack[];
  playTrack: (track: AudioTrack) => void;
  large?: boolean;
}) {
  if (tracks.length === 0) {
    return <p className="muted-copy">还没有音频。到“资源”里添加目录并扫描。</p>;
  }

  return (
    <div className={`list-stack ${large ? "wide" : ""}`}>
      {tracks.map((item) => (
        <button className={`list-item ${large ? "large" : ""}`} key={item.id} onClick={() => playTrack(item)}>
          <span className="album-dot cover-dot" style={{ backgroundImage: coverBackground(item.coverPath) }} />
          <span>
            <strong>{item.title}</strong>
            <small>{[item.artist, item.album].filter(Boolean).join(" · ") || item.kind}</small>
          </span>
          <em>{formatDuration(item.duration)}</em>
        </button>
      ))}
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
        <SectionTitle icon={<Folder size={18} />} title="资源路径" />
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
        <p className="muted-copy">扫描会读取 EPUB 元数据、内置封面、音频标签和内嵌专辑图。</p>
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
  onCoverExtracted
}: {
  book: BookItem;
  onOpen: () => void;
  onCoverExtracted?: (bookId: string, coverPath: string) => void;
}) {
  const isPdf = book.format === "pdf";
  const hasCover = !!book.coverPath;

  return (
    <button className="book-card" onClick={onOpen}>
      <span className="book-cover" style={{ backgroundImage: hasCover ? coverBackground(book.coverPath) : undefined }}>
        <span className={`format-ribbon ${book.format}`}>{book.format.toUpperCase()}</span>
        {hasCover ? (
          ""
        ) : isPdf ? (
          <PdfCover bookId={book.id} title={book.title} onCoverExtracted={onCoverExtracted} />
        ) : (
          <span>{book.title}</span>
        )}
      </span>
      <strong>{book.title}</strong>
      <small>{book.author ?? "未知作者"}</small>
      <span className="mini-progress">
        <i style={{ width: `${Math.round(book.progress)}%` }} />
      </span>
    </button>
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
  activeLyric
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
}) {
  const nextMode = playMode === "repeat-all" ? "repeat-one" : playMode === "repeat-one" ? "shuffle" : "repeat-all";
  const playableDuration = finiteDuration(duration) ?? 0;
  const playablePosition = Number.isFinite(position) ? position : 0;

  return (
    <footer className="global-player">
      <button className="play-button" onClick={() => setIsPlaying(!isPlaying)} disabled={!track} aria-label={isPlaying ? "暂停" : "播放"}>
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <div className="now-playing-art" style={{ backgroundImage: coverBackground(track?.coverPath ?? null) }} />
      <div className="now-playing-copy">
        <strong>{track?.title ?? "还没有播放内容"}</strong>
        <span>{track ? [track.artist, track.album].filter(Boolean).join(" · ") || "当前书房播放" : "从音乐或播客里选择一项"}</span>
      </div>
      <div className="player-middle">
        <div className="lyric-line">{track ? activeLyric || "暂无本地歌词" : " "}</div>
        <div className="player-seek-row">
          <span>{formatDuration(position)}</span>
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
          <span>{formatDuration(playableDuration)}</span>
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

function applyReaderTheme(rendition: Rendition, theme: Theme, fontSize: number) {
  rendition.themes.register("shufang-day", {
    "html, body": {
      color: "#2f2923",
      background: "#fbf4e9",
      "font-family": "Georgia, 'Songti SC', serif",
      "line-height": "1.72",
      "font-size": `${fontSize}px`
    },
    body: {
      margin: "0 !important",
      padding: "0 4% !important"
    },
    "body *": { color: "#2f2923 !important", "background-color": "transparent !important" },
    "p, div": { "line-height": "1.72" },
    img: { "max-width": "100% !important", "height": "auto !important" },
    a: { color: "#2a8278 !important" }
  });
  rendition.themes.register("shufang-night", {
    "html, body": {
      color: "#efe3d0",
      background: "#171615",
      "font-family": "Georgia, 'Songti SC', serif",
      "line-height": "1.72",
      "font-size": `${fontSize}px`
    },
    body: {
      margin: "0 !important",
      padding: "0 4% !important"
    },
    "body *": { color: "#efe3d0 !important", "background-color": "transparent !important" },
    "p, div": { "line-height": "1.72" },
    img: { "max-width": "100% !important", "height": "auto !important" },
    a: { color: "#79d9cb !important" }
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
