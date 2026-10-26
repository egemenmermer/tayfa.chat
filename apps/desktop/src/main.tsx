import { tr } from './i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import './reference-tokens.css';
import App from './App';
import './reference-shell.css';
import './design-components.css';
import './interaction-quality.css';
// BoardUI (Tailwind) styles apply only inside BoardUI regions; see boardui/foundations/globals.css.
import './boardui/foundations/globals.css';
import { installInputModality } from './input-modality';
import { queryClient as client } from './query-client';
// A file dropped outside a drop target must never navigate the app window to that file.
for (const type of ['dragover', 'drop'] as const)
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
class Boundary extends React.Component<
  {
    children: React.ReactNode;
  },
  {
    failed: boolean;
  }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal">
          <h1>{tr('Let\u2019s get you back in.')}</h1>
          <p>{tr('The local view could not open. Your settings are still saved.')}</p>
          <button className="button primary" onClick={() => location.reload()}>
            {tr('Reload Tayfa')}
          </button>
        </div>
      );
    return this.props.children;
  }
}
async function bootstrap() {
  installInputModality();
  const params = new URLSearchParams(window.location.search);
  const fixture = import.meta.env.DEV ? params.get('fixture') : null;
  if (fixture === 'S90') {
    // BoardUI component gallery (development only); it replaces the app shell.
    const { renderBoardUiFixture } = await import('./dev/BoardUiFixture');
    renderBoardUiFixture(document.getElementById('root')!, params.get('variant') || 'default');
    return;
  }
  if (fixture === 'S94') {
    // Studio editors on a fake store (development only); it replaces the app shell.
    const { renderStudioEditorsFixture } = await import('./dev/StudioEditorsFixture');
    renderStudioEditorsFixture(
      document.getElementById('root')!,
      params.get('variant') || 'default',
    );
    return;
  }
  if (fixture) {
    const { installReferenceFixture } = await import('./dev/reference-fixtures');
    if (/^S5[678]$/.test(fixture)) {
      const task = await import('./dev/agent-task-fixture');
      task.getAgentTaskFixture(fixture, params.get('variant') || 'default');
      await installReferenceFixture('S19', 'default');
    } else if (/^S1[2-8]$/.test(fixture)) {
      await installReferenceFixture('S19', 'default');
      const detail = await import('./dev/social-detail-fixture');
      const state = detail.getSocialDetailFixture(fixture, params.get('variant') || 'default');
      const { useCommunity } = await import('./community');
      useCommunity.setState(state.publicState);
    } else if (fixture === 'S68') {
      const management = await import('./dev/community-management-fixture');
      management.getCommunityManagementFixture(params.get('variant') || 'default');
      await installReferenceFixture('S19', 'default');
    } else if (fixture === 'S29') {
      await installReferenceFixture('S19', 'default');
      const player = await import('./dev/personal-playback-fixture');
      player.installPersonalPlaybackFixture(params.get('variant') || 'default');
    } else if (fixture === 'S80') {
      await installReferenceFixture('S19', 'default');
      const hall = await import('./dev/community-cinema-fixture');
      hall.installCommunityCinemaFixture(params.get('variant') || 'default');
    } else if (fixture === 'S30') {
      await installReferenceFixture('S19', 'default');
      const mini = await import('./dev/mini-playback-fixture');
      mini.installMiniPlaybackFixture(params.get('variant') || 'personal');
    } else if (/^S3[3-9]$/.test(fixture)) {
      await installReferenceFixture('S19', 'default');
      const personal = await import('./dev/personal-media-fixture');
      personal.installPersonalMediaFixture(fixture, params.get('variant') || 'default');
      if (
        fixture === 'S36' ||
        fixture === 'S39' ||
        (fixture === 'S38' && params.get('variant') === 'playing')
      ) {
        const player = await import('./dev/personal-playback-fixture');
        player.installInsetPlaybackFixture(fixture, params.get('variant') || 'default');
      }
    } else if (fixture === 'S67') {
      const notification = await import('./dev/notification-fixture');
      notification.createNotificationFixture(params.get('variant') || 'default');
      await installReferenceFixture('S19', 'default');
    } else if (fixture === 'S66') {
      await installReferenceFixture('S19', 'default');
      const appearance = await import('./dev/appearance-fixture');
      appearance.installAppearanceFixture(params.get('variant') || 'default');
    } else if (/^S(59|60|61|62|63)$/.test(fixture)) {
      await installReferenceFixture('S19', 'default');
    } else if (/^S(4[0-9]|5[0-4]|7[3-5])$/.test(fixture)) {
      const games = await import('./dev/games-fixture');
      games.getGamesFixtureMetadata(fixture, params.get('variant') || 'default');
      await installReferenceFixture('S19', 'default');
      games.installGamesFixture(fixture, params.get('variant') || 'default', {
        initialActivityStatusIntegrated: true,
        initialUIIntegrated: true,
      });
    } else await installReferenceFixture(fixture, params.get('variant') || 'default');
    const { installMediaFixture } = await import('./dev/media-fixture');
    if (/^S5[678]$/.test(fixture) || fixture === 'S68' || fixture === 'S70' || fixture === 'S71')
      installMediaFixture('S10', 'default');
    if (fixture === 'S29') installMediaFixture('S19', 'default');
    if (fixture === 'S30' && ['personal', 'live'].includes(params.get('variant') || 'personal'))
      installMediaFixture('S19', 'default');
    if (fixture === 'S67' || fixture === 'S66' || /^S(59|60|61|62|63)$/.test(fixture))
      installMediaFixture('S10', 'default');
    if (/^S3[3-9]$/.test(fixture)) installMediaFixture('S10', 'default');
    if (['S10', 'S19', 'S20', 'S21', 'S22', 'S23'].includes(fixture))
      installMediaFixture(fixture, params.get('variant') || 'default');
    document.documentElement.dataset.referenceFixture = `${fixture}/${params.get('variant') || 'default'}`;
    console.info(
      'ROOMS development fixture: local example data; no service integration certification.',
    );
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Boundary>
        <QueryClientProvider client={client}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </Boundary>
    </React.StrictMode>,
  );
}
void bootstrap();

import './minimal-room.css';
