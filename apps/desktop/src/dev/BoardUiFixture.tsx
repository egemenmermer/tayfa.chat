import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Focusable } from 'react-aria-components';
import {
  RiAddLine,
  RiAlignCenter,
  RiAlignLeft,
  RiAlignRight,
  RiDeleteBinLine,
  RiDownloadLine,
  RiFileCopyLine,
  RiMicLine,
  RiMore2Fill,
  RiMusic2Line,
  RiPianoLine,
  RiPlayFill,
  RiRepeatLine,
  RiSave3Line,
  RiSearchLine,
  RiShareLine,
  RiShuffleLine,
  RiStopFill,
} from '@remixicon/react';
import { Badge } from '@boardui/base/badge';
import { Button } from '@boardui/base/button';
import { ButtonGroup, ButtonGroupItem } from '@boardui/base/button-group';
import {
  Dropdown,
  DropdownDivider,
  DropdownGroup,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '@boardui/base/dropdown';
import { IconButton } from '@boardui/base/icon-button';
import { Input } from '@boardui/base/input';
import { Kbd } from '@boardui/base/kbd';
import { SegmentedControl, SegmentedControlItem } from '@boardui/base/segmented-control';
import { Select, SelectItem } from '@boardui/base/select';
import { RangeSlider, Slider } from '@boardui/base/slider';
import { Switch } from '@boardui/base/switch';
import { Tab, TabList, TabPanel, Tabs } from '@boardui/base/tabs';
import { Tooltip, TooltipTrigger } from '@boardui/base/tooltip';
import { BoardUiRoot, type BoardUiTheme } from '@boardui/foundations/root';
import { boardUiProSource } from '@boardui-pro/pro-source';
import { BOARDUI_FIXTURE_VARIANTS, type BoardUiFixtureVariant } from './boardui-fixture';
import { sample } from './sample';

/** Development gallery of the BoardUI base components in Tayfa colours, dark and light side by side. */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption-1-medium text-text-tertiary">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Gallery({ theme, overlays }: { theme: BoardUiTheme; overlays: boolean }) {
  const [menuOpen, setMenuOpen] = useState(overlays && theme === 'dark');
  return (
    <BoardUiRoot theme={theme}>
      <section className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border border-border-button-default bg-background-secondary-default p-5">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-headline-semibold text-text-primary">
            {theme === 'dark'
              ? sample('Koyu (varsayılan)', 'Dark (default)')
              : sample('Açık (önizleme)', 'Light (preview)')}
          </h2>
          <Badge color={theme === 'dark' ? 'primary' : 'neutral'}>
            {theme === 'dark' ? 'data-theme=dark' : 'data-theme=light'}
          </Badge>
        </header>

        <Row label={sample('Düğmeler', 'Buttons')}>
          <Button leadingIcon={RiPlayFill}>{sample('Çal', 'Play')}</Button>
          <Button variant="secondary" leadingIcon={RiSave3Line}>
            {sample('Kaydet', 'Save')}
          </Button>
          <Button variant="ghost">{sample('Paylaş', 'Share')}</Button>
          <Button variant="danger" leadingIcon={RiDeleteBinLine}>
            {sample('Sil', 'Delete')}
          </Button>
          <Button disabled>{sample('Kapalı', 'Disabled')}</Button>
        </Row>

        <Row label={sample('Simge düğmeleri ve gruplar', 'Icon buttons and groups')}>
          <IconButton icon={RiAddLine} aria-label={sample('Parça ekle', 'Add track')} />
          <IconButton icon={RiMicLine} aria-label={sample('Kaydet', 'Record')} size="small" />
          <ButtonGroup aria-label={sample('Hizalama', 'Alignment')} size="small">
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiAlignLeft}
              aria-label="L"
              selected
            />
            <ButtonGroupItem size="small" iconOnly leadingIcon={RiAlignCenter} aria-label="C" />
            <ButtonGroupItem size="small" iconOnly leadingIcon={RiAlignRight} aria-label="R" />
          </ButtonGroup>
          <ButtonGroup aria-label={sample('Döngü', 'Loop')} size="small">
            <ButtonGroupItem size="small" leadingIcon={RiRepeatLine} selected>
              {sample('Döngü', 'Loop')}
            </ButtonGroupItem>
            <ButtonGroupItem size="small" leadingIcon={RiShuffleLine}>
              {sample('Karışık', 'Shuffle')}
            </ButtonGroupItem>
          </ButtonGroup>
        </Row>

        <Row label={sample('Seçiciler', 'Pickers')}>
          <SegmentedControl defaultSelectedKeys={['bar']} aria-label={sample('Izgara', 'Grid')}>
            <SegmentedControlItem id="beat">{sample('Vuruş', 'Beat')}</SegmentedControlItem>
            <SegmentedControlItem id="bar">{sample('Ölçü', 'Bar')}</SegmentedControlItem>
            <SegmentedControlItem id="free">{sample('Serbest', 'Free')}</SegmentedControlItem>
          </SegmentedControl>
          <Select
            aria-label={sample('Enstrüman', 'Instrument')}
            defaultSelectedKey="piano"
            className="w-40"
          >
            <SelectItem id="piano" textValue="Piano">
              <RiPianoLine className="size-4 text-foreground-icon-secondary" aria-hidden />
              {sample('Piyano', 'Piano')}
            </SelectItem>
            <SelectItem id="bass" textValue="Bass">
              <RiMusic2Line className="size-4 text-foreground-icon-secondary" aria-hidden />
              {sample('Bas', 'Bass')}
            </SelectItem>
          </Select>
        </Row>

        <Tabs defaultSelectedKey="track">
          <TabList aria-label={sample('Bölümler', 'Sections')}>
            <Tab id="track" count={4}>
              {sample('Parçalar', 'Tracks')}
            </Tab>
            <Tab id="mixer">{sample('Mikser', 'Mixer')}</Tab>
            <Tab id="share" count={2}>
              {sample('Paylaşım', 'Sharing')}
            </Tab>
          </TabList>
          <TabPanel id="track" className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-x-6">
              <Slider
                label={sample('Tempo', 'Tempo')}
                defaultValue={96}
                minValue={60}
                maxValue={180}
                formatValue={(value) => `${value} BPM`}
              />
              <RangeSlider
                label={sample('Döngü aralığı', 'Loop range')}
                defaultValue={[2, 6]}
                minValue={1}
                maxValue={8}
              />
            </div>
          </TabPanel>
          <TabPanel id="mixer" />
          <TabPanel id="share" />
        </Tabs>

        <Row label={sample('Anahtarlar ve etiketler', 'Switches and badges')}>
          <Switch defaultSelected>{sample('Metronom', 'Metronome')}</Switch>
          <Switch size="sm">{sample('Sayaç', 'Count-in')}</Switch>
          <Badge>12</Badge>
          <Badge color="primary">3</Badge>
          <span className="inline-flex items-center gap-1 text-caption-1-medium text-text-secondary">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </Row>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={sample('Parça adı', 'Track name')}
            placeholder={sample('Adsız parça', 'Untitled track')}
            leadingIcon={RiSearchLine}
            hint={sample('Herkes bu adı görür.', 'Everyone sees this name.')}
          />
          <Input
            label={sample('Ölçü sayısı', 'Bars')}
            defaultValue="0"
            isInvalid
            hint={sample('En az 1 ölçü.', 'At least 1 bar.')}
          />
        </div>

        <Row label={sample('Menü ve ipucu', 'Menu and tooltip')}>
          <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownTrigger
              aria-label={sample('Diğer işlemler', 'More actions')}
              className="flex size-9 items-center justify-center rounded-2lg border border-border-button-default bg-background-primary-default hover:bg-background-primary-hover"
            >
              <RiMore2Fill className="size-5 text-foreground-icon-secondary" aria-hidden />
            </DropdownTrigger>
            <DropdownPopover aria-label={sample('Parça', 'Track')} placement="top start">
              <DropdownGroup label={sample('Parça', 'Track')}>
                <DropdownItem onSelect={() => setMenuOpen(false)}>
                  <RiFileCopyLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                  <span className="text-body-medium">{sample('Çoğalt', 'Duplicate')}</span>
                </DropdownItem>
                <DropdownItem onSelect={() => setMenuOpen(false)}>
                  <RiDownloadLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                  <span className="text-body-medium">{sample('Dışa aktar', 'Export')}</span>
                </DropdownItem>
              </DropdownGroup>
              <DropdownDivider />
              <DropdownItem onSelect={() => setMenuOpen(false)}>
                <RiShareLine className="size-5 text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium">{sample('Odaya gönder', 'Send to room')}</span>
              </DropdownItem>
            </DropdownPopover>
          </Dropdown>
          <span className="flex-1" />
          <TooltipTrigger defaultOpen={overlays}>
            <Focusable>
              <Button variant="secondary" size="small" leadingIcon={RiStopFill}>
                {sample('Durdur', 'Stop')}
              </Button>
            </Focusable>
            <Tooltip placement="top">{sample('Boşluk tuşu', 'Space bar')}</Tooltip>
          </TooltipTrigger>
        </Row>
      </section>
    </BoardUiRoot>
  );
}

