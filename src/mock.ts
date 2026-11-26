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

export interface HeroItem {
  id: string;
  title: string;
  subtitle: string;
  backdrop: string;
  appId: string;
}

export interface RowItem {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  color: string;
  backdrop?: string;
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
      id: 'hero-nordic-passage',
      title: 'Northern Passage',
      subtitle: '4K HDR · Direct Play from Living Room NAS · Resume at 42 min',
      backdrop: heroNordicFjord,
      appId: 'jellyfin',
    },
    {
      id: 'hero-orbital-horizon',
      title: 'Orbital Horizon',
      subtitle: 'Director’s Cut · 5.1 DTS-HD Master Audio · Sci-Fi Collection',
      backdrop: heroOrbitalHorizon,
      appId: 'kodi',
    },
    {
      id: 'hero-alpine-pass',
      title: 'Alpine Pass Rally',
      subtitle: 'Steam Play Proton · 1080p 60 fps · Controller Ready',
      backdrop: heroAlpineRally,
      appId: 'steam',
    },
    {
      id: 'hero-hifi-sessions',
      title: 'Late Night Sessions',
      subtitle: '24-bit / 96 kHz FLAC · Direct ALSA DAC · Acoustic Vault',
      backdrop: heroHifiStudio,
      appId: 'navidrome',
    },
  ],
  rows: [
    {
      title: 'Apps',
      items: [
        {
          id: 'jellyfin',
          name: 'Jellyfin',
          subtitle: 'Local Media Server',
          icon: jellyfinIcon,
          color: '#2563EB',
          backdrop: heroNordicFjord,
        },
        {
          id: 'kodi',
          name: 'Kodi',
          subtitle: 'Home Theater',
          icon: kodiIcon,
          color: '#0284C7',
          backdrop: heroOrbitalHorizon,
        },
        {
          id: 'steam',
          name: 'Steam Big Picture',
          subtitle: 'Linux Gaming',
          icon: steamIcon,
          color: '#1E40AF',
          backdrop: heroAlpineRally,
        },
        {
          id: 'retroarch',
          name: 'RetroArch',
          subtitle: 'Classic Consoles',
          icon: retroarchIcon,
          color: '#4F46E5',
        },
        {
          id: 'navidrome',
          name: 'Navidrome',
          subtitle: 'Lossless Music',
          icon: navidromeIcon,
          color: '#B45309',
          backdrop: heroHifiStudio,
        },
        {
          id: 'freetube',
          name: 'FreeTube',
          subtitle: 'Ad-Free Video',
          icon: '',
          color: '#B91C1C',
        },
        {
          id: 'moonlight',
          name: 'Moonlight',
          subtitle: 'LAN Game Stream',
          icon: '',
          color: '#0F766E',
          backdrop: heroAlpineRally,
        },
      ],
    },
    {
      title: 'Continue Watching',
      items: [
        {
          id: 'cw-northern-passage',
          name: 'Northern Passage',
          subtitle: 'Film · 38 min remaining',
          icon: '',
          color: '#1D4E6E',
          backdrop: heroNordicFjord,
        },
        {
          id: 'cw-orbital-horizon',
          name: 'Orbital Horizon',
          subtitle: 'Season 2 · Episode 4',
          icon: '',
          color: '#3730A3',
          backdrop: heroOrbitalHorizon,
        },
        {
          id: 'cw-timber-stone',
          name: 'Timber & Stone',
          subtitle: 'Documentary · 52 min left',
          icon: '',
          color: '#3F6212',
          backdrop: heroNordicFjord,
        },
        {
          id: 'cw-night-train',
          name: 'Night Train North',
          subtitle: 'Cinema · 1 hr 12 min left',
          icon: '',
          color: '#9A3412',
          backdrop: heroAlpineRally,
        },
        {
          id: 'cw-analog-acoustics',
          name: 'Analog Acoustics',
          subtitle: 'Series · Episode 2',
          icon: '',
          color: '#6B21A8',
          backdrop: heroHifiStudio,
        },
        {
          id: 'cw-arctic-drift',
          name: 'Arctic Drift',
          subtitle: 'Nature 4K · 24 min left',
          icon: '',
          color: '#0E7490',
          backdrop: heroNordicFjord,
        },
      ],
    },
    {
      title: 'Live & Channels',
      items: [
        {
          id: 'live-dvb',
          name: 'Live DVB-T2',
          subtitle: 'TVHeadend Tuner',
          icon: tvIcon,
          color: '#0369A1',
        },
        {
          id: 'radio-streams',
          name: 'FIP & Radio',
          subtitle: 'Lossless Web Streams',
          icon: radioIcon,
          color: '#C2410C',
        },
        {
          id: 'home-cameras',
          name: 'Home Cameras',
          subtitle: 'Local RTSP Feeds',
          icon: '',
          color: '#334155',
        },
        {
          id: 'podcasts',
          name: 'Podcasts',
          subtitle: '3 New Episodes',
          icon: '',
          color: '#6D28D9',
        },
        {
          id: 'ambient-loops',
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
          name: 'NAS Library',
          subtitle: 'SMB · 14.2 TB Free',
          icon: nasIcon,
          color: '#1D4ED8',
        },
        {
          id: 'pipewire-audio',
          name: 'PipeWire Audio',
          subtitle: 'HDMI Passthrough',
          icon: '',
          color: '#047857',
        },
        {
          id: 'controllers',
          name: 'Controllers',
          subtitle: '2 Gamepads Paired',
          icon: '',
          color: '#4338CA',
        },
        {
          id: 'display-refresh',
          name: 'Display & Refresh',
          subtitle: '1080p · 60 Hz Output',
          icon: '',
          color: '#475569',
        },
        {
          id: 'system-shell',
          name: 'System Shell',
          subtitle: 'Linux · Wayland Session',
          icon: '',
          color: '#1E293B',
        },
      ],
    },
  ],
};

export default mockData;
