import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Info,
  ListPlus,
  NotebookPen,
  Play,
  Star,
  X,
} from 'lucide-react';
import type {
  CatalogKind,
  CinemaCategory,
  CinemaContinueItem,
  CinemaDetails,
  CinemaEpisode,
  CinemaEpisodeMarks,
  CinemaItem,
} from '../../../../packages/community-cinema/src/types';
import { cinemaArt, cinemaErrorText, getCinemaBridge } from './cinema-bridge';
import { cleanEpisodeTitle } from '../../../../packages/community-cinema/src/titles';
import { useCinemaPreferences } from './cinema-preferences';
import { CinemaArt, QualityBadges } from './CinemaArt';
import {
  rememberItems,
  useBridgeRead,
  useCategories,
  useItems,
  usePagedItems,
} from './catalog-cache';
import { minutesLabel } from './hall-model';
import { RmdbCatalogActions } from './RmdbCatalogActions';
import { useHall } from './use-hall';
import { useHallMenu } from './HallMenu';
import {
  airDateLabel,
  continueLine,
  daysUntil,
  hideContinue,
  visibleContinue,
} from './continue-model';
import { locale, t } from '../i18n';

type VodKind = Extract<CatalogKind, 'movie' | 'series'>;
export type VodView =
  | { mode: 'home' }
  | { mode: 'grid'; categoryId: string | null; label: string }
  | { mode: 'details'; ref: string };

const NEW_DAYS = 14;

/** Movies or series: a hero and rows, a full grid per category, and a details page. */
export function VodTab({
  kind,
  view,
  onView,
  onRmdb,
}: {
  kind: VodKind;
  view: VodView;
  onView(view: VodView): void;
  /** Shows a work in the RMDB tab. */
  onRmdb?(workId: string): void;
}) {
  if (view.mode === 'details')
    return (
      <VodDetails
        kind={kind}
        refId={view.ref}
        onBack={() => onView({ mode: 'home' })}
        onOpen={(ref) => onView({ mode: 'details', ref })}
        onRmdb={onRmdb}
      />
    );
  if (view.mode === 'grid')
    return (
      <VodGrid
        kind={kind}
        categoryId={view.categoryId}
        label={view.label}
        onBack={() => onView({ mode: 'home' })}
        onOpen={(ref) => onView({ mode: 'details', ref })}
      />
    );
  return <VodHome kind={kind} onView={onView} onRmdb={onRmdb} />;
}

function VodHome({
  kind,
  onView,
  onRmdb,
}: {
  kind: VodKind;
  onView(view: VodView): void;
  onRmdb?(workId: string): void;
}) {
  const hall = useHall();
  const categories = useCategories(hall.hallId, kind);
  const recent = useItems(hall.hallId, kind, null, 'added', 24);
  const hero =
    recent.data?.items.find((item) => item.rating !== null) ?? recent.data?.items[0] ?? null;
  if (recent.loading && !recent.data) return <VodSkeleton />;
  if (recent.error) return <p className="hall-empty-note">{recent.error}</p>;
  if (!recent.data?.items.length)
    return (
      <p className="hall-empty-note">
        {kind === 'movie' ? t('Katalogda henüz film yok.') : t('Katalogda henüz dizi yok.')}
      </p>
    );
  return (
    <div className="hall-vod">
      {hero && (
        <Hero
          item={hero}
          kind={kind}
          onDetails={() => onView({ mode: 'details', ref: hero.ref })}
        />
      )}
      <ContinueRow
        kind={kind}
        onDetails={(ref) => onView({ mode: 'details', ref })}
        onRmdb={onRmdb}
      />
      <Row
        title={t('Yeni eklenenler')}
        items={recent.data.items}
        onAll={() =>
          onView({
            mode: 'grid',
            categoryId: null,
            label: kind === 'movie' ? t('Tüm filmler') : t('Tüm diziler'),
          })
        }
        onOpen={(ref) => onView({ mode: 'details', ref })}
      />
      {categories.data?.slice(0, 8).map((category) => (
        <CategoryRow
          key={category.id}
          kind={kind}
          category={category}
          onAll={() => onView({ mode: 'grid', categoryId: category.id, label: category.label })}
          onOpen={(ref) => onView({ mode: 'details', ref })}
        />
      ))}
    </div>
  );
}