export function BoardUiFixture({ variant }: { variant: BoardUiFixtureVariant }) {
  const overlays = variant === 'overlays';
  return (
    <BoardUiRoot>
      <main className="flex h-screen flex-col gap-4 overflow-auto bg-background-full p-5">
        <header className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-title-2-semibold text-text-primary">
            {sample('BoardUI · Tayfa renkleri', 'BoardUI · Tayfa colors')}
          </h1>
          <span className="rounded-full border border-border-button-default px-2 py-0.5 text-caption-2-semibold tracking-[0.08em] text-text-secondary">
            {sample('GELİŞTİRME ÖRNEĞİ', 'DEVELOPMENT SAMPLE')}
          </span>
          <span className="text-caption-1-regular text-text-tertiary">
            {sample('Pro kaynağı', 'Pro source')}: {boardUiProSource}
          </span>
        </header>
        <div className="flex flex-wrap items-start gap-4">
          <Gallery theme="dark" overlays={overlays} />
          <Gallery theme="light" overlays={overlays} />
        </div>
      </main>
    </BoardUiRoot>
  );
}

/** Mounts the gallery in place of the app shell (main.tsx, development only). */
export function renderBoardUiFixture(container: HTMLElement, variant: string) {
  const variants: readonly string[] = BOARDUI_FIXTURE_VARIANTS.S90;
  const chosen = (variants.includes(variant) ? variant : 'default') as BoardUiFixtureVariant;
  document.documentElement.dataset.referenceFixture = `S90/${chosen}`;
  createRoot(container).render(
    <StrictMode>
      <BoardUiFixture variant={chosen} />
    </StrictMode>,
  );
}
