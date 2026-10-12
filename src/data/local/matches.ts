import { DESCRIPTION_TYPES, VIDEO_FORMATS } from '../../constants/videoConstants';
import { FLIPBOOK_MEDIA_HOST } from '../../flipbook/media';
import { TitleData } from '../../types/TitleData';
import { REF_APPS_ASSETS_DOMAIN } from '../../utils/videoPlayerValues';
import { tile21 } from './images';

/**
 * Flipbook's "Matches" row (data only). Full-match replays from Belmont Media Center, released CC0 1.0 on the
 * Internet Archive — high-school matches, school marks belong to the schools. Plus Amazon's own BIF-backed title
 * from the sample, kept as a witness that the scan reads a BIF Flipbook did not make.
 */
export const getMatches = (): TitleData[] => [
  {
    id: 'fb-belmont-winchester-2023',
    title: 'Belmont vs Winchester · Girls Varsity',
    description:
      'Full match, 19 Sep 2023. Belmont Media Center, CC0 1.0. Press ⏩ to jump to the next score change without seeing it.',
    descriptionType: 'Full-match replay · BIF trickplay · Flipbook',
    mediaType: 'video',
    mediaSourceType: 'url',
    duration: 5168,
    thumbnail: `${FLIPBOOK_MEDIA_HOST}/winchester-2023/poster.jpg`,
    posterUrl: `${FLIPBOOK_MEDIA_HOST}/winchester-2023/poster.jpg`,
    uri: `${FLIPBOOK_MEDIA_HOST}/winchester-2023/match.mp4`,
    bifUrl: `${FLIPBOOK_MEDIA_HOST}/winchester-2023/match.bif`,
    categories: ['Matches'],
    channelID: '13453',
    rating: '',
    releaseDate: '09/23',
    format: VIDEO_FORMATS.MP4,
    uhd: false,
    secure: false,
    rentAmount: '0',
    flipbook: {
      source: 'belmont-media-center-2023',
      defaultRect: { x: 0.03, y: 0.03, w: 0.3, h: 0.08 },
    },
  },
  {
    id: 'fb-witness-tv-webinar',
    title: 'Witness: Amazon’s own BIF',
    description:
      'The sample’s “TV App Development” webinar and the BIF Amazon hosts for it. Flipbook chapters it by slide changes — proof the scan reads a file we did not make.',
    descriptionType: DESCRIPTION_TYPES.STANDARD_MP4_WITH_BIF,
    mediaType: 'video',
    mediaSourceType: 'url',
    duration: 4264,
    thumbnail: tile21,
    posterUrl: tile21,
    uri: `${REF_APPS_ASSETS_DOMAIN}/tv-webinar.mp4`,
    bifUrl: `${REF_APPS_ASSETS_DOMAIN}/tv-webinar-bif/tv-webinar-hd.bif`,
    categories: ['Matches'],
    channelID: '13453',
    rating: '',
    releaseDate: '09/20',
    format: VIDEO_FORMATS.MP4,
    uhd: false,
    secure: false,
    rentAmount: '0',
    flipbook: {
      source: 'witness-amazon-tv-webinar',
      // Whole slide area; every frame counts as "present", so each held slide change is a chapter.
      defaultRect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
      params: { tauAbs: 256 },
    },
  },
];
