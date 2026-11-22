/**
 * Name, slogan and mark of the campaign. To change them, change them here, replace public/logo.png (a square with a
 * transparent background, because the mark also stands on the black of the high-contrast version) and app/favicon.ico,
 * and change apps/api/src/brand.ts, which signs the messages to keepers.
 */
export const BRAND = { name: "Mapa serc", slogan: "kierunek ratunek", logo: "/logo.png" } as const;

/**
 * Where the mobile app is downloaded from: a store page, a file or a repository. While it is empty, the header and
 * the page "O projekcie" mark the app as coming soon. Now the newest release on GitHub: an .apk for Android, with
 * the install steps on the release page (file names carry the version, so a direct file link would go stale).
 */
export const MOBILE_APP_URL: string = "https://github.com/Nullrunners/mapa-serca-mobile/releases/latest";
