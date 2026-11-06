// Small first-party cookies for preferences (theme, analysis depth).
// Nothing here is sent anywhere: the site is static and has no server.

const YEAR = 60 * 60 * 24 * 365;

export function getCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function setCookie(name, value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${YEAR}; Path=/; SameSite=Lax${secure}`;
}

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("btnTheme");
  if (btn) {
    btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    document.getElementById("themeLabel").textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  setCookie("or_theme", next);
  return next;
}
