// All Unsplash API access now goes through the backend proxy so the access
// key never ships in the client bundle. Photo *images* still load directly
// from the Unsplash CDN as required by their guidelines.
import { triggerDownload as proxyTriggerDownload } from './api';

export async function triggerDownload(downloadLocation: string): Promise<void> {
  try {
    await proxyTriggerDownload(downloadLocation);
  } catch (err) {
    console.warn('Unsplash download trigger failed:', err);
  }
}
