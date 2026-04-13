export interface VisualDescriptors {
  locationType: string;
  lightingConditions: string;
  colorPalette: string;
  mood: string;
  framing: string;
  architectureStyle?: string | null;
  searchTerms: string[];
}

export interface UnsplashExif {
  make: string | null;
  model: string | null;
  focal_length: string | null;
  aperture: string | null;
  exposure_time: string | null;
  iso: number | null;
}

export interface UnsplashPhoto {
  id: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    html: string;
    download: string;
    download_location: string;
  };
  user: {
    name: string;
    username: string;
    links: {
      html: string;
    };
  };
  alt_description: string | null;
  description: string | null;
  color: string | null;
  tags?: Array<{ title: string }>;
  exif?: UnsplashExif;
  width: number;
  height: number;
}

export interface RankedPhoto extends UnsplashPhoto {
  score: number;
}

export type Mode = 'moodboard' | 'stealthisshot';

export type SearchStatus =
  | 'idle'
  | 'analyzing'
  | 'searching'
  | 'done'
  | 'error';

export interface UsageSummary {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  isLimited: boolean;
  usingOwnApiKey?: boolean;
}
