import { useEffect, useId, useRef, useState } from 'react';
import { ListPlus, MonitorPlay, Play, Search } from 'lucide-react';
import type { QueueItem } from '../../../../packages/activity-protocol/src';
import type { YouTubeSearchResult } from '../../../../packages/community-cinema/src/youtube-search';
import { clock, parseYouTubeVideo, youtubeThumbnail } from '../cinema-youtube';
import { activityBridge } from '../runtime-sources';
import { didThis, paletteShortcut } from './hall-model';
import { cinemaErrorText, getCinemaBridge } from './cinema-bridge';
import { useHall } from './use-hall';
import { t } from '../i18n';

type YouTubeQueueItem = QueueItem & { media: { kind: 'youtube'; videoId: string; title: string } };

/** Titles looked up by video id; null when YouTube has none (private, removed, offline). */
const titles = new Map<string, string | null>();
/** Names a queue item got when it was added without a title. */
const PLACEHOLDER = /^YouTube(?: videosu| video| · [\w-]+)?$/;

/** Real titles for the ids, looked up one at a time and remembered for the session. */
function useYouTubeTitles(ids: string[]) {
  const [, setVersion] = useState(0);
  const key = ids
    .filter((id) => !titles.has(id))
    .slice(0, 60)
    .join(',');
  useEffect(() => {
    if (!key) return;
    let live = true;
    void (async () => {
      for (const id of key.split(',')) {
        if (!live) return;
        try {
          const details = await activityBridge().youtubeDetails?.(id);
          titles.set(id, details?.playable ? details.title.trim().slice(0, 240) || null : null);
        } catch {
          titles.set(id, null);
        }
        if (live) setVersion((value) => value + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);
  return (id: string, fallback: string) =>
    PLACEHOLDER.test(fallback) ? (titles.get(id) ?? fallback) : fallback;
}

/** Shortest text the search accepts (the service refuses less). */
const MIN_QUERY = 2;

/**
 * YouTube in the hall, laid out like Movies and Series: a link-or-search field in the header,
 * what plays now, and the hall's YouTube queue as a poster grid. A pasted link opens as before;
 * other text searches YouTube, and picking a result opens it exactly like a pasted link. The
 * official embedded player plays whatever is opened.
 */
export function YouTubeTab() {
  const hall = useHall();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<YouTubeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  /** The text the visible results answer; editing the field hides them. */
  const [answered, setAnswered] = useState('');
  const searchRun = useRef(0);
  const listId = useId();
  const videoId = parseYouTubeVideo(text);
  const steer = hall.canDirect || !hall.primary;
  const all = hall.room?.queue ?? [];
  const queue = all.filter((item): item is YouTubeQueueItem => item.media.kind === 'youtube');
  const currentIndex = all.findIndex((item) => item.id === hall.current?.id);
  const playing = queue.find((item) => item.id === hall.current?.id) ?? null;
  const upcoming = queue.filter((item) => item !== playing && all.indexOf(item) > currentIndex);
  const watched = queue.filter((item) => all.indexOf(item) < currentIndex);
  const title = useYouTubeTitles([
    ...(videoId ? [videoId] : []),
    ...queue.filter((item) => PLACEHOLDER.test(item.media.title)).map((i) => i.media.videoId),
  ]);
  const found = videoId ? titles.get(videoId) : undefined;

  const search = async () => {
    const query = text.trim();
    if (query.length < MIN_QUERY) {
      setError(t('Aramak için en az 2 harf yaz.'));
      return;
    }
    const bridge = getCinemaBridge();
    const run = ++searchRun.current;
    setSearching(true);
    setError('');
    setResults(null);
    try {
      if (!bridge) throw new Error('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
      const found = await bridge.youtubeSearch(hall.hallId, query);
      if (run !== searchRun.current) return;
      setResults(found);
      setAnswered(query);
      setActive(0);
    } catch (reason) {
      if (run === searchRun.current) setError(cinemaErrorText(reason));
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  };

  /** Opens a video like a pasted link: the hall's own permission and queue rules apply. */
  const pick = async (result: YouTubeSearchResult) => {
    searchRun.current++;
    setBusy(true);
    try {
      titles.set(result.videoId, result.title);
      await hall.open({ kind: 'youtube', videoId: result.videoId, title: result.title });
      setText('');
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const showResults = !!results && !videoId && answered === text.trim();

  const submit = async () => {
    if (!videoId) {
      await search();
      return;
    }
    setBusy(true);
    setError('');
    try {
      let name = found ?? null;
      if (found === undefined) {
        try {
          const details = await activityBridge().youtubeDetails?.(videoId);
          if (details && details.playable === false) {
            setError(t('Bu video gizli ya da kaldırılmış.'));
            return;
          }
          if (details?.playable) name = details.title.trim().slice(0, 240) || null;
        } catch {
          // The shared player still opens the video without a title.
        }
      }
      await hall.open({ kind: 'youtube', videoId, title: name ?? t('YouTube videosu') });
      setText('');
    } finally {
      setBusy(false);
    }
  };

  const card = (item: YouTubeQueueItem) => (
    <button
      key={item.id}
      className="hall-poster wide"
      disabled={!hall.canDirect}
      title={hall.canDirect ? t('Şimdi aç') : hall.directReason}
      onClick={() => hall.run({ type: 'queue.select', itemId: item.id, play: true })}
    >
      <span className="hall-poster-frame">
        <span className="hall-art wide">
          <img src={youtubeThumbnail(item.media.videoId)} alt="" draggable={false} />
        </span>
      </span>
      <strong>{title(item.media.videoId, item.media.title)}</strong>
      <small>{didThis(hall.nameOf(item.addedBy), 'add')}</small>
    </button>
  );

  return (
    <div className="hall-vod hall-youtube-tab">
      <header className="hall-grid-head">
        <h2>YouTube</h2>
        <form
          className="hall-youtube-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            role="combobox"
            aria-expanded={showResults && results!.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              showResults && results![active] ? `${listId}-${active}` : undefined
            }
            aria-autocomplete="list"
            value={text}
            placeholder={t('YouTube bağlantısı yapıştır ya da ara')}
            aria-label={t('YouTube bağlantısı ya da arama')}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
              searchRun.current++;
              setSearching(false);
            }}
            onKeyDown={(event) => {
              if (!showResults || !results!.length) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(
                  (value) =>
                    (value + (event.key === 'ArrowDown' ? 1 : -1) + results!.length) %
                    results!.length,
                );
              } else if (event.key === 'Enter' && !busy) {
                // Enter on a shown list opens the highlighted result; edited text searches again.
                event.preventDefault();
                void pick(results![Math.min(active, results!.length - 1)]!);
              }
            }}
          />
          <button className="button primary" disabled={!text.trim() || busy || searching}>
            {videoId ? (
              steer ? (
                <Play size={16} />
              ) : (
                <ListPlus size={16} />
              )
            ) : (
              <Search size={16} />
            )}
            {videoId ? (steer ? t('Salonda aç') : t('Sıraya öner')) : t('Ara')}
          </button>
        </form>
      </header>
      {error && (
        <p className="hall-form-error" role="alert">
          {error}
        </p>
      )}
      {searching && (
        <p className="hall-youtube-status" role="status">
          <span className="hall-spinner" aria-hidden="true" />
          {t('YouTube’da aranıyor…')}
        </p>
      )}
      {showResults && results!.length === 0 && !error && (
        <p className="hall-youtube-status" role="status">
          {t('“{query}” için sonuç bulunamadı.', { query: answered })}
        </p>
      )}
      {showResults && results!.length > 0 && (
        <section className="hall-youtube-results" aria-label={t('Arama sonuçları')}>
          <ul id={listId} role="listbox" aria-label={t('Arama sonuçları')}>
            {results!.map((result, index) => (
              <li
                key={result.videoId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => !busy && void pick(result)}
              >
                <span className="hall-art wide">
                  <img src={youtubeThumbnail(result.videoId)} alt="" draggable={false} />
                  {result.durationSec > 0 && (
                    <small className="hall-youtube-length">{clock(result.durationSec)}</small>
                  )}
                </span>
                <span className="hall-youtube-result-text">
                  <strong>{result.title}</strong>
                  <small>{steer ? t('Salonda aç') : t('Sıraya öner')}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {showResults ? null : videoId && !error ? (
        <section className="hall-youtube-feature" aria-label={t('Bulunan video')}>
          <span className="hall-art wide">
            <img src={youtubeThumbnail(videoId)} alt="" draggable={false} />
          </span>
          <div>
            <span className="hall-eyebrow">{t('Bulunan video')}</span>
            <h3>{found === undefined ? t('Başlık aranıyor…') : (found ?? t('YouTube videosu'))}</h3>
            <p>
              {steer
                ? t('Salonda aç’a bas; herkes aynı anda izler.')
                : t('Ev sahibine öneri olarak sıraya eklenir.')}
            </p>
          </div>
        </section>
      ) : (
        playing && (
          <section className="hall-youtube-feature" aria-label={t('Salonda oynuyor')}>
            <span className="hall-art wide">
              <img src={youtubeThumbnail(playing.media.videoId)} alt="" draggable={false} />
            </span>
            <div>
              <span className="hall-eyebrow live">{t('Salonda oynuyor')}</span>
              <h3>{title(playing.media.videoId, playing.media.title)}</h3>
              <p>{didThis(hall.nameOf(playing.addedBy), 'add')}</p>
            </div>
          </section>
        )
      )}
      {upcoming.length > 0 && (
        <section className="hall-youtube-section" aria-label={t('Sırada')}>
          <h3>
            {t('Sırada')} <small>{upcoming.length}</small>
          </h3>
          <div className="hall-poster-grid youtube">{upcoming.map(card)}</div>
        </section>
      )}
      {watched.length > 0 && (
        <section className="hall-youtube-section" aria-label={t('İzlenenler')}>
          <h3>
            {t('İzlenenler')} <small>{watched.length}</small>
          </h3>
          <div className="hall-poster-grid youtube">{watched.map(card)}</div>
        </section>
      )}
      {!queue.length && !videoId && !showResults && !searching && (
        <div className="hall-youtube-empty">
          <MonitorPlay size={26} />
          <p>
            {t('Bir YouTube bağlantısı yapıştır ya da bir şey ara; video salondaki herkes için aynı anda oynar.')}{' '}
            {t('{shortcut} ile de açabilirsin.', { shortcut: paletteShortcut })}
          </p>
        </div>
      )}
    </div>
  );
}