function Hero({ item, kind, onDetails }: { item: CinemaItem; kind: VodKind; onDetails(): void }) {
  const hall = useHall();
  const details = useBridgeRead<CinemaDetails>(`${hall.hallId}:details:${item.ref}`, (bridge) =>
    bridge.details(hall.hallId, item.ref),
  );
  // Without a backdrop the poster stands in, softened: stretched sharp, it would crop badly.
  const posterOnly = !details.data?.backdrop;
  const backdrop = cinemaArt(hall.hallId, details.data?.backdrop ?? item.art);
  const steer = hall.canDirect || !hall.primary;
  const firstEpisode = details.data?.seasons[0]?.episodes[0];
  return (
    <section className="hall-hero" aria-label={item.title}>
      {backdrop && (
        <img
          className={`hall-hero-backdrop ${posterOnly ? 'from-poster' : ''}`}
          src={backdrop}
          alt=""
          draggable={false}
        />
      )}
      <div className="hall-hero-shade" />
      <div className="hall-hero-text">
        <span className="hall-eyebrow">{kind === 'movie' ? t('Yeni film') : t('Yeni dizi')}</span>
        <h2>{item.title}</h2>
        <Meta item={item} details={details.data} />
        {details.data?.plot && <p>{details.data.plot}</p>}
        <div className="hall-detail-actions">
          <button
            className="button primary"
            disabled={kind === 'series' && !firstEpisode}
            onClick={() =>
              kind === 'movie'
                ? void hall.openItem(item)
                : firstEpisode && void hall.openEpisode(item, firstEpisode)
            }
          >
            {steer ? <Play size={16} /> : <ListPlus size={16} />}
            {steer
              ? kind === 'movie'
                ? t('Salonda oynat')
                : t('İlk bölümü oynat')
              : t('Sıraya öner')}
          </button>
          <button className="button secondary" onClick={onDetails}>
            <Info size={16} />
            {t('Ayrıntılar')}
          </button>
        </div>
      </div>
    </section>
  );
}

function Meta({
  item,
  details,
  children,
}: {
  item: CinemaItem;
  details: CinemaDetails | null;
  children?: ReactNode;
}) {
  const parts = [
    item.year,
    details?.genre,
    details?.durationSec ? minutesLabel(details.durationSec * 1000) : null,
    details?.seasons.length ? t('{count} sezon', { count: details.seasons.length }) : null,
  ].filter(Boolean);
  return (
    <p className="hall-meta">
      {item.rating !== null && (
        <span className="hall-rating">
          <Star size={13} />
          {item.rating.toLocaleString(locale, { maximumFractionDigits: 1 })}
        </span>
      )}
      {parts.map((part) => (
        <span key={String(part)}>{part}</span>
      ))}
      {children}
      <QualityBadges badges={item.badges} max={2} />
    </p>
  );
}

/**
 * IMDb (films and series) and Letterboxd (films) open in the browser. The IMDb id is looked up
 * on the click; without the title's TMDB id from the provider, neither can be found.
 */
function TitleLinks({
  kind,
  refId,
  tmdbId,
}: {
  kind: VodKind;
  refId: string;
  tmdbId: number | null;
}) {
  const hall = useHall();
  const [state, setState] = useState<'idle' | 'busy' | 'missing'>('idle');
  const none = t('Sağlayıcı bu yapımın TMDB kimliğini vermiyor; sayfası bulunamadı.');
  const imdb = async () => {
    const bridge = getCinemaBridge();
    if (!bridge?.titleLinks || state === 'busy') return;
    setState('busy');
    try {
      const links = await bridge.titleLinks(hall.hallId, refId);
      if (links.imdbId) {
        window.open(`https://www.imdb.com/title/${links.imdbId}/`);
        setState('idle');
      } else setState('missing');
    } catch (error) {
      setState('idle');
      hall.notify(cinemaErrorText(error));
    }
  };
  return (
    <span className="hall-title-links">
      <button
        className="hall-title-link imdb"
        disabled={!tmdbId || state === 'missing'}
        aria-busy={state === 'busy'}
        title={
          !tmdbId
            ? none
            : state === 'missing'
              ? t('Bu yapımın IMDb sayfası bulunamadı.')
              : t("IMDb'de aç")
        }
        aria-label={t('IMDb sayfasını aç')}
        onClick={() => void imdb()}
      >
        IMDb
      </button>
      {kind === 'movie' && (
        <button
          className="hall-title-link letterboxd"
          disabled={!tmdbId}
          title={tmdbId ? t("Letterboxd'da aç") : none}
          aria-label={t('Letterboxd sayfasını aç')}
          onClick={() => tmdbId && window.open(`https://letterboxd.com/tmdb/${tmdbId}/`)}
        >
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          <i aria-hidden="true" />
          Letterboxd
        </button>
      )}
    </span>
  );
}

