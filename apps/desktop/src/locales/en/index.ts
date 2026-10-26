import type { Catalog } from '@rooms/i18n';
import { assistant } from './assistant';
import { cinema } from './cinema';
import { core } from './core';
import { games } from './games';
import { main } from './main';
import { media } from './media';
import { settings } from './settings';
import { shell } from './shell';
import { social } from './social';
import { studio } from './studio';

/** Each group's catalog, kept apart so a key translated twice can be checked for agreement. */
export const enGroups: Readonly<Record<string, Catalog>> = {
  core,
  shell,
  social,
  media,
  settings,
  cinema,
  assistant,
  games,
  studio,
  main,
};

export const en: Catalog = Object.assign({}, ...Object.values(enGroups));
