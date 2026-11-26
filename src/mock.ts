import heroNordicFjord from './assets/images/hero_nordic_fjord_1795653338547.jpg';
import heroOrbitalHorizon from './assets/images/hero_orbital_horizon_1795653339988.jpg';
import heroAlpineRally from './assets/images/hero_alpine_rally_1795653341379.jpg';
import heroHifiStudio from './assets/images/hero_hifi_studio_1795653342650.jpg';

import jellyfinIcon from './assets/icons/jellyfin.svg';
import kodiIcon from './assets/icons/kodi.svg';
import steamIcon from './assets/icons/steam.svg';
import retroarchIcon from './assets/icons/retroarch.svg';
import navidromeIcon from './assets/icons/navidrome.svg';
import tvIcon from './assets/icons/tv.svg';
import radioIcon from './assets/icons/radio.svg';
import nasIcon from './assets/icons/nas.svg';
import storeIcon from './assets/icons/store.svg';
import northernPassageLogo from './assets/logos/northern-passage.svg';

export type ItemKind = 'app' | 'media';

export interface HeroItem {
  id: string;
  kind?: ItemKind;
  title: string;
  subtitle: string;
  backdrop: string;
  backdropFallback?: string;
  appId: string;
  eyebrow?: string;
  progress?: number;
  logo?: string;
}

export interface RowItem {
  id: string;
  kind?: ItemKind;
  name: string;
  subtitle: string;
  icon: string;
  color: string;
  backdrop?: string;
  poster?: string;
  progress?: number;
  previews?: HeroItem[];
}

export interface ContentRow {
  title: string;
  items: RowItem[];
}

export interface MockData {
  hero: HeroItem[];
  rows: ContentRow[];
}