/**
 * What the hall left unfinished, the next episode of a series it is following, or that
 * episode's air date. A card opens where the hall stopped; its menu hides it for this viewer.
 */
function ContinueRow({
  kind,
  onDetails,
  onRmdb,
}: {
  kind: VodKind;
  onDetails(ref: string): void;
  onRmdb?(workId: string): void;
}) {
  const hall = useHall();
  // Read again whenever the hall moves on, so the row follows what was just watched.
  const read = useBridgeRead(
    `${hall.hallId}:continue:${kind}:${hall.current?.id ?? '-'}`,
    (bridge) => bridge.continueWatching?.(hall.hallId, kind) ?? Promise.resolve([]),
  );
  const [hidden, setHidden] = useState<string[]>([]);
  const menu = useHallMenu();
  const now = Date.now();
  // An older server has no row; it is simply not shown.
  const items = visibleContinue(hall.hallId, read.data ?? []).filter(
    (item) => !hidden.includes(item.workId),
  );
  if (read.error || (!read.loading && !items.length) || (read.loading && !read.data)) return null;
  const steer = hall.canDirect || !hall.primary;
  const open = (item: CinemaContinueItem) =>
    item.resume ? void hall.resume(item.resume) : onDetails(item.ref);
  return (
    <HallRow title={t('Devam et')} wide>
      {items.map((item) => {
        const days = item.upcomingAt ? daysUntil(item.upcomingAt, now) : null;
        const line = continueLine(item);
        return (
          <button
            key={item.workId}
            className="hall-continue-card"
            title={item.title}
            aria-label={[
              item.title,
              line,
              item.upcomingAt
                ? t('yakında, {date}', { date: airDateLabel(item.upcomingAt) })
                : null,
              item.resume
                ? steer
                  ? t('salonda devam et')
                  : t('sıraya öner')
                : t('ayrıntıları aç'),
            ]
              .filter(Boolean)
              .join(', ')}
            onClick={() => open(item)}
            {...menu.bind(item.title, () => [
              {
                label: t('Listeden kaldır'),
                icon: <X size={15} />,
                danger: true,
                onSelect: () => {
                  hideContinue(hall.hallId, item.workId);
                  setHidden((value) => [...value, item.workId]);
                },
              },
              ...(item.resume
                ? [
                    {
                      label: steer ? t('Devam et') : t('Sıraya öner'),
                      icon: steer ? <Play size={15} /> : <ListPlus size={15} />,
                      onSelect: () => open(item),
                    },
                  ]
                : []),
              {
                label: t('Ayrıntılar'),
                icon: <Info size={15} />,
                onSelect: () => onDetails(item.ref),
              },
              ...(onRmdb
                ? [
                    {
                      label: t("Tayfa'da aç"),
                      icon: <NotebookPen size={15} />,
                      onSelect: () => onRmdb(item.workId),
                    },
                  ]
                : []),
            ])}
          >
            <span className="hall-continue-art">
              <CinemaArt hallId={hall.hallId} art={item.art} title={item.title} shape="wide" />
              {item.upcomingAt ? (
                <span className="hall-continue-badges">
                  <span>{t('Yakında · {date}', { date: airDateLabel(item.upcomingAt) })}</span>
                  {days !== null && <span>{t('{days}g', { days })}</span>}
                </span>
              ) : (
                <span className="hall-continue-play" aria-hidden="true">
                  {steer ? <Play size={20} /> : <ListPlus size={20} />}
                </span>
              )}
              {item.progress > 0 && (
                <span
                  className="hall-continue-progress"
                  style={{ '--progress': item.progress } as CSSProperties}
                />
              )}
            </span>
            <strong>{item.title}</strong>
            <small>{line}</small>
          </button>
        );
      })}
      {menu.menu}
    </HallRow>
  );
}

