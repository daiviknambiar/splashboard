// Regenerates app/data/sample-profile.json from the backend's SQLite cache.
// Run after (re)indexing or enriching the sample profile.
const USERNAME = process.argv[2] || 'heytowner';
const res = await fetch(`http://localhost:4000/api/profile/${USERNAME}/photos?per_page=8&order_by=popular`);
const data = await res.json();
const statusRes = await fetch(`http://localhost:4000/api/profile/${USERNAME}`);
const status = await statusRes.json();

const keep = (p) => ({
  id: p.id, urls: p.urls, links: p.links, user: p.user,
  alt_description: p.alt_description, description: p.description,
  color: p.color, width: p.width, height: p.height, score: 50,
});

const out = {
  user: {
    username: status.user.username,
    name: status.user.name,
    location: status.user.location ?? null,
    total_photos: status.totalPhotos,
    profile_image: status.user.profile_image,
    links: { html: status.user.links?.html },
  },
  clusters: status.clusters.map((c) => ({ label: c.label, count: c.count })),
  facets: data.facets,
  totalMatches: data.totalMatches,
  photos: data.photos.map(keep),
};

const fs = await import('node:fs');
fs.writeFileSync(new URL('../app/data/sample-profile.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('sample-profile.json rebuilt:', out.photos.length, 'photos,', out.facets.topLocations.length, 'locations,', out.facets.enrichedCount, 'enriched');
