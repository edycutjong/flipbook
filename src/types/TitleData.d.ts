import { MediaItem } from '../blocks/types';
import type { FlipbookTitleConfig } from '../flipbook/app/FlipbookContext';

export type MimeType =
  | 'text/plain'
  | 'text/vtt'
  | 'application/x-subtitle' // .srt
  | 'application/x-subtitle-vtt' // .vtt
  | 'application/x-subtitle-sami'
  | 'application/x-subtitle-tmplayer'
  | 'application/x-subtitle-mpl2'
  | 'application/x-subtitle-dks'
  | 'application/x-subtitle-qttext'
  | 'application/x-subtitle-lrc';

export type VideoFormat = 'MPD' | 'HLS' | 'MP4' | 'DASH';

interface TextTrack {
  label: string;
  language: string;
  uri: string;
  mimeType: MimeType;
}

export interface TitleData extends MediaItem {
  title: string;
  uri: string;
  categories: string[];
  channelID: string;
  posterUrl: string;
  format: string;
  descriptionType?: string;
  drm_scheme?: string;
  drm_license_uri?: string;
  textTrack?: TextTrack[];
  uhd: boolean;
  secure: boolean;
  acodec?: string;
  vcodec?: string;
  rentAmount: string;
  bifUrl?: string;
  thumbnailUrl?: string;
  /** Flipbook: score-change chapters from this title's BIF (see src/flipbook). */
  flipbook?: FlipbookTitleConfig;
}