function CategoryRow({
  kind,
  category,
  onAll,
  onOpen,
}: {
  kind: VodKind;
  category: CinemaCategory;
  onAll(): void;
  onOpen(ref: string): void;
}) {
  const hall = useHall();
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  const items = useBridgeRead(seen ? `${hall.hallId}:${kind}:${category.id}:row` : null, (bridge) =>
    bridge.items(hall.hallId, { kind, categoryId: category.id, limit: 20 }).then((page) => {
      rememberItems(page.items);
      return page.items;
    }),
  );
  return (
    <Row
      sectionRef={ref}
      title={category.label}
      count={category.count}
      items={items.data}
      onAll={onAll}
      onOpen={onOpen}
    />
  );
}

function Row({
  title,
  count,
  items,
  sectionRef,
  onAll,
  onOpen,
}: {
  title: string;
  count?: number;
  items: CinemaItem[] | null;
  sectionRef?: React.Ref<HTMLElement>;
  onAll(): void;
  onOpen(ref: string): void;
}) {
  const hall = useHall();
  const now = Date.now();
  return (
    <HallRow title={title} count={count} sectionRef={sectionRef} onAll={onAll} loading={!items}>
      {items?.map((item) => (
        <Poster
          key={item.ref}
          item={item}
          fresh={!!item.addedAt && now - item.addedAt < NEW_DAYS * 86_400_000}
          onOpen={() => onOpen(item.ref)}
          hallId={hall.hallId}
        />
      ))}
    </HallRow>
  );
}

/** A titled, horizontally scrolling row of posters; shimmering placeholders while `loading`. */
export function HallRow({
  title,
  count,
  sectionRef,
  onAll,
  loading = false,
  wide = false,
  children,
}: {
  title: string;
  count?: number;
  sectionRef?: React.Ref<HTMLElement>;
  onAll?(): void;
  loading?: boolean;
  /** 16:9 cards (the continue row) instead of posters. */
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={`hall-row ${wide ? 'wide' : ''}`} ref={sectionRef} aria-label={title}>
      <header>
        <h3>
          {title}
          {count !== undefined && <small>{count}</small>}
        </h3>
        {onAll && (
          <button className="hall-text-button" onClick={onAll}>
            {t('Tümünü gör')}
            <ChevronRight size={15} />
          </button>
        )}
      </header>
      <RowTrack>
        {loading
          ? Array.from({ length: wide ? 4 : 7 }, (_, index) => (
              <span key={index} className={`hall-skeleton ${wide ? 'wide' : 'poster'}`} />
            ))
          : children}
      </RowTrack>
    </section>
  );
}

/**
 * A row's horizontal track: arrows on hover page it by most of its width, and it can be
 * dragged with the mouse. The wheel keeps scrolling the page.
 */
