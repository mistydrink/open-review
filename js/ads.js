// Side ad rails. Ads only ever appear in these two fixed slots beside the
// board: no pop-ups, no overlays, no interstitials, no autoplay.
//
// To show real ads, sign up with an ad network (for example Google AdSense),
// then fill in your publisher ID and one ad-slot ID per rail below.
// Ad networks set their own cookies; check their rules for showing a
// consent notice in your region before switching ads on.
// Until then each rail shows a quiet placeholder.

export const ADS = {
  adsenseClient: "", // e.g. "ca-pub-1234567890123456"
  slots: { adLeft: "", adRight: "" }, // e.g. "1234567890"
};

const WIDE = "(min-width: 1440px)";

function placeholder(slot) {
  slot.innerHTML =
    '<p class="ad-label">Advertisement</p>' +
    '<div class="ad-placeholder"><strong>Ad space</strong><span>160 × 600</span></div>';
}

function adsense(slot, slotId) {
  slot.innerHTML =
    '<p class="ad-label">Advertisement</p>' +
    `<ins class="adsbygoogle" style="display:block;width:160px;height:600px" data-ad-client="${ADS.adsenseClient}" data-ad-slot="${slotId}"></ins>`;
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

let mounted = false;

export function mountAds() {
  // Rails are hidden on smaller screens; don't load anything there.
  if (mounted || !window.matchMedia(WIDE).matches) return;
  mounted = true;
  const useNetwork = ADS.adsenseClient && Object.values(ADS.slots).some(Boolean);
  if (useNetwork) {
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + ADS.adsenseClient;
    document.head.appendChild(s);
  }
  for (const [id, slotId] of Object.entries(ADS.slots)) {
    const slot = document.getElementById(id);
    if (!slot) continue;
    if (useNetwork && slotId) adsense(slot, slotId);
    else placeholder(slot);
  }
}

export function watchAds() {
  mountAds();
  window.matchMedia(WIDE).addEventListener("change", mountAds);
}
