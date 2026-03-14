/**
 * Beacon Extractor — pure browser JS
 * Extracts all tracker URLs from email HTML.
 * Same 6 types as the original GAS script.
 */

function extractPixels(html) {
  const urls = [];
  const imgs = html.match(/<img[^>]+>/gi) || [];
  for (const img of imgs) {
    const src = (img.match(/src=["']([^"']+)["']/i) || [])[1];
    if (!src || src.startsWith('data:') || src.startsWith('cid:')) continue;
    const isPixel =
      /width=["']?\s*[01]\s*["']?/i.test(img)  ||
      /height=["']?\s*[01]\s*["']?/i.test(img) ||
      /width:\s*[01]px/i.test(img)             ||
      /height:\s*[01]px/i.test(img)            ||
      /display:\s*none/i.test(img);
    if (isPixel) urls.push({ url: src, type: 'pixel' });
  }
  return urls;
}

function extractTrackedLinks(html) {
  const urls = [];
  const links = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
  for (const link of links) {
    const href = (link.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href || /^(mailto:|#|tel:)/i.test(href)) continue;
    const isTracked = /track|click|redirect|open\?|\/e\/|sendgrid|mailchimp|hubspot|klaviyo|convertkit|drip|activehosted|mailgun|sparkpost|constantcontact|marketo|salesforce|intercom|customer\.io|mandrillapp|myemma|sendinblue|pstmrk|getresponse|mailjet|yesware|mixmax|mailtrack|bananatag|superhuman|close\.com/i.test(href);
    if (isTracked) urls.push({ url: href, type: 'tracked-link' });
  }
  return urls;
}

function extractCssBeacons(html) {
  const urls = [];
  const matches = html.match(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi) || [];
  for (const css of matches) {
    const url = (css.match(/url\(["']?([^"')]+)["']?\)/i) || [])[1];
    if (!url || url.startsWith('data:')) continue;
    urls.push({ url, type: 'css-beacon' });
  }
  return urls;
}

function extractIframes(html) {
  const urls = [];
  const iframes = html.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
  for (const iframe of iframes) {
    const src = (iframe.match(/src=["']([^"']+)["']/i) || [])[1];
    if (src) urls.push({ url: src, type: 'iframe' });
  }
  return urls;
}

function extractPreloads(html) {
  const urls = [];
  const links = html.match(/<link[^>]+rel=["'](?:preload|prefetch)["'][^>]*>/gi) || [];
  for (const link of links) {
    const href = (link.match(/href=["']([^"']+)["']/i) || [])[1];
    if (href) urls.push({ url: href, type: 'preload' });
  }
  return urls;
}

function extractHiddenInputs(html) {
  const urls = [];
  const inputs = html.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || [];
  for (const input of inputs) {
    const value = (input.match(/value=["']([^"']+)["']/i) || [])[1];
    if (value?.startsWith('http')) urls.push({ url: value, type: 'hidden-input' });
  }
  return urls;
}

const TAG = '[Extractor]';

export function extractAllBeacons(html) {
  if (!html) return [];
  const results = [
    ...extractPixels(html),
    ...extractTrackedLinks(html),
    ...extractCssBeacons(html),
    ...extractIframes(html),
    ...extractPreloads(html),
    ...extractHiddenInputs(html),
  ];
  const byType = results.reduce((acc, b) => { acc[b.type] = (acc[b.type] || 0) + 1; return acc; }, {});
  console.log(`${TAG} Extracted ${results.length} beacons:`, byType);
  return results;
}
