import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  ListPlus,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Star,
} from 'lucide-react';
import type {
  StremioContinueItem,
  StremioDetails,
  StremioFeatured,
  StremioHome,
  StremioRow,
  StremioStream,
  StremioStreams,
  StremioTitle,
  StremioType,
  StremioVideo,
} from '../../../../packages/community-cinema/src/types';
import { cinemaArt, cinemaErrorCode, cinemaErrorText, getCinemaBridge } from './cinema-bridge';
import { CinemaArt } from './CinemaArt';
import { useBridgeRead } from './catalog-cache';
import { useHall } from './use-hall';
import { Credits, DetailsHead, HallRow, PosterCard, VodSkeleton } from './VodTab';
import { t } from '../i18n';

export type StremioView =
  | { mode: 'home'; query: string }
  | {
      mode: 'grid';
      /** `StremioRow.key`; genre browsing uses Cinemeta's popular catalog. */
      key: string;
      title: string;
      type: StremioType;
      genre: string | null;
      genres: string[];
    }
  | {
      mode: 'details';
      type: StremioType;
      id: string;
      videoId: string | null;
      /** Where "back" returns: the grid it was opened from, or the home. */
      back?: StremioView;
    };

/**
 * Stremio: what the owner's linked account watches and has saved, Cinemeta's and the
 * account's add-on catalogs, search, and per film or episode the streams its add-ons
 * (Torrentio with a debrid service…) offer. A picked stream plays in the hall through the
 * server, like a catalog film.
 */
export function StremioTab({
  view,
  onView,
}: {
  view: StremioView;
  onView(view: StremioView): void;
}) {
  const hall = useHall();
  if (!hall.status.stremio?.linked) return <NotLinked />;
  if (view.mode === 'details')
    return (
      <StremioDetailsView
        key={`${view.type}:${view.id}`}
        type={view.type}
        id={view.id}
        videoId={view.videoId}
        backLabel={view.back?.mode === 'grid' ? view.back.title : 'Stremio'}
        onBack={() => onView(view.back ?? { mode: 'home', query: '' })}
      />
    );
  if (view.mode === 'grid')
    return <StremioGridView key={`${view.key}:${view.genre ?? ''}`} view={view} onView={onView} />;
  return <StremioHomeView query={view.query} onView={onView} />;
}

function NotLinked() {
  const hall = useHall();
  const navigate = useNavigate();
  return (
    <div className="hall-message">
      <span className="hall-message-icon">
        <Clapperboard size={28} />
      </span>
      <h2>{hall.status.isOwner ? t('Stremio hesabını bağla') : t('Stremio bağlı değil')}</h2>
      <p>
        {hall.status.isOwner
          ? t(
              'Stremio’da kurulu eklentilerin (Torrentio ve Real-Debrid gibi) buradaki filmler ve diziler için kaynak bulur. Seçtiğin kaynak sunucudan herkese aynı anda oynar. Hesap anahtarın ve debrid anahtarın hiçbir üyeye gitmez.',
            )
          : t('Topluluk sahibi Stremio hesabını bağladığında filmler ve diziler burada olacak.')}
      </p>
      {hall.status.isOwner && (
        <button className="button primary" onClick={() => navigate('/settings?tab=cinema')}>
          <Settings2 size={16} />
          {t('Bağlantıyı kur')}
        </button>
      )}
    </div>
  );
}

/** Cinemeta's genre values are English; the desktop names them. Unknown ones stay as sent. */
function genreName(genre: string) {
  const names: Record<string, string> = {
    Action: t('Aksiyon'),
    Adventure: t('Macera'),
    Animation: t('Animasyon'),
    Biography: t('Biyografi'),
    Comedy: t('Komedi'),
    Crime: t('Suç'),
    Documentary: t('Belgesel'),
    Drama: t('Dram'),
    Family: t('Aile'),
    Fantasy: t('Fantastik'),
    'Game-Show': t('Yarışma'),
    History: t('Tarih'),
    Horror: t('Korku'),
    Music: t('Müzik'),
    Musical: t('Müzikal'),
    Mystery: t('Gizem'),
    News: t('Haber'),
    'Reality-TV': t('Reality'),
    Romance: t('Romantik'),
    'Sci-Fi': t('Bilim kurgu'),
    Sport: t('Spor'),
    'Talk-Show': t('Talk show'),
    Thriller: t('Gerilim'),
    War: t('Savaş'),
    Western: t('Western'),
  };
  return names[genre] ?? genre;
}