export const mockData: MockData = {
  hero: [
    {
      id: 'cw-northern-passage',
      kind: 'media',
      eyebrow: 'Continue watching in Nuvio',
      title: 'Northern Passage',
      subtitle: '4K HDR · 38 min left',
      backdrop: heroNordicFjord,
      logo: northernPassageLogo,
      progress: 0.64,
      appId: 'nuvio',
    },
    {
      id: 'cw-orbital-horizon-s1e2',
      kind: 'media',
      eyebrow: 'Continue watching in Nuvio',
      title: 'Orbital Horizon',
      subtitle: 'S1:E2 · Pilot · 30 min left',
      backdrop: heroOrbitalHorizon,
      logo: '',
      progress: 0.42,
      appId: 'nuvio',
    },
    {
      id: 'hero-alpine-pass',
      kind: 'app',
      title: 'Alpine Pass Rally',
      subtitle: 'Steam Play Proton · 1080p 60 fps · Controller Ready',
      backdrop: heroAlpineRally,
      appId: 'steam',
    },
    {
      id: 'hero-hifi-sessions',
      kind: 'app',
      title: 'Late Night Sessions',
      subtitle: '24-bit / 96 kHz FLAC · Direct ALSA DAC · Acoustic Vault',
      backdrop: heroHifiStudio,
      appId: 'navidrome',
    },
  ],
  rows: [
    {
      title: 'Continue watching',
      items: [
        {
          id: 'cw-northern-passage',
          kind: 'media',
          name: 'Northern Passage',
          subtitle: 'Film · 38 min left',
          icon: '',
          color: '#1D4E6E',
          backdrop: heroNordicFjord,
          poster: heroNordicFjord,
          progress: 0.64,
        },
        {
          id: 'cw-orbital-horizon-s1e2',
          kind: 'media',
          name: 'Orbital Horizon',
          subtitle: 'S1:E2 · Pilot · 30 min left',
          icon: '',
          color: '#3730A3',
          backdrop: heroOrbitalHorizon,
          poster: heroOrbitalHorizon,
          progress: 0.42,
        },
      ],
    },
    {
      title: 'Apps',
      items: [
        {
          id: 'nuvio',
          kind: 'app',
          name: 'Nuvio',
          subtitle: 'Movies & Series',
          icon: '',
          color: '#7C3AED',
          previews: [
            {
              id: 'preview-nuvio-northern',
              appId: 'nuvio',
              kind: 'media',
              eyebrow: 'Continue watching in Nuvio',
              title: 'Northern Passage',
              subtitle: '4K HDR · 38 min left',
              backdrop: heroNordicFjord,
              backdropFallback: heroNordicFjord,
              logo: northernPassageLogo,
              progress: 0.64,
            },
            {
              id: 'preview-nuvio-orbital',
              appId: 'nuvio',
              kind: 'media',
              eyebrow: 'Continue watching in Nuvio',
              title: 'Orbital Horizon',
              subtitle: 'S1:E2 · Pilot · 30 min left',
              backdrop: heroOrbitalHorizon,
              backdropFallback: heroOrbitalHorizon,
              logo: '',
              progress: 0.42,
            },
            {
              id: 'preview-nuvio-alpine',
              appId: 'nuvio',
              kind: 'media',
              eyebrow: 'Trending on Nuvio',
              title: 'Alpine Pass',
              subtitle: '2026 · Adventure · 2h 04m',
              backdrop: heroAlpineRally,
              backdropFallback: heroAlpineRally,
              logo: '',
            },
          ],
        },
        {
          id: 'youtube',
          kind: 'app',
          name: 'YouTube',
          subtitle: 'Videos & Channels',
          icon: '',
          color: '#DC2626',
          previews: [
            {
              id: 'preview-yt-hifi',
              appId: 'youtube',
              kind: 'media',
              eyebrow: 'Recommended on YouTube',
              title: 'Building a Silent 4K Living Room HTPC',
              subtitle: 'Audio & Hardware · 18 min',
              backdrop: heroHifiStudio,
              backdropFallback: heroHifiStudio,
              logo: '',
            },
            {
              id: 'preview-yt-rally',
              appId: 'youtube',
              kind: 'media',
              eyebrow: 'Subscriptions · YouTube',
              title: 'Alpine Rally Onboard in 4K 60fps',
              subtitle: 'Motorsport Vault · 12 min',
              backdrop: heroAlpineRally,
              backdropFallback: heroAlpineRally,
              logo: '',
            },
            {
              id: 'preview-yt-fjord',
              appId: 'youtube',
              kind: 'media',
              eyebrow: '4K Nature · YouTube',
              title: 'Crossing the Arctic Fjord at Dawn',
              subtitle: 'Nordic Cinema · 24 min',
              backdrop: heroNordicFjord,
              backdropFallback: heroNordicFjord,
              logo: '',
            },
          ],
        },
        {
          id: 'jellyfin',
          kind: 'app',
          name: 'Jellyfin',
          subtitle: 'Local Media Server',
          icon: jellyfinIcon,
          color: '#2563EB',
          backdrop: heroNordicFjord,
        },
        {
          id: 'kodi',
          kind: 'app',
          name: 'Kodi',
          subtitle: 'Home Theater',
          icon: kodiIcon,
          color: '#0284C7',
          backdrop: heroOrbitalHorizon,
        },
        {
          id: 'steam',
          kind: 'app',
          name: 'Steam Big Picture',
          subtitle: 'Linux Gaming',
          icon: steamIcon,
          color: '#1E40AF',
          backdrop: heroAlpineRally,
        },
        {
          id: 'retroarch',
          kind: 'app',
          name: 'RetroArch',
          subtitle: 'Classic Consoles',
          icon: retroarchIcon,
          color: '#4F46E5',
        },
        {
          id: 'navidrome',
          kind: 'app',
          name: 'Navidrome',
          subtitle: 'Lossless Music',
          icon: navidromeIcon,
          color: '#B45309',
          backdrop: heroHifiStudio,
        },
        {
          id: 'freetube',
          kind: 'app',
          name: 'FreeTube',
          subtitle: 'Ad-Free Video',
          icon: '',
          color: '#B91C1C',
        },
        {
          id: 'moonlight',
          kind: 'app',
          name: 'Moonlight',
          subtitle: 'LAN Game Stream',
          icon: '',
          color: '#0F766E',
          backdrop: heroAlpineRally,
        },
      ],
    },
    {
      title: 'Live & Channels',
      items: [
        {
          id: 'live-dvb',
          kind: 'app',
          name: 'Live DVB-T2',
          subtitle: 'TVHeadend Tuner',
          icon: tvIcon,
          color: '#0369A1',
        },
        {
          id: 'radio-streams',
          kind: 'app',
          name: 'FIP & Radio',
          subtitle: 'Lossless Web Streams',
          icon: radioIcon,
          color: '#C2410C',
        },
        {
          id: 'home-cameras',
          kind: 'app',
          name: 'Home Cameras',
          subtitle: 'Local RTSP Feeds',
          icon: '',
          color: '#334155',
        },
        {
          id: 'podcasts',
          kind: 'app',
          name: 'Podcasts',
          subtitle: '3 New Episodes',
          icon: '',
          color: '#6D28D9',
        },
        {
          id: 'ambient-loops',
          kind: 'app',
          name: 'Fireplace & Rain',
          subtitle: 'Ambient 4K Loop',
          icon: '',
          color: '#92400E',
        },
      ],
    },
    {
      title: 'HTPC System',
      items: [
        {
          id: 'nas-library',
          kind: 'app',
          name: 'NAS Library',
          subtitle: 'SMB · 14.2 TB Free',
          icon: nasIcon,
          color: '#1D4ED8',
        },
        {
          id: 'pipewire-audio',
          kind: 'app',
          name: 'PipeWire Audio',
          subtitle: 'HDMI Passthrough',
          icon: '',
          color: '#047857',
        },
        {
          id: 'controllers',
          kind: 'app',
          name: 'Controllers',
          subtitle: '2 Gamepads Paired',
          icon: '',
          color: '#4338CA',
        },
        {
          id: 'display-refresh',
          kind: 'app',
          name: 'Display & Refresh',
          subtitle: '1080p · 60 Hz Output',
          icon: '',
          color: '#475569',
        },
        {
          id: 'system-shell',
          kind: 'app',
          name: 'System Shell',
          subtitle: 'Linux · Wayland Session',
          icon: '',
          color: '#1E293B',
        },
      ],
    },
  ],
};

