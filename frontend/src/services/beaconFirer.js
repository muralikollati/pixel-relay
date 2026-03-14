/**
 * Beacon Firer — fires tracker URLs directly from the user's browser
 *
 * Strategy per type:
 *   pixel → new Image().src   (no CORS, no preflight, fires even on 404)
 *   all others → fetch no-cors (follows redirect chain)
 *
 * Requests originate from the user's real browser IP.
 * Trackers see a genuine open — not a VPS/bot IP.
 */

const TIMEOUT_MS = 8000;
const TAG        = '[BeaconFirer]';

function fireWithImage(url) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`${TAG} TIMEOUT (img): ${url.slice(0, 80)}`);
      resolve(false);
    }, TIMEOUT_MS);

    const img   = new Image();
    img.onload  = () => { clearTimeout(timer); console.log(`${TAG} ✓ img fired: ${url.slice(0, 80)}`); resolve(true); };
    img.onerror = () => { clearTimeout(timer); console.log(`${TAG} ✓ img fired (4xx ok): ${url.slice(0, 80)}`); resolve(true); }; // error = request still sent
    img.src = url;
  });
}

function fireWithFetch(url) {
  return Promise.race([
    fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store' })
      .then(() => { console.log(`${TAG} ✓ fetch fired: ${url.slice(0, 80)}`); return true; })
      .catch((err) => { console.warn(`${TAG} ✗ fetch failed: ${url.slice(0, 80)} —`, err.message); return false; }),
    new Promise(resolve => setTimeout(() => {
      console.warn(`${TAG} TIMEOUT (fetch): ${url.slice(0, 80)}`);
      resolve(false);
    }, TIMEOUT_MS)),
  ]);
}

function fireOne(beacon) {
  if (beacon.type === 'pixel') return fireWithImage(beacon.url);
  return fireWithFetch(beacon.url);
}

/**
 * Fire all beacons concurrently.
 * Returns { fired, total }
 */
export async function fireAllBeacons(beacons) {
  if (!beacons || beacons.length === 0) return { fired: 0, total: 0 };

  console.log(`${TAG} Firing ${beacons.length} beacons concurrently...`);
  const results = await Promise.allSettled(beacons.map(b => fireOne(b)));
  const fired   = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  console.log(`${TAG} Done — ${fired}/${beacons.length} fired successfully`);

  return { fired, total: beacons.length };
}