function RowTrack({ children }: { children?: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const measure = () => {
    const element = track.current;
    if (!element) return;
    const start = element.scrollLeft <= 2;
    const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
    setEnds((value) => (value.start === start && value.end === end ? value : { start, end }));
  };
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Cards arrive after the first paint (lazy rows); look at the ends again when they change.
  useEffect(measure, [children]);
  const page = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth',
    });
  };
  return (
    <div className="hall-row-frame">
      <div
        ref={track}
        className="hall-row-track"
        onScroll={measure}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          drag.current = { x: event.clientX, left: track.current!.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          const element = track.current;
          if (!state || !element) return;
          // Released outside the track (over an arrow, off the window): hovering must not drag
          // the row or swallow the next click.
          if ((event.buttons & 1) === 0) {
            element.classList.remove('dragging');
            drag.current = null;
            return;
          }
          const dx = event.clientX - state.x;
          if (!state.moved && Math.abs(dx) < 6) return;
          if (!state.moved) {
            state.moved = true;
            element.setPointerCapture(event.pointerId);
            element.classList.add('dragging');
          }
          element.scrollLeft = state.left - dx;
        }}
        onPointerUp={(event) => {
          const element = track.current;
          if (drag.current?.moved && element) {
            element.classList.remove('dragging');
            if (element.hasPointerCapture(event.pointerId))
              element.releasePointerCapture(event.pointerId);
            // The click that ends a drag opens nothing.
            const swallow = (click: MouseEvent) => {
              click.stopPropagation();
              click.preventDefault();
            };
            element.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0);
          }
          drag.current = null;
        }}
        onPointerCancel={() => {
          track.current?.classList.remove('dragging');
          drag.current = null;
        }}
      >
        {children}
      </div>
      {!ends.start && (
        <button
          className="hall-row-arrow left"
          aria-label={t('Öncekiler')}
          tabIndex={-1}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {!ends.end && (
        <button
          className="hall-row-arrow right"
          aria-label={t('Sonrakiler')}
          tabIndex={-1}
          onClick={() => page(1)}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </div>
  );
}

function Poster({
  item,
  fresh,
  hallId,
  onOpen,
}: {
  item: CinemaItem;
  fresh: boolean;
  hallId: string;
  onOpen(): void;
}) {
  return (
    <PosterCard
      hallId={hallId}
      art={item.art}
      title={item.title}
      meta={[
        item.year,
        item.rating !== null
          ? `★ ${item.rating.toLocaleString(locale, { maximumFractionDigits: 1 })}`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      onOpen={onOpen}
    >
      {fresh && <span className="hall-new-badge">{t('Yeni')}</span>}
    </PosterCard>
  );
}

/** A poster button with its title and one line under it; `children` sit on the artwork. */
export function PosterCard({
  hallId,
  art,
  title,
  meta,
  label,
  onOpen,
  children,
}: {
  hallId: string;
  art: string | null;
  title: string;
  meta: string;
  /** The accessible name, when the card says more than its title. */
  label?: string;
  onOpen(): void;
  children?: ReactNode;
}) {
  return (
    <button className="hall-poster" onClick={onOpen} title={title} aria-label={label}>
      <span className="hall-poster-frame">
        <CinemaArt hallId={hallId} art={art} title={title} shape="poster" />
        {children}
      </span>
      <strong>{title}</strong>
      <small>{meta}</small>
    </button>
  );
}

function VodGrid({
  kind,
  categoryId,
  label,
  onBack,
  onOpen,
}: {
  kind: VodKind;
  categoryId: string | null;
  label: string;
  onBack(): void;
  onOpen(ref: string): void;
}) {
  const hall = useHall();
  const [sort, setSort] = useState<'added' | 'name' | 'rating'>('added');
  const items = usePagedItems(hall.hallId, kind, categoryId, sort);
  const sentinel = useRef<HTMLDivElement>(null);
  const total = items.total;
  const { more } = items;
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) more();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [more]);
  const now = Date.now();
  return (
    <div className="hall-vod grid-view">
      <header className="hall-grid-head">
        <button className="hall-text-button" onClick={onBack}>
          <ArrowLeft size={15} />
          {kind === 'movie' ? t('Filmler') : t('Diziler')}
        </button>
        <h2>
          {label} {total > 0 && <small>{total}</small>}
        </h2>
        <label className="hall-sort">
          {t('Sırala')}
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="added">{t('Yeni eklenen')}</option>
            <option value="name">{t('Ada göre')}</option>
            <option value="rating">{t('Puana göre')}</option>
          </select>
        </label>
      </header>
      <div className="hall-poster-grid">
        {items.items.map((item) => (
          <Poster
            key={item.ref}
            item={item}
            hallId={hall.hallId}
            fresh={!!item.addedAt && now - item.addedAt < NEW_DAYS * 86_400_000}
            onOpen={() => onOpen(item.ref)}
          />
        ))}
        {items.loading &&
          Array.from({ length: 12 }, (_, index) => (
            <span key={index} className="hall-skeleton poster" />
          ))}
      </div>
      {items.error && (
        <p className="hall-empty-note">
          {items.error}{' '}
          <button className="hall-text-button" onClick={items.retry}>
            {t('Yeniden dene')}
          </button>
        </p>
      )}
      <div ref={sentinel} className="hall-sentinel" />
    </div>
  );
}

function VodDetails({
  kind,
  refId,
  onBack,
  onOpen,
  onRmdb,
}: {
  kind: VodKind;
  refId: string;
  onBack(): void;
  onOpen(ref: string): void;
  onRmdb?(workId: string): void;
}) {
  const hall = useHall();
  const details = useBridgeRead<CinemaDetails>(`${hall.hallId}:details:${refId}`, (bridge) =>
    bridge.details(hall.hallId, refId).then((value) => {
      rememberItems([value.item]);
      return value;
    }),
  );
  const [marksVersion, setMarksVersion] = useState(0);
  const marks = useBridgeRead<CinemaEpisodeMarks>(
    kind === 'series' ? `${hall.hallId}:marks:${refId}:${marksVersion}` : null,
    (bridge) =>
      bridge.episodeMarks?.(hall.hallId, refId) ?? Promise.resolve({ workId: null, episodes: [] }),
  );
  const [marking, setMarking] = useState<string | null>(null);
  const { blurUnwatched: blur } = useCinemaPreferences();
  const menu = useHallMenu();
  const markOf = (episode: CinemaEpisode) =>
    marks.data?.episodes.find((e) => e.season === episode.season && e.episode === episode.episode);
  const markEpisode = async (ref: string, watched: boolean) => {
    const bridge = getCinemaBridge();
    if (!bridge?.markEpisode) return;
    setMarking(ref);
    try {
      await bridge.markEpisode(hall.hallId, ref, watched);
      setMarksVersion((value) => value + 1);
    } catch (error) {
      hall.notify(cinemaErrorText(error));
    } finally {
      setMarking(null);
    }
  };
  const [season, setSeason] = useState<number | null>(null);
  const data = details.data;
  const seasons = data?.seasons ?? [];
  // The season the hall is in, until the viewer picks one.
  const lastSeason = marks.data?.episodes.at(-1)?.season ?? null;
  const activeSeason =
    seasons.find((value) => value.season === (season ?? lastSeason)) ?? seasons[0] ?? null;
  const steer = hall.canDirect || !hall.primary;
  const playingRef = hall.current?.media.kind === 'community-media' ? hall.current.media.ref : null;
  return (
    <div className="hall-vod details-view">
      <button className="hall-text-button hall-back" onClick={onBack}>
        <ArrowLeft size={15} />
        {kind === 'movie' ? t('Filmler') : t('Diziler')}
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
            art={data.item.art}
            title={data.item.title}
          >
            <span className="hall-eyebrow">{kind === 'movie' ? t('Film') : t('Dizi')}</span>
            <h2>{data.item.title}</h2>
            <Meta item={data.item} details={data}>
              <TitleLinks kind={kind} refId={data.item.ref} tmdbId={data.tmdbId ?? null} />
            </Meta>
            {data.plot && <p>{data.plot}</p>}
            <Credits director={data.director} cast={data.cast} />
            {!!data.versions?.length && (
              <div className="hall-versions" role="radiogroup" aria-label={t('Kalite')}>
                <span>{t('Kalite')}</span>
                {[{ ref: data.item.ref, badges: data.item.badges }, ...data.versions].map(
                  (version) => (
                    <button
                      key={version.ref}
                      role="radio"
                      aria-checked={version.ref === data.item.ref}
                      className={version.ref === data.item.ref ? 'selected' : ''}
                      onClick={() => version.ref !== data.item.ref && onOpen(version.ref)}
                    >
                      {version.badges.join(' ') || t('Standart')}
                    </button>
                  ),
                )}
              </div>
            )}
            <div className="hall-detail-actions">
              {kind === 'movie' && (
                <button
                  className="button primary"
                  disabled={playingRef === data.item.ref}
                  onClick={() => void hall.openItem(data.item)}
                >
                  {steer ? <Play size={16} /> : <ListPlus size={16} />}
                  {playingRef === data.item.ref
                    ? t('Salonda açık')
                    : steer
                      ? t('Salonda oynat')
                      : t('Sıraya öner')}
                </button>
              )}
              <RmdbCatalogActions item={data.item} onRmdb={onRmdb} />
            </div>
          </DetailsHead>
          {kind === 'series' && activeSeason && (
            <section className="hall-episodes" aria-label={t('Bölümler')}>
              <div className="hall-season-tabs" role="tablist" aria-label={t('Sezonlar')}>
                {seasons.map((value) => (
                  <button
                    key={value.season}
                    role="tab"
                    aria-selected={value.season === activeSeason.season}
                    className={value.season === activeSeason.season ? 'selected' : ''}
                    onClick={() => setSeason(value.season)}
                  >
                    {t('{season}. Sezon', { season: value.season })}
                  </button>
                ))}
              </div>
              <ol>
                {activeSeason.episodes.map((episode) => {
                  const mark = markOf(episode);
                  const watched = !!mark?.finished;
                  const name =
                    cleanEpisodeTitle(
                      episode.title,
                      data.item.title,
                      episode.season,
                      episode.episode,
                    ) || t('{episode}. Bölüm', { episode: episode.episode });
                  const toggle = () => void markEpisode(episode.ref, !watched);
                  return (
                    <li
                      key={episode.ref}
                      className={[
                        playingRef === episode.ref ? 'playing' : '',
                        watched ? 'watched' : '',
                      ].join(' ')}
                      {...menu.bind(name, () => [
                        {
                          label: watched
                            ? t('İzlenmedi olarak işaretle')
                            : t('İzlendi olarak işaretle'),
                          icon: watched ? <EyeOff size={15} /> : <Check size={15} />,
                          onSelect: toggle,
                        },
                      ])}
                    >
                      <button
                        className="hall-episode"
                        disabled={playingRef === episode.ref}
                        onClick={() => void hall.openEpisode(data.item, episode)}
                        aria-label={
                          watched
                            ? t('{number}. bölüm, {name}, izlendi: {action}', {
                                number: episode.episode,
                                name,
                                action: steer ? t('salonda oynat') : t('sıraya öner'),
                              })
                            : t('{number}. bölüm, {name}: {action}', {
                                number: episode.episode,
                                name,
                                action: steer ? t('salonda oynat') : t('sıraya öner'),
                              })
                        }
                      >
                        <span className={`hall-episode-thumb ${blur && !watched ? 'spoiler' : ''}`}>
                          <CinemaArt
                            hallId={hall.hallId}
                            art={episode.art}
                            title={name}
                            shape="wide"
                          />
                          <span className="hall-episode-play">
                            {steer ? <Play size={18} /> : <ListPlus size={18} />}
                          </span>
                          <small>
                            {t('S{season} B{episode}', {
                              season: episode.season,
                              episode: episode.episode,
                            })}
                          </small>
                          {mark && !mark.finished && mark.durationSec ? (
                            <span
                              className="hall-continue-progress"
                              style={
                                {
                                  '--progress': Math.min(1, mark.positionSec / mark.durationSec),
                                } as CSSProperties
                              }
                            />
                          ) : null}
                        </span>
                        <span className="hall-episode-text">
                          <strong>
                            {episode.episode}. {name}
                            {episode.durationSec ? (
                              <small> · {minutesLabel(episode.durationSec * 1000)}</small>
                            ) : null}
                            {episode.airDate && episode.airDate > Date.now() ? (
                              <small> · {airDateLabel(episode.airDate)}</small>
                            ) : null}
                          </strong>
                          {episode.plot && !(blur && !watched) && <span>{episode.plot}</span>}
                        </span>
                      </button>
                      <button
                        className={`hall-episode-mark ${watched ? 'on' : ''}`}
                        aria-pressed={watched}
                        aria-label={
                          watched
                            ? t('{name}: izlenmedi olarak işaretle', { name })
                            : t('{name}: izlendi olarak işaretle', { name })
                        }
                        title={
                          watched
                            ? t('İzlendi · izlenmedi olarak işaretle')
                            : t('İzlendi olarak işaretle')
                        }
                        disabled={marking === episode.ref}
                        onClick={toggle}
                      >
                        <Check size={15} />
                      </button>
                    </li>
                  );
                })}
              </ol>
              {menu.menu}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Backdrop, poster and a text column: the head of a details page. */
export function DetailsHead({
  hallId,
  backdrop,
  art,
  title,
  children,
}: {
  hallId: string;
  backdrop: string | null;
  art: string | null;
  title: string;
  children: ReactNode;
}) {
  const src = cinemaArt(hallId, backdrop ?? art);
  return (
    <section className="hall-details-head">
      {src && (
        <img
          className={`hall-hero-backdrop ${backdrop ? '' : 'from-poster'}`}
          src={src}
          alt=""
          draggable={false}
        />
      )}
      <div className="hall-hero-shade" />
      <div className="hall-details-body">
        <CinemaArt hallId={hallId} art={art} title={title} shape="poster" />
        <div className="hall-hero-text">{children}</div>
      </div>
    </section>
  );
}

export function Credits({ director, cast }: { director: string | null; cast: string | null }) {
  return (
    <dl className="hall-credits">
      {director && (
        <>
          <dt>{t('Yönetmen')}</dt>
          <dd>{director}</dd>
        </>
      )}
      {cast && (
        <>
          <dt>{t('Oyuncular')}</dt>
          <dd>{cast}</dd>
        </>
      )}
    </dl>
  );
}

export function VodSkeleton() {
  return (
    <div className="hall-vod" role="status" aria-label={t('Yükleniyor')}>
      <span className="hall-skeleton hero" />
      <span className="hall-skeleton line" style={{ width: 180 }} />
      <div className="hall-row-track">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="hall-skeleton poster" />
        ))}
      </div>
    </div>
  );
}
