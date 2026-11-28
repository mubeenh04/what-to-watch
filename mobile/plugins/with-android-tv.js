// Makes the Android build install and launch on Google TV / Android TV as well as on phones:
// - lists the app in the TV launcher (LEANBACK_LAUNCHER) with a 320x180 banner,
// - says a touchscreen isn't required and the TV (leanback) UI is supported but optional.
// The same APK runs on phones as before. The app picks its TV layout at run time (src/lib/tv.ts).
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const BANNER = 'tv_banner';

function addFeature(manifest, name) {
  manifest['uses-feature'] = manifest['uses-feature'] ?? [];
  if (!manifest['uses-feature'].some((f) => f.$['android:name'] === name)) {
    manifest['uses-feature'].push({ $: { 'android:name': name, 'android:required': 'false' } });
  }
}

const withTvManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    addFeature(manifest, 'android.software.leanback');
    addFeature(manifest, 'android.hardware.touchscreen');

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:banner'] = `@drawable/${BANNER}`;

    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const launcher = (activity['intent-filter'] ?? []).find((f) =>
      (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN'),
    );
    if (launcher) {
      launcher.category = launcher.category ?? [];
      if (!launcher.category.some((c) => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
        launcher.category.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
      }
    }
    return cfg;
  });

const withTvBanner = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets', 'tv-banner.png');
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable-xhdpi');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, path.join(dir, `${BANNER}.png`));
      return cfg;
    },
  ]);

module.exports = (config) => withTvBanner(withTvManifest(config));
