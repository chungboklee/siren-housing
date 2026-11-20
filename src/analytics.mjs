const { gaId, gaOrigin } = document.querySelector('script[data-ga-id]').dataset;
if (location.origin === gaOrigin) startAnalytics(gaId);

function startAnalytics(id) {
  const pageLocation = location.origin + location.pathname;
  const referrer = document.referrer ? new URL(document.referrer) : null;
  const pageReferrer = referrer && ['https:', 'http:'].includes(referrer.protocol)
    ? referrer.origin
    : '';
  const fromChatGPT = new URLSearchParams(location.search).get('utm_source') === 'chatgpt.com';

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }

  gtag('js', new Date());
  gtag('config', id, {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    ...(fromChatGPT ? { campaign_source: 'chatgpt.com', campaign_medium: 'referral' } : {}),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  function trackLink(event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('a[data-analytics-event]');
    if (!link) return;

    const params = { link_domain: new URL(link.href).hostname };
    if (link.dataset.rssRegion) params.rss_region = link.dataset.rssRegion;
    gtag('event', link.dataset.analyticsEvent, params);
  }

  document.addEventListener('click', trackLink);
  document.addEventListener('auxclick', trackLink);

  const tag = document.createElement('script');
  tag.async = true;
  tag.referrerPolicy = 'strict-origin';
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.append(tag);
}