export type StoreJobAction = 'install' | 'remove';
export type StoreJobState = 'queued' | 'running' | 'done' | 'failed';

export interface StoreJob {
  action: StoreJobAction;
  state: StoreJobState;
  message: string;
}

export interface StoreItem {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  category: string;
  color: string;
  icon: string;
  installed: boolean;
  job: StoreJob | null;
}

export interface StorePayload {
  items: StoreItem[];
}

export const STORE_CARD_ID = 'store';

export const storeCardItem: RowItem = {
  id: STORE_CARD_ID,
  kind: 'app',
  name: 'Store',
  subtitle: 'Browse & Install Apps',
  icon: storeIcon,
  color: '#0284C7',
};

export const mockStoreData: StorePayload = {
  items: [
    // Watch
    {
      id: 'jellyfin',
      name: 'Jellyfin',
      subtitle: 'Local Media Server',
      description:
        'Stream movies, TV series, and live broadcasts directly from your home NAS with hardware-accelerated VA-API decoding on Intel graphics.',
      category: 'Watch',
      color: '#2563EB',
      icon: jellyfinIcon,
      installed: true,
      job: null,
    },
    {
      id: 'kodi',
      name: 'Kodi',
      subtitle: 'Home Theater',
      description:
        'Full-featured 10-foot media center supporting local libraries, 4K HDR playback, passthrough surround sound, and community add-ons.',
      category: 'Watch',
      color: '#0284C7',
      icon: kodiIcon,
      installed: true,
      job: null,
    },
    {
      id: 'freetube',
      name: 'FreeTube',
      subtitle: 'Private Video Client',
      description:
        'Watch online video subscriptions from the couch with zero tracking, local subscription storage, and clean keyboard/remote playback.',
      category: 'Watch',
      color: '#B91C1C',
      icon: '',
      installed: false,
      job: {
        action: 'install',
        state: 'running',
        message: 'Installing FreeTube Flatpak runtime…',
      },
    },
    {
      id: 'mpv-cinema',
      name: 'MPV Cinema',
      subtitle: 'Reference Player',
      description:
        'Minimalist high-precision video player tuned for 24p frame pacing, crisp subtitle rendering, and low-overhead GPU scaling.',
      category: 'Watch',
      color: '#4C1D95',
      icon: '',
      installed: false,
      job: null,
    },
    {
      id: 'live-dvb',
      name: 'Live DVB-T2',
      subtitle: 'TVHeadend Tuner',
      description:
        'Watch and record over-the-air broadcasts with full electronic program guide support via your local TVHeadend tuner.',
      category: 'Watch',
      color: '#0369A1',
      icon: tvIcon,
      installed: true,
      job: null,
    },

    // Music
    {
      id: 'navidrome',
      name: 'Navidrome',
      subtitle: 'Lossless Music',
      description:
        'Browse and play your personal FLAC and hi-res audio collection with gapless playback and bit-perfect PipeWire output.',
      category: 'Music',
      color: '#B45309',
      icon: navidromeIcon,
      installed: true,
      job: null,
    },
    {
      id: 'radio-streams',
      name: 'FIP & Radio',
      subtitle: 'Curated Web Radio',
      description:
        'Listen to ad-free international public radio and lossless internet streams optimized for living-room speakers.',
      category: 'Music',
      color: '#C2410C',
      icon: radioIcon,
      installed: true,
      job: null,
    },
    {
      id: 'spotube',
      name: 'Spotube',
      subtitle: 'Open Audio Streamer',
      description:
        'Lightweight open-source music client with synced lyrics, playlists, and clean remote-friendly queue controls.',
      category: 'Music',
      color: '#047857',
      icon: '',
      installed: false,
      job: null,
    },
    {
      id: 'podcast-deck',
      name: 'Podcast Deck',
      subtitle: 'Audio & Video Feeds',
      description:
        'Subscribe to RSS podcast feeds with automatic overnight downloads and living-room chapter skipping.',
      category: 'Music',
      color: '#6D28D9',
      icon: '',
      installed: false,
      job: null,
    },

    // Play
    {
      id: 'steam',
      name: 'Steam Big Picture',
      subtitle: 'Linux Gaming',
      description:
        'Launch your PC game library in controller-first mode with Steam Play Proton, shader pre-caching, and wireless gamepad profiles.',
      category: 'Play',
      color: '#1E40AF',
      icon: steamIcon,
      installed: true,
      job: null,
    },
    {
      id: 'retroarch',
      name: 'RetroArch',
      subtitle: 'Classic Consoles',
      description:
        'Unified frontend for classic console cores with low-latency run-ahead, CRT shaders, and automatic controller mapping.',
      category: 'Play',
      color: '#4F46E5',
      icon: retroarchIcon,
      installed: true,
      job: null,
    },
    {
      id: 'moonlight',
      name: 'Moonlight',
      subtitle: 'LAN Game Stream',
      description:
        'Stream low-latency 1080p/4K 60 fps games from a desktop PC on your local network using Sunshine with hardware decoding.',
      category: 'Play',
      color: '#0F766E',
      icon: '',
      installed: false,
      job: null,
    },
    {
      id: 'heroic-games',
      name: 'Heroic Launcher',
      subtitle: 'GOG & Epic Games',
      description:
        'Native Linux launcher for GOG, Epic, and Amazon game libraries with Wine/Proton management and gamepad navigation.',
      category: 'Play',
      color: '#1D4ED8',
      icon: '',
      installed: false,
      job: null,
    },

    // Web
    {
      id: 'couch-browser',
      name: 'Couch Web',
      subtitle: '10-Foot Browser',
      description:
        'Fullscreen Wayland web browser tuned for TV viewing with large zoom defaults, ad blocking, and controller scrolling.',
      category: 'Web',
      color: '#0E7490',
      icon: '',
      installed: false,
      job: null,
    },
    {
      id: 'home-dashboard',
      name: 'Home Assistant',
      subtitle: 'Smart Home View',
      description:
        'Check living-room climate, lighting scenes, and local RTSP cameras right on the TV without leaving the couch.',
      category: 'Web',
      color: '#0369A1',
      icon: nasIcon,
      installed: false,
      job: null,
    },
    {
      id: 'weather-radar',
      name: 'Sky Radar',
      subtitle: 'Local Forecast',
      description:
        'High-contrast 10-foot local weather overview with hourly temperature curves and regional radar playback.',
      category: 'Web',
      color: '#334155',
      icon: '',
      installed: false,
      job: null,
    },
  ],
};

export default mockData;
