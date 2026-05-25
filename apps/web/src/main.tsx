import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import ePub, { type Book as EpubBook, type Location, type NavItem, type Rendition } from "epubjs";
import {
  BookMarked,
  BookOpen,
  Bookmark,
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
  Search,
  Shuffle,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  UserRound
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { AmbientParticles } from "./components/AmbientParticles";
import "./styles/app.css";

const API_BASE = resolveApiBase();

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
  progress: number;
  cfi: string | null;
  chapterTitle: string | null;
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

function App() {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<Theme>("night");
  const [users, setUsers] = useState<User[]>([]);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [music, setMusic] = useState<AudioTrack[]>([]);
  const [podcasts, setPodcasts] = useState<AudioTrack[]>([]);
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState("u-1");
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

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) ?? books[0] ?? null,
    [activeBookId, books]
  );
  const activeUser = users.find((user) => user.id === activeUserId) ?? users[0] ?? {
    id: "u-1",
    name: "陶宁",
    avatar: "T",
    role: "admin"
  };

  useEffect(() => {
    void refreshAll(activeUserId);
  }, [activeUserId]);

  useEffect(() => {
    if (!activeBookId && books.length > 0) {
      setActiveBookId(books[0].id);
    }
  }, [activeBookId, books]);

  useEffect(() => {
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
  };

  const openBook = (bookId: string) => {
    setActiveBookId(bookId);
    setView("reader");
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
      playTrack(choices[Math.floor(Math.random() * choices.length)] ?? currentTrack);
      return;
    }
    const index = queue.findIndex((track) => track.id === currentTrack.id);
    playTrack(queue[(index + 1) % queue.length]);
  };

  const seekAudio = (position: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = position;
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
    <div className="app-shell" data-theme={theme}>
      <AmbientParticles isPlaying={isPlaying} />
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
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
          <button className="user-chip" onClick={() => setActiveUserId(nextUserId(activeUserId, users))}>
            <span>{activeUser.avatar}</span>
            <div>
              <strong>{activeUser.name}</strong>
              <small>个人进度与书签</small>
            </div>
          </button>
          <button className="icon-button" onClick={() => setTheme(theme === "night" ? "day" : "night")} aria-label="切换主题">
            {theme === "night" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </aside>

      <main className="main-panel" ref={mainPanelRef}>
        <header className="topbar">
          <div>
            <p className="eyebrow">{roots.length > 0 ? "家庭共享书架" : "先设置资源路径"}</p>
            <h1>{titleForView(view, activeBook?.title)}</h1>
          </div>
          <label className="search-box">
            <Search size={18} />
            <input placeholder="搜索书籍、专辑、播客" />
          </label>
        </header>

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
              <HomeView books={books} tracks={[...music, ...podcasts]} openBook={openBook} playTrack={playTrack} goSettings={() => setView("settings")} />
            )}
            {view === "books" && <BooksView books={books} openBook={openBook} goSettings={() => setView("settings")} />}
            {view === "reader" && activeBook && (
              <ReaderView book={activeBook} user={activeUser} theme={theme} onProgressSaved={() => refreshAll()} />
            )}
            {view === "reader" && !activeBook && <EmptyLibrary goSettings={() => setView("settings")} />}
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
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration || currentTrack?.duration || 0)}
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
  goSettings
}: {
  books: BookItem[];
  tracks: AudioTrack[];
  openBook: (bookId: string) => void;
  playTrack: (track: AudioTrack) => void;
  goSettings: () => void;
}) {
  const heroBook = books[0];
  const heroTrack = tracks[0];

  if (!heroBook && !heroTrack) return <EmptyLibrary goSettings={goSettings} />;

  return (
    <div className="home-grid">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">继续进入书房</p>
          <h2>{heroBook ? `继续读《${heroBook.title}》` : "播放你的本地音乐"}</h2>
          <p>共享同一间书房，资源来自家里的 Mac；每个人保留自己的页码、书签和收听位置。</p>
          <div className="hero-actions">
            {heroBook && (
              <button className="primary-action" onClick={() => openBook(heroBook.id)}>
                <BookOpen size={18} />
                继续阅读
              </button>
            )}
            {heroTrack && (
              <button className="ghost-action" onClick={() => playTrack(heroTrack)}>
                <Headphones size={18} />
                继续收听
              </button>
            )}
          </div>
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
        <SectionTitle icon={<Bookmark size={18} />} title="正在阅读" />
        <div className="book-row">
          {books.slice(0, 4).map((book) => (
            <BookCard key={book.id} book={book} onOpen={() => openBook(book.id)} />
          ))}
        </div>
      </section>

      <section className="audio-panel">
        <SectionTitle icon={<ListMusic size={18} />} title="正在收听" />
        <TrackList tracks={tracks.slice(0, 4)} playTrack={playTrack} />
      </section>
    </div>
  );
}

