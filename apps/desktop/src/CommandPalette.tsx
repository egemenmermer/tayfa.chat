import { useEffect, useId, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  AudioLines,
  BarChart3,
  Bell,
  Bot,
  Film,
  Folder,
  Home,
  MessageSquare,
  PenTool,
  Search,
  Settings,
  Spade,
  Users,
} from 'lucide-react';
import { EmptyState, Modal } from '@rooms/design';
import { t } from './i18n';
import { foldSearch } from './shell-commands';

type Command = {
  label: string;
  detail: string;
  path: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  /** Hidden search words: old names stay findable (the Games page was once called Kiraathane). */
  aliases?: string;
};

/** Destinations, named as the sidebar and the activity launcher name them. */
const commands = (): Command[] => [
  { label: t('Ana sayfa'), detail: '', path: '/home', icon: Home },
  {
    label: t('Mesajlar'),
    detail: t('Arkadaşlarınla özel konuşmalar'),
    path: '/messages',
    icon: MessageSquare,
  },
  {
    label: t('Arkadaşlar'),
    detail: t('Arkadaş ekle, istekleri gör'),
    path: '/friends',
    icon: Users,
  },
  {
    label: t('Bildirimler'),
    detail: t('Senden bahsedilen mesajlar'),
    path: '/notifications',
    icon: Bell,
  },
  {
    label: t('Ses odaları'),
    detail: t('Bir odaya katıl, sesli konuş'),
    path: '/voice',
    icon: AudioLines,
  },
  { label: t('Sinema'), detail: t('Topluluğun sinema salonu'), path: '/cinema', icon: Film },
  {
    label: t('Dosyalar'),
    detail: t('Sohbetlerde paylaşılan dosyalar'),
    path: '/files',
    icon: Folder,
  },
  {
    label: t('Oyunlar'),
    detail: t('Kart ve masa oyunları'),
    path: '/games',
    icon: Spade,
    aliases: 'kiraathane',
  },
  {
    label: t('Beyaz tahta'),
    detail: t('Birlikte çiz, yaz; imleçler canlı görünür.'),
    path: '/together?tab=board',
    icon: PenTool,
  },
  {
    label: t('Anketler'),
    detail: t('Ortak odada birlikte karar ver'),
    path: '/together?tab=polls',
    icon: BarChart3,
  },
  {
    label: t('Asistan'),
    detail: t('Görevler, sonuçlar ve oda hafızası'),
    path: '/agent',
    icon: Bot,
  },
  { label: t('Ayarlar'), detail: '', path: '/settings', icon: Settings },
];

/** ⌘K palette: a combobox over the app's destinations, driven by ↑/↓ and Enter. */
export function CommandPalette({ onClose }: { onClose(): void }) {
  const navigate = useNavigate();
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const needle = foldSearch(query.trim());
  const results = commands().filter((item) =>
    foldSearch(`${item.label} ${item.detail} ${item.aliases ?? ''}`).includes(needle),
  );
  const current = results.length ? Math.min(active, results.length - 1) : -1;
  const optionId = (index: number) => `${id}-option-${index}`;
  const activeId = current >= 0 ? optionId(current) : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);
  const run = (item: Command) => {
    onClose();
    navigate(item.path);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[current]!);
    }
  };
  return (
    <Modal title={t('Ara')} onClose={onClose} className="command-modal">
      <div className="command-input">
        <Search size={19} aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-label={t('Sayfa veya komut ara')}
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          placeholder={t('Sayfa veya komut ara…')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd>Esc</kbd>
      </div>
      {results.length ? (
        <div className="command-list" role="listbox" id={`${id}-list`} aria-label={t('Sonuçlar')}>
          {results.map((item, index) => (
            <div
              key={item.path}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              className="command-option"
              onMouseMove={() => {
                if (index !== current) setActive(index);
              }}
              onClick={() => run(item)}
            >
              <item.icon size={20} aria-hidden />
              <span>
                {item.label}
                {item.detail && <small>{item.detail}</small>}
              </span>
              <ArrowRight size={16} aria-hidden />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          size="inline"
          className="command-empty"
          icon={<Search size={24} />}
          title={t('Sonuç bulunamadı')}
        >
          {t('Başka bir sözcükle dene.')}
        </EmptyState>
      )}
      <p className="modal-footnote">{t('↑ ↓ ile seç · Enter ile aç · Esc ile kapat')}</p>
    </Modal>
  );
}
