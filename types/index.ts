export interface VisualDescriptors {
  locationType: string;
  lightingConditions: string;
  colorPalette: string;
  mood: string;
  framing: string;
  architectureStyle?: string | null;
  searchTerms: string[];
}

export interface QueryPlanItem {
  query: string;
  color?: string;
  orientation?: string;
  weight: number;
}

export interface UnsplashExif {
  make: string | null;
  model: string | null;
  focal_length: string | null;
  aperture: string | null;
  exposure_time: string | null;
  iso: number | null;
}

export interface UnsplashLocation {
  name?: string | null;
  city?: string | null;
  country?: string | null;
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
  created_at?: string;
  likes?: number;
  tags?: Array<{ title: string }>;
  exif?: UnsplashExif;
  location?: UnsplashLocation | null;
  topics?: string[];
  locationName?: string | null;
  width: number;
  height: number;
}

export interface RankedPhoto extends UnsplashPhoto {
  score: number;
}

export type Mode = 'moodboard' | 'stealthisshot' | 'profile';

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
  globalLimited?: boolean;
  usingOwnApiKey?: boolean;
}

export interface ProfileUser {
  username: string;
  name: string;
  bio?: string | null;
  location?: string | null;
  total_photos?: number;
  profile_image?: {
    small: string;
    medium: string;
    large?: string;
  };
  links?: {
    html: string;
  };
}

export interface ProfileCluster {
  label: string;
  keywords: string[];
  count: number;
}

export interface ProfileStatus {
  user: ProfileUser;
  totalPhotos: number;
  indexedCount: number;
  indexComplete: boolean;
  clustersReady: boolean;
  clusters: ProfileCluster[];
  rate?: { limit: number | null; remaining: number | null };
}

export interface ProfileFacets {
  dateHistogram: Array<{ month: string; count: number }>;
  topLocations: Array<{ name: string; count: number }>;
  enrichedCount: number;
  totalIndexed: number;
}