function BooksView({
  books,
  openBook,
  goSettings
}: {
  books: BookItem[];
  openBook: (bookId: string) => void;
  goSettings: () => void;
}) {
  if (books.length === 0) return <EmptyLibrary goSettings={goSettings} />;

  return (
    <div className="library-layout">
      <div className="filter-row">
        <button className="filter-chip active">最近阅读</button>
        <button className="filter-chip">最近加入</button>
        <button className="filter-chip">有书签</button>
        <button className="filter-chip">未读完</button>
      </div>
      <div className="book-grid">
        {books.map((book) => (
          <BookCard key={book.id} book={book} onOpen={() => openBook(book.id)} />
        ))}
      </div>
    </div>
  );
}

function ReaderView({
  book,
  user,
  theme,
  onProgressSaved
}: {
  book: BookItem;
  user: User;
  theme: Theme;
  onProgressSaved: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const epubBookRef = useRef<EpubBook | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const currentCfiRef = useRef(book.cfi ?? "");
  const [toc, setToc] = useState<NavItem[]>([]);
  const [drawer, setDrawer] = useState<"toc" | "bookmarks" | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [progress, setProgress] = useState(Math.round(book.progress));
  const [chapterTitle, setChapterTitle] = useState(book.chapterTitle ?? "");
  const [note, setNote] = useState("");
  const [isReaderReady, setIsReaderReady] = useState(false);
  const [readerError, setReaderError] = useState("");

  useEffect(() => {
    let disposed = false;
    setToc([]);
    setProgress(Math.round(book.progress));
    setChapterTitle(book.chapterTitle ?? "");
    setIsReaderReady(false);
    setReaderError("");
    currentCfiRef.current = book.cfi ?? "";

    const setup = async () => {
      try {
        await mountReader(`${API_BASE}/api/books/${book.id}/file`);
      } catch {
        try {
          const response = await fetch(`${API_BASE}/api/books/${book.id}/file`);
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
        spread: "none",
        flow: "paginated"
      });
      renditionRef.current = rendition;
      applyReaderTheme(rendition, theme);

      await Promise.race([
        epubBook.ready,
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("reader_timeout")), 8000))
      ]);
      if (disposed) return;
      const cacheKey = `shufang.locations.${book.id}`;
      const cachedLocations = window.localStorage.getItem(cacheKey);
      if (cachedLocations) {
        epubBook.locations.load(cachedLocations);
      } else {
        await epubBook.locations.generate(1200);
        window.localStorage.setItem(cacheKey, epubBook.locations.save());
      }
      setToc(epubBook.navigation.toc);
      rendition.on("relocated", (location: Location) => {
        const cfi = location.start.cfi;
        currentCfiRef.current = cfi;
        const nextProgress = Math.round(epubBook.locations.percentageFromCfi(cfi) * 100);
        setProgress(nextProgress);
        const navItem = epubBook.navigation.get(location.start.href);
        const nextChapter = navItem?.label ?? "";
        setChapterTitle(nextChapter);
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
          void saveProgress(book.id, user.id, cfi, nextProgress, nextChapter).then(onProgressSaved);
        }, 500);
      });
      await rendition.display(book.cfi ?? undefined);
      setIsReaderReady(true);
      await loadBookmarks(book.id, user.id, setBookmarks);
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
  }, [book.id, user.id]);

  useEffect(() => {
    if (renditionRef.current) applyReaderTheme(renditionRef.current, theme);
  }, [theme]);

  const addBookmark = async () => {
    if (!currentCfiRef.current) return;
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
        <button className="icon-button" onClick={() => setDrawer(drawer === "toc" ? null : "toc")} aria-label="目录">
          <List size={18} />
        </button>
        <button className="icon-button" onClick={() => void renditionRef.current?.prev()} aria-label="上一页">
          <ChevronLeft size={18} />
        </button>
        <div className="reader-status">
          <strong>{chapterTitle || book.title}</strong>
          <span>{user.name} 的进度 {progress}%</span>
        </div>
        <button className="icon-button" onClick={() => void renditionRef.current?.next()} aria-label="下一页">
          <ChevronRight size={18} />
        </button>
        <button
          className="icon-button"
          onClick={() => setDrawer(drawer === "bookmarks" ? null : "bookmarks")}
          aria-label="书签"
        >
          <BookMarked size={18} />
        </button>
        <a className="icon-button" href={`${API_BASE}/api/books/${book.id}/file`} download aria-label="下载">
          <Download size={18} />
        </a>
      </div>

      <div className="reader-workspace">
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
          <div ref={hostRef} className="epub-host" />
        </article>
      </div>

      <div className="reader-bottom">
        <button className="ghost-action" onClick={addBookmark}>
          <Bookmark size={18} />
          标记此处
        </button>
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

function BookCard({ book, onOpen }: { book: BookItem; onOpen: () => void }) {
  return (
    <button className="book-card" onClick={onOpen}>
      <span className="book-cover" style={{ backgroundImage: coverBackground(book.coverPath) }}>
        <span>{book.coverPath ? "" : book.title}</span>
      </span>
      <strong>{book.title}</strong>
      <small>{book.author ?? "未知作者"}</small>
      <span className="mini-progress">
        <i style={{ width: `${Math.round(book.progress)}%` }} />
      </span>
    </button>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
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
            max={Math.max(duration, 0)}
            step="0.1"
            value={Math.min(position, duration || position)}
            disabled={!track || !duration}
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
      <button className="icon-button" onClick={() => setPlayMode(nextMode)} aria-label="切换循环模式" title={playModeLabel(playMode)}>
        {playMode === "shuffle" ? <Shuffle size={18} /> : playMode === "repeat-one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
      </button>
    </footer>
  );
}

function titleForView(view: View, bookTitle?: string) {
  if (view === "books") return "家庭书架";
  if (view === "reader") return bookTitle ?? "阅读";
  if (view === "music") return "音乐";
  if (view === "podcasts") return "播客";
  if (view === "settings") return "资源";
  return "今晚的书房";
}

function nextUserId(current: string, users: User[]) {
  if (users.length === 0) return current;
  const index = users.findIndex((user) => user.id === current);
  return users[(index + 1) % users.length].id;
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
  if (!duration || Number.isNaN(duration)) return "0:00";
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

function applyReaderTheme(rendition: Rendition, theme: Theme) {
  rendition.themes.register("shufang-day", {
    "html, body": {
      color: "#2f2923",
      background: "#fbf4e9",
      "font-family": "Georgia, 'Songti SC', serif",
      "line-height": "1.85",
      "font-size": "18px"
    },
    "body *": { color: "#2f2923 !important", "background-color": "transparent !important" },
    "p, div": { "line-height": "1.85" },
    a: { color: "#2a8278 !important" }
  });
  rendition.themes.register("shufang-night", {
    "html, body": {
      color: "#efe3d0",
      background: "#171615",
      "font-family": "Georgia, 'Songti SC', serif",
      "line-height": "1.85",
      "font-size": "18px"
    },
    "body *": { color: "#efe3d0 !important", "background-color": "transparent !important" },
    "p, div": { "line-height": "1.85" },
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