function rowTitle(row: StremioRow) {
  const names: Record<string, string> = {
    'cinemeta:movie:top': t('Popüler filmler'),
    'cinemeta:series:top': t('Popüler diziler'),
    'cinemeta:movie:year': t('Bu yılın filmleri'),
    'cinemeta:series:year': t('Bu yılın dizileri'),
    'cinemeta:movie:imdbRating': t('Öne çıkan filmler'),
    'cinemeta:series:imdbRating': t('Öne çıkan diziler'),
  };
  return names[row.key] ?? (row.addon ? `${row.name} · ${row.addon}` : row.name);
}

/** Rows for services older than `rows`: Cinemeta's popular films and series only. */
function legacyRows(home: StremioHome): StremioRow[] {
  return (['movie', 'series'] as const).map((type) => ({
    key: `cinemeta:${type}:top`,
    type,
    name: 'top',
    addon: null,
    items: home.popular[type],
    genres: [],
    paged: false,
  }));
}

function StremioHomeView({ query, onView }: { query: string; onView(view: StremioView): void }) {
  const hall = useHall();
  const [text, setText] = useState(query);
  const [searched, setSearched] = useState(query.trim());
  const [genreType, setGenreType] = useState<StremioType>('movie');
  // Search once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setSearched(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);
  const home = useBridgeRead<StremioHome>(`${hall.hallId}:stremio-home`, (bridge) =>
    bridge.stremioHome(hall.hallId),
  );
  const results = useBridgeRead<StremioTitle[]>(
    searched ? `${hall.hallId}:stremio-search:${searched}` : null,
    (bridge) => bridge.stremioSearch(hall.hallId, searched),
  );
  const open = (title: StremioTitle, videoId: string | null = null) =>
    onView({ mode: 'details', type: title.type, id: title.id, videoId });
  // An older service has no catalog pages: its rows cannot open "Tümünü gör".
  const browsable = !!home.data?.rows;
  const rows = home.data ? (home.data.rows ?? legacyRows(home.data)) : [];
  const browse = (row: StremioRow, genre: string | null = null) =>
    onView({
      mode: 'grid',
      key: row.key,
      title: genre ? genreName(genre) : rowTitle(row),
      type: row.type,
      genre,
      genres: row.genres,
    });
  // Genre chips browse Cinemeta's popular catalog of the chosen type.
  const genreRow = rows.find((row) => row.key === `cinemeta:${genreType}:top`);
  return (
    <div className="hall-vod stremio-home">
      <div className="stremio-search">
        <label className="hall-filter">
          <Search size={15} />
          <input
            value={text}
            placeholder={t('Stremio’da film veya dizi ara')}
            aria-label={t('Stremio’da ara')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && setText('')}
          />
        </label>
      </div>
      {searched ? (
        results.loading && !results.data ? (
          <VodSkeleton />
        ) : results.error ? (
          <p className="hall-empty-note">{results.error}</p>
        ) : !results.data?.length ? (
          <p className="hall-empty-note">
            {t('“{query}” için bir şey bulunamadı.', { query: searched })}
          </p>
        ) : (
          <div className="hall-poster-grid" aria-label={t('Arama sonuçları')}>
            {results.data.map((title) => (
              <TitleCard
                key={`${title.type}:${title.id}`}
                title={title}
                onOpen={() => open(title)}
              />
            ))}
          </div>
        )
      ) : home.error ? (
        <p className="hall-empty-note">{home.error}</p>
      ) : (
        <>
          {!!home.data?.featured?.length && (
            <StremioHero items={home.data.featured} onOpen={(title) => open(title)} />
          )}
          {!!genreRow?.genres.length && (
            <section className="stremio-genres" aria-label={t('Türler')}>
              <div className="stremio-segment" role="radiogroup" aria-label={t('Tür')}>
                {(['movie', 'series'] as const).map((type) => (
                  <button
                    key={type}
                    role="radio"
                    aria-checked={genreType === type}
                    className={genreType === type ? 'selected' : ''}
                    onClick={() => setGenreType(type)}
                  >
                    {type === 'movie' ? t('Filmler') : t('Diziler')}
                  </button>
                ))}
              </div>
              <div className="stremio-chips">
                {genreRow.genres.map((genre) => (
                  <button
                    key={genre}
                    className="stremio-chip"
                    onClick={() => browse(genreRow, genre)}
                  >
                    {genreName(genre)}
                  </button>
                ))}
              </div>
            </section>
          )}
          {(home.loading || !!home.data?.continue.length) && (
            <HallRow title={t('İzlemeye devam et')} loading={!home.data}>
              {home.data?.continue.map((item) => (
                <ContinueCard
                  key={`${item.type}:${item.id}`}
                  item={item}
                  onOpen={() => open(item, item.videoId)}
                />
              ))}
            </HallRow>
          )}
          {(home.loading || !!home.data?.library.length) && (
            <HallRow title={t('Kitaplığın')} loading={!home.data}>
              {home.data?.library.map((title) => (
                <TitleCard
                  key={`${title.type}:${title.id}`}
                  title={title}
                  onOpen={() => open(title)}
                />
              ))}
            </HallRow>
          )}
          {!home.data && <HallRow title={t('Popüler filmler')} loading />}
          {rows.map((row) => (
            <HallRow
              key={row.key}
              title={rowTitle(row)}
              onAll={
                browsable && (row.paged || row.items.length > 12) ? () => browse(row) : undefined
              }
            >
              {row.items.map((title) => (
                <TitleCard
                  key={`${title.type}:${title.id}`}
                  title={title}
                  onOpen={() => open(title)}
                />
              ))}
            </HallRow>
          ))}
          {home.data && !rows.length && (
            <p className="hall-empty-note">
              {t('Cinemeta şu an yanıt vermiyor; arama yine de çalışabilir.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The home's hero: Cinemeta's popular titles with their backdrop, turning every 9 s. */
function StremioHero({
  items,
  onOpen,
}: {
  items: StremioFeatured[];
  onOpen(title: StremioTitle): void;
}) {
  const hall = useHall();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [logoFailed, setLogoFailed] = useState<string | null>(null);
  const item = items[index % items.length]!;
  useEffect(() => {
    if (paused || items.length < 2 || document.documentElement.dataset.motion === 'reduce') return;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % items.length), 9000);
    return () => clearTimeout(timer);
  }, [index, paused, items.length]);
  const backdrop = cinemaArt(hall.hallId, item.backdrop);
  const logo = item.logo && logoFailed !== item.logo ? cinemaArt(hall.hallId, item.logo) : null;
  const step = (by: number) => setIndex((value) => (value + by + items.length) % items.length);
  return (
    <section
      className="hall-hero stremio-hero"
      aria-label={t('Öne çıkanlar')}
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {backdrop && (
        <img
          key={backdrop}
          className="hall-hero-backdrop"
          src={backdrop}
          alt=""
          draggable={false}
        />
      )}
      <div className="hall-hero-shade" />
      <div className="hall-hero-text" aria-live={paused ? 'polite' : 'off'}>
        <span className="hall-eyebrow">
          {item.type === 'movie' ? t('Popüler film') : t('Popüler dizi')}
        </span>
        {logo ? (
          <img
            className="stremio-hero-logo"
            src={logo}
            alt={item.name}
            draggable={false}
            onError={() => setLogoFailed(item.logo)}
          />
        ) : (
          <h2>{item.name}</h2>
        )}
        <p className="hall-meta">
          {item.rating && (
            <span className="hall-rating">
              <Star size={13} />
              {item.rating}
            </span>
          )}
          {[item.year, item.genres.map(genreName).join(', ')].filter(Boolean).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </p>
        {item.plot && <p>{item.plot}</p>}
        <div className="hall-detail-actions">
          <button className="button primary" onClick={() => onOpen(item)}>
            <Play size={16} />
            {t('Kaynak seç')}
          </button>
        </div>
      </div>
      {items.length > 1 && (
        <div className="stremio-hero-nav">
          <button className="stremio-hero-arrow" aria-label={t('Önceki')} onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <div className="stremio-hero-dots">
            {items.map((entry, i) => (
              <button
                key={`${entry.type}:${entry.id}`}
                className={i === index % items.length ? 'selected' : ''}
                aria-label={entry.name}
                aria-current={i === index % items.length}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button className="stremio-hero-arrow" aria-label={t('Sonraki')} onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </section>
  );
}

/** "Tümü" and genres: one catalog as a poster grid that loads the next page near its end. */
function StremioGridView({
  view,
  onView,
}: {
  view: Extract<StremioView, { mode: 'grid' }>;
  onView(view: StremioView): void;
}) {
  const hall = useHall();
  const [items, setItems] = useState<StremioTitle[]>([]);
  const [state, setState] = useState<{ loading: boolean; more: boolean; error: string | null }>({
    loading: true,
    more: true,
    error: null,
  });
  const skip = useRef(0);
  const seen = useRef(new Set<string>());
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = async () => {
    const bridge = getCinemaBridge();
    if (!bridge || busy.current) return;
    busy.current = true;
    setState((value) => ({ ...value, loading: true, error: null }));
    try {
      const page = await bridge.stremioCatalog(hall.hallId, view.key, view.genre, skip.current);
      skip.current += page.items.length;
      const fresh = page.items.filter((title) => !seen.current.has(title.id));
      for (const title of fresh) seen.current.add(title.id);
      setItems((current) => [...current, ...fresh]);
      // A page with nothing new ends the list too: some add-ons ignore `skip`.
      setState({ loading: false, more: page.more && fresh.length > 0, error: null });
    } catch (error) {
      setState({ loading: false, more: true, error: cinemaErrorText(error) });
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    void load();
    // The view is keyed by catalog and genre; it loads its first page once.
  }, []);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !state.more || state.loading || state.error) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && void load(),
      { rootMargin: '600px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.more, state.loading, state.error, items.length]);
  const choose = (genre: string | null) =>
    onView({ ...view, genre, title: genre ? genreName(genre) : view.title });
  return (
    <div className="hall-vod stremio-grid-view">
      <button
        className="hall-text-button hall-back"
        onClick={() => onView({ mode: 'home', query: '' })}
      >
        <ArrowLeft size={15} />
        Stremio
      </button>
      <header className="hall-grid-head">
        <h2>
          {view.genre
            ? t('{genre} · {type}', {
                genre: genreName(view.genre),
                type: view.type === 'movie' ? t('Filmler') : t('Diziler'),
              })
            : view.title}
          {items.length > 0 && <small>{items.length}</small>}
        </h2>
      </header>
      {view.genres.length > 0 && (
        <div className="stremio-chips" role="radiogroup" aria-label={t('Tür')}>
          <button
            role="radio"
            aria-checked={!view.genre}
            className={`stremio-chip ${!view.genre ? 'selected' : ''}`}
            onClick={() => choose(null)}
          >
            {t('Tümü')}
          </button>
          {view.genres.map((genre) => (
            <button
              key={genre}
              role="radio"
              aria-checked={view.genre === genre}
              className={`stremio-chip ${view.genre === genre ? 'selected' : ''}`}
              onClick={() => choose(genre)}
            >
              {genreName(genre)}
            </button>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="hall-poster-grid">
          {items.map((title) => (
            <TitleCard
              key={`${title.type}:${title.id}`}
              title={title}
              onOpen={() =>
                onView({
                  mode: 'details',
                  type: title.type,
                  id: title.id,
                  videoId: null,
                  back: view,
                })
              }
            />
          ))}
        </div>
      )}
      {state.loading && !items.length && <VodSkeleton />}
      {state.error && (
        <p className="hall-empty-note">
          {state.error}{' '}
          <button className="hall-text-button" onClick={() => void load()}>
            {t('Yeniden dene')}
          </button>
        </p>
      )}
      {!state.loading && !state.error && !items.length && (
        <p className="hall-empty-note">{t('Bu katalogda bir şey yok.')}</p>
      )}
      {state.more && !state.error && <div ref={sentinel} className="stremio-grid-sentinel" />}
      {state.loading && items.length > 0 && (
        <p className="hall-empty-note" role="status">
          {t('Daha fazlası yükleniyor…')}
        </p>
      )}
    </div>
  );
}

function TitleCard({ title, onOpen }: { title: StremioTitle; onOpen(): void }) {
  const hall = useHall();
  return (
    <PosterCard
      hallId={hall.hallId}
      art={title.art}
      title={title.name}
      meta={[title.year, title.type === 'series' ? t('Dizi') : t('Film')]
        .filter(Boolean)
        .join(' · ')}
      onOpen={onOpen}
    >
      {title.rating && (
        <span
          className="stremio-card-rating"
          aria-label={t('IMDb puanı {rating}', { rating: title.rating })}
        >
          <Star size={11} />
          {title.rating}
        </span>
      )}
    </PosterCard>
  );
}

function ContinueCard({ item, onOpen }: { item: StremioContinueItem; onOpen(): void }) {
  const hall = useHall();
  return (
    <PosterCard
      hallId={hall.hallId}
      art={item.art}
      title={item.name}
      meta={
        item.season && item.episode
          ? t('S{season} B{episode}', { season: item.season, episode: item.episode })
          : (item.year ?? t('Film'))
      }
      label={t('{title}: kaldığın yerden kaynak seç', { title: item.name })}
      onOpen={onOpen}
    >
      {item.progress !== null && (
        <span
          className="hall-continue-progress"
          style={{ '--progress': item.progress } as CSSProperties}
        />
      )}
    </PosterCard>
  );
}

function StremioDetailsView({
  type,
  id,
  videoId,
  backLabel,
  onBack,
}: {
  type: StremioType;
  id: string;
  videoId: string | null;
  backLabel: string;
  onBack(): void;
}) {
  const hall = useHall();
  const details = useBridgeRead<StremioDetails>(
    `${hall.hallId}:stremio-details:${type}:${id}`,
    (bridge) => bridge.stremioDetails(hall.hallId, type, id),
  );
  const data = details.data;
  const seasons = useMemo(() => {
    const map = new Map<number, StremioVideo[]>();
    for (const video of data?.videos ?? [])
      map.set(video.season, [...(map.get(video.season) ?? []), video]);
    // Specials (season 0) go last.
    return [...map].sort((a, b) => (a[0] || 1e6) - (b[0] || 1e6));
  }, [data]);
  const [episode, setEpisode] = useState<string | null>(videoId);
  const [season, setSeason] = useState<number | null>(null);
  const chosen = data?.videos.find((video) => video.id === episode) ?? null;
  const activeSeason = season ?? chosen?.season ?? seasons[0]?.[0] ?? null;
  const episodes = seasons.find(([value]) => value === activeSeason)?.[1] ?? [];
  const streamsFor = type === 'movie' ? id : (chosen?.id ?? null);
  return (
    <div className="hall-vod details-view">
      <button className="hall-text-button hall-back" onClick={onBack}>
        <ArrowLeft size={15} />
        {backLabel}
      </button>
      {details.loading && !data ? (
        <VodSkeleton />
      ) : details.error || !data ? (
        <p className="hall-empty-note">{details.error ?? t('Ayrıntılar alınamadı.')}</p>
      ) : (
        <>
          <DetailsHead
            hallId={hall.hallId}
            backdrop={data.backdrop}
            art={data.art}
            title={data.name}
          >
            <span className="hall-eyebrow">
              {type === 'movie' ? t('Film') : t('Dizi')} · Stremio
            </span>
            <h2>{data.name}</h2>
            <p className="hall-meta">
              {data.rating && (
                <span className="hall-rating">
                  <Star size={13} />
                  {data.rating}
                </span>
              )}
              {[data.year, data.genres.slice(0, 3).join(', '), data.runtime]
                .filter(Boolean)
                .map((part) => (
                  <span key={part}>{part}</span>
                ))}
            </p>
            {data.plot && <p>{data.plot}</p>}
            <Credits
              director={data.director.join(', ') || null}
              cast={data.cast.slice(0, 6).join(', ') || null}
            />
          </DetailsHead>
          {type === 'series' && (
            <section className="hall-episodes" aria-label={t('Bölümler')}>
              <div className="hall-season-tabs" role="tablist" aria-label={t('Sezonlar')}>
                {seasons.map(([value]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={value === activeSeason}
                    className={value === activeSeason ? 'selected' : ''}
                    onClick={() => setSeason(value)}
                  >
                    {value === 0 ? t('Özel') : t('{season}. Sezon', { season: value })}
                  </button>
                ))}
              </div>
              <ol>
                {episodes.map((video) => (
                  <li key={video.id} className={video.id === episode ? 'playing stremio-open' : ''}>
                    <button
                      className="hall-episode"
                      aria-pressed={video.id === episode}
                      onClick={() => setEpisode(video.id)}
                    >
                      <span className="hall-episode-thumb">
                        <CinemaArt
                          hallId={hall.hallId}
                          art={video.art}
                          title={video.title}
                          shape="wide"
                        />
                        <small>
                          {t('S{season} B{episode}', {
                            season: video.season,
                            episode: video.episode,
                          })}
                        </small>
                      </span>
                      <span className="hall-episode-text">
                        <strong>
                          {video.episode}. {video.title}
                        </strong>
                        {video.plot && <span>{video.plot}</span>}
                      </span>
                    </button>
                    {video.id === episode && (
                      <StreamList type={type} id={id} videoId={video.id} reveal />
                    )}
                  </li>
                ))}
              </ol>
              {!episodes.length && (
                <p className="hall-empty-note">{t('Bu dizinin bölüm listesi yok.')}</p>
              )}
            </section>
          )}
          {type === 'movie' && streamsFor && (
            <StreamList type={type} id={id} videoId={streamsFor} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * What the account's add-ons offer for one film or episode; a click plays it in the hall.
 * Add-ons that refuse the server (Torrentio blocks data-centre addresses) are asked from
 * this computer when it is the one that linked the account.
 */
function StreamList({
  type,
  id,
  videoId,
  reveal = false,
}: {
  type: StremioType;
  id: string;
  videoId: string;
  /** Scrolls the list into view (an episode further down the season). */
  reveal?: boolean;
}) {
  const hall = useHall();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reveal) section.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [reveal]);
  const admin = hall.status.isOwner;
  const streams = useBridgeRead<StremioStreams>(
    admin ? `${hall.hallId}:stremio-streams:${type}:${videoId}` : null,
    (bridge) => bridge.stremioStreams(hall.hallId, type, id, videoId),
  );
  const assist = !!streams.data?.assist;
  const local = useBridgeRead<StremioStream[]>(
    assist
      ? `${hall.hallId}:stremio-assist:${type}:${videoId}:${streams.data?.streams.length}`
      : null,
    (bridge) => bridge.stremioAssist(hall.hallId, type, id, videoId),
  );
  const localIds = useMemo(
    () => new Set((local.data ?? []).map((stream) => stream.id)),
    [local.data],
  );
  const all = [...(local.data ?? []), ...(streams.data?.streams ?? [])];
  const [picking, setPicking] = useState<string | null>(null);
  const steer = hall.canDirect || !hall.primary;
  const play = async (stream: StremioStream) => {
    const bridge = getCinemaBridge();
    if (!bridge || picking) return;
    setPicking(stream.id);
    try {
      const picked = localIds.has(stream.id)
        ? await bridge.stremioPickLocal(hall.hallId, stream.id)
        : await bridge.stremioPick(hall.hallId, stream.id);
      await hall.open({
        kind: 'community-media',
        ref: picked.ref,
        title: picked.title.slice(0, 240),
        live: false,
        art: picked.art && /^[a-f0-9]{16,64}$/.test(picked.art) ? picked.art : null,
      });
    } catch (error) {
      const text = cinemaErrorText(error);
      hall.notify(text);
      if (cinemaErrorCode(error) === 'CINEMA_STREMIO_STREAM_EXPIRED') {
        streams.reload();
        local.reload();
      }
    } finally {
      setPicking(null);
    }
  };
  if (!admin)
    return (
      <section className="stremio-streams" aria-label={t('Kaynaklar')}>
        <p className="hall-empty-note">
          {t(
            'Kaynakları topluluk sahibi ve yöneticiler seçer; açtıkları şey salonda herkes için oynar.',
          )}
        </p>
      </section>
    );
  const loading = (streams.loading && !streams.data) || (assist && local.loading && !local.data);
  const blocked = streams.data?.blockedAddons ?? [];
  return (
    <section
      ref={section}
      className="stremio-streams"
      aria-label={t('Kaynaklar')}
      aria-busy={streams.loading || local.loading}
    >
      <header>
        <h3>{t('Kaynaklar')}</h3>
        <button
          className="hall-text-button"
          onClick={() => {
            streams.reload();
            if (assist) local.reload();
          }}
          disabled={streams.loading || local.loading}
          aria-label={t('Kaynakları yeniden ara')}
        >
          <RefreshCw size={14} />
          {t('Yenile')}
        </button>
      </header>
      {loading ? (
        <p className="hall-empty-note" role="status">
          {t('Eklentiler kaynak arıyor… Bu birkaç saniye sürebilir.')}
        </p>
      ) : streams.error ? (
        <p className="hall-empty-note">{streams.error}</p>
      ) : !all.length ? (
        <p className="hall-empty-note">
          {streams.data?.skippedTorrents
            ? t(
                '{count} torrent bulundu ama sunucu yalnızca doğrudan bağlantıları oynatır. Stremio’daki Torrentio ayarına Real-Debrid gibi bir debrid hesabı ekle.',
                { count: streams.data.skippedTorrents },
              )
            : streams.data?.skippedOther
              ? t(
                  '{count} kaynak bulundu ama hiçbiri salonda oynatılabilen doğrudan bir bağlantı değil (dış sayfa, YouTube veya Usenet).',
                  { count: streams.data.skippedOther },
                )
              : t('Bu içerik için eklentilerin bir kaynak bulamadı.')}
        </p>
      ) : (
        <ol>
          {all.map((stream) => {
            const [first, ...rest] = stream.title.split('\n');
            return (
              <li key={stream.id}>
                <button
                  className="stremio-stream"
                  disabled={!!picking}
                  onClick={() => void play(stream)}
                  aria-label={
                    steer
                      ? t('{quality} {title}: salonda oynat', {
                          quality: stream.resolution ?? '',
                          title: first,
                        })
                      : t('{quality} {title}: sıraya öner', {
                          quality: stream.resolution ?? '',
                          title: first,
                        })
                  }
                >
                  <span className="stremio-stream-quality">{stream.resolution ?? '—'}</span>
                  <span className="stremio-stream-text">
                    <strong>{first || stream.name.split('\n')[0]}</strong>
                    <small>
                      {[
                        stream.addon,
                        stream.size,
                        ...rest.map((line) => line.replace(/💾\s*[\d.,]+\s?[GM]B/, '').trim()),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  {stream.cached !== null && (
                    <span
                      className={`stremio-stream-cache ${stream.cached ? 'ready' : ''}`}
                      title={
                        stream.cached
                          ? t('Debrid önbelleğinde: hemen açılır.')
                          : t('Debrid önce indirmeli: açılması uzun sürebilir ya da açılmayabilir.')
                      }
                    >
                      {stream.cached ? t('Hazır') : t('İndirilecek')}
                    </span>
                  )}
                  <span className="stremio-stream-play" aria-hidden="true">
                    {picking === stream.id ? (
                      <RefreshCw size={16} className="spin" />
                    ) : steer ? (
                      <Play size={16} />
                    ) : (
                      <ListPlus size={16} />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {blocked.length > 0 && !assist && (
        <p className="hall-detail-note">
          {t(
            '{addons} sunucunun adresini engelliyor; bu kaynakları yalnızca Stremio’yu bağlayan kişinin bilgisayarı listeleyebilir.',
            { addons: blocked.join(', ') },
          )}
        </p>
      )}
      {assist && local.error && (
        <p className="hall-detail-note">
          {t('{addons} bu bilgisayardan da yanıt vermedi: {error}', {
            addons: blocked.join(', '),
            error: local.error,
          })}
        </p>
      )}
      {!!streams.data?.failedAddons.length && (
        <p className="hall-detail-note">
          {t('Yanıt vermeyen eklenti: {addons}', {
            addons: streams.data.failedAddons.join(', '),
          })}
        </p>
      )}
      {!steer && (
        <p className="hall-detail-note">
          {hall.directReason ?? t('Seçtiğin kaynak sıraya önerilir.')}
        </p>
      )}
    </section>
  );
}
